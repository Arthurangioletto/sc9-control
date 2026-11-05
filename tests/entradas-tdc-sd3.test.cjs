'use strict';
// Envio do SD3 (movimentação) pelo perfil do TDC: leitor/compactador do modelo + permissão da rota.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const M = require('../entradas-tdc.js');

/* ---------- modelo ---------- */
const CAB = ['Filial', 'TP Movimento', 'Produto', 'Quantidade', 'Armazém', 'Documento', 'DT Emissão', 'Usuário', 'Lote', 'Tipo RE/DE', 'Estornado', 'Valid. Lote'];
test('detectarColunasSD3: acha o cabeçalho com acento e caixa diferentes', () => {
  const d = M.detectarColunasSD3([['Relatório'], CAB]);
  assert.strictEqual(d.linhaCab, 1);
  assert.deepStrictEqual(d.mapa, { tp: 1, produto: 2, qt: 3, armazem: 4, doc: 5, dt: 6, usuario: 7, lote: 8, cf: 9, estornado: 10, validade: 11 });
  assert.strictEqual(M.detectarColunasSD3([['a', 'b'], ['c']]), null);
  assert.strictEqual(M.detectarColunasSD3([['TP MOVIMENTO', 'PRODUTO']]), null); // falta armazém e quantidade
});
const campos = ['tp', 'produto', 'qt', 'armazem', 'doc', 'lote', 'usuario', 'dt', 'cf', 'estornado', 'validade'];
test('lerSD3 + compactarSD3: mesmo formato da tela inicial (só linhas com lote)', () => {
  const linhas = [
    [999, '0123.0', 10, '59', ' D1 ', 'L1', 'maria', '03/11/2026', 'de4', 'NÃO', '2027-01-31'],
    [499, 'P2', '5', '01', 'D2', 'L1', 'joao', new Date(Date.UTC(2026, 10, 4)), 'RE4', 'SIM', ''],
    [999, 'P3', 1, '59', 'D3', '', 'maria', '2026-11-04', '', '', ''], // sem lote: fica de fora do compacto
    [499, 'P4', 2, '', 'D4', 'L9', 'x', '', '', '', ''],              // sem armazém: ignorada
    ['', '', '', '', '', '', '', '', '', '', ''],
  ];
  const reg = M.lerSD3(linhas, campos);
  assert.strictEqual(reg.length, 3);
  assert.deepStrictEqual(reg[0], { tp: 999, produto: '0123', qt: 10, armazem: '59', doc: 'D1', lote: 'L1', usuario: 'maria', dt: '2026-11-03', cf: 'DE4', estornado: false, validade: '2027-01-31' });
  assert.strictEqual(reg[1].estornado, true); assert.strictEqual(reg[1].dt, '2026-11-04');
  const c = M.compactarSD3(reg);
  assert.strictEqual(c.totalOriginal, 3);
  assert.deepStrictEqual(c.usuarios, ['maria', 'joao']);
  assert.deepStrictEqual(c.cfs, ['DE4', 'RE4']);
  assert.deepStrictEqual(c.rows[0], [999, '0123', 10, '59', 'D1', 'L1', 0, '2026-11-03', 0, 0, '2027-01-31']);
  assert.deepStrictEqual(c.rows[1], [499, 'P2', 5, '01', 'D2', 'L1', 1, '2026-11-04', 1, 1, '']);
  assert.strictEqual(c.rows.length, 2);
  assert.ok(c.rows.every((r) => r.length === 11));
  // volta pelo expandirSD3 que a tela do TDC usa
  const volta = M.expandirSD3(c);
  assert.strictEqual(volta[0].dia, '2026-11-03'); assert.strictEqual(volta[0].usuario, 'maria'); assert.strictEqual(volta[1].estornado, true);
});
test('lerSD3: para depois de 300 linhas vazias seguidas', () => {
  const vazias = Array.from({ length: 301 }, () => ['', '', '', '', '', '', '', '', '', '', '']);
  const reg = M.lerSD3([[999, 'P', 1, '59', 'D', 'L', 'u', '', '', '', ''], ...vazias, [999, 'Q', 1, '59', 'D', 'L', 'u', '', '', '', '']], campos);
  assert.strictEqual(reg.length, 1);
});

/* ---------- servidor ---------- */
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-sd3-'));
for (const f of fs.readdirSync(root)) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(root, f), path.join(dir, f));
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
process.env.PORT = '0'; process.env.APP_PASSWORD = 'sd3-' + crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex'); process.env.NODE_ENV = 'test';
process.env.DATA_DIR = path.join(dir, 'data');
const server = require(path.join(dir, 'server.js'));
let base, admin, tdc, outro;
async function req(url, { body, cookie } = {}) {
  const headers = {}; if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-Sc9-App'] = '1'; }
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(base + url, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch (e) { /* sem corpo */ }
  return { status: r.status, data, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
test.before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  admin = (await req('/api/login', { body: { password: process.env.APP_PASSWORD } })).cookie;
  await req('/api/usuarios', { cookie: admin, body: { acao: 'criar', usuario: 'tdc', nome: 'TDC', senha: 'tdc-123456', perfis: ['alteracoes'] } });
  await req('/api/usuarios', { cookie: admin, body: { acao: 'criar', usuario: 'saida', nome: 'Saida', senha: 'saida-12345', perfis: ['saida'] } });
  tdc = (await req('/api/login', { body: { usuario: 'tdc', password: 'tdc-123456' } })).cookie;
  outro = (await req('/api/login', { body: { usuario: 'saida', password: 'saida-12345' } })).cookie;
});
test.after(() => { server.close(); });

const payload = () => M.compactarSD3(M.lerSD3([[999, 'P1', 3, '59', 'D1', 'L1', 'maria', '2026-11-04', 'DE4', '', '']], campos));
test('SD3: perfil do TDC envia; sem perfil não; admin continua podendo; todos com acesso leem', async () => {
  assert.strictEqual((await req('/api/movimentacao-analise', { body: payload() })).status, 401);
  assert.strictEqual((await req('/api/movimentacao-analise', { cookie: outro, body: payload() })).status, 403);
  const a = await req('/api/movimentacao-analise', { cookie: tdc, body: payload() });
  assert.strictEqual(a.status, 200); assert.strictEqual(a.data.total, 1);
  const b = await req('/api/movimentacao-analise', { cookie: admin, body: payload() });
  assert.strictEqual(b.status, 200);
  const g = await req('/api/movimentacao-analise', { cookie: tdc });
  assert.strictEqual(g.status, 200); assert.strictEqual(g.data.por, 'admin'); assert.strictEqual(g.data.rows[0][5], 'L1');
  assert.strictEqual((await req('/api/movimentacao-analise', { cookie: outro })).status, 403);
  const c = await req('/api/movimentacao-analise', { cookie: tdc, body: payload() });
  assert.strictEqual((await req('/api/movimentacao-analise?meta=1', { cookie: tdc })).data.por, 'tdc'); assert.ok(c.data.savedAt);
});
test('SD3: payload inválido continua rejeitado para o perfil do TDC', async () => {
  assert.strictEqual((await req('/api/movimentacao-analise', { cookie: tdc, body: { rows: [['x']], usuarios: [], cfs: [] } })).status, 400);
  assert.strictEqual((await req('/api/movimentacao-analise', { cookie: tdc, body: { rows: 1 } })).status, 400);
});
