'use strict';
// Rotas /api/indicador-i09: guardam as linhas da SC2 por mês e a configuração (metas, feriados, tipos, Não considera).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-i09-'));
for (const f of ['server.js', 'index.html', 'bundle.js', 'indicador-i09.js', 'indicador-i09-ui.js', 'stock-position.js', 'stock-import.js', 'inventory-integrity.js', 'navigation.js', 'navigation.css', 'lot-filters.js', 'lot-records.js', 'expiry-panel.js', 'operation-overview.js', 'operation-flow.js', 'operation-shipping.js', 'operation-handoff.js', 'operation-transfers.js', 'inventory-presentation.js', 'operation-live.js', 'operation-productivity.js', 'entradas-tdc.js', 'entradas-tdc-ui.js', 'entradas-tdc-relatorio.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
process.env.PORT = '0'; process.env.APP_PASSWORD = 'i09-' + crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex'); process.env.NODE_ENV = 'test';
const server = require(path.join(dir, 'server.js'));
let base, admin, geral, outro;

async function req(url, { body, cookie, header = true } = {}) {
  const headers = {};
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; if (header) headers['X-Sc9-App'] = '1'; }
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(base + url, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch (e) { /* sem corpo */ }
  return { status: r.status, data, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
// [op, seq, produto, descrição, modOP, emissão, real fim, quantidade, produzida, perda, armazém]
const linha = (op, seq, prod, mod, fim, qtd, prd, perda) => [op, seq, prod, 'Produto ' + prod, mod, '2026-10-01', fim, qtd, prd, perda, '18'];

test.before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  admin = (await req('/api/login', { body: { password: process.env.APP_PASSWORD } })).cookie;
  await req('/api/usuarios', { cookie: admin, body: { acao: 'criar', usuario: 'gerente', nome: 'Gerente', senha: 'gerente-123', perfis: ['geral'] } });
  await req('/api/usuarios', { cookie: admin, body: { acao: 'criar', usuario: 'ctrl', nome: 'Ctrl', senha: 'ctrl-12345', perfis: ['controle0201'] } });
  geral = (await req('/api/login', { body: { usuario: 'gerente', password: 'gerente-123' } })).cookie;
  outro = (await req('/api/login', { body: { usuario: 'ctrl', password: 'ctrl-12345' } })).cookie;
});
test.after(() => { server.close(); });

test('front: módulos servidos e carregados na página', async () => {
  for (const f of ['indicador-i09.js', 'indicador-i09-ui.js']) { const r = await fetch(base + '/' + f); assert.strictEqual(r.status, 200); assert.match(r.headers.get('content-type'), /javascript/); }
  assert.match(await (await fetch(base + '/')).text(), /indicador-i09-ui\.js/);
});
test('exige sessão, perfil e cabeçalho CSRF; gravar é só do administrador', async () => {
  assert.strictEqual((await req('/api/indicador-i09')).status, 401);
  assert.strictEqual((await req('/api/indicador-i09', { cookie: outro })).status, 403);
  assert.strictEqual((await req('/api/indicador-i09', { cookie: geral })).status, 200);
  assert.strictEqual((await req('/api/indicador-i09', { cookie: geral, body: { acao: 'apagar', mes: '2026-10' } })).status, 403);
  assert.strictEqual((await req('/api/indicador-i09', { cookie: admin, header: false, body: { acao: 'apagar', mes: '2026-10' } })).status, 403);
});
test('começa vazio e com a configuração padrão', async () => {
  const g = await req('/api/indicador-i09', { cookie: admin });
  assert.deepStrictEqual(g.data.base.meses, {});
  assert.deepStrictEqual(g.data.config.metas, { om: {}, os: {} });
  assert.deepStrictEqual(g.data.config.naoConsidera, []);
});
test('mês: valida, grava só o mês enviado e substitui sem tocar nos outros', async () => {
  const bad = (rows, mes = '2026-10') => req('/api/indicador-i09', { cookie: admin, body: { acao: 'mes', mes, rows } });
  assert.strictEqual((await bad([['x']])).status, 400);
  assert.strictEqual((await bad([linha('1', '001', 'A', 'Montagem Produto Acabado', '2026-09-30', 10, 10, 0)])).status, 400); // fora do mês
  assert.strictEqual((await bad([linha('1', '001', 'A', 'Montagem Produto Acabado', '2026-10-05', 'x', 10, 0)])).status, 400);
  const a = await req('/api/indicador-i09', { cookie: admin, body: { acao: 'mes', mes: '2026-09', ate: '2026-11-01', arquivo: 'set.xlsx', rows: [linha('9', '001', 'A', 'Montagem Produto Acabado', '2026-09-10', 20, 18, 2)] } });
  assert.strictEqual(a.status, 200); assert.deepStrictEqual(a.data.meses, ['2026-09']);
  const b = await req('/api/indicador-i09', { cookie: admin, body: { acao: 'mes', mes: '2026-10', ate: '2026-10-31', rows: [linha('1', '001', 'A', 'Servico de Componente', '2026-10-05', 100, 90, 10), linha('2', '001', 'B', 'Montagem Produto Acabado', '2026-10-06', 50, 50, 0)] } });
  assert.strictEqual(b.status, 200); assert.deepStrictEqual(b.data.meses, ['2026-09', '2026-10']);
  const c = await req('/api/indicador-i09', { cookie: admin, body: { acao: 'mes', mes: '2026-10', ate: '2026-10-31', rows: [linha('1', '001', 'A', 'Servico de Componente', '2026-10-05', 100, 90, 10)] } });
  assert.strictEqual(c.status, 200);
  const g = await req('/api/indicador-i09', { cookie: geral });
  assert.strictEqual(g.data.base.meses['2026-10'].rows.length, 1);
  assert.strictEqual(g.data.base.meses['2026-09'].rows.length, 1);
  assert.strictEqual(g.data.base.meses['2026-09'].ate, '2026-11-01');
  assert.strictEqual(g.data.base.meses['2026-09'].arquivo, 'set.xlsx');
});
test('config: metas de OM e OS, feriados, tipos e Não considera', async () => {
  const post = (config, extra) => req('/api/indicador-i09', { cookie: admin, body: Object.assign({ acao: 'config', config }, extra) });
  assert.strictEqual((await post({ metas: { om: { '2026-10': -1 } } })).status, 400);
  assert.strictEqual((await post({ metas: { os: { outubro: 5 } } })).status, 400);
  assert.strictEqual((await post({ feriados: ['12/10/2026'] })).status, 400);
  assert.strictEqual((await post({ tipos: { A: 5 } })).status, 400);
  assert.strictEqual((await post({ naoConsidera: [''] })).status, 400);
  assert.strictEqual((await post({ metas: { om: { '2026-10': 162055 }, os: { '2026-10': 257000 } }, feriados: ['2026-10-12'], tipos: { A: 'ABUTMENT', B: 'TOOL' }, naoConsidera: ['N1', 'N2'] })).status, 200);
  assert.strictEqual((await post({ tipos: { C: 'COMPONENT' } })).status, 200); // soma
  let c = (await req('/api/indicador-i09', { cookie: geral })).data.config;
  assert.deepStrictEqual(c.metas, { om: { '2026-10': 162055 }, os: { '2026-10': 257000 } });
  assert.deepStrictEqual(Object.keys(c.tipos).sort(), ['A', 'B', 'C']);
  assert.deepStrictEqual(c.naoConsidera, ['N1', 'N2']);
  assert.strictEqual((await post({ tipos: { Z: 'TOOL' } }, { substituirTipos: true })).status, 200); // substitui
  c = (await req('/api/indicador-i09', { cookie: geral })).data.config;
  assert.deepStrictEqual(c.tipos, { Z: 'TOOL' });
  assert.deepStrictEqual(c.metas.om, { '2026-10': 162055 }); // não mexeu nas metas
  assert.strictEqual((await post({ metas: { om: { '2026-10': 0 } } })).status, 200); // meta 0 remove
  assert.deepStrictEqual((await req('/api/indicador-i09', { cookie: geral })).data.config.metas.om, {});
});
test('apagar e importar (carga inicial / cópia de segurança)', async () => {
  assert.strictEqual((await req('/api/indicador-i09', { cookie: admin, body: { acao: 'apagar', mes: '2030-01' } })).status, 404);
  const ap = await req('/api/indicador-i09', { cookie: admin, body: { acao: 'apagar', mes: '2026-09' } });
  assert.strictEqual(ap.status, 200); assert.deepStrictEqual(ap.data.meses, ['2026-10']);
  assert.strictEqual((await req('/api/indicador-i09', { cookie: admin, body: { acao: 'importar', base: { meses: { '2026-11': { rows: [linha('1', '001', 'A', 'Montagem Produto Acabado', '2026-10-05', 1, 1, 0)] } } } } })).status, 400);
  const im = await req('/api/indicador-i09', { cookie: admin, body: { acao: 'importar', base: { meses: { '2026-11': { rows: [linha('1', '001', 'A', 'Montagem Produto Acabado', '2026-11-03', 5, 5, 0)], ate: '2026-11-04', arquivo: 'nov.xlsx' } } }, config: { metas: { os: { '2026-11': 255000 } }, tipos: { A: 'ABUTMENT' }, naoConsidera: ['N9'], feriados: [] } } });
  assert.strictEqual(im.status, 200); assert.deepStrictEqual(im.data.meses, ['2026-11']);
  const g = (await req('/api/indicador-i09', { cookie: geral })).data;
  assert.deepStrictEqual(Object.keys(g.base.meses), ['2026-11']);
  assert.deepStrictEqual(g.config.metas, { om: {}, os: { '2026-11': 255000 } });
  assert.deepStrictEqual(g.config.naoConsidera, ['N9']);
  assert.strictEqual((await req('/api/indicador-i09', { cookie: admin, body: { acao: 'foo' } })).status, 400);
});
