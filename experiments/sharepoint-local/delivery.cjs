const orderCode = value => {
  const text = String(value ?? '').trim();
  return /^\d{1,12}$/.test(text) && Number(text) > 0 ? text.replace(/^0+(?=\d)/, '') : '';
};
function text(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString('pt-BR', {timeZone:'UTC'});
  if (typeof value === 'object') {
    if ('result' in value) return text(value.result);
    if (value.richText) return value.richText.map(part => part.text).join('');
    return text(value.text);
  }
  return String(value).trim();
}
const label = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function parseDelivery(workbook, sheetName) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw Error('A aba de entrega configurada não existe na planilha.');
  let positions, start;
  for (let row = 1; row <= Math.min(sheet.rowCount, 15); row++) {
    const headers = [];
    sheet.getRow(row).eachCell((cell, column) => {headers[column] = label(cell.value);});
    const pedido = headers.findIndex(value => ['pedido','pedidos','numerodopedido','numeropedido'].includes(value));
    if (pedido < 1) continue;
    const field = options => headers.findIndex(value => options.includes(value));
    positions = {pedido, cliente:field(['cliente','nomecliente']), nota:field(['notafiscal','nf']),
      data:field(['data','datasaida','datadesaida']), transportadora:field(['transportadora','transporte']),
      status:field(['status','situacao']), obs:field(['obs','observacoes','observacao'])};
    start = row + 1;
    break;
  }
  if (!positions) throw Error('Não encontrei a coluna Pedidos na aba de entrega.');
  const orders = new Map();
  let ignored = 0;
  for (let index = start; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    const value = field => positions[field] > 0 ? text(row.getCell(positions[field]).value) : '';
    const raw = value('pedido');
    if (!raw) continue;
    const numbers = raw.split(/[,;\s+/]+/).map(orderCode);
    if (!numbers.length || numbers.some(number => !number)) {ignored++;continue;}
    for (const pedido of new Set(numbers)) {
      if (!orders.has(pedido)) orders.set(pedido, []);
      orders.get(pedido).push({
        pedido, linha:index, cliente:value('cliente'), nota:value('nota'),
        data:value('data'), transportadora:value('transportadora'), statusPlanilha:value('status'), observacao:value('obs')
      });
    }
  }
  if (!orders.size) throw Error('A aba foi lida, mas nenhum número de pedido válido foi identificado.');
  return {orders, ignored, rows:sheet.rowCount - start + 1, columns:positions};
}
function consult(orders, pedido, warehouse) {
  const code = orderCode(pedido);
  if (!code) throw Error('Digite um número de pedido válido.');
  const matches = orders.get(code) || [];
  return {pedido:code, armazem:warehouse, encontrado:matches.length>0,
    status:matches.length ? 'Enviado' : 'Sem confirmação na planilha', ocorrencias:matches};
}
module.exports = {orderCode,parseDelivery,consult};
