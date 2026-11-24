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
  assert.deepEqual(Object.keys(V.visaoPublica(Object.assign({}, conta, { x: 1 }))).sort(), ['email', 'id', 'login', 'nome']);
  // e-mail corporativo: "implacil" só vale no domínio
  assert.equal(V.validarEmailCorporativo('ana@implacil.com.br'), '');
  assert.equal(V.validarEmailCorporativo('  Ana.Silva@Filial.IMPLACIL.com  '), '');
  assert.notEqual(V.validarEmailCorporativo('ana@gmail.com'), '');
  assert.notEqual(V.validarEmailCorporativo('implacil@gmail.com'), '');
  assert.notEqual(V.validarEmailCorporativo(''), '');
  assert.equal(V.normalizarEmail('  Ana@Implacil.COM.br '), 'ana@implacil.com.br');

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
    assert.equal((await call('/api/vendedoras/conta?k=errado', { acao: 'criar', nome: 'Ana', login: 'ana', email: 'ana@implacil.com.br', codigo: 'café-forte-9' })).status, 401);
    // validações
    assert.equal((await call(U('conta'), { acao: 'criar', nome: 'Ana', login: 'a', email: 'a@implacil.com.br', codigo: 'café-forte-9' })).status, 400);
    assert.equal((await call(U('conta'), { acao: 'criar', nome: 'Ana', login: 'ana', email: 'ana@implacil.com.br', codigo: '123' })).status, 400);
    assert.equal((await call(U('conta'), { acao: 'criar', nome: 'Ana', login: 'ana', email: 'ana@implacil.com.br', codigo: '123456' })).status, 400, 'código fácil');
    assert.equal((await call(U('conta'), { acao: 'criar', nome: 'A', login: 'ana', email: 'ana@implacil.com.br', codigo: 'café-forte-9' })).status, 400, 'nome curto');
    // e-mail corporativo: obrigatório e com "implacil" no domínio
    for (const [email, motivo] of [[undefined, 'sem e-mail'], ['', 'e-mail vazio'], ['ana', 'sem @'], ['ana@gmail.com', 'domínio de fora'], ['implacil@gmail.com', 'implacil só antes do @'], ['ana@@implacil.com.br', 'e-mail malformado']]) {
      const r = await call(U('conta'), { acao: 'criar', nome: 'Ana', login: 'ana', email, codigo: 'café-forte-9' });
      assert.equal(r.status, 400, motivo); assert.match(r.data.error, /implacil/i, motivo);
    }

    // solicitação feita ANTES de ter acesso (só com o nome) e outra de outro nome
    const antes = (await call(U('prioridade'), Object.assign({}, pedido, { pedidoPor: 'Ana' }))).data.linha;
    const doutra = (await call(U('prioridade'), Object.assign({}, pedido, { pedido: '355400', pedidoPor: 'Beatriz' }))).data.linha;
    assert.ok(antes.id && doutra.id);

    const criada = await call(U('conta'), { acao: 'criar', nome: 'Ana', login: 'Ana.Vendas', email: 'ana.vendas@implacil.com.br', codigo: 'café-forte-9', ids: [antes.id, doutra.id] });
    assert.equal(criada.status, 200); assert.equal(criada.data.conta.login, 'ana.vendas'); assert.ok(criada.data.token);
    assert.ok(!JSON.stringify(criada.data).match(/salt|hash/));
    const token = criada.data.token;
    assert.equal((await call(U('conta'), { acao: 'criar', nome: 'Outra', login: 'ANA.vendas', email: 'ana.vendas@implacil.com.br', codigo: 'outro-codigo-1' })).status, 409, 'login repetido');
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

