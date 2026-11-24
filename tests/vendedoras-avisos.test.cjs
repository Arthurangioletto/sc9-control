const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const A = require('../avisos-store.js');

test('avisos: protocolo, tipo e texto obrigatórios, limite por dia, equipe assume/responde/resolve, histórico público sem nomes da equipe nem comentário interno', () => {
  const t0 = Date.UTC(2026, 10, 24, 15);
  const base = { acao: 'criar', pedido: '0355386', tipo: 'endereco', texto: '  cliente   mudou o endereço  ', pedidoPor: 'Ana', filial: 'Cambuci' };
  assert.match(A.aplicar([], Object.assign({}, base, { pedido: 'abc' }), '', t0).erro, /Número do pedido/);
  assert.match(A.aplicar([], Object.assign({}, base, { tipo: 'x' }), '', t0).erro, /tipo/);
  assert.match(A.aplicar([], Object.assign({}, base, { texto: 'ok' }), '', t0).erro, /mínimo 5/);
  assert.match(A.aplicar([], Object.assign({}, base, { pedidoPor: 'A' }), '', t0).erro, /nome/);
  let r = A.aplicar([], base, '', t0);
  assert.equal(r.erro, undefined); const l0 = r.linhas[0];
  assert.deepEqual([l0.pedido, l0.status, l0.texto, l0.protocolo, l0.tipo], ['355386', 'recebido', 'cliente mudou o endereço', 'AVI-20261124-001', 'endereco']);
  assert.equal(A.aplicar(r.linhas, Object.assign({}, base, { tipo: 'retirada' }), '', t0 + 1000).linhas[0].protocolo, 'AVI-20261124-002');
  const id = r.resultado.id;
  r = A.aplicar(r.linhas, { acao: 'assumir', id }, 'Eva', t0 + 2000); assert.equal(r.linhas[0].status, 'em_andamento'); assert.equal(r.linhas[0].responsavel, 'Eva');
  r = A.aplicar(r.linhas, { acao: 'interno', id, texto: 'falei com a transportadora' }, 'Eva', t0 + 3000);
  r = A.aplicar(r.linhas, { acao: 'status', id, status: 'resolvido', resposta: 'endereço atualizado, sai hoje' }, 'Eva', t0 + 4000);
  assert.equal(r.linhas[0].status, 'resolvido'); assert.equal(r.linhas[0].resposta, 'endereço atualizado, sai hoje');
  assert.match(A.aplicar(r.linhas, { acao: 'assumir', id }, 'Eva', t0 + 5000).erro, /já foi resolvido/);
  assert.match(A.aplicar(r.linhas, { acao: 'status', id: 'nao-existe', status: 'resolvido' }, 'Eva', t0).erro, /não encontrado/);
  const pub = JSON.stringify(A.visaoMeu(r.linhas[0]));
  assert.ok(!pub.includes('Eva') && !pub.includes('transportadora') && !pub.includes('Ana'), 'a vendedora não vê nome da equipe, comentário interno nem o nome dela devolvido');
  assert.deepEqual(A.visaoMeu(r.linhas[0]).historico.map((h) => h.status), ['recebido', 'em_andamento', 'resolvido']);
  // limite por dia
  let linhas = [];
  for (let i = 0; i < A.LIMITE_POR_DIA; i++) linhas = A.aplicar(linhas, base, '', t0 + i).linhas;
  assert.match(A.aplicar(linhas, base, '', t0 + 99).erro, /10 avisos hoje/);
  assert.equal(A.aplicar(linhas, Object.assign({}, base, { pedidoPor: 'Bia' }), '', t0 + 99).erro, undefined, 'o limite é por vendedora');
  // vincular ao login só o que é do mesmo nome e sem conta
  const v = A.vincularConta([Object.assign({}, l0, { id: 'x1' }), Object.assign({}, l0, { id: 'x2', pedidoPor: 'Outra' })], ['x1', 'x2'], 'ana', 'ana.v');
  assert.deepEqual(v.linhas.map((l) => l.conta), ['ana.v', '']);
});

