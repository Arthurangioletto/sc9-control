const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const V = require('../vendedoras-contas.js');

test('contas: login e código validados, hash com sal (nunca o código), sessão assinada que expira e cai ao trocar o código', async () => {
  assert.equal(V.normalizarLogin(' Ana.Vendas '), 'ana.vendas');
  for (const ruim of ['', 'ab', 'a b c', 'ana@x', 'x'.repeat(25), '../../x']) assert.equal(V.normalizarLogin(ruim), '', 'login inválido: ' + ruim);
  assert.match(V.validarCodigo('abc', 'ana'), /pelo menos 6/); assert.match(V.validarCodigo('123456', 'ana'), /fácil demais/); assert.match(V.validarCodigo('aaaaaaa', 'ana'), /fácil demais/);
  assert.match(V.validarCodigo('ANA.vendas', 'ana.vendas'), /igual ao login/); assert.equal(V.validarCodigo('café-forte-9', 'ana'), '');
  const cred = await V.criarHash('café-forte-9');
  const conta = { id: 'c1', login: 'ana', nome: 'Ana', salt: cred.salt, hash: cred.hash, sv: 0, ativo: true };
  assert.ok(!JSON.stringify(cred).includes('café'));
  assert.equal(await V.conferirCodigo(conta, 'café-forte-9'), true); assert.equal(await V.conferirCodigo(conta, 'café-forte-8'), false); assert.equal(await V.conferirCodigo(null, 'qualquer'), false);
  assert.notEqual((await V.criarHash('café-forte-9')).hash, cred.hash, 'o sal muda o hash');
  assert.deepEqual(Object.keys(V.visaoPublica(Object.assign({}, conta, { x: 1 }))).sort(), ['id', 'login', 'nome']);
  assert.ok(!JSON.stringify(V.visaoAdmin(conta)).match(/salt|hash/));
  const t0 = Date.UTC(2026, 10, 24), seg = 'segredo-de-teste';
  const tok = V.emitirSessao(seg, conta, t0);
  assert.deepEqual(V.lerSessao(seg, tok, t0 + 1000), { id: 'c1', sv: 0 });
  assert.equal(V.lerSessao('outro-segredo', tok, t0), null, 'assinatura com outro segredo');
  assert.equal(V.lerSessao(seg, tok.replace('.c1.', '.c2.'), t0), null, 'token adulterado');
  assert.equal(V.lerSessao(seg, tok, t0 + (V.TTL_SESSAO_S + 5) * 1000), null, 'expirado');
  assert.equal(V.lerSessao(seg, 'lixo', t0), null);
  assert.ok(V.contaDaSessao([conta], V.lerSessao(seg, tok, t0)));
  assert.equal(V.contaDaSessao([Object.assign({}, conta, { sv: 1 })], V.lerSessao(seg, tok, t0)), null, 'trocar o código derruba a sessão');
  assert.equal(V.contaDaSessao([Object.assign({}, conta, { ativo: false })], V.lerSessao(seg, tok, t0)), null, 'conta desativada');
  assert.match(V.codigoTemporario(), /^[a-z2-9]{8}$/);
});

