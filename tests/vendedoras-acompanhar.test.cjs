const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('vendedoras: acompanhar pedido fica só neste aparelho e compara com a última vez vista', () => {
  const js = ler('vendedoras.js');
  assert.match(js, /seguindo: 'sc9v_seguindo'/);
  assert.match(js, /function seguir\(r\)/);
  assert.match(js, /Acompanhar este pedido/);
  assert.match(js, /Pedidos que você acompanha/);
  assert.match(js, /'Mudou'/);
  // a chave de comparação considera etapa atual, situação geral e ocorrência
  assert.match(js, /const chaveDe = /);
  assert.match(js, /oc-res/);
  // pedir prioridade passa a acompanhar o pedido
  assert.match(js, /seguir\(f\.previa\)/);
  // limite de 30 pedidos acompanhados e nenhuma chamada nova de back-end
  assert.match(js, /\.slice\(0, 30\)/);
  assert.ok(!/\/api\/vendedoras\/acompanhar/.test(js));
});

test('vendedoras: pedido não encontrado oferece "Digitar outro número" em primeiro lugar', () => {
  const js = ler('vendedoras.js');
  const i = js.indexOf('Digitar outro número');
  assert.ok(i > 0);
  assert.ok(i < js.indexOf('Tentar de novo', i) && js.indexOf('Tentar de novo', i) < js.indexOf('Avisar a expedição', i));
  assert.match(js.slice(i - 400, i), /btn peq primario/);
});

test('central.css: alvo de toque de 44px no celular e contraste de placeholder/etapa pendente/aguarde', () => {
  const css = ler('central.css');
  assert.match(css, /@media \(pointer: coarse\) \{ \.btn\.peq \{ min-height: 44px; \} \}/);
  assert.match(css, /\.busca input::placeholder \{ color: #6b7790; \}/);
  assert.match(css, /\.tempo li\.pendente \.q \{ color: #66728f; \}/);
  assert.match(css, /\.aguarde \{ color: #a14a07/);
});
