const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read, findScan } = require('../retem-inventory');

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
  assert.equal(findScan(lots, null, '000123').ambiguous, true);
  assert.equal(findScan(lots, lots[1].id, '000123').item.endereco, 'BB26');
  assert.equal(findScan(lots, lots[0].id, '7891234567890').item.descricao, 'Produto');
  sheets.ZZ2.splice(1, 1);
  assert.equal(read(book, xlsx)[0].itens[0].endereco, 'OUTRO (Arm. 01)');
  assert.throws(() => read({ ...book, SheetNames: ['SB8', 'SB1'] }, xlsx), /ZZ2/);
});
