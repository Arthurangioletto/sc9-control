const { test } = require('node:test');
const assert = require('node:assert/strict');
const expiry = require('../expiry-panel.js');
require('../inventory-integrity.js');
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

test('achados salvos recuperam referências disponíveis sem duplicar a mesma posição', () => {
  const overdue = row('16', '2026-11-01'), far = row('RJ', '2067-11-15');
  const rows = filters.savedValidityRows([
    { tipo: 'validadeVariavel', dados: { registros: [overdue, far] } },
    { tipo: 'vencimento', dados: overdue }
  ]);
  assert.equal(analyze(rows)[0].registros.length, 2);
  assert.equal(filters.validityDate(rows[1].dtValidade), '15/11/2067');
});
