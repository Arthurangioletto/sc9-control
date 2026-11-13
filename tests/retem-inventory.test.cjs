const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read, findInventoryScan } = require('../retem-inventory');

test('Retem cruza SB8, ZZ2 e SB1 sem misturar filiais, armazéns ou lotes', () => {
  const sheets = {
    SB8: [
      ['Filial', 'Produto', 'Armazem', 'Data Validad', 'Saldo Lote', 'Lote'],
      [1, 'P01', 26, '14/08/2027', 2, '000123'],
      [2, 'P01', 26, '', 1, '000123'],
      [1, 'P01', 1, '', 80, '000123'],
      [1, 'P01', 26, '', 0, 'SEM-SALDO']
    ],
    ZZ2: [['Filial', 'Armazem', 'Endereco', 'Produto'], [1, 26, 'AA26', 'P01'], [1, 1, 'OUTRO', 'P01'], [2, 26, 'BB26', 'P01']],
    SB1: [['Filial', 'Codigo', 'Descricao', 'Unidade', 'Cod Barras'], ['', 'P01', 'Produto', 'UN', '7891234567890']]
  };
  const xlsx = { utils: { sheet_to_json: rows => rows } };
  const book = { SheetNames: Object.keys(sheets), Sheets: sheets };
  const lots = read(book, xlsx);
  assert.deepEqual(lots.map(lot => lot.itens[0].endereco), ['AA26', 'BB26']);
  assert.equal(lots[0].itens[0].esperado, 2);
  assert.equal(lots[0].itens[0].validade, '2027-08-14');
  sheets.ZZ2.splice(1, 1);
  assert.equal(read(book, xlsx)[0].itens[0].endereco, 'OUTRO (Arm. 01)');
  assert.throws(() => read({ ...book, SheetNames: ['SB8', 'SB1'] }, xlsx), /ZZ2/);
});

test('bipagem unificada encontra qualquer linha e não aloca códigos ambíguos', () => {
  const first = { lote: '000123', sku: 'P01', ean: '7891234567890' };
  const second = { lote: '000124', sku: 'P02', ean: '7891234567891' };
  assert.equal(findInventoryScan([first, second], '000124').item, second);
  assert.equal(findInventoryScan([first, second], '7891234567891').item, second);
  assert.equal(findInventoryScan([first, second], 'p02').item, second);
  assert.deepEqual(findInventoryScan([first, { ...second, lote: first.lote }], first.lote), { ambiguous: true });
  assert.deepEqual(findInventoryScan([first, { ...second, sku: first.sku }], first.sku), { ambiguous: true });
  assert.deepEqual(findInventoryScan([first, second], 'inexistente'), { ambiguous: false });
});
