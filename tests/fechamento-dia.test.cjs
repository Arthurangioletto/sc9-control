const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../fechamento-dia.js');

const e = (pedido, transp, extra) => Object.assign({ pedido, recebidoEm: '2026-11-24T14:00:00.000Z', info: { cliente: 'CLIENTE ' + pedido, transportadora: transp, nf: '1' }, volumes: null, naoSaiHoje: null, saiuEntrega: null }, extra || {});

test('fechamento: agrupa por transportadora, soma volumes e separa confirmado, não sai hoje e sem confirmação', () => {
  const f = F.montarFechamento([
    e('1001', 'Retira 02', { volumes: 2, saiuEntrega: { transportadora: 'RETIRA 02', dataEntrega: '2026-11-24' } }),
    e('1002', 'Retira 02', { volumes: 1 }),
    e('1003', 'Retira 02', { naoSaiHoje: { motivo: 'falta nota' } }),
    e('1004', 'TCS', { volumes: 3, saiuEntrega: { transportadora: 'TCS TRANSPORTES', dataEntrega: '2026-11-24' } }),
    e('1005', '', { volumes: 1 })
  ], { dia: '2026-11-24' });
  assert.deepEqual(f.totais, { recebidos: 5, volumes: 7, semVolume: 1, confirmados: 2, naoSai: 1, semConfirmacao: 2, divergencias: 0 });
  const r = f.transportadoras.find((g) => g.nome === 'Retira 02');
  assert.deepEqual([r.recebidos, r.volumes, r.semVolume, r.confirmados, r.naoSai, r.semConfirmacao], [3, 3, 1, 1, 1, 1]);
  assert.equal(r.naoSaiLista[0].motivo, 'falta nota');
  assert.equal(r.semConfirmacaoLista[0].pedido, '1002');
  assert.ok(f.transportadoras.find((g) => g.nome === 'Sem transportadora'), 'pedido sem transportadora não some');
  assert.equal(f.transportadoras[0].semConfirmacao >= f.transportadoras[1].semConfirmacao, true, 'quem tem mais pendência vem primeiro');
});

test('fechamento: transportadora diferente entre o SC5 e a Entrega é sinalizada; nome parecido ou vazio não é', () => {
  const f = F.montarFechamento([
    e('2001', 'Brasil', { saiuEntrega: { transportadora: 'TCS', dataEntrega: '2026-11-24' } }),
    e('2002', 'Brasil', { saiuEntrega: { transportadora: 'BRASIL' } }),
    e('2003', 'São Paulo', { saiuEntrega: { transportadora: 'SAO PAULO EXPRESS' } }),
    e('2004', 'Brasil', { saiuEntrega: { transportadora: '' } })
  ]);
  assert.equal(f.totais.divergencias, 1);
  assert.deepEqual(f.transportadoras[0].divergentes.map((d) => [d.pedido, d.sc5, d.entrega]), [['2001', 'Brasil', 'TCS']]);
  assert.match(F.resumoEmTexto(f, '24/11'), /1 pedido\(s\) com transportadora diferente/);
});

test('fechamento: lista vazia e linhas inválidas não quebram; texto de resumo sai pronto para colar', () => {
  const vazio = F.montarFechamento([null, {}, { pedido: '' }], { dia: '2026-11-24' });
  assert.deepEqual(vazio.totais, { recebidos: 0, volumes: 0, semVolume: 0, confirmados: 0, naoSai: 0, semConfirmacao: 0, divergencias: 0 });
  const f = F.montarFechamento([e('3001', 'TCS', { volumes: 2 })]);
  assert.match(F.resumoEmTexto(f, '24/11'), /^Fechamento da expedição · 24\/11: 1 pedidos recebidos, 0 confirmados na Entrega, 0 que não saem hoje, 1 sem confirmação\.\n- TCS: 1 recebidos, 2 volumes, 0 confirmados, 1 sem confirmação\./);
});

test('servidor: /api/recebimento/fechamento mostra o dia por transportadora, confirma pela planilha de Entrega e exige login', async () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-fech-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..'))) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const hdr = { 'Content-Type': 'application/json', 'X-Sc9-App': '1' };
    assert.equal((await fetch(base + '/api/recebimento/fechamento')).status, 401, 'sem login não abre');
    const login = await fetch(base + '/api/login', { method: 'POST', headers: hdr, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
    const H = Object.assign({ Cookie: login.headers.get('set-cookie').split(';')[0] }, hdr);
    const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    for (const p of ['123456', '234567']) assert.equal((await fetch(base + '/api/recebimento/bipar', { method: 'POST', headers: H, body: JSON.stringify({ pedido: p }) })).status, 200);
    let f = await (await fetch(base + '/api/recebimento/fechamento', { headers: H })).json();
    assert.equal(f.totais.recebidos, 2); assert.equal(f.totais.semConfirmacao, 2); assert.equal(f.entregaEnviadaEm, null);
    const ent = await fetch(base + '/api/recebimento/entrega', { method: 'POST', headers: H, body: JSON.stringify({ nome: 'entrega.xlsx', linhas: [['123456', hoje, 'TCS']] }) });
    assert.equal(ent.status, 200, await ent.clone().text());
    f = await (await fetch(base + '/api/recebimento/fechamento?dia=' + hoje, { headers: H })).json();
    assert.equal(f.totais.confirmados, 1); assert.equal(f.totais.semConfirmacao, 1); assert.ok(f.entregaEnviadaEm);
    assert.equal((await fetch(base + '/api/recebimento/fechamento?dia=ontem', { headers: H })).status, 400);
    assert.equal((await fetch(base + '/fechamento-dia.html')).status, 200);
    assert.equal((await fetch(base + '/fechamento-dia.js')).headers.get('content-type').includes('javascript'), false, 'o módulo de cálculo não é servido ao navegador');
  } finally { server.close(); }
});