test('servidor: cada vendedora vê só o que é dela (solicitações e consultas gravadas no servidor); o administrador vê tudo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-priv-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'ocorrencias-store.js', 'ocorrencias-lookup.js', 'ocorrencias.js', 'consolidado.js', 'rastreio.js', 'prioridades-store.js', 'vendedoras-contas.js', 'central.css', 'central-ui.js', 'vendedoras.html', 'vendedoras.js', 'prioridades.html', 'prioridades.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  const linha = (o) => Object.assign({ pedido: '0355386', armazem: 'Cambuci', nf: '', nome: 'CLIENTE ALFA', cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Liberado', separador: '', conferente: '' }, o);
  fs.writeFileSync(path.join(data, 'latest.json'), JSON.stringify({ savedAt: '2026-11-24T14:00:00.000Z', orders: [linha({ pedido: '355386' }), linha({ pedido: '355400' })], faturamento: [], entregaInfo: [], valores: [] }));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, body, { cookie, token } = {}) => {
    const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}), ...(token ? { 'X-Vend-Token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  try {
    const admin = (await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) })).headers.get('set-cookie') || '').split(';')[0];
    const k = (await call('/api/vendedoras-link', { acao: 'gerar' }, { cookie: admin })).data.token;
    const U = (rota) => '/api/vendedoras/' + rota + (rota.includes('?') ? '&' : '?') + 'k=' + k;
    const nova = async (nome, login) => (await call(U('conta'), { acao: 'criar', nome, login, email: login + '@implacil.com.br', codigo: 'codigo-' + login + '-9' })).data.token;
    const ana = await nova('Ana', 'ana.v'), bia = await nova('Bia', 'bia.v');
    assert.ok(ana && bia);

    // consultas: só com login, sem atualização automática, sem repetir o mesmo pedido em 10 min
    await call(U('pedido?pedido=355386'), null, { token: ana });
    await call(U('pedido?pedido=355386'), null, { token: ana });
    await call(U('pedido?pedido=355400&auto=1'), null, { token: ana });
    await call(U('pedido?pedido=999999'), null, { token: ana });
    await call(U('pedido?pedido=355400'));
    await call(U('pedido?pedido=355400'), null, { token: bia });
    const minhas = (await call(U('consultas'), null, { token: ana })).data;
    assert.equal(minhas.conta.login, 'ana.v');
    assert.deepEqual(minhas.consultas.map((x) => x.pedido), ['999999', '355386'], 'da mais nova para a mais antiga, sem repetida, sem automática e sem a de outra');
    assert.equal(minhas.consultas[0].achado, false); assert.match(minhas.consultas[1].situacao, /Atrasado/); assert.equal(minhas.consultas[1].filial, 'Cambuci');
    assert.deepEqual((await call(U('consultas'))).data, { conta: null, consultas: [] }, 'sem login não há registro');
    assert.deepEqual((await call(U('consultas'), null, { token: bia })).data.consultas.map((x) => x.pedido), ['355400']);

    // administrador vê tudo; vendedora não acessa a rota do admin
    assert.equal((await call('/api/vendedoras-consultas')).status, 401);
    assert.equal((await call('/api/vendedoras-consultas', null, { cookie: 'x=1' })).status, 401);
    const todas = (await call('/api/vendedoras-consultas', null, { cookie: admin })).data.consultas;
    assert.equal(todas.length, 3); assert.deepEqual(todas.map((x) => x.conta).sort(), ['ana.v', 'ana.v', 'bia.v']);
    assert.equal((await call('/api/vendedoras-consultas?login=BIA.v', null, { cookie: admin })).data.consultas.length, 1);
    assert.equal((await call('/api/vendedoras-consultas?login=$$', null, { cookie: admin })).data.consultas.length, 0);
    const contas = (await call('/api/vendedoras-contas', null, { cookie: admin })).data.contas;
    assert.deepEqual(contas.map((c) => [c.login, c.consultas]).sort(), [['ana.v', 2], ['bia.v', 1]]);
    const arq = fs.readFileSync(path.join(data, 'vendedoras-consultas.json'), 'utf8');
    assert.ok(!arq.includes(ana) && !arq.includes(bia) && !/codigo-/.test(arq), 'o registro não guarda token nem código');

    // solicitações: cada uma vê só a sua; quem reforça o pedido de outra não vê a observação dela
    const pedido = { pedido: '355386', nivel: 'alta', motivo: 'cliente_aguardando' };
    const dela = await call(U('prioridade'), Object.assign({}, pedido, { observacao: 'segredo da Ana: cliente VIP' }), { token: ana });
    assert.equal(dela.data.linha.observacao, 'segredo da Ana: cliente VIP'); assert.equal(dela.data.linha.reforco, false);
    const reforco = await call(U('prioridade'), Object.assign({}, pedido, { observacao: 'nota da Bia' }), { token: bia });
    assert.equal(reforco.data.duplicado, true);
    assert.equal(reforco.data.linha.observacao, '', 'não devolve a observação da outra'); assert.equal(reforco.data.linha.pedidoPor, ''); assert.equal(reforco.data.linha.motivo, ''); assert.equal(reforco.data.linha.reforco, true);
    assert.ok(!JSON.stringify(reforco.data).includes('segredo da Ana'));
    let g = (await call(U('prioridades'), null, { token: ana })).data;
    assert.equal(g.fila, undefined, 'não existe lista geral'); assert.equal(g.meus.length, 1); assert.equal(g.meus[0].observacao, 'segredo da Ana: cliente VIP'); assert.equal(g.meus[0].reforco, false);
    g = (await call(U('prioridades'), null, { token: bia })).data;
    assert.equal(g.meus.length, 1, 'a Bia também acompanha o pedido que reforçou'); assert.equal(g.meus[0].reforco, true); assert.ok(!JSON.stringify(g).includes('segredo da Ana') && !JSON.stringify(g).includes('"Ana"'));
    const carla = (await call(U('prioridades?ids=' + dela.data.linha.id + '&nome=Carla'))).data;
    assert.equal(carla.meus[0].observacao, '', 'com o id mas sem ser a dona: sem observação');
    assert.equal((await call(U('prioridades'))).data.meus.length, 0);
    // o administrador vê tudo, inclusive quem reforçou
    const adm = (await call('/api/prioridades', null, { cookie: admin })).data.ativos;
    assert.equal(adm.length, 1); assert.equal(adm[0].observacao, 'segredo da Ana: cliente VIP'); assert.equal(adm[0].conta, 'ana.v');
    assert.ok(adm[0].historico.some((h) => h.acao === 'reforco' && h.conta === 'bia.v' && h.texto === 'nota da Bia'));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('servidor: pedido que ainda não está no SC9 pode ser incluído; a equipe é sinalizada e o aviso some quando o SC9 é recarregado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-fora-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'ocorrencias-store.js', 'ocorrencias-lookup.js', 'ocorrencias.js', 'consolidado.js', 'rastreio.js', 'prioridades-store.js', 'vendedoras-contas.js', 'central.css', 'central-ui.js', 'vendedoras.html', 'vendedoras.js', 'prioridades.html', 'prioridades.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  const linha = (o) => Object.assign({ pedido: '0355386', armazem: 'Cambuci', nf: '', nome: 'CLIENTE ALFA', cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Liberado', separador: '', conferente: '' }, o);
  const gravarSnap = (orders, savedAt) => fs.writeFileSync(path.join(data, 'latest.json'), JSON.stringify({ savedAt, orders, faturamento: [], entregaInfo: [], valores: [] }));
  gravarSnap([linha({ pedido: '355386' })], '2026-11-24T14:00:00.000Z');
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, body, { cookie } = {}) => {
    const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  try {
    const admin = (await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) })).headers.get('set-cookie') || '').split(';')[0];
    const k = (await call('/api/vendedoras-link', { acao: 'gerar' }, { cookie: admin })).data.token;
    const U = (rota) => '/api/vendedoras/' + rota + (rota.includes('?') ? '&' : '?') + 'k=' + k;
    const pedido = { pedido: '888777', nivel: 'alta', motivo: 'cliente_aguardando', pedidoPor: 'Bia' };

    // o pedido não está no SC9: a consulta diz que não achou, mas a solicitação entra
    assert.equal((await call(U('pedido?pedido=888777'))).data.achado, false);
    const enviada = await call(U('prioridade'), pedido);
    assert.equal(enviada.status, 200); assert.equal(enviada.data.naoAchado, true); assert.equal(enviada.data.linha.foraDoSc9, true);
    const id = enviada.data.linha.id;
    assert.equal((await call(U('prioridades?ids=' + id + '&nome=Bia'))).data.meus[0].foraDoSc9, true, 'a vendedora vê que ele ainda não está no SC9');

    // equipe: o painel recebe o pedido sem situação (fora do SC9) e a hora da última carga para decidir "recarregar" x "conferir o número"
    let painel = (await call('/api/prioridades', null, { cookie: admin })).data;
    assert.equal(painel.baseEm, '2026-11-24T14:00:00.000Z');
    const ativo = painel.ativos.find((l) => l.pedido === '888777');
    assert.equal(ativo.situacao, null); assert.ok(Date.parse(ativo.criadoEm) > Date.parse(painel.baseEm), 'pedido feito depois da carga: é só recarregar');
    assert.equal(painel.ativos.filter((l) => l.situacao === null).length, 1);

    // o SC9 é recarregado (aqui: uma instância nova com a base nova e os mesmos dados) e o pedido entra: o aviso some sozinho nos dois lados
    await new Promise((resolve) => server.close(resolve));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-fora2-')); fs.cpSync(dir, dir2, { recursive: true });
    fs.writeFileSync(path.join(dir2, 'data', 'latest.json'), JSON.stringify({ savedAt: new Date().toISOString(), orders: [linha({ pedido: '355386' }), linha({ pedido: '888777', nome: 'CLIENTE NOVO' })], faturamento: [], entregaInfo: [], valores: [] }));
    const server2 = require(path.join(dir2, 'server.js'));
    if (!server2.listening) await new Promise((resolve) => server2.once('listening', resolve));
    try {
      const base2 = 'http://127.0.0.1:' + server2.address().port;
      const call2 = async (url, cookie) => { const r = await fetch(base2 + url, { headers: { 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}) } }); return r.json(); };
      painel = await call2('/api/prioridades', admin);
      assert.ok(painel.ativos.find((l) => l.pedido === '888777').situacao, 'agora tem situação');
      assert.equal(painel.ativos.filter((l) => l.situacao === null).length, 0);
      assert.equal((await call2(U('prioridades?ids=' + id + '&nome=Bia'))).meus[0].foraDoSc9, false);
      assert.equal((await call2(U('pedido?pedido=888777'))).achado, true);
    } finally { await new Promise((resolve) => server2.close(resolve)); }
    return;
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
