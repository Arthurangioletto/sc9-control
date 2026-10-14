const test = require('node:test');
const assert = require('node:assert/strict');
const { records, findings } = require('../lot-filters.js');
const rows = [
  { filial: '01', lote: 'CB', saldo: 5 },
  { filial: 1, lote: 'CB2', saldo: 3 },
  { filial: '03', lote: 'TB', saldo: 7 },
  { filial: 3, lote: 'TB2', saldo: -1 },
  { filial: '', lote: 'SEM' },
  { filial: '04', lote: 'OUTRA' }
];
test('normaliza códigos numéricos de filial sem confundir unidades', () => {
  assert.deepEqual(records(rows, '1').map(row => row.lote), ['CB', 'CB2']);
  assert.deepEqual(records(rows, '03').map(row => row.lote), ['TB', 'TB2']);
  assert.strictEqual(records(rows, ''), rows);
  assert.equal(records(rows, '04').length, 1);
});
test('filtra achados agrupados e individuais sem modificar o histórico completo', () => {
  const saved = [
    { tipo: 'duplicado', dados: { lote: 'MISTO', registros: rows.slice(0, 4) }, historicoSaldo: [{ data: '2026-10-14' }] },
    { tipo: 'saldoNegativo', dados: rows[3] },
    { tipo: 'saldoNegativo', dados: rows[4] }
  ];
  const scoped = findings(saved, '01');
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].dados.registros.length, 2);
  assert.equal(scoped[0].historicoSaldo.length, 1);
  assert.equal(findings(saved, '3').length, 2);
  assert.equal(saved[0].dados.registros.length, 4);
  assert.strictEqual(findings(saved, ''), saved);
});
test('saldo ativo de um achado filtrado considera apenas a unidade selecionada', () => {
  const saved = [{ dados: { registros: [{ filial: '01', saldo: 0 }, { filial: '03', saldo: 8 }], temSaldoAtivo: true } }];
  assert.equal(findings(saved, '01')[0].dados.temSaldoAtivo, false);
  assert.equal(findings(saved, '03')[0].dados.temSaldoAtivo, true);
});

test('lista todos os armazéns da unidade, sem depender do saldo, e ordena códigos', () => {
  const { warehouses } = require('../lot-filters.js');
  const data = [
    { filial: '01', produto: 'P1', armazem: '01', saldo: 5 },
    { filial: '01', produto: 'P1', armazem: '02', saldo: 0 },
    { filial: 1, produto: 'P1', armazem: 10, saldo: -1 },
    { filial: '01', produto: 'P1', armazem: 2 },
    { filial: '03', produto: 'P1', armazem: '03' },
    { filial: '01', produto: 'P1', armazem: '' }
  ];
  assert.deepEqual(warehouses(data, [], '01'), ['1', '2', '10']);
  assert.deepEqual(warehouses(data, [], '03'), ['3']);
  assert.deepEqual(warehouses(data, [], ''), ['1', '2', '3', '10']);
});
test('recupera armazéns dos achados salvos, agrupados ou individuais', () => {
  const { warehouses } = require('../lot-filters.js');
  const saved = [
    { dados: { registros: [{ filial: '01', armazem: '01' }, { filial: '01', armazem: '59' }] } },
    { dados: { filial: '01', armazem: '02' } },
    { dados: { filial: '03', armazem: '03' } }
  ];
  assert.deepEqual(warehouses([], saved, '1'), ['1', '2', '59']);
  assert.deepEqual(warehouses([], saved, '3'), ['3']);
  assert.deepEqual(warehouses([{ filial: '01', armazem: '90' }], saved, '1'), ['90']);
});
