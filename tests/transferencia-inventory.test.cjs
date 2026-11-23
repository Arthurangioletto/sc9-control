const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const inventory = require('../transferencia-inventory');
const { read, findInventoryScan, records, readPartial, savePartial, compareSelectedDocuments } = inventory;

const xlsx = { utils: { sheet_to_json: rows => rows } };
const book = sheets => ({ SheetNames: Object.keys(sheets), Sheets: sheets });
const sb1 = [['Filial', 'Codigo', 'Descricao', 'Unidade', 'Cod Barras'], ['', 'P01', 'Produto', 'UN', '7891234567890']];

test('Transferência lê somente o saldo do 59 e mostra o endereço de destino no 02', () => {
  const lots = read(book({
    SB8: [
      ['Filial', 'Produto', 'Armazem', 'Data Validad', 'Saldo Lote', 'Lote'],
      [1, 'P01', 59, '', 5, '000123'],
      [1, 'P01', 'ES', '', 3, '000123'],
      [1, 'P01', 26, '', 2, '000123'],
      [1, 'P01', 1, '', 0, '000123']
    ],
    ZZ2: [['Filial', 'Armazem', 'Endereco', 'Produto', 'Lote'],
      [1, 59, 'A59', 'P01'], [1, 'ES', 'EE01', 'P01'],
      [1, 1, 'G01', 'P01'], ['01', '02', 'D01', 'P01', '000123'], [2, 2, 'OUTRA-FILIAL', 'P01', '000123']],
    SB1: sb1
  }), xlsx);
  assert.equal(lots.length, 1);
  const items = lots[0].itens;
  assert.deepEqual(items.map(item => [item.arm, item.esperado, inventory.destinationAddress(item)]), [
    ['59', 5, 'D01']
  ]);
  assert.equal(inventory.destinationAddress({ endereco: 'A59' }), '');
});

test('o endereço de destino segue o armazém escolhido (qualquer um da ZZ2, menos o 59)', () => {
  const lots = read(book({
    SB8: [['Filial', 'Produto', 'Armazem', 'Data Validad', 'Saldo Lote', 'Lote'], [1, 'P01', 59, '', 5, '000123']],
    ZZ2: [['Filial', 'Armazem', 'Endereco', 'Produto', 'Lote'],
      [1, 59, 'A59', 'P01', '000123'], ['01', '01', 'G01', 'P01', '000123'], ['01', '02', 'D02', 'P01', '000123'],
      ['01', '02', 'D02B', 'P01', '000123'], ['01', '03', 'T03', 'P01', '000123'], ['01', 'ES', 'E-ES', 'P01', '000123']],
    SB1: sb1
  }), xlsx);
  const item = lots[0].itens[0];
  assert.equal(inventory.destinationAddress(item), 'D02 / D02B', 'padrão: armazém 02, vários endereços juntos');
  assert.equal(inventory.destinationAddress(item, '02'), 'D02 / D02B');
  assert.equal(inventory.destinationAddress(item, '01'), 'G01', 'armazém 01 com zero à esquerda');
  assert.equal(inventory.destinationAddress(item, '3'), 'T03');
  assert.equal(inventory.destinationAddress(item, 'es'), 'E-ES');
  assert.equal(inventory.destinationAddress(item, '04'), '', 'sem endereço nesse armazém');
  assert.equal(inventory.destinationAddress(item, '59'), '', 'o 59 é a origem e não vira destino');
  assert.deepEqual(inventory.destinationArms(lots[0].itens), ['1', '2', '3', 'ES']);
  // base salva antes da escolha do destino: só o armazém 02 existe
  assert.equal(inventory.destinationAddress({ enderecoDestino: 'ANTIGO' }, '02'), 'ANTIGO');
  assert.equal(inventory.destinationAddress({ enderecoDestino: 'ANTIGO' }, '03'), '');
  // o arquivo parcial aceita o mapa novo e recusa lixo
  const parcial = { ...item, filial: lots[0].filial, bipado: false, conferido: 0, avaria: 0 };
  assert.equal(inventory.readPartial(inventory.savePartial('x.xlsx', [parcial])).items.length, 1);
  assert.throws(() => inventory.readPartial(inventory.savePartial('x.xlsx', [{ ...parcial, enderecosDestino: { 2: 7 } }])), /inválidos/);
});

