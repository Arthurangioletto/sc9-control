'use strict';
// Rotas /api/entradas-tdc/*: guardam o SD1 (acumulando) e o fichário de revisões.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-tdc-'));
for (const f of ['server.js', 'index.html', 'bundle.js', 'entradas-tdc.js', 'entradas-tdc-ui.js', 'stock-position.js', 'stock-import.js', 'inventory-integrity.js', 'navigation.js', 'navigation.css', 'lot-filters.js', 'lot-records.js', 'expiry-panel.js', 'operation-overview.js', 'operation-flow.js', 'operation-shipping.js', 'operation-handoff.js', 'operation-transfers.js', 'inventory-presentation.js', 'operation-live.js', 'operation-productivity.js', 'entradas-tdc-relatorio.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
process.env.PORT = '0'; process.env.APP_PASSWORD = 'tdc-' + crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex'); process.env.NODE_ENV = 'test';
const server = require(path.join(dir, 'server.js'));
let base, admin, comPerfil, semPerfil;

async function req(url, { body, cookie, header = true } = {}) {
  const headers = {};
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; if (header) headers['X-Sc9-App'] = '1'; }
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(base + url, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch (e) { /* sem corpo */ }
  return { status: r.status, data, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const linha = (nota, prod, lote, qt, dia, u = 0) => [nota, '1', 'FORN', prod, lote, qt, '59', dia, '09:00', u, dia, ''];

test.before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  admin = (await req('/api/login', { body: { password: process.env.APP_PASSWORD } })).cookie;
  await req('/api/usuarios', { cookie: admin, body: { acao: 'criar', usuario: 'estoque', nome: 'Estoque', senha: 'estoque-123', perfis: ['alteracoes'] } });
  await req('/api/usuarios', { cookie: admin, body: { acao: 'criar', usuario: 'ctrl', nome: 'Ctrl', senha: 'ctrl-12345', perfis: ['controle0201'] } });
  comPerfil = (await req('/api/login', { body: { usuario: 'estoque', password: 'estoque-123' } })).cookie;
  semPerfil = (await req('/api/login', { body: { usuario: 'ctrl', password: 'ctrl-12345' } })).cookie;
});
test.after(() => { server.close(); });

test('front: módulos novos são servidos', async () => {
  for (const f of ['entradas-tdc.js', 'entradas-tdc-ui.js']) {
    const r = await fetch(base + '/' + f); assert.strictEqual(r.status, 200); assert.match(r.headers.get('content-type'), /javascript/);
  }
  assert.match(await (await fetch(base + '/')).text(), /entradas-tdc-ui\.js/);
});
test('exige sessão, perfil e cabeçalho CSRF', async () => {
  assert.strictEqual((await req('/api/entradas-tdc/sd1')).status, 401);
  assert.strictEqual((await req('/api/entradas-tdc/fichas')).status, 401);
  assert.strictEqual((await req('/api/entradas-tdc/sd1', { cookie: semPerfil })).status, 403);
  assert.strictEqual((await req('/api/entradas-tdc/sd1', { cookie: semPerfil, body: { rows: [linha('1', 'P', 'L', 1, '2026-10-01')], usuarios: ['a'] } })).status, 403);
  assert.strictEqual((await req('/api/entradas-tdc/fichas', { cookie: semPerfil, body: { id: 'x', ficha: { status: 'confirmado' } } })).status, 403);
  assert.strictEqual((await req('/api/entradas-tdc/sd1', { cookie: admin, header: false, body: { rows: [], usuarios: [] } })).status, 403);
});
test('SD1: 404 antes do envio, valida e acumula sem duplicar', async () => {
  assert.strictEqual((await req('/api/entradas-tdc/sd1', { cookie: comPerfil })).status, 404);
  assert.strictEqual((await req('/api/entradas-tdc/sd1', { cookie: comPerfil, body: { rows: [], usuarios: [] } })).status, 400);
  assert.strictEqual((await req('/api/entradas-tdc/sd1', { cookie: comPerfil, body: { rows: [['x']], usuarios: [] } })).status, 400);
  const a = await req('/api/entradas-tdc/sd1', { cookie: comPerfil, body: { rows: [linha('1', 'P1', 'L1', 8, '2026-10-01'), linha('2', 'P2', 'L2', 5, '2026-10-01', 1)], usuarios: ['maria', 'joao'], arquivo: 'a.xlsx' } });
  assert.strictEqual(a.status, 200); assert.strictEqual(a.data.novas, 2); assert.strictEqual(a.data.total, 2);
  const b = await req('/api/entradas-tdc/sd1', { cookie: comPerfil, body: { rows: [linha('1', 'P1', 'L1', 8, '2026-10-01'), linha('3', 'P3', 'L3', 4, '2026-10-02', 0)], usuarios: ['Maria'] } });
  assert.strictEqual(b.data.novas, 1); assert.strictEqual(b.data.total, 3);
  const g = await req('/api/entradas-tdc/sd1', { cookie: admin });
  assert.strictEqual(g.status, 200); assert.strictEqual(g.data.rows.length, 3); assert.deepStrictEqual(g.data.usuarios, ['maria', 'joao']);
  assert.strictEqual(g.data.rows[2][9], 0); // usuário 'Maria' reaproveita o índice de 'maria'
  const c = await req('/api/entradas-tdc/sd1', { cookie: admin, body: { rows: [linha('9', 'P9', 'L9', 1, '2026-10-03')], usuarios: ['x'], substituir: true } });
  assert.strictEqual(c.data.total, 1);
});
test('fichário: confirma, descarta, remove só manual, carimba quem revisou', async () => {
  assert.strictEqual((await req('/api/entradas-tdc/fichas', { cookie: comPerfil, body: { id: 'a', ficha: { status: 'invalido' } } })).status, 400);
  const id = '100|1|P1|L1|qtd_maior';
  const r = await req('/api/entradas-tdc/fichas', { cookie: comPerfil, body: { id, ficha: { status: 'confirmado', tipo: 'qtd_maior', obs: 'contei 10', fisicoQtd: 10, por: 'fraude', em: '2000-01-01' } } });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.data.ficha.por, 'estoque'); assert.notStrictEqual(r.data.ficha.em, '2000-01-01'); assert.strictEqual(r.data.ficha.fisicoQtd, 10);
  const man = 'MANUAL|abc';
  await req('/api/entradas-tdc/fichas', { cookie: admin, body: { id: man, ficha: { status: 'confirmado', tipo: 'lote_trocado', produto: 'PX', lote: 'A', loteFisico: 'B', qtdNota: 5, qtdFisica: 5 } } });
  const g = await req('/api/entradas-tdc/fichas', { cookie: comPerfil });
  assert.strictEqual(g.data.fichas[man].produto, 'PX'); assert.ok(g.data.fichas[id]);
  assert.strictEqual((await req('/api/entradas-tdc/fichas', { cookie: admin, body: { id, remover: true, ficha: {} } })).status, 400);
  assert.strictEqual((await req('/api/entradas-tdc/fichas', { cookie: admin, body: { id: man, remover: true, ficha: {} } })).status, 200);
  assert.strictEqual((await req('/api/entradas-tdc/fichas', { cookie: admin })).data.fichas[man], undefined);
});
test('notas em conferência: adiciona sem duplicar (zeros à esquerda), valida e remove', async () => {
  assert.strictEqual((await req('/api/entradas-tdc/notas')).status, 401);
  assert.strictEqual((await req('/api/entradas-tdc/notas', { cookie: semPerfil })).status, 403);
  assert.strictEqual((await req('/api/entradas-tdc/notas', { cookie: comPerfil, body: { nota: '' } })).status, 400);
  assert.strictEqual((await req('/api/entradas-tdc/notas', { cookie: comPerfil, body: { nota: '1;DROP' } })).status, 400);
  await req('/api/entradas-tdc/notas', { cookie: comPerfil, body: { nota: '000123', serie: '1' } });
  const r = await req('/api/entradas-tdc/notas', { cookie: comPerfil, body: { nota: '123', serie: '1' } });
  assert.strictEqual(Object.keys(r.data.notas).length, 1); assert.strictEqual(r.data.notas['123|1'].por, 'estoque');
  assert.strictEqual(Object.keys((await req('/api/entradas-tdc/notas', { cookie: admin })).data.notas).length, 1);
  const d = await req('/api/entradas-tdc/notas', { cookie: admin, body: { nota: '123', serie: '1', remover: true } });
  assert.strictEqual(Object.keys(d.data.notas).length, 0);
});
test('SD1 reenviado: nota que vem de novo é substituída (corrigida), nota nova entra, as demais ficam', async () => {
  await req('/api/entradas-tdc/sd1', { cookie: admin, body: { rows: [linha('10', 'P1', 'L1', 5, '2026-10-01'), linha('11', 'P2', 'L2', 7, '2026-10-01')], usuarios: ['a'], substituir: true } });
  const r = await req('/api/entradas-tdc/sd1', { cookie: admin, body: { rows: [linha('10', 'P1', 'L1', 6, '2026-10-01'), linha('12', 'P3', 'L3', 1, '2026-10-02')], usuarios: ['a'] } });
  assert.strictEqual(r.data.notasNovas, 1); assert.strictEqual(r.data.notasAtualizadas, 1); assert.strictEqual(r.data.total, 3);
  const g = (await req('/api/entradas-tdc/sd1', { cookie: admin })).data.rows;
  assert.strictEqual(g.find((x) => x[0] === '10')[5], 6); assert.strictEqual(g.find((x) => x[0] === '11')[5], 7);
});
// JPEG mínimo válido (1x1)
const JPG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
test('fotos: valida, guarda e devolve só para quem tem perfil', async () => {
  const dataUrl = 'data:image/jpeg;base64,' + JPG;
  assert.strictEqual((await req('/api/entradas-tdc/fotos', { cookie: semPerfil, body: { dataUrl } })).status, 403);
  assert.strictEqual((await req('/api/entradas-tdc/fotos', { cookie: comPerfil, body: { dataUrl: 'data:text/html;base64,PGI+' } })).status, 400);
  assert.strictEqual((await req('/api/entradas-tdc/fotos', { cookie: comPerfil, body: { dataUrl: 'data:image/jpeg;base64,' + Buffer.from('nao sou imagem').toString('base64') } })).status, 400);
  assert.strictEqual((await req('/api/entradas-tdc/fotos', { cookie: comPerfil, body: { dataUrl: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(1000 * 1024)]).toString('base64') } })).status, 400);
  const up = await req('/api/entradas-tdc/fotos', { cookie: comPerfil, body: { dataUrl } });
  assert.strictEqual(up.status, 200); assert.match(up.data.id, /^[a-f0-9]{24}$/);
  const g = await fetch(base + '/api/entradas-tdc/fotos?id=' + up.data.id, { headers: { Cookie: comPerfil } });
  assert.strictEqual(g.status, 200); assert.strictEqual(g.headers.get('content-type'), 'image/jpeg'); assert.strictEqual(g.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual((await fetch(base + '/api/entradas-tdc/fotos?id=' + up.data.id)).status, 401);
  assert.strictEqual((await fetch(base + '/api/entradas-tdc/fotos?id=' + up.data.id, { headers: { Cookie: semPerfil } })).status, 403);
  assert.strictEqual((await fetch(base + '/api/entradas-tdc/fotos?id=../../x', { headers: { Cookie: comPerfil } })).status, 400);
  assert.strictEqual((await fetch(base + '/api/entradas-tdc/fotos?id=' + 'a'.repeat(24), { headers: { Cookie: comPerfil } })).status, 404);
  // a ficha guarda só ids válidos, no máximo 4
  const f = await req('/api/entradas-tdc/fichas', { cookie: comPerfil, body: { id: 'x|1', ficha: { status: 'confirmado', fotos: [up.data.id, '../etc', 'zz', up.data.id, up.data.id, up.data.id, up.data.id], protheus: 'subiu 10 de 8' } } });
  assert.strictEqual(f.data.ficha.fotos.length, 4); assert.ok(f.data.ficha.fotos.every((x) => /^[a-f0-9]{24}$/.test(x))); assert.strictEqual(f.data.ficha.protheus, 'subiu 10 de 8');
});
