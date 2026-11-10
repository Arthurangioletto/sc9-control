const { test } = require('node:test');
const assert = require('node:assert/strict');
const expiry = require('../expiry-panel.js');
const stock = require('../stock-position.js');
const filters = require('../lot-filters.js');

const today = expiry.day('2026-11-10');
const row = (armazem, dtValidade, extra) => ({
  produto: '4930', lote: '6068930', filial: '01', armazem, dtValidade, saldo: 1, ...extra
});
const analyze = (rows, filial, warehouse, day = today) => filters.validityAnalysis(rows, filial, warehouse, day);

test('saldo no 16 prioriza o lote mesmo com datas futuras iguais ou ausentes', () => {
  const rows = [
    row('RJ', '2067-11-15', { filial: '02' }), row('016', '2067-11-15'),
    row('01', null), row('20', '2067-11-15', { saldo: 0 }),
    row('T1', '2067-11-27', { saldo: -1 }), row('RT', '2067-11-27', { produto: 'OUTRO' })
  ];
  const [group] = analyze(rows, '2', 'RJ');
  assert.equal(group.reason, 'arm16');
  assert.deepEqual(group.registros.map(item => item.armazem), ['016', 'RJ', '01']);
  assert.deepEqual(analyze(rows, '1', '20'), []);
  assert.deepEqual(analyze([rows[1], rows[3], rows[5]]), []);
});

test('sem o 16, compara datas de locais com saldo e aplica a janela inclusiva de 90 dias', () => {
  const far = row('RJ', '2027-09-10');
  const soon = row('01', '2027-02-08');
  const rows = [soon, far, row('16', '2026-11-01', { saldo: 0 })];
  assert.equal(analyze(rows)[0].reason, 'upcoming');
  assert.deepEqual(analyze(rows, '', '', today - 1), []);
  assert.equal(analyze([row('01', '2026-11-09'), far])[0].reason, 'expired');
  assert.deepEqual(analyze([soon, row('RJ', soon.dtValidade)]), []);
  assert.deepEqual(analyze([soon, { ...far, armazem: '1' }, row('RJ', null)]), []);
  assert.deepEqual(analyze([soon, { ...far, lote: 'OUTRO' }]), []);
});

test('lote ausente da última importação fica guardado, mas sai da análise de validade', () => {
  const first = '2026-11-09T12:00:00.000Z', last = '2026-11-10T12:00:00.000Z';
  const lot = { produto: '30301', lote: '129027' };
  const arm01 = row('01', '2026-06-20', { ...lot, saldo: 3 });
  const arm16 = row('16', '2026-06-20', { ...lot, saldo: 4 });
  const previous = stock.update(null, [arm01, arm16], { now: first }).position;
  const current = stock.update(previous, [arm16], { now: last }).position;
  const confirmed = position => stock.confirmedRows(stock.hydrate(position), position);
  assert.equal(analyze(confirmed(previous))[0].reason, 'arm16');
  assert.equal(current.rows.find(item => item.armazem === '1').saldo, 3);
  assert.deepEqual(confirmed(current).map(item => item.saldo), [4]);
  assert.deepEqual(analyze(confirmed(current)), []);
  const restored = { ...current, importedAt: stock.importTimestamp(current),
    updatedAt: '2026-11-11T12:00:00.000Z', source: { backup: 'backup' } };
  assert.deepEqual(confirmed(restored), confirmed(current));
  assert.equal(filters.validityDate(confirmed(restored)[0].dtValidade), '20/06/2026');
});
