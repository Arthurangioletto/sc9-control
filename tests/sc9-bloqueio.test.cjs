const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// Bloqueio de crédito/estoque do SC9: as linhas bloqueadas continuam FORA de todas as contas (o parser as descarta como sempre);
// o código do bloqueio é guardado À PARTE só para a vendedora ver por que o pedido não anda.

// ---- parser do bundle (tn), isolado com um SC9 de brincadeira: as linhas aceitas não mudam e o bloqueio vai para o lado ----
function parserDoBundle() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bundle.js'), 'utf8');
  const i = src.indexOf('function tn(t,a){'), j = src.indexOf('function Gs(t){', i);
  assert.ok(i > 0 && j > i, 'achou o parser do SC9 no bundle');
  const fonte = src.slice(i, j);
  // 'o' = a planilha: linhas { colunaPorNome } ; Us devolve o mapa de colunas e Y lê a coluna da linha
  const stubs = {
    Qe: { utils: { decode_range: (ref) => ({ s: { r: 0 }, e: { r: Number(String(ref).split(':')[1]) } }) } },
    Us: (o, Vs) => Vs, Y: (o, r, c) => (o.rows[r] ? o.rows[r][c] : null), Le: (x) => String(x == null ? '' : x).trim(),
    lo: { Cambuci: 1, Tambore: 1 }, Co: () => null, no: (x) => x, en: () => null,
    Vs: { pedido: 'pedido', produto: 'produto', lote: 'lote', qt: 'qt', dt: 'dt', cliente: 'cliente', nome: 'nome', nf: 'nf', bc: 'bc', be: 'be', arm: 'arm', romaneio: 'rom', dtIniSep: 'a', horaIniSep: 'b', dtFimPick: 'c', hrFimPick: 'd', dtIniConf: 'e', horaIniConf: 'f', dtFimConf: 'g', horaFimConf: 'h', horaLiberacao: 'hl', sep: 'sep', conf: 'conf', transp: 'tr' }
  };
  return new Function(...Object.keys(stubs), fonte + '; return tn;')(...Object.values(stubs));
}
const linha = (pedido, extra) => Object.assign({ pedido, produto: 'P' + pedido, qt: 3, arm: '1', bc: null, be: null, nome: 'CLI' }, extra);
const planilha = (rows) => ({ SheetNames: ['SC9'], Sheets: { SC9: { '!ref': 'A:' + rows.length, rows: [{}].concat(rows) } } });

test('parser: linha bloqueada continua descartada e o código vai para o lado (por pedido)', () => {
  const tn = parserDoBundle();
  const livre = tn(planilha([linha('100001'), linha('100002', { bc: 10 }), linha('100003', { be: '' })]), null);
  const comBloq = tn(planilha([linha('100001'), linha('100002', { bc: 10 }), linha('100003', { be: '' }), linha('200001', { bc: '01' }), linha('200001', { bc: '01', be: '02' }), linha('200002', { be: '02' }), linha('100001', { bc: '04' })]), null);
  assert.deepEqual(comBloq.map((x) => x.pedido + ':' + x.produto), livre.map((x) => x.pedido + ':' + x.produto), 'as linhas aceitas são exatamente as mesmas de antes');
  assert.equal(comBloq.length, 3);
  assert.ok(!livre.bloq, 'sem bloqueio não cria nada');
  assert.deepEqual([...comBloq.bloq.keys()].sort(), ['100001', '200001', '200002']);
  assert.deepEqual(comBloq.bloq.get('200001'), { c: ['01'], e: ['02'], n: 2 });
  assert.deepEqual(comBloq.bloq.get('200002'), { c: [], e: ['02'], n: 1 });
  assert.deepEqual(comBloq.bloq.get('100001').c, ['04'], 'pedido com uma linha livre e outra bloqueada aparece nos dois');
});

