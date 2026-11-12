const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readTransfer, indexStock, compare } = require('../operation-retem.js');

test('reconhece o modelo da nota 721 e preserva os códigos de produto, lote e armazém', () => {
  const sheet = { '!ref': 'A1:H4' };
  const workbook = { SheetNames: ['Planilha1'], Sheets: { Planilha1: sheet } };
  const headers = ['PRODUTO', 'Origem', 'LOTE', 'Produto Destino', 'Arm Destino', 'Lote destino', 'Qtde', 'Importador'];
  const xlsx = { utils: {
    decode_range: () => ({ s: { r: 0 } }),
    sheet_to_json: () => [headers, ['013512','59','138353','013512','01','138353','5',''], ['','26','','','01'], ['17312','59','154130','17312','01','154130','2','']]
  } };
  const items = readTransfer(workbook, xlsx);
  assert.deepEqual(items.map(item => item.linha), [2, 4]);
  assert.equal(items[0].produto, '013512');
  assert.equal(items[0].armazemDestino, '01');
  assert.equal(items[0].quantidade, '5');
});

test('cruza o par exato na filial escolhida e separa a quantidade da transferência do Retem', () => {
  const item = { produto: '13512', lote: '138353', produtoDestino: '13512', loteDestino: '138353', origem: '59', armazemDestino: '01', quantidade: '5' };
  const row = { filial: '01', armazem: '26', produto: item.produto, lote: item.lote, saldo: 1 };
  const stock = indexStock([
    row,
    { ...row, filial: '02', saldo: 0 },
    { ...row, filial: '02', armazem: '59', saldo: 10 },
    { ...row, filial: '02', produto: 'OUTRO', saldo: 10 }
  ]);
  assert.deepEqual(stock.filiais, ['1', '2']);
  assert.deepEqual(compare([item], stock, '1'), [{ ...item, saldo: 1, status: 'confirmado' }]);
  assert.equal(compare([item], stock, '2')[0].status, 'sem_saldo');
  assert.equal(compare([{ ...item, produto: 'OUTRO', produtoDestino: 'OUTRO' }], stock, '1')[0].status, 'nao_encontrado');
  assert.equal(compare([{ ...item, loteDestino: 'OUTRO' }], stock, '1')[0].status, 'destino_divergente');
  assert.equal(compare([{ ...item, quantidade: '' }], stock, '1')[0].status, 'linha_invalida');
});
