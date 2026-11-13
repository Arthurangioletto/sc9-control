const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read, findInventoryScan, template, savePartial, readPartial } = require('../retem-inventory');

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

test('modelo do Retem inclui as três abas aceitas pelo importador', () => {
  const xlsx = { utils: {
    book_new: () => ({}),
    aoa_to_sheet: rows => rows,
    book_append_sheet: (book, rows, name) => { book[name] = rows; }
  }, write: book => book };
  const book = template(xlsx);
  assert.deepEqual(Object.keys(book), ['SB8', 'ZZ2', 'SB1']);
  assert.ok(book.SB8[0].includes('Saldo Lote'));
  assert.ok(book.ZZ2[0].includes('Endereco'));
  assert.ok(book.SB1[0].includes('Cod Barras'));
});

test('salvar e restaurar mantém a contagem e separa o mesmo lote por filial', () => {
  const item = {id:'1',filial:'01',lote:'000123',sku:'P01',ean:'',descricao:'Produto',
    validade:'2027-08-14',endereco:'AA26',unidade:'UN',esperado:3,conferido:2,avaria:1};
  const items = [item, {...item,id:'2',filial:'02',conferido:0}];
  const source = savePartial('base.xlsx', items);
  assert.deepEqual(readPartial(source), {arquivo:'base.xlsx',items,lotCount:2});
  assert.throws(() => readPartial(savePartial('base.xlsx',[item,item])), /inválidos/);
  assert.throws(() => readPartial(savePartial('base.xlsx',[{...item,validade:'2027-99-14'}])), /inválidos/);
  assert.throws(() => readPartial('sem JSON'), /inválido/);
});
