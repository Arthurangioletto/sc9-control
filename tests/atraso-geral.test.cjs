const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../atraso-geral.js');

// itens do SC9 (uma linha por item): Cambuci é Enviado se o pedido está na Entrega
const it = (ped, dia, qt, arm) => ({ armazem: arm || 'Cambuci', pedido: ped, produto: 'P' + ped, dt: dia + 'T00:00:00.000Z', qt, nome: 'CLIENTE', cliente: '1', nf: '', transportadora: '5' });

test('geral: lançado × feito em pedidos e peças, com a média por dia', () => {
  const items = [it('1', '2026-11-02', 100), it('2', '2026-11-02', 900), it('3', '2026-11-03', 50), it('4', '2026-11-03', 50)];
  items.forEach((x, i) => { x.pickEnd = x.confEnd = '2026-11-04T10:00:00.000Z'; });
  const snap = { items, entregaCounts: [['1', 1], ['2', 1]], sc5PorPedido: [], itemNames: [] };
  const g = G.montarGeral(snap, {});
  assert.equal(g.total.pedidos, 4);
  assert.equal(g.total.pecas, 1100);
  assert.equal(g.total.enviados, 2);
  assert.equal(g.total.pecasEnviadas, 1000);
  assert.equal(g.total.pctPedidos, 50);
  assert.equal(g.total.pctPecas, 90.9); // 1000 de 1100: poucos pedidos grandes
  assert.equal(g.dias.length, 2);
  assert.equal(g.mediaPorDia.pedidos, 2);
  assert.equal(g.base.de, '2026-11-02');
});

test('geral: filtra por armazém e respeita o período', () => {
  const items = [it('1', '2026-11-02', 10), it('2', '2026-11-09', 20), it('3', '2026-11-09', 30, 'BH')];
  const snap = { items, entregaCounts: [], sc5PorPedido: [], itemNames: [] };
  assert.equal(G.montarGeral(snap, { de: '2026-11-09', ate: '2026-11-09' }).total.pedidos, 2);
  assert.equal(G.montarGeral(snap, { arm: 'BH' }).total.pedidos, 1);
  assert.equal(G.montarGeral({ items: [] }, {}).semBase, true);
  assert.equal(G.montarGeral(null, {}).total.pedidos, 0);
});

test('picos: a média "normal" não é puxada por semana de pico (2.000 peças vs 30)', () => {
  const dias = [];
  const semanas = [['2026-11-02', 30], ['2026-11-09', 40], ['2026-11-16', 35], ['2026-11-23', 2000], ['2026-11-30', 38], ['2026-12-07', 32]];
  for (const [seg, pecas] of semanas) dias.push({ dia: seg, pedidos: Math.ceil(pecas / 10), pecas, enviados: Math.ceil(pecas / 20), pecasEnviadas: Math.round(pecas / 2), atrasados: 0, pecasAtrasadas: 0, pendentes: 0, pecasPendentes: 0 });
  const a = G.analisarPicos(dias, '2026-11-02', '2026-12-13');
  assert.equal(a.picos.semanasPico, 1);
  assert.equal(a.semanas.find((s) => s.semana === '2026-11-23').pico, true);
  assert.equal(a.normal.porSemana.pecas, 35); // média das 5 semanas normais (30,40,35,38,32)
  assert.ok(a.picos.limiteSemanaPecas < 2000 && a.picos.limiteSemanaPecas > 40);
  assert.equal(a.picos.semanasDePico.pecas, 2000);
  assert.equal(a.picos.semanasDePico.pctPecas, 50);
  assert.ok(Math.abs(a.picos.semanasNormais.pctPecas - 50) < 1);
});

test('picos: poucos dados não inventam pico e período vazio não quebra', () => {
  assert.equal(G.limitePico([5]), null);
  const a = G.analisarPicos([], '2026-11-02', '2026-11-02');
  assert.deepEqual(a.semanas, []);
  assert.equal(a.normal.porDia, null);
});

test('rota /api/atraso-geral: sem login 401; com login devolve o geral do último SC9', async () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-geral-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..'))) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  try {
    const base = 'http://127.0.0.1:' + server.address().port, hdr = { 'Content-Type': 'application/json', 'X-Sc9-App': '1' };
    assert.equal((await fetch(base + '/api/atraso-geral', { headers: hdr })).status, 401);
    const lr = await fetch(base + '/api/login', { method: 'POST', headers: hdr, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
    const ck = lr.headers.get('set-cookie').split(';')[0];
    const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const items = [it('1', hoje, 10), it('2', hoje, 30)];
    const sv = await fetch(base + '/api/save', { method: 'POST', headers: { ...hdr, Cookie: ck }, body: JSON.stringify({ orders: [{ pedido: '1', armazem: 'Cambuci', nome: 'X', cliente: '1', dt: hoje, qt: 1, status: 'Pendente', nf: '' }], items, itemNames: [], warehousesPresent: ['Cambuci'], cutoff: hoje, entregaCounts: [['1', 1]], entregaInfo: [], faturamento: [], valores: [] }) });
    assert.equal(sv.status, 200);
    const r = await fetch(base + '/api/atraso-geral', { headers: { ...hdr, Cookie: ck } });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.total.pedidos, 2); assert.equal(j.total.enviados, 1); assert.equal(j.total.pecas, 40); assert.equal(j.total.pecasEnviadas, 10);
    assert.equal((await (await fetch(base + '/api/atraso-geral?arm=BH', { headers: { ...hdr, Cookie: ck } })).json()).total.pedidos, 0);
  } finally { server.close(); }
});
