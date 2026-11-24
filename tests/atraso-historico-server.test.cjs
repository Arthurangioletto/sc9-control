const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

test('rota do histórico de atraso: só administrador, grava por mês, troca só o mesmo dia e rejeita lixo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-atraso-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'ocorrencias-store.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie;
  async function req(url, body, auth = cookie) {
    const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(auth ? { Cookie: auth } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  }
  const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const ontem = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() - 24 * 3600 * 1000));
  const registro = (dia, total, itens) => ({ dia, total, pecas: 10, itens });
  try {
    assert.equal((await req('/api/atraso-historico', null, '')).status, 401, 'sem login não lê');
    assert.equal((await req('/api/atraso-historico', registro(hoje, 5, []), '')).status, 401, 'sem login não grava');
    cookie = (await req('/api/login', { password: process.env.APP_PASSWORD })).cookie;

    const vazio = (await req('/api/atraso-historico')).data;
    assert.deepEqual(Object.assign({}, vazio, { ocorrencias: undefined }), { meses: {}, expedicao: {}, entregues: {}, saidas: {}, ocorrencias: undefined });
    assert.deepEqual(vazio.ocorrencias.map((o) => o.nf).sort(), ['885234', '886039', '886511'], 'a página recebe as ocorrências da expedição (lista inicial)');
    assert.equal((await req('/api/atraso-historico', registro(ontem, 50, [['P1', 'Cambuci', ontem, 3, 'E', 'A', 2]]))).status, 200);
    assert.equal((await req('/api/atraso-historico', registro(hoje, 60, [['P2', 'BH', ontem, 4, 'F', 'P', 1], ['P3', 'BH', ontem, 1, 'E', 'A', 1]]))).status, 200);
    assert.equal((await req('/api/atraso-historico', registro(hoje, 61, [['P2', 'BH', ontem, 4, 'F', 'A', 1]]))).status, 200, 'o mesmo dia pode ser regravado');

    const dias = Object.assign({}, ...Object.values((await req('/api/atraso-historico?meses=2')).data.meses).map(m => m.dias));
    assert.equal(dias[ontem].total, 50, 'o dia anterior continua');
    assert.equal(dias[hoje].total, 61, 'o dia de hoje foi trocado pela última versão');
    assert.equal(dias[hoje].itens.length, 1);

    assert.equal((await req('/api/atraso-historico', registro('2026-02-31', 5, []))).status, 400, 'data que não existe');
    assert.equal((await req('/api/atraso-historico', registro('2099-01-01', 5, []))).status, 400, 'dia no futuro');
    assert.equal((await req('/api/atraso-historico', registro(hoje, 0, []))).status, 400, 'base vazia');
    assert.equal((await req('/api/atraso-historico', { dia: hoje, total: 3 })).status, 400, 'sem lista de pedidos');
    const arquivos = fs.readdirSync(path.join(dir, 'data')).filter(f => f.startsWith('atraso-historico-'));
    assert.ok(arquivos.length >= 1 && arquivos.every(f => /^atraso-historico-\d{4}-\d{2}\.json$/.test(f)), 'um arquivo por mês');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
