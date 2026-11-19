(function(root) {
  function orderNumber(value) {
    const text = String(value ?? '').trim();
    return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/,'') : '';
  }
  function applyDelivery(orders, snapshot, warehouse='Cambuci') {
    if (!snapshot?.orders) return orders;
    return orders.map(order => {
      if (order.armazem !== warehouse || !snapshot.orders.has(orderNumber(order.pedido))) return order;
      return {...order, status:'Enviado', faturadoSemDespacho:false, faturadoSemDespachoProntoFisico:false,
        confirmadoPelaEntrega:true};
    });
  }
  const api = {applyDelivery};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SC9DeliveryAudit = api;
})(typeof window === 'object' ? window : globalThis);
