const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const P = require('../prioridades-store.js');
const V = require('../vendedoras-contas.js');

test('e-mail corporativo: "implacil" tem de ser o domínio da empresa, não um pedaço de outro endereço', () => {
  for (const ok of ['ana@implacil.com.br', 'ana@mail.implacil.com.br', 'ana@implacil.com', 'ANA@Implacil.com.br']) assert.equal(V.validarEmailCorporativo(ok), '', ok);
  for (const ruim of ['x@implacil.evil.com', 'x@evil.com/implacil.com.br', 'x@gmail.com', 'x@implacil', 'x@meuimplacil.evil.org']) assert.notEqual(V.validarEmailCorporativo(ruim), '', ruim);
});

test('quem só reforçou o pedido de outra pessoa recebe outro id (que não leva ao id do dono): nunca sai a observação do dono', () => {
  const linha = P.normalizarLinha({ id: 'abc123', pedido: '123456', nivel: 'normal', motivo: 'cliente_aguardando', observacao: 'segredo da Maria', pedidoPor: 'Maria', status: 'recebido', criadoEm: '2026-11-24T10:00:00.000Z', atualizadoEm: '2026-11-24T10:00:00.000Z' });
  const idR = (id) => 'r' + id.split('').reverse().join('');
  const dono = P.visaoMeu(linha, true, idR), outra = P.visaoMeu(linha, false, idR);
  assert.equal(dono.id, 'abc123');
  assert.equal(outra.id, 'r321cba');
  assert.equal(outra.observacao, ''); assert.equal(outra.pedidoPor, '');
});

async function subir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-verif-'));
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
  return { server, dir, adm, base };
}

test('servidor: foto de dia passado não é trocada por uma bem menor, meta inválida é recusada e o histórico do dashboard não some', async () => {
  const { server, dir, adm } = await subir();
  try {
    const ontem = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() - 24 * 3600 * 1000));
    const itens = (n) => Array.from({ length: n }, (_, i) => ['P' + i, 'BH', ontem, 1, 'E', 'A', 2, '']);
    assert.equal((await adm('/api/atraso-historico', { dia: ontem, total: 20, pecas: 20, itens: itens(20) })).status, 200);
    const pequena = await adm('/api/atraso-historico', { dia: ontem, total: 1, pecas: 1, itens: itens(1) });
    assert.equal(pequena.status, 409, 'foto bem menor num dia que já passou é recusada');
    assert.equal((await (await adm('/api/atraso-historico')).json()).meses[ontem.slice(0, 7)].dias[ontem].itens.length, 20, 'e a foto antiga continua lá');
    assert.equal((await adm('/api/atraso-historico', { dia: ontem, total: 1, pecas: 1, itens: itens(1), forcar: true })).status, 200, 'com "forcar" vale');

    assert.equal((await adm('/api/meta-faturamento', { valor: '1e999' })).status, 400);
    assert.equal((await adm('/api/meta-faturamento', { valor: -1 })).status, 400);
    assert.equal((await adm('/api/meta-faturamento', { valor: 1000 })).status, 200);

    // arquivo do histórico do dashboard ilegível: o erro sobe e o arquivo não é regravado só com hoje
    const arq = path.join(dir, 'data', 'dashboard-historico.json');
    const antes = JSON.stringify({ dias: { '2026-11-01': { pedidosHoje: 5, pecasHoje: 9, pecasExpedidasHoje: 1, atualizacoes: 2 } } });
    fs.writeFileSync(arq, '{quebrado');
    await adm('/api/dashboard');
    assert.equal(fs.readFileSync(arq, 'utf8'), '{quebrado', 'e não regrava por cima');
    fs.writeFileSync(arq, antes);
  } finally { server.close(); }
});

test('servidor: cota geral de avisos só conta pedido válido; reforço não revela a observação do dono', async () => {
  const { server, adm, base } = await subir();
  try {
    const k = (await (await adm('/api/vendedoras-link', { acao: 'gerar' })).json()).token;
    const post = (rota, corpo) => fetch(base + rota + '?k=' + k, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', 'X-Forwarded-For': '10.0.0.' + Math.floor(Math.random() * 250) }, body: JSON.stringify(corpo) });
    for (let i = 0; i < 70; i++) await post('/api/vendedoras/aviso', { pedido: 'x', tipo: 'outro', texto: 'a', pedidoPor: 'Bia' });
    const ok = await post('/api/vendedoras/aviso', { pedido: '123456', tipo: 'outro', texto: 'preciso de ajuda aqui', pedidoPor: 'Bia' });
    assert.notEqual(ok.status, 429, 'pedidos inválidos não gastam a cota geral');

    const maria = await (await post('/api/vendedoras/prioridade', { pedido: '654321', nivel: 'normal', motivo: 'cliente_aguardando', observacao: 'segredo da Maria', pedidoPor: 'Maria' })).json();
    assert.ok(maria.linha && maria.linha.id, JSON.stringify(maria));
    const joana = await (await post('/api/vendedoras/prioridade', { pedido: '654321', nivel: 'normal', motivo: 'cliente_aguardando', observacao: 'minha', pedidoPor: 'Joana' })).json();
    assert.notEqual(joana.linha.id, maria.linha.id, 'quem só reforçou recebe outro id');
    const ler = async (ids, nome) => (await (await fetch(base + '/api/vendedoras/prioridades?k=' + k + '&ids=' + ids + '&nome=' + nome)).json()).meus || [];
    assert.equal((await ler(joana.linha.id, 'Maria'))[0].observacao, '', 'com o id de reforço nem dizendo o nome do dono a observação sai');
    assert.equal((await ler(maria.linha.id, 'Maria'))[0].observacao, 'segredo da Maria', 'a dona continua vendo a dela');
  } finally { server.close(); }
});
