const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read, findInventoryScan, template, savePartial, readPartial, records, restore, compareTransfer } = require('../retem-inventory');

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

test('documento retomado preserva ordem, saldo, endereço e bipagem', () => {
  const base = [{id:'a',filial:'01',lote:'L1',conferido:0,avaria:0},{id:'b',filial:'02',lote:'L2',conferido:0,avaria:0}];
  const saved = records([base[0],{...base[1],conferido:1,bipado:true,endereco:'B26'}]);
  assert.equal(saved.length,1);
  const restored = restore(base,saved);
  assert.deepEqual(restored.map(row=>row.id),['b','a']);
  assert.equal(restored[0].conferido,1);
  assert.equal(restored[0].bipado,true);
  assert.equal(restored[0].endereco,'B26');
});

test('comparativo exige duas pontas no mesmo documento e sinaliza diferenças e sobras', () => {
  const expected = [{produto:'P01',lote:'00123',origem:'26',destino:'01',qtd:2}];
  const common = {produto:'P01',lote:'123',filial:'01',dt:'2026-11-14',doc:'T001',qt:2};
  const out = {...common,tp:999,cf:'RE4',armazem:'26'};
  const incoming = {...common,tp:499,cf:'DE4',armazem:'01'};
  assert.equal(compareTransfer(expected,[out,incoming],{documento:'T001'})[0].situacao,'confere');
  assert.equal(compareTransfer(expected,[out,{...incoming,doc:'T002'}])[0].situacao,'divergente');
  assert.equal(compareTransfer(expected,[out,{...incoming,estornado:true}])[0].entradaSd3,0);
  assert.equal(compareTransfer(expected,[out,{...incoming,qt:1}])[0].situacao,'divergente');
  assert.equal(compareTransfer(expected,[out,incoming],{filial:'02'})[0].situacao,'nao_encontrado');
  const rows = compareTransfer(expected,[out,incoming,{...out,produto:'OUTRO'}],{documento:'T001'});
  assert.deepEqual(rows.map(row=>row.situacao),['confere','divergente']);
  assert.equal(rows[1].qtdDocumento,0);
});