// ---- rastreio ----
const R = require('../rastreio.js');
const ordem = (pedido) => ({ pedido, armazem: 'Cambuci', nf: '', nome: 'CLIENTE ' + pedido, cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Liberado' });

test('rastreio: pedido só bloqueado, pedido com parte bloqueada e pedido sem bloqueio', () => {
  const snap = { savedAt: '2026-11-27T10:00:00.000Z', orders: [ordem('300001'), ordem('300002')], items: [], bloqueioPorPedido: [['300001', { c: ['04'], e: [], n: 1 }], ['400001', { c: ['01'], e: ['02'], n: 3 }], ['500001', { c: [], e: [], n: 1 }], ['<img>', { c: ['01'] }]] };
  const so = R.montarRastreio(snap, '400001', { agora: new Date('2026-11-27T12:00:00Z') });
  assert.equal(so.achado, false);
  assert.equal(so.bloqueio.parcial, false);
  assert.match(so.bloqueio.texto, /crédito \(código 01\) e estoque \(código 02\)/);
  assert.equal(so.bloqueio.linhas, 3);
  const parte = R.montarRastreio(snap, '300001', { agora: new Date('2026-11-27T12:00:00Z') });
  assert.equal(parte.achado, true); assert.equal(parte.bloqueio.parcial, true); assert.deepEqual(parte.bloqueio.credito, ['04']);
  const normal = R.montarRastreio(snap, '300002', { agora: new Date('2026-11-27T12:00:00Z') });
  assert.equal(normal.achado, true); assert.equal(normal.bloqueio, null);
  assert.equal(R.montarRastreio(snap, '500001', {}).bloqueio, undefined, 'sem código nenhum não é bloqueio');
  assert.equal(R.montarRastreio(snap, '999999', {}).bloqueio, undefined);
  assert.equal(R.montarRastreio({ orders: [ordem('300002')], items: [] }, '300002', { agora: new Date() }).bloqueio, null, 'base antiga, sem o campo, continua funcionando');
});

// ---- servidor ----
async function subir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-bloq-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..'))) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, body, cookie) => {
    const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = {}; try { json = await r.json(); } catch (e) { /* vazio */ } return { status: r.status, data: json };
  };
  const lg = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
  const admin = (lg.headers.get('set-cookie') || '').split(';')[0];
  return { server, call, admin };
}

test('servidor: a vendedora vê o bloqueio; solicitar para pedido bloqueado não diz "fora do SC9"; cancelar tem aviso próprio', async () => {
  const { server, call, admin } = await subir();
  try {
    const salvo = await call('/api/save', { orders: [ordem('300002')], items: [], itemNames: [], saldoPorLote: [], warehousesPresent: ['Cambuci'], cutoff: '2026-11-27', faturamento: [], entregaInfo: [], valores: [], bloqueioPorPedido: [['400001', { c: ['01'], e: [], n: 2 }]] }, admin);
    assert.equal(salvo.status, 200);
    const k = (await call('/api/vendedoras-link', { acao: 'gerar' }, admin)).data.token;
    const U = (rota) => '/api/vendedoras/' + rota + (rota.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(k);
    const p = (await call(U('pedido?pedido=400001'))).data;
    assert.equal(p.achado, false); assert.equal(p.bloqueio.credito[0], '01'); assert.equal(p.etapa, 'bloqueado');
    assert.equal((await call(U('pedido?pedido=300002'))).data.bloqueio, null);
    const varios = (await call(U('pedidos?pedidos=400001,300002'))).data.pedidos;
    assert.equal(varios.find((x) => x.pedido === '400001').bloqueio.linhas, 2);
    const env = await call(U('solicitacao'), { tipo: 'cancelar_pedido', pedido: '400001', pedidoPor: 'Gi QA', dados: { motivo: 'cliente desistiu' }, texto: 'cliente desistiu' });
    assert.equal(env.status, 200, JSON.stringify(env.data));
    assert.equal(env.data.naoAchado, false, 'está no Protheus: a equipe não precisa "recarregar o SC9"');
    assert.equal(env.data.etapa, 'bloqueado'); assert.equal(env.data.linha.aTempo, true);
    assert.match(env.data.aviso, /bloqueado/);
    const fora = await call(U('solicitacao'), { tipo: 'cancelar_pedido', pedido: '999999', pedidoPor: 'Gi QA', dados: { motivo: 'teste do fora' }, texto: 'teste' });
    assert.equal(fora.data.naoAchado, true, 'pedido que não existe continua como antes');
  } finally { server.close(); }
});