test('servidor: vendedora avisa a expedição (com ou sem login), só vê os próprios avisos, equipe vê tudo, responde e a vendedora vê a resposta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-avisos-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'ocorrencias-store.js', 'ocorrencias-lookup.js', 'ocorrencias.js', 'consolidado.js', 'rastreio.js', 'prioridades-store.js', 'avisos-store.js', 'vendedoras-contas.js', 'central.css', 'central-ui.js', 'vendedoras.html', 'vendedoras.js', 'prioridades.html', 'prioridades.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  const linha = (o) => Object.assign({ pedido: '0355386', armazem: 'Cambuci', nf: '', nome: 'CLIENTE ALFA', cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Liberado', separador: '', conferente: '' }, o);
  fs.writeFileSync(path.join(data, 'latest.json'), JSON.stringify({ savedAt: '2026-11-24T14:00:00.000Z', orders: [linha({ pedido: '355386' })], faturamento: [], entregaInfo: [], valores: [] }));
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
    const aviso = { pedido: '355386', tipo: 'endereco', texto: 'Cliente mudou o endereço de entrega para Rua X, 100' };

    assert.equal((await call('/api/vendedoras/aviso?k=errado', Object.assign({}, aviso, { pedidoPor: 'Bia' }))).status, 401, 'precisa do link com código');
    assert.equal((await call(U('aviso'), Object.assign({}, aviso, { pedidoPor: 'Bia', texto: 'oi' }))).status, 400);
    assert.equal((await call(U('aviso'), Object.assign({}, aviso, { pedidoPor: 'Bia', tipo: 'xyz' }))).status, 400);
    assert.equal((await call(U('aviso'), { pedido: '12', tipo: 'outro', texto: 'texto valido', pedidoPor: 'Bia' })).status, 400);
    // sem login: só o nome; guarda o id do aviso para acompanhar
    const bia = await call(U('aviso'), Object.assign({}, aviso, { pedidoPor: 'Bia' }));
    assert.equal(bia.status, 200); assert.match(bia.data.linha.protocolo, /^AVI-\d{8}-001$/); assert.equal(bia.data.naoAchado, false);
    // pedido que ainda não está no SC9 também entra, marcado
    const fora = await call(U('aviso'), { pedido: '999000', tipo: 'outro', texto: 'pedido novo ainda sem carga', pedidoPor: 'Bia' });
    assert.equal(fora.status, 200); assert.equal(fora.data.naoAchado, true); assert.equal(fora.data.linha.foraDoSc9, true);
    // com login: nome e login vêm da conta
    const ana = (await call(U('conta'), { acao: 'criar', nome: 'Ana', login: 'ana.v', email: 'ana.v@implacil.com.br', codigo: 'codigo-ana-v-9' })).data.token;
    const daAna = await call(U('aviso'), Object.assign({}, aviso, { texto: 'Aviso da Ana: cliente VIP', pedidoPor: 'Qualquer' }), { token: ana });
    assert.equal(daAna.status, 200);

    // cada uma só vê os próprios
    assert.deepEqual((await call(U('avisos?ids=' + bia.data.linha.id))).data.meus.map((x) => x.id), [bia.data.linha.id]);
    assert.deepEqual((await call(U('avisos'))).data.meus, [], 'sem login e sem id: nada');
    const minhasAna = (await call(U('avisos'), null, { token: ana })).data;
    assert.equal(minhasAna.meus.length, 1); assert.equal(minhasAna.meus[0].texto, 'Aviso da Ana: cliente VIP');
    assert.ok(!JSON.stringify(minhasAna).includes('Bia'), 'não vê aviso de outra');
    assert.equal((await call(U('avisos?ids=' + bia.data.linha.id), null, { token: ana })).data.meus.length, 2, 'com o id do aviso da Bia ela veria — o id só a Bia tem');

    // quem cria o acesso depois leva os avisos do aparelho (mesmo nome)
    const bia2 = (await call(U('conta'), { acao: 'criar', nome: 'Bia', login: 'bia.v', email: 'bia.v@implacil.com.br', codigo: 'codigo-bia-v-9', idsAvisos: [bia.data.linha.id, fora.data.linha.id] })).data.token;
    assert.equal((await call(U('avisos'), null, { token: bia2 })).data.meus.length, 2);

    // equipe: só logada com perfil; vê tudo (com quem avisou), assume, responde e resolve
    assert.equal((await call('/api/avisos')).status, 401);
    assert.equal((await call('/api/avisos', null, { cookie: 'x=1' })).status, 401);
    let painel = (await call('/api/avisos', null, { cookie: admin })).data;
    assert.equal(painel.ativos.length, 3); assert.equal(painel.baseEm, '2026-11-24T14:00:00.000Z');
    assert.equal(painel.ativos.find((l) => l.pedido === '999000').situacao, null, 'fora do SC9');
    const idBia = bia.data.linha.id;
    assert.equal((await call('/api/avisos', { acao: 'assumir', id: idBia }, { cookie: admin })).status, 200);
    assert.equal((await call('/api/avisos', { acao: 'interno', id: idBia, texto: 'ligar para a transportadora' }, { cookie: admin })).status, 200);
    assert.equal((await call('/api/avisos', { acao: 'status', id: idBia, status: 'resolvido', resposta: 'Endereço atualizado no pedido.' }, { cookie: admin })).status, 200);
    assert.equal((await call('/api/avisos', { acao: 'status', id: 'nao-existe', status: 'resolvido' }, { cookie: admin })).status, 404);
    assert.equal((await call('/api/avisos', { acao: 'status', id: idBia, status: 'invalido' }, { cookie: admin })).status, 400);
    painel = (await call('/api/avisos', null, { cookie: admin })).data;
    assert.equal(painel.ativos.length, 2); assert.equal(painel.demais[0].responsavel, 'admin');
    const vista = (await call(U('avisos'), null, { token: bia2 })).data.meus.find((x) => x.id === idBia);
    assert.equal(vista.status, 'resolvido'); assert.equal(vista.resposta, 'Endereço atualizado no pedido.');
    assert.ok(!JSON.stringify(vista).includes('transportadora') && !JSON.stringify(vista).includes('admin'), 'a vendedora não vê comentário interno nem nome da equipe');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
