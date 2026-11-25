const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

async function subir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-leve-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..'))) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const adm = (rota, corpo) => fetch(base + rota, { method: corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', Cookie: cookie }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { server, adm, base };
}
const ordem = (pedido, extra) => Object.assign({ pedido, armazem: 'Cambuci', nf: '', nome: 'CLIENTE ' + pedido, cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Pendente', transportadora: '4', separador: '', conferente: '', pickEnd: '2026-11-18T15:00:00.000Z' }, extra || {});

test('vendedoras: vários pedidos numa chamada só (limite de 30, sem repetir, sem lixo) e ocorrência nova aparece na hora', async () => {
  const { server, adm, base } = await subir();
  try {
    await adm('/api/save', { orders: [ordem('0355386'), ordem('0355387', { confEnd: '2026-11-20T11:00:00.000Z' })], items: [], itemNames: [], warehousesPresent: ['Cambuci'], cutoff: '2026-11-24' });
    const k = (await (await adm('/api/vendedoras-link', { acao: 'gerar' })).json()).token;
    const lote = (lista) => fetch(base + '/api/vendedoras/pedidos?k=' + k + '&pedidos=' + encodeURIComponent(lista), { headers: { 'X-Sc9-App': '1' } });
    const r = await lote('355386, 355387,355386,999999,abc');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(j.pedidos.map((x) => x.pedido), ['355386', '355387', '999999']);
    assert.equal(j.pedidos[0].achado, true); assert.equal(j.pedidos[2].achado, false);
    assert.ok(j.pedidos.every((x) => x.espera == null), '"onde mais demorou" não sai para a vendedora');
    const um = await (await fetch(base + '/api/vendedoras/pedido?k=' + k + '&pedido=355386', { headers: { 'X-Sc9-App': '1' } })).json();
    assert.equal(um.espera, null);
    assert.equal((await lote('')).status, 400);
    assert.equal((await lote('abc,,')).status, 400);
    const muitos = Array.from({ length: 45 }, (_, i) => String(100000 + i)).join(',');
    assert.equal((await (await lote(muitos)).json()).pedidos.length, 30);
    assert.equal((await fetch(base + '/api/vendedoras/pedidos?pedidos=355386', { headers: { 'X-Sc9-App': '1' } })).status === 200, false, 'sem o código do link não abre');
    // ocorrência salva pela expedição passa a valer na hora (o cache de 20 s é limpo na gravação)
    assert.equal((await (await lote('355386')).json()).pedidos[0].ocorrencia, null);
    const salvo = await adm('/api/ocorrencias', { acao: 'salvar', linha: { nf: '', pedido: '355386', dataOcorrencia: '2026-11-21', tipo: 'endereco', detalhes: 'faltou número', responsavel: 'Expedição' } });
    assert.equal(salvo.status, 200);
    const depois = (await (await lote('355386')).json()).pedidos[0];
    assert.ok(depois.ocorrencia && depois.ocorrencia.tipo === 'endereco', 'ocorrência aparece sem esperar o cache');
  } finally { server.close(); }
});

test('arquivos do app saem em brotli quando o navegador aceita, e continuam em gzip/puro para quem não aceita', async () => {
  const { server, base } = await subir();
  try {
    const pedir = (enc) => fetch(base + '/central.css', { headers: enc ? { 'Accept-Encoding': enc } : {} });
    const original = fs.readFileSync(path.join(__dirname, '..', 'central.css'));
    const br = await fetch(base + '/central.css', { headers: { 'Accept-Encoding': 'br, gzip' } });
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.ok(Buffer.from(await br.arrayBuffer()).equals(original), 'o navegador (fetch) descompacta e recebe o arquivo igual');
    const gz = await fetch(base + '/central.css', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    const bruto = await pedir('identity');
    assert.equal(bruto.headers.get('content-encoding'), null);
    assert.ok(Buffer.from(await bruto.arrayBuffer()).equals(original));
  } finally { server.close(); }
});