test('Transferência soma o saldo repetido do mesmo lote e armazém e ignora linhas sem lote', () => {
  const lots = read(book({
    SB8: [
      ['Filial', 'Produto', 'Armazem', 'Data Validad', 'Saldo Lote', 'Lote'],
      [1, 'P01', 59, '', 5, '000123'],
      [1, 'P01', '059', '', 4, '000123'],
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

test('bipagem só localiza o 59, inclusive com itens de outros armazéns numa base antiga', () => {
  const base = { filial: '01', sku: 'P01', lote: '000123', ean: '', conferido: 0 };
  const items = [
    { ...base, id: 'a', arm: '26', esperado: 20 },
    { ...base, id: 'b', arm: 'ES', esperado: 3 },
    { ...base, id: 'c', arm: '59', esperado: 5 }
  ];
  assert.equal(findInventoryScan(items, '000123').item, items[2]);
  items[2].conferido = 5;
  assert.equal(findInventoryScan(items, '000123').item, items[2], 'o excesso continua sendo apontado no 59');
  assert.deepEqual(findInventoryScan(items.slice(0,2), '000123'), { ambiguous: false });
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
  const source = html.match(/function _n\(doc, route\) \{[\s\S]*?\n\}/)[0];
  const transferRows = new Function('window', source + '\nreturn _n;')({ SC9TransferenciaInventory: inventory });
  const row = { filial: '01', sku: 'P01', lote: '000123', esperado: 3, conferido: 2, avaria: 0 };
  const document = { registros: [
    { ...row, arm: '59' },
    { ...row, arm: '059', conferido: 3 },
    { ...row, arm: 'ES' },
    { ...row, arm: 'es', conferido: 1 },
    { ...row, arm: '59', lote: '000124', conferido: 0 }
  ] };
  assert.deepEqual(transferRows(document, { destino: '02' }).map(row => row.importador), [
    'P01;59;000123;P01;02;000123;5', 'P01;ES;000123;P01;02;000123;3'
  ]);
  assert.deepEqual(inventory.aggregateExportRecords(document.registros).map(row => [row.lote, row.arm, row.conferido]), [
    ['000123', '59', 5], ['000123', 'ES', 3], ['000124', '59', 0]
  ]);
  assert(html.includes('onEditar:edit'));
  assert(html.includes("' · Saldo SB8 59: '+stock"));
  assert(!/Retem · Armazém 26|SC9RetemInventory|SC9RetemDocumentStorage/.test(html));
});

test('comparativo diário soma documentos sem reaproveitar entradas do SD3 entre filiais, datas ou origens', () => {
  const day = '2026-11-15';
  const line = (origem,qtd) => ({ produto:'P1', lote:'L1', origem, destino:'01', qtd });
  const docs = [
    { id:'TRF-000001', filial:'01', lines:[line('59',2)] },
    { id:'TRF-000002', filial:'01', lines:[line('59',3),line('ES',4)] },
    { id:'TRF-000003', filial:'02', lines:[line('ES',4)] }
  ];
  const move = (armazem,qt,tp,more={}) => ({ filial:'01', armazem, qt, tp, dt:day, doc:'D1', produto:'P1', lote:'L1', ...more });
  const movements = [move('59',5,999),move('ES',4,999),move('01',9,499),
    move('ES',4,999,{dt:'2026-11-14',filial:'02'}),move('01',4,499,{dt:'2026-11-14',filial:'02'})];
  const result = inventory.compareDaily(docs,movements,day);
  assert.deepEqual(result.map(row=>[row.filial,row.origem,row.qtdDocumento,row.entradaSd3,row.situacao]), [
    ['01','59',5,5,'confere'], ['01','ES',4,4,'confere'], ['02','ES',4,0,'nao_encontrado']
  ]);
  assert.deepEqual(result[0].documentos,['TRF-000001','TRF-000002']);
  assert(inventory.compareDaily(docs,movements.map(row=>row.tp===499?{...row,qt:5}:row),day)
    .filter(row=>row.filial==='01').every(row=>row.situacao==='divergente'));
});

test('comparativo selecionado soma os documentos da mesma filial e limita o SD3 aos movimentos escolhidos', () => {
  const line={produto:'P1',lote:'L1',origem:'59',destino:'01',qtd:3};
  const docs=[
    {id:'TRF-000001',filial:'01',lines:[line]},
    {id:'TRF-000002',filial:'01',lines:[{...line,qtd:5}]},
    {id:'TRF-000003',filial:'02',lines:[line]}
  ];
  const pair=(doc,filial,qt,estornado=false)=>[999,499].map(tp=>({
    ...line,doc,filial,qt,tp,dt:'2026-11-16',armazem:tp===999?'59':'01',estornado
  }));
  const sd3=[
    ...pair('001','01',3),...pair('ZB2','01',5),...pair('ZB2','02',2),
    ...pair('OUTRO','01',100),...pair('ZB2','01',100,true)
  ];
  const results=compareSelectedDocuments(docs,sd3,['1','zb2']);
  assert.deepEqual(results.map(row=>[row.filial,row.qtdDocumento,row.saidaSd3,row.entradaSd3,row.situacao,row.documentos]),[
    ['01',8,8,8,'confere',['TRF-000001','TRF-000002']],
    ['02',3,2,2,'divergente',['TRF-000003']]
  ]);
  assert.equal(compareSelectedDocuments(docs,sd3,['SEM-MOVIMENTO'])[0].situacao,'nao_encontrado');
  assert.throws(()=>compareSelectedDocuments(docs,sd3,[]),/Informe o número/);
});
