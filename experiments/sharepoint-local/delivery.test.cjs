const {test} = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('../../vendor-exceljs.js');
const {parseDelivery,consult} = require('./delivery.cjs');
function workbook(rows) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Controle de entregas 2026').addRows(rows);
  return book;
}
test('presença na entrega confirma saída sem exigir NF nem informações antigas do SC9',()=>{
  const result = parseDelivery(workbook([
    ['Data','Transportadora','Cod/Cliente','CLIENTE','Pedidos','Nota Fiscal','Status'],
    ['19/11/2026','Retira','A1','Cliente A','000311261','',''],
    ['19/11/2026','Correios','A2','Cliente B',311262,'NF 10','Em trânsito']
  ]),'Controle de entregas 2026');
  assert.equal(result.orders.size,2);
  const found = consult(result.orders,'311261','Cambuci');
  assert.equal(found.status,'Enviado');
  assert.equal(found.ocorrencias[0].nota,'');
  assert.equal(found.armazem,'Cambuci');
  assert.equal(consult(result.orders,'311263','Cambuci').encontrado,false);
});
test('ignora anotações na coluna Pedidos e reúne ocorrências do mesmo pedido',()=>{
  const result = parseDelivery(workbook([
    ['Pedidos','Cliente','NF'],
    ['311261 / 311262','Cliente A','2'],
    [311261,'Cliente A','3'],
    ['SOLICITADO POR TDC','Cliente B',''],
    ['123ABC','Cliente C',''],
    [{formula:'1+311262',result:311263},'Cliente D','']
  ]),'Controle de entregas 2026');
  assert.equal(result.orders.size,3);
  assert.equal(result.ignored,2);
  assert.equal(consult(result.orders,'000311261','Cambuci').ocorrencias.length,2);
  assert.equal(consult(result.orders,'311263','Cambuci').status,'Enviado');
});
test('aba e cabeçalho ausentes interrompem a leitura sem produzir uma lista vazia válida',()=>{
  assert.throws(()=>parseDelivery(workbook([['Pedidos'],[311261]]),'Outra aba'),/não existe/);
  assert.throws(()=>parseDelivery(workbook([['Nome'],['A']]),'Controle de entregas 2026'),/coluna Pedidos/);
  assert.throws(()=>parseDelivery(workbook([['Pedidos'],['SOLICITADO POR TDC']]),'Controle de entregas 2026'),/nenhum número/);
});
