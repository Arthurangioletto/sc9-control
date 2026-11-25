'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const E = require('../tdc-enderecos.js');

test('ZZ2: só o armazém 01, prefere o endereço do lote e cai nos do produto', () => {
  const zz2 = E.indexarZz2([
    ['01', '01', 'A-01-1', '000123', 'L1', ''], ['01', '1', 'A-01-2', '123', 'L2', ''], ['01', '02', 'Z-99', '123', 'L1', ''], ['01', '59', 'Y-1', '123', 'L1', ''],
    ['01', '1', 'B-05', 'ABC', '', '']
  ]);
  const r = E.consultar([zz2], [{ produto: '123', lote: 'l1' }, { produto: '0123', lote: 'L2' }, { produto: '123', lote: 'L9' }, { produto: 'ABC', lote: 'X' }, { produto: 'NAO', lote: 'L1' }]);
  assert.deepEqual(r['123|L1'], { e: 'A-01-1', x: 1, f: 'zz2' }, 'endereço do lote, sem misturar outros armazéns');
  assert.deepEqual(r['123|L2'], { e: 'A-01-2', x: 1, f: 'zz2' }, 'zeros à esquerda e armazém 1 = 01');
  assert.deepEqual(r['123|L9'], { e: 'A-01-1 / A-01-2', x: 0, f: 'zz2' }, 'lote fora do ZZ2: mostra os do produto');
  assert.equal(r['ABC|X'].e, 'B-05'); assert.equal(r['NAO|L1'], undefined);
});

test('base da Transferência entra como segunda fonte e o ZZ2 tem prioridade', () => {
  const zz2 = E.indexarZz2([['01', '1', 'ZZ-1', 'P1', 'L1', '']]);
  const tr = E.indexarTransferencia([{ sku: 'P1', lote: 'L1', enderecosDestino: { 1: 'TR-9', 2: 'DOIS' } }, { sku: 'P2', lote: 'L2', enderecosDestino: { 1: 'TR-1 / TR-2', 2: 'X' } }, { sku: 'P3', lote: 'L3', enderecosDestino: { 2: 'X' } }]);
  const r = E.consultar([zz2, tr], [{ produto: 'P1', lote: 'L1' }, { produto: 'P2', lote: 'L2' }, { produto: 'P3', lote: 'L3' }]);
  assert.equal(r['P1|L1'].e, 'ZZ-1'); assert.equal(r['P1|L1'].f, 'zz2');
  assert.deepEqual(r['P2|L2'], { e: 'TR-1 / TR-2', x: 1, f: 'transferencia' });
  assert.equal(r['P3|L3'], undefined);
});

test('rota /api/entradas-tdc/enderecos lê o ZZ2 salvo e exige o perfil do TDC', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-tdcend-'));
  for (const f of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'gaveta-core.js', 'tdc-enderecos.js']) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, body, cookie) => {
    const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  };
  try {
    const admin = (await call('/api/login', { password: process.env.APP_PASSWORD })).cookie;
    await call('/api/usuarios', { acao: 'criar', usuario: 'est', nome: 'Est', senha: 'ficticio-123', perfis: ['alteracoes'] }, admin);
    await call('/api/usuarios', { acao: 'criar', usuario: 'sem', nome: 'Sem', senha: 'ficticio-123', perfis: ['saida'] }, admin);
    const est = (await call('/api/login', { usuario: 'est', password: 'ficticio-123' })).cookie, sem = (await call('/api/login', { usuario: 'sem', password: 'ficticio-123' })).cookie;
    const itens = [{ produto: 'P1', lote: 'L1' }, { produto: 'P2', lote: 'LX' }];
    assert.equal((await call('/api/entradas-tdc/enderecos', { itens })).status, 401);
    assert.equal((await call('/api/entradas-tdc/enderecos', { itens }, sem)).status, 403);
    const vazio = await call('/api/entradas-tdc/enderecos', { itens }, est);
    assert.equal(vazio.status, 200); assert.equal(vazio.data.semBase, true); assert.deepEqual(vazio.data.enderecos, {});
    assert.equal((await call('/api/gaveta/carga', { tipo: 'zz2', rows: [['1', '1', 'AB1', 'P1', 'L1', ''], ['1', '1', 'AB2', 'P2', 'L2', ''], ['1', '2', 'ZZ', 'P1', 'L1', '']] }, admin)).status, 200);
    const r = await call('/api/entradas-tdc/enderecos', { itens }, est);
    assert.equal(r.data.semBase, false);
    assert.deepEqual(r.data.enderecos['P1|L1'], { e: 'AB1', x: 1, f: 'zz2' });
    assert.deepEqual(r.data.enderecos['P2|LX'], { e: 'AB2', x: 0, f: 'zz2' });
  } finally { server.close(); }
});

test('coluna e rota estão ligadas no painel do TDC', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'entradas-tdc-ui.js'), 'utf8');
  assert.match(ui, /\/api\/entradas-tdc\/enderecos/); assert.match(ui, /End\. 01 \(ZZ2\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /SERVABLE\.add\("tdc-enderecos\.js"\)/);
});