test('exportar: CSV com ; BOM-friendly, aspas escapadas e texto digitado nunca vira fórmula', () => {
  global.window = { document: {} };
  delete require.cache[require.resolve('../central-ui.js')];
  require('../central-ui.js');
  const C = global.window.Central;
  const csv = C.montarCsv(['Pedido', 'Obs'], [['355386', 'cliente "VIP"; retira'], ['355387', '=HYPERLINK("http://x")'], ['355388', '+55 11 9999'], ['355389', '-1'], ['355390', 'linha 1\nlinha 2'], ['355391', null]]);
  const l = csv.split('\r\n');
  assert.equal(l[0], 'Pedido;Obs');
  assert.equal(l[1], '355386;"cliente ""VIP""; retira"');
  assert.equal(l[2], "355387;\"'=HYPERLINK(\"\"http://x\"\")\"", 'fórmula neutralizada');
  assert.equal(l[3], "355388;'+55 11 9999");
  assert.equal(l[4], '355389;-1', 'número negativo continua número');
  assert.equal(l[5], '355390;"linha 1\nlinha 2"', 'quebra de linha dentro de aspas');
  assert.equal(l[6], '355391;');
  assert.equal(C.dataHoraCsv('2026-11-24T15:30:00.000Z'), '24/11/2026 12:30');
  assert.match(C.nomeArquivo('x'), /^x-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('servidor: acesso opcional (criar/entrar/trocar), solicitações ligadas ao login em qualquer aparelho, painel do admin sem segredos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-contas-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'ocorrencias-store.js', 'ocorrencias-lookup.js', 'ocorrencias.js', 'consolidado.js', 'rastreio.js', 'prioridades-store.js', 'vendedoras-contas.js', 'central.css', 'central-ui.js', 'vendedoras.html', 'vendedoras.js', 'prioridades.html', 'prioridades.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  const linha = (o) => Object.assign({ pedido: '0355386', armazem: 'Cambuci', nf: '', nome: 'CLIENTE ALFA', cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Liberado', separador: '', conferente: '' }, o);
  fs.writeFileSync(path.join(data, 'latest.json'), JSON.stringify({ savedAt: '2026-11-24T14:00:00.000Z', orders: [linha({ pedido: '355386' }), linha({ pedido: '355400' }), linha({ pedido: '355401' })], faturamento: [], entregaInfo: [], valores: [] }));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, body, { cookie, token, metodo } = {}) => {
    const r = await fetch(base + url, { method: metodo || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}), ...(token ? { 'X-Vend-Token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  try {
    const admin = (await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) })).headers.get('set-cookie') || '').split(';')[0];
    const k = (await call('/api/vendedoras-link', { acao: 'gerar' }, { cookie: admin })).data.token;
    const U = (rota) => '/api/vendedoras/' + rota + (rota.includes('?') ? '&' : '?') + 'k=' + k;
    const pedido = { pedido: '355386', nivel: 'alta', motivo: 'cliente_aguardando', observacao: 'cliente retira hoje' };

    // sem o link com código, nem a conta abre
    assert.equal((await call('/api/vendedoras/conta?k=errado', { acao: 'criar', nome: 'Ana', login: 'ana', codigo: 'café-forte-9' })).status, 401);
    // validações
    assert.equal((await call(U('conta'), { acao: 'criar', nome: 'Ana', login: 'a', codigo: 'café-forte-9' })).status, 400);
    assert.equal((await call(U('conta'), { acao: 'criar', nome: 'Ana', login: 'ana', codigo: '123' })).status, 400);
    assert.equal((await call(U('conta'), { acao: 'criar', nome: 'Ana', login: 'ana', codigo: '123456' })).status, 400, 'código fácil');
    assert.equal((await call(U('conta'), { acao: 'criar', nome: 'A', login: 'ana', codigo: 'café-forte-9' })).status, 400, 'nome curto');
    // solicitação feita ANTES de ter acesso (só com o nome) e outra de outro nome
    const antes = (await call(U('prioridade'), Object.assign({}, pedido, { pedidoPor: 'Ana' }))).data.linha;
    const doutra = (await call(U('prioridade'), Object.assign({}, pedido, { pedido: '355400', pedidoPor: 'Beatriz' }))).data.linha;
    assert.ok(antes.id && doutra.id);

    const criada = await call(U('conta'), { acao: 'criar', nome: 'Ana', login: 'Ana.Vendas', codigo: 'café-forte-9', ids: [antes.id, doutra.id] });
    assert.equal(criada.status, 200); assert.equal(criada.data.conta.login, 'ana.vendas'); assert.ok(criada.data.token);
    assert.ok(!JSON.stringify(criada.data).match(/salt|hash/));
    const token = criada.data.token;
    assert.equal((await call(U('conta'), { acao: 'criar', nome: 'Outra', login: 'ANA.vendas', codigo: 'outro-codigo-1' })).status, 409, 'login repetido');
    assert.equal((await call(U('conta'), null, { token })).data.conta.nome, 'Ana');
    assert.equal((await call(U('conta'))).data.conta, null, 'sem token não há conta');

    // só ligou a solicitação do MESMO nome; sem passar ids, o login enxerga a dela em qualquer aparelho
    let g = (await call(U('prioridades'), null, { token })).data;
    assert.deepEqual(g.meus.map((x) => x.id), [antes.id], 'a de Beatriz não vira da Ana');
    assert.equal(g.conta.login, 'ana.vendas'); assert.equal(g.sessaoRecusada, false); assert.equal(g.baseEm, '2026-11-24T14:00:00.000Z');
    g = (await call(U('prioridades'))).data;
    assert.deepEqual(g.meus, [], 'sem login e sem ids, nada de "minhas"');
    assert.ok(g.baseEm, 'a hora da carga do SC9 vem junto');

    // com acesso, o nome vem da conta (não do que foi digitado) e fica o login na solicitação
    const nova = await call(U('prioridade'), Object.assign({}, pedido, { pedido: '355401', pedidoPor: 'Qualquer Nome' }), { token });
    assert.equal(nova.status, 200); assert.equal(nova.data.linha.pedidoPor, 'Ana');
    g = (await call(U('prioridades'), null, { token })).data;
    assert.deepEqual(g.meus.map((x) => x.pedido).sort(), ['355386', '355401']);
    const fila = (await call('/api/prioridades', null, { cookie: admin })).data.ativos;
    assert.equal(fila.find((l) => l.pedido === '355401').conta, 'ana.vendas'); assert.equal(fila.find((l) => l.pedido === '355400').conta, '');

    // entrar / código errado / trocar código
    assert.equal((await call(U('conta'), { acao: 'entrar', login: 'ana.vendas', codigo: 'errado-errado' })).status, 401);
    assert.equal((await call(U('conta'), { acao: 'entrar', login: 'nao.existe', codigo: 'café-forte-9' })).status, 401);
    const entrou = await call(U('conta'), { acao: 'entrar', login: 'ANA.vendas', codigo: 'café-forte-9' });
    assert.equal(entrou.status, 200);
    assert.equal((await call(U('conta'), { acao: 'trocar-codigo', codigoAtual: 'café-forte-9', codigoNovo: 'novo-codigo-77' })).status, 401, 'trocar exige estar logada');
    assert.equal((await call(U('conta'), { acao: 'trocar-codigo', codigoAtual: 'errado', codigoNovo: 'novo-codigo-77' }, { token })).status, 401);
    assert.equal((await call(U('conta'), { acao: 'trocar-codigo', codigoAtual: 'café-forte-9', codigoNovo: '123456' }, { token })).status, 400);
    const trocou = await call(U('conta'), { acao: 'trocar-codigo', codigoAtual: 'café-forte-9', codigoNovo: 'novo-codigo-77' }, { token });
    assert.equal(trocou.status, 200);
    assert.equal((await call(U('prioridades'), null, { token })).data.sessaoRecusada, true, 'a sessão antiga caiu');
    assert.equal((await call(U('prioridades'), null, { token: trocou.data.token })).data.sessaoRecusada, false);
    assert.equal((await call(U('conta'), { acao: 'entrar', login: 'ana.vendas', codigo: 'café-forte-9' })).status, 401, 'o código antigo não vale mais');
    assert.equal((await call(U('prioridades'), null, { token: token.slice(0, -3) + 'abc' })).data.sessaoRecusada, true, 'token adulterado');

    // painel do administrador: sem segredo, redefinir, desativar
    assert.equal((await call('/api/vendedoras-contas')).status, 401);
    let lista = await call('/api/vendedoras-contas', null, { cookie: admin });
    assert.equal(lista.status, 200); assert.equal(lista.data.contas.length, 1); assert.equal(lista.data.contas[0].solicitacoes, 2);
    assert.ok(!JSON.stringify(lista.data).match(/salt|hash|café|novo-codigo/));
    const id = lista.data.contas[0].id;
    assert.equal((await call('/api/vendedoras-contas', { acao: 'redefinir', id }, { cookie: 'x=1' })).status, 401);
    const red = await call('/api/vendedoras-contas', { acao: 'redefinir', id }, { cookie: admin });
    assert.match(red.data.codigoTemporario, /^[a-z2-9]{8}$/);
    assert.equal((await call(U('prioridades'), null, { token: trocou.data.token })).data.sessaoRecusada, true, 'redefinir derruba as sessões');
    assert.equal((await call(U('conta'), { acao: 'entrar', login: 'ana.vendas', codigo: red.data.codigoTemporario })).status, 200);
    assert.equal((await call('/api/vendedoras-contas', { acao: 'desativar', id }, { cookie: admin })).status, 200);
    assert.equal((await call(U('conta'), { acao: 'entrar', login: 'ana.vendas', codigo: red.data.codigoTemporario })).status, 401, 'conta desativada não entra');
    assert.equal((await call('/api/vendedoras-contas', { acao: 'apagar', id }, { cookie: admin })).status, 400);
    assert.equal((await call('/api/vendedoras-contas', { acao: 'ativar', id: 'nao-existe' }, { cookie: admin })).status, 404);
    const arquivo = fs.readFileSync(path.join(data, 'vendedoras-contas.json'), 'utf8');
    assert.ok(!/café-forte|novo-codigo|errado/.test(arquivo) && !arquivo.includes(red.data.codigoTemporario), 'o código nunca é guardado');

    // trava por login: 8 erros seguidos bloqueiam (mesmo com o código certo) por alguns minutos
    await call('/api/vendedoras-contas', { acao: 'ativar', id }, { cookie: admin });
    let ultimo = 0;
    for (let i = 0; i < 9; i++) ultimo = (await call(U('conta'), { acao: 'entrar', login: 'ana.vendas', codigo: 'chute-' + i + '-xyz' })).status;
    assert.equal(ultimo, 429, 'trava depois de muitos erros');
    assert.equal((await call(U('conta'), { acao: 'entrar', login: 'ana.vendas', codigo: red.data.codigoTemporario })).status, 429);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
