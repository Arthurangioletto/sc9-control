const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../entradas-tdc.js');

const linha = (nota, produto, lote, qt, armazem) => ({ nota, serie: '1', fornecedor: 'F', produto, lote, qt, armazem, dtDigit: '2026-11-10', emissao: '2026-11-09', usuario: 'u', hora: '10:00', cfop: '1102', tipo: '001', validade: '' });

test('a análise completa fica guardada: trocar as notas em conferência só filtra', () => {
  const sd1 = [linha('100', 'P1', 'L1', 5, '59'), linha('200', 'P2', 'L2', 3, '59')];
  const sd3 = [];
  const ign = new Set();
  const a = M.analisar(sd1, sd3, { ignorar: ign, notas: [{ nota: '100', serie: '1' }] });
  const b = M.analisar(sd1, sd3, { ignorar: ign, notas: [{ nota: '200', serie: '1' }] });
  assert.deepEqual(a.itens.map((i) => i.nota), ['100']);
  assert.deepEqual(b.itens.map((i) => i.nota), ['200']);
  assert.equal(a.cobertura, b.cobertura, 'mesma análise reaproveitada (não refez)');
  const todas = M.analisar(sd1, sd3, { ignorar: ign });
  assert.equal(todas.itens.length, 2);
  assert.equal(todas.cobertura, a.cobertura);
  const outraFicha = M.analisar(sd1, sd3, { ignorar: new Set(['x']), notas: [{ nota: '100', serie: '1' }] });
  assert.notEqual(outraFicha.cobertura, a.cobertura, 'mudou a lista de fichas descartadas: refaz');
  assert.notEqual(M.analisar(sd1.slice(), sd3, { ignorar: ign }).cobertura, a.cobertura, 'outro SD1: refaz');
});

test('o resultado guardado não é alterado por quem usa (ordenação não mexe no cache)', () => {
  const sd1 = [linha('100', 'P1', 'L1', 5, '59')];
  const r1 = M.analisar(sd1, [], {});
  r1.findings.push({ lixo: true });
  assert.equal(M.analisar(sd1, [], {}).findings.length, 0);
});

test('item da nota traz o armazém', () => {
  const r = M.analisar([linha('100', 'P1', 'L1', 5, '59'), linha('101', 'P2', 'L2', 5, '')], [], {});
  assert.deepEqual(r.itens.map((i) => i.armazem), ['59', '59']);
});

test('transferência sai do armazém em que o SD1 lançou a peça; 01 não transfere', () => {
  assert.equal(M.armazemDeOrigem(''), '59');
  assert.equal(M.armazemDeOrigem(undefined), '59');
  assert.equal(M.armazemDeOrigem('2'), '02');
  assert.equal(M.armazemDeOrigem('59'), '59');
  const itens = [{ produto: 'A', lote: 'L1', armazem: '59' }, { produto: 'A', lote: 'L1', armazem: '02' }, { produto: 'B', lote: 'L2', armazem: '01' }, { produto: 'C', lote: 'L3' }];
  const r = M.conferenciaParaTransferencia(itens, ['5', '2', '4', '1']);
  assert.deepEqual(r.transferencias.map((t) => [t.produto, t.origem, t.qtde, t.armDestino]), [['A', '59', 5, '01'], ['A', '02', 2, '01'], ['C', '59', 1, '01']]);
  assert.deepEqual(r.jaNoDestino, [{ produto: 'B', lote: 'L2', quantidade: 4 }]);
  assert.equal(r.registros.length, 4, 'a contagem física de todos continua registrada');
});
