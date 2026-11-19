const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyDelivery } = require('./delivery-view.js');
const { build } = require('../../../operation-overview.js');
const snapshot = numbers => ({ orders: new Map(numbers.map(number => [number, []])) });
const order = (pedido, extra = {}) => ({ pedido, key: 'Cambuci|' + pedido, armazem: 'Cambuci', status: 'Atrasado', qt: 2.5, ...extra });

test('a entrega confirma a saída mesmo sem NF e sem informações de separação antigas', () => {
  const original = order('311261');
  const projected = applyDelivery([original], snapshot(['311261']))[0];
  assert.equal(projected.status, 'Enviado');
  assert.equal(projected.nf, undefined);
  assert.equal(projected.pickEnd, undefined);
  assert.equal(projected.confEnd, undefined);
  assert.equal(projected.confirmadoPelaEntrega, true);
});

test('pedido igual em outra unidade conserva o estado anterior', () => {
  const other = order('311261', { armazem: 'RJ', key: 'RJ|311261' });
  assert.strictEqual(applyDelivery([other], snapshot(['311261']))[0], other);
});

test('zeros à esquerda são normalizados sem multiplicar a quantidade', () => {
  const original = [order('000311261')];
  const projected = applyDelivery(original, snapshot(['311261']));
  assert.equal(projected.length, 1);
  assert.equal(projected[0].status, 'Enviado');
  assert.equal(projected[0].qt, 2.5);
});

test('a projeção preserva a base e as informações originais', () => {
  const original = Object.freeze([Object.freeze(order('311261', { nf: '10', faturadoSemDespacho: true }))]);
  const projected = applyDelivery(original, snapshot(['311261']));
  assert.equal(original[0].status, 'Atrasado');
  assert.equal(original[0].faturadoSemDespacho, true);
  assert.equal(projected[0].nf, '10');
  assert.equal(projected[0].faturadoSemDespacho, false);
});

test('a reimportação reaplica a entrega sem confirmar pedidos ausentes', () => {
  const original = [order('311261'), order('311262')];
  const delivery = snapshot(['311261']);
  assert.deepEqual(applyDelivery(original, delivery), applyDelivery(original.map(row => ({ ...row })), delivery));
  assert.strictEqual(applyDelivery(original, delivery)[1], original[1]);
  assert.strictEqual(applyDelivery(original, null), original);
});

test('o Resumo remove pendências confirmadas e preserva total de pedidos e peças', () => {
  const original = [order('311261'), order('311262', { faturadoSemDespacho: true, faturadoSemDespachoProntoFisico: true })];
  const projected = applyDelivery(original, snapshot(['311261', '311262']));
  const before = build(original, [original[0]]), after = build(projected, [original[0]]);
  assert.equal(after.total, before.total);
  assert.equal(after.qt, before.qt);
  assert.equal(after.sent, 2);
  assert.equal(after.open, 0);
  assert.equal(after.lists.late.length, 0);
  assert.equal(after.lists.billing.length, 0);
  assert.equal(after.lists.dispatch.length, 0);
});
