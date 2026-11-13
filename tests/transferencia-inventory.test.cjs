const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { read, findInventoryScan, records, readPartial, savePartial } = require('../transferencia-inventory');

const xlsx = { utils: { sheet_to_json: rows => rows } };
const book = sheets => ({ SheetNames: Object.keys(sheets), Sheets: sheets });
const sb1 = [['Filial', 'Codigo', 'Descricao', 'Unidade', 'Cod Barras'], ['', 'P01', 'Produto', 'UN', '7891234567890']];

test('Transferência lê o SB8 de todos os armazéns e guarda o armazém de cada peça', () => {
  const lots = read(book({
    SB8: [
      ['Filial', 'Produto', 'Armazem', 'Data Validad', 'Saldo Lote', 'Lote'],
      [1, 'P01', 59, '', 5, '000123'],
      [1, 'P01', 'ES', '', 3, '000123'],
      [1, 'P01', 26, '', 2, '000123'],
      [1, 'P01', 1, '', 0, '000123']
    ],
    ZZ2: [['Filial', 'Armazem', 'Endereco', 'Produto'], [1, 59, 'A59', 'P01'], [1, 'ES', 'EE01', 'P01']],
    SB1: sb1
  }), xlsx);
  assert.equal(lots.length, 1);
  const items = lots[0].itens;
  assert.deepEqual(items.map(item => [item.arm, item.esperado, item.endereco]), [['59', 5, 'A59'], ['ES', 3, 'EE01'], ['26', 2, '']]);
});

test('Transferência soma o saldo repetido do mesmo lote e armazém e ignora linhas sem lote', () => {
  const lots = read(book({
    SB8: [
      ['Filial', 'Produto', 'Armazem', 'Data Validad', 'Saldo Lote', 'Lote'],
      [1, 'P01', 59, '', 5, '000123'],
      [1, 'P01', 59, '', 4, '000123'],
      [1, 'P01', 59, '', 9, ''],
      [1, 'P01', '', '', 9, '000124']
    ],
    ZZ2: [['Filial', 'Armazem', 'Endereco', 'Produto']],
    SB1: sb1
  }), xlsx);
  assert.equal(lots.length, 1);
  assert.equal(lots[0].itens.length, 1);
  assert.equal(lots[0].itens[0].esperado, 9);
});

test('Transferência rejeita saldo inválido em vez de contar errado', () => {
  assert.throws(() => read(book({
    SB8: [['Filial', 'Produto', 'Armazem', 'Data Validad', 'Saldo Lote', 'Lote'], [1, 'P01', 59, '', 'abc', '000123']],
    ZZ2: [['Filial', 'Armazem', 'Endereco', 'Produto']], SB1: sb1
  }), xlsx), /linha inválida/);
});

test('bipar o mesmo lote de novo nunca trava: escolhe 59, depois ES, depois os demais', () => {
  const base = { filial: '01', sku: 'P01', lote: '000123', ean: '', conferido: 0 };
  const items = [
    { ...base, id: 'a', arm: '26', esperado: 20 },
    { ...base, id: 'b', arm: 'ES', esperado: 3 },
    { ...base, id: 'c', arm: '59', esperado: 5 }
  ];
  let scan = findInventoryScan(items, '000123');
  assert.equal(scan.item.arm, '59');
  assert.deepEqual(scan.outrosArmazens.sort(), ['26', 'ES']);
  items[2].conferido = 5;
  assert.equal(findInventoryScan(items, '000123').item.arm, 'ES');
  items[1].conferido = 3;
  assert.equal(findInventoryScan(items, '000123').item.arm, '26');
  items[0].conferido = 20;
  scan = findInventoryScan(items, '000123');
  assert.equal(scan.item.arm, '59', 'com tudo conferido continua aceitando o bip, sem erro');
});

test('lotes iguais de produtos ou filiais diferentes continuam ambíguos', () => {
  const a = { id: 'a', filial: '01', sku: 'P01', lote: 'L1', ean: '', arm: '59', esperado: 1, conferido: 0 };
  assert.deepEqual(findInventoryScan([a, { ...a, id: 'b', sku: 'P02' }], 'L1'), { ambiguous: true });
  assert.deepEqual(findInventoryScan([a, { ...a, id: 'b', filial: '02' }], 'L1'), { ambiguous: true });
  assert.deepEqual(findInventoryScan([a], 'inexistente'), { ambiguous: false });
});

test('o armazém acompanha os registros e o parcial salvo', () => {
  const item = { id: 'x', filial: '01', lote: 'L1', sku: 'P01', arm: 'ES', ean: '', descricao: 'D', validade: '', endereco: '', unidade: 'UN', esperado: 3, conferido: 4, avaria: 0 };
  assert.equal(records([item])[0].arm, 'ES');
  const parcial = readPartial(savePartial('base.xlsx', [item]));
  assert.equal(parcial.items[0].arm, 'ES');
  assert.throws(() => readPartial(JSON.stringify({ format: 'sc9-transferencia-parcial', version: 1, arquivo: 'a', items: [{ ...item, arm: undefined }] })), /inválidos/);
});

test('a página da Transferência exporta a origem de cada peça e deixa a quantidade editável', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'transferencia-de-lotes.html'), 'utf8');
  assert(html.includes('origem:r.arm||t.origem'));
  assert(html.includes('onEditar:edit'));
  assert(html.includes("tipo:'ok',texto:item.descricao"));
  assert(!/Retem · Armazém 26|SC9RetemInventory|SC9RetemDocumentStorage/.test(html));
});
