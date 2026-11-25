const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const AH = require('../atraso-historico.js');

const diaSP = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(d);

test('faturados da base: pedido conta uma vez no dia da emissão (horário de São Paulo), por armazém, sem IMPLACIL nem nota sem data', () => {
  const orders = [
    { pedido: 'A1', armazem: 'Cambuci', nf: '885234.0', qt: 5, nome: 'CLIENTE A' }, { pedido: 'A1', armazem: 'Cambuci', nf: '885234', qt: 2, nome: 'CLIENTE A' },
    { pedido: 'A2', armazem: 'Cambuci', nf: '886039', qt: 3.5, nome: 'CLIENTE B' }, { pedido: 'A3', armazem: 'Tambore', nf: '000887', qt: 4, nome: 'CLIENTE C' },
    { pedido: 'A4', armazem: 'BH', nf: '', qt: 9, nome: 'CLIENTE D' }, { pedido: 'A5', armazem: 'BH', nf: '999', qt: 1, nome: 'CLIENTE E' },
    { pedido: 'A6', armazem: 'Cambuci', nf: '885000', qt: 8, nome: 'IMPLACIL FILIAL' }, { pedido: 'A7', armazem: 'Outro', nf: '885001', qt: 8, nome: 'X' }
  ];
  // 02:30 UTC já é a noite anterior em São Paulo
  const emissoes = [['885234', '2026-11-20T13:00:00.000Z'], ['886039', '2026-11-20T18:00:00.000Z'], ['887', '2026-11-20T02:30:00.000Z'], ['885000', '2026-11-20T13:00:00.000Z'], ['885001', '2026-11-20T13:00:00.000Z']];
  const r = AH.faturadosDaBase(orders, emissoes, (iso) => (iso ? diaSP(new Date(iso)) : ''), new Set(['Cambuci', 'Tambore', 'BH']));
  assert.deepEqual(r, {
    '2026-11-20': { pedidos: 2, pecas: 8.5, por: { Cambuci: { pedidos: 2, pecas: 8.5 } } },
    '2026-11-19': { pedidos: 1, pecas: 4, por: { 'Tamboré': { pedidos: 1, pecas: 4 } } }
  });
  assert.deepEqual(AH.faturadosDaBase(orders, null, () => ''), {});
  assert.deepEqual(AH.faturadosDaBase(null, [], () => ''), {});
});

test('servidor: ao salvar a base do SC9 os faturados por dia entram no histórico sozinhos e nunca diminuem', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-fatauto-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..'))) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const H = { 'Content-Type': 'application/json', 'X-Sc9-App': '1', Cookie: cookie };
    const d1 = diaSP(new Date(Date.now() - 86400000)), d2 = diaSP(new Date(Date.now() - 2 * 86400000));
    const ordem = (pedido, nf, qt) => ({ pedido, armazem: 'Cambuci', nf, nome: 'CLIENTE ' + pedido, cliente: '001', dt: d2, qt, itens: 1, status: 'Enviado', transportadora: '4' });
    const salvar = (orders, faturamento) => fetch(base + '/api/save', { method: 'POST', headers: H, body: JSON.stringify({ orders, items: [], itemNames: [], warehousesPresent: ['Cambuci'], cutoff: d1, faturamento }) });
    const lerFat = async () => (await (await fetch(base + '/api/atraso-historico?meses=2', { headers: { Cookie: cookie } })).json()).faturados;
    const meio = (d) => d + 'T15:00:00.000Z';
    assert.equal((await salvar([ordem('P1', '100', 5), ordem('P2', '101', 3), ordem('P3', '102', 2)], [['100', meio(d1)], ['101', meio(d1)], ['102', meio(d2)]])).status, 200);
    let f = await lerFat();
    assert.equal(f[d1.slice(0, 7)][d1].pedidos, 2); assert.equal(f[d1.slice(0, 7)][d1].pecas, 8);
    assert.equal(f[d2.slice(0, 7)][d2].pedidos, 1);
    assert.equal(f[d1.slice(0, 7)][d1].por.Cambuci.pedidos, 2);
    // base seguinte com menos pedidos faturados naquele dia (pedido antigo saiu da base): o número do dia não cai
    assert.equal((await salvar([ordem('P1', '100', 5)], [['100', meio(d1)]])).status, 200);
    f = await lerFat();
    assert.equal(f[d1.slice(0, 7)][d1].pedidos, 2, 'só cresce');
  } finally { await new Promise((r) => server.close(r)); }
});
