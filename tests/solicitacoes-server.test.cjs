const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// Central de solicitações: servidor local de verdade. Vendedora cria (com e sem login), busca de produtos (índice em memória), cancelamento esperto,
// equipe atende, dashboard, CSV, limites, permissões, concorrência e compatibilidade com prioridades e avisos.
const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ordem = (pedido, extra) => Object.assign({ pedido, armazem: 'Cambuci', nf: '', nome: 'CLIENTE ' + pedido, cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Liberado', separador: '', conferente: '' }, extra);
const ITEM_NAMES = [['10.100', 'Cabo de Aço 8 mm'], ['10.101', 'Cabo de aço 10 mm'], ['20.500', 'Luva Térmica'], ['30.001', 'Parafuso sem saldo']];
const SALDO = [
  ['L1', { produto: '10.100', porArmazem: [['01', 30]], itens: [{ arm: '01', produto: '10.100', descricao: 'Cabo de Aço 8 mm', saldo: 30 }, { arm: '02', produto: '10.100', descricao: 'Cabo de Aço 8 mm', saldo: 7 }] }],
  ['L2', { produto: '10.100', porArmazem: [['01', 12]], itens: [{ arm: '01', produto: '10.100', descricao: 'Cabo de Aço 8 mm', saldo: 12 }, { arm: '01', produto: '20.500', descricao: 'Luva Térmica', saldo: 80 }] }]
];
const PEDIDOS = [ordem('400001'), ordem('400002', { pickStart: iso(1) }), ordem('400003', { pickStart: iso(3), pickEnd: iso(2) }), ordem('400004', { pickStart: iso(5), pickEnd: iso(4), confEnd: iso(3), nf: '9001' })];

async function subir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-solic-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..'))) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, body, { cookie, token } = {}) => {
    const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}), ...(token ? { 'X-Vend-Token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const texto = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer()); // mantém o BOM do CSV
    let json = {}; try { json = JSON.parse(texto); } catch (e) { /* CSV */ }
    return { status: r.status, data: json, texto, headers: r.headers };
  };
  const login = async (corpo) => { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify(corpo) }); return (r.headers.get('set-cookie') || '').split(';')[0]; };
  const admin = await login({ password: process.env.APP_PASSWORD });
  const salvar = (extra) => call('/api/save', Object.assign({ orders: PEDIDOS, items: [], itemNames: ITEM_NAMES, saldoPorLote: SALDO, warehousesPresent: ['Cambuci'], cutoff: '2026-11-24', faturamento: [], entregaInfo: [], valores: [] }, extra), { cookie: admin });
  assert.equal((await salvar()).status, 200);
  const k = (await call('/api/vendedoras-link', { acao: 'gerar' }, { cookie: admin })).data.token;
  const U = (rota) => '/api/vendedoras/' + rota + (rota.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(k);
  const novaConta = async (nome, login) => (await call(U('conta'), { acao: 'criar', nome, login, email: login + '@implacil.com.br', codigo: 'codigo-' + login + '-9' })).data.token;
  const equipe = async (usuario, perfis) => { const r = await call('/api/usuarios', { acao: 'criar', usuario, nome: 'Pessoa ' + usuario, senha: 'senha-' + usuario + '-xyz', perfis }, { cookie: admin }); assert.equal(r.status, 200, 'criar ' + usuario); return login({ usuario, password: 'senha-' + usuario + '-xyz' }); };
  return { server, call, admin, k, U, dir, data, salvar, novaConta, equipe, fechar: () => new Promise((r) => server.close(r)) };
}
const transf = (extra) => Object.assign({ itens: [{ produto: '10.100', qt: 5 }], origem: { filial: 'Cambuci', armazem: '01' }, destino: { filial: 'Tambore', armazem: '01' } }, extra);

test('busca de produtos: autenticação, código e descrição, saldo por origem, sem dado sensível, índice em memória (sem ir ao disco) e limite', async () => {
  const { call, U, k, data, salvar, fechar } = await subir();
  try {
    assert.equal((await call('/api/vendedoras/produtos?q=cabo&k=errado')).status, 401, 'precisa do link com código');
    assert.equal((await call('/api/vendedoras/produtos?q=cabo')).status, 401);
    assert.deepEqual((await call(U('produtos?q=c'))).data.produtos, [], 'menos de 2 letras: nada');
    const cod = (await call(U('produtos?q=10.100'))).data.produtos;
    assert.deepEqual(cod.map((p) => p.codigo), ['10.100']);
    assert.deepEqual([cod[0].descricao, cod[0].saldoTotal, cod[0].saldoDisponivel], ['Cabo de Aço 8 mm', 49, true]);
    assert.deepEqual(cod[0].saldos, [{ filial: 'Cambuci', armazem: '01', saldo: 42 }, { filial: 'Cambuci', armazem: '02', saldo: 7 }]);
    assert.deepEqual(cod[0].lotes.map((l) => [l.lote, l.armazem, l.saldo]), [['L1', '01', 30], ['L2', '01', 12], ['L1', '02', 7]]);
    assert.deepEqual((await call(U('produtos?q=' + encodeURIComponent('CABO aco')))).data.produtos.map((p) => p.codigo), ['10.100', '10.101']);
    const origem = (await call(U('produtos?q=10.100&filial=Cambuci&armazem=02'))).data.produtos[0];
    assert.deepEqual([origem.saldoOrigem, origem.lotes.length], [7, 1]);
    assert.equal((await call(U('produtos?q=10.100&filial=03&armazem=01'))).data.produtos[0].saldoOrigem, 0);
    const sem = (await call(U('produtos?q=parafuso'))).data.produtos[0];
    assert.deepEqual([sem.codigo, sem.saldoTotal, sem.saldoDisponivel], ['30.001', null, false], 'sem saldo: só a descrição');
    assert.ok(!/custo|valor|fornecedor|cliente/i.test(JSON.stringify(cod)), 'nada sensível');
    // índice em memória: sem o arquivo de saldo no disco a resposta continua igual (nada de ler disco/Supabase a cada digitação)
    fs.rmSync(path.join(data, 'saldo-lotes.json'));
    assert.equal((await call(U('produtos?q=10.100'))).data.produtos[0].saldoTotal, 49);
    // novo snapshot (e novo saldo): o índice é refeito na consulta seguinte
    assert.equal((await salvar({ savedAt: undefined, saldoPorLote: [['L9', { produto: '10.100', porArmazem: [], itens: [{ arm: '01', produto: '10.100', saldo: 3 }] }]] })).status, 200);
    assert.equal((await call(U('produtos?q=10.100'))).data.produtos[0].saldoTotal, 3);
    // limite generoso por digitação: 60 por minuto por IP (já usamos algumas)
    let ultimo = 200;
    for (let i = 0; i < 70 && ultimo === 200; i++) ultimo = (await call(U('produtos?q=cabo'))).status;
    assert.equal(ultimo, 429);
    assert.ok(k);
  } finally { await fechar(); }
});

test('busca de produtos sem catálogo nem saldo: lista vazia, nunca erro', async () => {
  const { call, U, salvar, fechar } = await subir();
  try {
    assert.equal((await salvar({ itemNames: [], saldoPorLote: [] })).status, 200);
    const r = await call(U('produtos?q=cabo'));
    assert.equal(r.status, 200); assert.deepEqual(r.data.produtos, []); assert.equal(r.data.catalogoVazio, true);
  } finally { await fechar(); }
});

test('transferência completa: itens, descrição e saldo do servidor, acima do saldo só sinaliza, validações e o que a vendedora vê', async () => {
  const { call, U, admin, novaConta, fechar } = await subir();
  try {
    const ana = await novaConta('Ana', 'ana.v');
    const pedir = (dados, token) => call(U('solicitacao'), { tipo: 'transferencia_peca', pedidoPor: 'Ana', dados }, { token: token || ana });
    assert.equal((await call('/api/vendedoras/solicitacao?k=errado', { tipo: 'outro', texto: 'preciso de ajuda', pedidoPor: 'Ana' })).status, 401);
    const ruins = [
      [transf({ itens: [] }), /pelo menos um produto/], [transf({ itens: [{ produto: '10.100', qt: 0 }] }), /1 a 99999/], [transf({ destino: { filial: 'Cambuci', armazem: '01' } }), /diferentes/],
      [transf({ origem: { filial: 'Marte', armazem: '01' } }), /filial de origem/], [transf({ prazo: '2020-01-01' }), /passado/]
    ];
    for (const [dados, re] of ruins) { const r = await pedir(dados); assert.equal(r.status, 400); assert.match(r.data.error, re); }
    const r = await pedir(transf({
      itens: [{ produto: '10.100', lote: 'L1', qt: 40, descricao: 'MENTIRA', saldoOrigem: 99999 }, { produto: '20.500', qt: 10 }, { produto: '99.999', qt: 1 }], motivo: 'venda para a obra do cliente', prazo: '2099-01-01'
    }));
    assert.equal(r.status, 400, 'prazo longe demais'); assert.match(r.data.error, /muito distante/);
    const ok = await pedir(transf({ itens: [{ produto: '10.100', lote: 'L1', qt: 40, descricao: 'MENTIRA', saldoOrigem: 99999 }, { produto: '20.500', qt: 10 }, { produto: '99.999', qt: 1 }], motivo: 'venda para a obra do cliente' }));
    assert.equal(ok.status, 200, ok.texto);
    const l = ok.data.linha, d = l.dados;
    assert.match(l.protocolo, /^S-\d{6}-001$/); assert.equal(l.status, 'recebida'); assert.equal(l.tipo, 'transferencia_peca');
    assert.deepEqual(d.itens.map((i) => [i.produto, i.descricao, i.lote, i.qt, i.saldoOrigem, i.acimaDoSaldo]), [
      ['10.100', 'Cabo de Aço 8 mm', 'L1', 40, 30, true], ['20.500', 'Luva Térmica', '', 10, 80, false], ['99.999', '', '', 1, null, false]
    ]);
    assert.deepEqual([d.tipoTransferencia, d.totalPecas, d.totalProdutos, d.acimaDoSaldo, d.origem.filial, d.origem.codigo, d.destino.filial, d.destino.codigo], ['entre_filiais', 51, 3, true, 'Cambuci', '01', 'Tambore', '03']);
    const entre = await pedir(transf({ destino: { filial: 'Cambuci', armazem: '2' } }));
    assert.equal(entre.data.linha.dados.tipoTransferencia, 'entre_armazens');
    // a vendedora vê as dela, com os itens; sem nomes da equipe
    const minhas = (await call(U('solicitacoes'), null, { token: ana })).data;
    assert.equal(minhas.ativas.length, 2); assert.equal(minhas.ativas.find((x) => x.id === l.id).dados.itens.length, 3);
    // equipe vê a transferência com a tabela de itens
    const painel = (await call('/api/solicitacoes', null, { cookie: admin })).data;
    const linha = painel.ativos.find((x) => x.id === l.id);
    assert.equal(linha.pedidoPor, 'Ana'); assert.equal(linha.dados.itens[0].descricao, 'Cabo de Aço 8 mm'); assert.equal(linha.slaMin, 240); assert.equal(linha.atrasada, false);
    assert.equal((await call('/api/solicitacoes?q=' + encodeURIComponent('luva termica'), null, { cookie: admin })).data.ativos.length, 1, 'busca pelo produto da transferência');
    assert.equal((await call('/api/solicitacoes?q=tambor', null, { cookie: admin })).data.ativos.length, 1);
    const dash = (await call('/api/solicitacoes/dashboard?dias=7', null, { cookie: admin })).data;
    assert.deepEqual([dash.transferencias.total, dash.transferencias.totalPecas], [2, 56]);
    assert.deepEqual(dash.transferencias.produtos[0], { produto: '10.100', descricao: 'Cabo de Aço 8 mm', pedidos: 2, pecas: 45 });
    assert.deepEqual(dash.transferencias.rotas.map((x) => x.tipoTransferencia).sort(), ['entre_armazens', 'entre_filiais']);
  } finally { await fechar(); }
});

test('cancelamento esperto: etapa do pedido no SC9, urgente só se ainda não separado, aviso em português e pedido fora do SC9', async () => {
  const { call, U, admin, novaConta, fechar } = await subir();
  try {
    const contas = [await novaConta('Ana', 'ana.v'), await novaConta('Bia', 'bia.v'), await novaConta('Cris', 'cris.v')];
    const pedir = (tipo, pedido, token, extra) => call(U('solicitacao'), Object.assign({ tipo, pedido, pedidoPor: 'X', dados: { motivo: 'o cliente desistiu da compra' } }, extra), { token });
    const esperado = [['400001', 'nao_separado', true, 'urgente', /ainda não começou/], ['400002', 'em_separacao', false, 'alta', /em separação/], ['400003', 'separado', false, 'alta', /já foi separado/], ['400004', 'faturado', false, 'alta', /nota fiscal/]];
    const ids = [];
    for (let i = 0; i < esperado.length; i++) {
      const [pedido, etapa, aTempo, , re] = esperado[i];
      const r = await pedir(i % 2 ? 'segurar_pedido' : 'cancelar_pedido', pedido, contas[i % 3]);
      assert.equal(r.status, 200, r.texto);
      assert.equal(r.data.etapa, etapa, pedido); assert.equal(r.data.linha.etapa, etapa); assert.equal(r.data.linha.aTempo, aTempo); assert.match(r.data.aviso, re); assert.equal(r.data.linha.aviso, r.data.aviso);
      assert.equal(r.data.naoAchado, false); ids.push(r.data.linha.id);
    }
    const fora = await pedir('cancelar_pedido', '999000', contas[0]);
    assert.equal(fora.status, 200); assert.equal(fora.data.etapa, 'nao_achado'); assert.equal(fora.data.naoAchado, true); assert.equal(fora.data.linha.foraDoSc9, true); assert.match(fora.data.aviso, /Não encontramos este pedido/);
    // não duplica o mesmo cancelamento ativo
    const dup = await pedir('cancelar_pedido', '400001', contas[0]);
    assert.equal(dup.status, 400); assert.match(dup.data.error, /já pediu isso/);
    // pedido obrigatório e válido; motivo obrigatório
    assert.equal((await call(U('solicitacao'), { tipo: 'cancelar_pedido', pedidoPor: 'X', dados: { motivo: 'motivo valido' } }, { token: contas[1] })).status, 400);
    assert.equal((await call(U('solicitacao'), { tipo: 'cancelar_pedido', pedido: '12', pedidoPor: 'X', dados: { motivo: 'motivo valido' } }, { token: contas[1] })).status, 400);
    assert.equal((await call(U('solicitacao'), { tipo: 'cancelar_pedido', pedido: '400003', pedidoPor: 'X', dados: {} }, { token: contas[1] })).status, 400);
    // equipe: situação do pedido ao lado, prioridade e etapa gravadas
    const painel = (await call('/api/solicitacoes', null, { cookie: admin })).data;
    const urgente = painel.ativos[0];
    assert.deepEqual([urgente.pedido, urgente.prioridade, urgente.etapa, urgente.aTempo], ['400001', 'urgente', 'nao_separado', true], 'urgente primeiro na fila');
    assert.ok(urgente.situacao && urgente.situacao.cliente, 'situação do pedido vem do SC9');
    assert.equal(painel.ativos.find((x) => x.pedido === '999000').situacao, null);
    assert.equal(painel.ativos.find((x) => x.pedido === '999000').naoAchado, true);
    assert.equal(painel.ativos.find((x) => x.pedido === '400001').slaMin, 30);
    const dash = (await call('/api/solicitacoes/dashboard', null, { cookie: admin })).data;
    assert.deepEqual(dash.cancelamentos, { total: 4, aTempo: 1, tarde: 3, pctATempo: 25 });
  } finally { await fechar(); }
});

test('equipe: permissões, assumir/responder/comentar/prioridade/área, a vendedora vê a resposta (sem nomes nem comentário interno), CSV e nada é apagado', async () => {
  const { call, U, admin, data, novaConta, equipe, fechar } = await subir();
  try {
    const bia = await novaConta('Bia', 'bia.v');
    const nova = await call(U('solicitacao'), { tipo: 'consulta_estoque', pedidoPor: 'Bia', dados: { produto: '10.100', qt: 3, filial: 'BH' } }, { token: bia });
    assert.equal(nova.status, 200, nova.texto); const id = nova.data.linha.id;
    assert.equal((await call(U('solicitacao'), { tipo: 'outro', texto: '=HYPERLINK("http://x") preciso de ajuda', pedidoPor: 'Bia' }, { token: bia })).status, 200);
    // permissões
    for (const rota of ['/api/solicitacoes', '/api/solicitacoes/dashboard', '/api/solicitacoes/exportar']) assert.equal((await call(rota)).status, 401, rota);
    assert.equal((await call('/api/solicitacoes', { acao: 'assumir', id })).status, 401);
    const semPerfil = await equipe('semperfil', ['saida']);
    for (const rota of ['/api/solicitacoes', '/api/solicitacoes/dashboard', '/api/solicitacoes/exportar']) assert.equal((await call(rota, null, { cookie: semPerfil })).status, 403, rota);
    assert.equal((await call('/api/solicitacoes', { acao: 'assumir', id }, { cookie: semPerfil })).status, 403);
    assert.equal((await call('/api/solicitacoes', null, { token: bia })).status, 401, 'o acesso da vendedora não abre a rota da equipe');
    const logi = await equipe('logi', ['ocorrencias']);
    const r1 = await call('/api/solicitacoes', null, { cookie: logi });
    assert.equal(r1.status, 200); assert.equal(r1.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(r1.data.tipos), ['cancelar_pedido', 'segurar_pedido', 'transferencia_peca', 'consulta_estoque', 'alterar_pedido', 'nota_fiscal', 'outro']);
    // ações
    const agir = (corpo, cookie) => call('/api/solicitacoes', corpo, { cookie: cookie || logi });
    assert.equal((await agir({ acao: 'apagar', id })).status, 400);
    assert.equal((await agir({ acao: 'assumir', id: 'nao-existe' })).status, 404);
    assert.equal((await agir({ acao: 'status', id, status: 'negada' })).status, 400, 'negar exige resposta');
    assert.equal((await agir({ acao: 'status', id, status: 'xx' })).status, 400);
    const a = await agir({ acao: 'assumir', id }); assert.equal(a.status, 200);
    assert.equal(a.data.ativos.find((x) => x.id === id).status, 'em_analise');
    assert.equal(a.data.ativos.find((x) => x.id === id).responsavel, 'logi');
    assert.equal((await agir({ acao: 'interno', id, texto: 'ligar para o estoque da BH' })).status, 200);
    assert.equal((await agir({ acao: 'prioridade', id, prioridade: 'alta' })).data.ativos.find((x) => x.id === id).prioridade, 'alta');
    assert.equal((await agir({ acao: 'area', id, area: 'expedicao' })).data.ativos.find((x) => x.id === id).area, 'expedicao');
    assert.equal((await agir({ acao: 'area', id, area: 'rh' })).status, 400);
    const fim = await agir({ acao: 'status', id, status: 'concluida', resposta: 'Tem 10 peças na BH.' });
    assert.equal(fim.status, 200); assert.equal(fim.data.ativos.some((x) => x.id === id), false);
    const guardada = fim.data.demais.find((x) => x.id === id);
    assert.deepEqual([guardada.status, guardada.resposta, guardada.respondidoPor], ['concluida', 'Tem 10 peças na BH.', 'logi']);
    assert.ok(guardada.primeiraRespostaEm && guardada.concluidaEm);
    assert.deepEqual(guardada.historico.map((h) => h.acao), ['criado', 'assumir', 'interno', 'prioridade', 'area', 'status']);
    // filtros
    assert.equal((await call('/api/solicitacoes?status=concluida', null, { cookie: logi })).data.demais.length, 1);
    assert.equal((await call('/api/solicitacoes?tipo=outro', null, { cookie: logi })).data.ativos.length, 1);
    // a vendedora vê a resposta, sem nome da equipe nem comentário interno
    const vista = (await call(U('solicitacoes'), null, { token: bia })).data;
    const v = vista.recentes.find((x) => x.id === id);
    assert.deepEqual([v.status, v.resposta, v.rotulo], ['concluida', 'Tem 10 peças na BH.', 'Consulta de estoque']);
    assert.ok(!/logi|ligar para o estoque|interno/.test(JSON.stringify(v)), 'sem nome da equipe nem comentário interno');
    assert.equal(vista.ativas.length, 1);
    // outra vendedora e quem não tem o id não veem
    const cris = await novaConta('Cris', 'cris.v');
    assert.equal((await call(U('solicitacoes'), null, { token: cris })).data.ativas.length + (await call(U('solicitacoes'), null, { token: cris })).data.recentes.length, 0);
    assert.equal((await call(U('solicitacoes'))).data.ativas.length, 0, 'sem login e sem ids: nada');
    assert.equal((await call(U('solicitacoes?ids=' + id))).data.recentes.length, 1, 'com o id guardado no aparelho');
    // CSV: UTF-8 com BOM e sem fórmula solta
    const csv = await call('/api/solicitacoes/exportar', null, { cookie: logi });
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv; charset=utf-8/);
    assert.ok(csv.texto.startsWith('﻿id;protocolo;tipo;pedido;vendedora;filial;status;prioridade;criada;1ª resposta;concluída;minutos até resposta;minutos até conclusão'));
    assert.equal(csv.texto.trim().split('\r\n').length, 3);
    assert.ok(!/(^|;)=HYPERLINK/.test(csv.texto));
    // nada apagado: o arquivo guarda as duas, com histórico
    const arq = JSON.parse(fs.readFileSync(path.join(data, 'solicitacoes-vendedoras.json'), 'utf8'));
    assert.equal(arq.linhas.length, 2); assert.equal(arq.linhas.find((x) => x.id === id).historico.length, 6);
  } finally { await fechar(); }
});

test('conta nova leva as solicitações feitas neste aparelho (idsSolic) e o limite por IP vale sem login', async () => {
  const { call, U, k, fechar } = await subir();
  try {
    const feitas = [];
    for (let i = 0; i < 8; i++) { const r = await call(U('solicitacao'), { tipo: 'outro', texto: 'preciso de ajuda número ' + i, pedidoPor: 'Dani' }); assert.equal(r.status, 200, r.texto); feitas.push(r.data.linha.id); }
    const barrada = await call(U('solicitacao'), { tipo: 'outro', texto: 'mais uma ajuda aqui', pedidoPor: 'Dani' });
    assert.equal(barrada.status, 429); assert.match(barrada.data.error, /Muitas solicitações/);
    const token = (await call(U('conta'), { acao: 'criar', nome: 'Dani', login: 'dani.v', email: 'dani.v@implacil.com.br', codigo: 'codigo-dani-v-9', idsSolic: feitas })).data.token;
    assert.equal((await call(U('solicitacoes'), null, { token })).data.ativas.length, 8);
    assert.ok(k);
  } finally { await fechar(); }
});

test('concorrência: várias vendedoras e a equipe ao mesmo tempo não perdem nenhuma solicitação nem repetem protocolo', async () => {
  const { call, U, admin, data, fechar } = await subir();
  try {
    const primeira = await call(U('solicitacao'), { tipo: 'outro', texto: 'primeira para a equipe agir', pedidoPor: 'Eva' });
    const nomes = ['Ana', 'Bia', 'Cris', 'Dani', 'Edna', 'Fabi', 'Gabi'];
    const envios = nomes.map((n, i) => call(U('solicitacao'), i % 2 ? { tipo: 'transferencia_peca', pedidoPor: n, dados: transf({ itens: [{ produto: '10.100', qt: i + 1 }] }) } : { tipo: 'outro', texto: 'ajuda da ' + n + ' agora', pedidoPor: n }));
    const acoes = [call('/api/solicitacoes', { acao: 'assumir', id: primeira.data.linha.id }, { cookie: admin }), call('/api/solicitacoes', { acao: 'interno', id: primeira.data.linha.id, texto: 'olhando' }, { cookie: admin })];
    const res = await Promise.all(envios.concat(acoes));
    assert.deepEqual(res.map((r) => r.status), res.map(() => 200));
    const arq = JSON.parse(fs.readFileSync(path.join(data, 'solicitacoes-vendedoras.json'), 'utf8'));
    assert.equal(arq.linhas.length, 8);
    assert.equal(new Set(arq.linhas.map((l) => l.protocolo)).size, 8, 'protocolos únicos');
    const p = arq.linhas.find((l) => l.id === primeira.data.linha.id);
    assert.deepEqual([p.status, p.responsavel, p.historico.map((h) => h.acao)], ['em_analise', 'admin', ['criado', 'assumir', 'interno']]);
  } finally { await fechar(); }
});

test('compatibilidade: prioridades e avisos continuam iguais e entram no dashboard da central', async () => {
  const { call, U, admin, novaConta, fechar } = await subir();
  try {
    const ana = await novaConta('Ana', 'ana.v');
    const aviso = await call(U('aviso'), { pedido: '400003', tipo: 'endereco', texto: 'Cliente mudou o endereço de entrega', pedidoPor: 'Ana' }, { token: ana });
    assert.equal(aviso.status, 200); assert.match(aviso.data.linha.protocolo, /^AVI-/);
    const prio = await call(U('prioridade'), { pedido: '400002', nivel: 'alta', motivo: 'cliente_aguardando', pedidoPor: 'Ana' }, { token: ana });
    assert.equal(prio.status, 200, prio.texto);
    const sol = await call(U('solicitacao'), { tipo: 'nota_fiscal', pedido: '400004', dados: { o_que: 'reenviar a nota por e-mail' }, pedidoPor: 'Ana' }, { token: ana });
    assert.equal(sol.status, 200, sol.texto);
    assert.equal((await call('/api/avisos', null, { cookie: admin })).data.ativos.length, 1);
    assert.equal((await call('/api/prioridades', null, { cookie: admin })).data.ativos.length, 1);
    assert.equal((await call('/api/solicitacoes', null, { cookie: admin })).data.ativos.length, 1, 'cada coisa na sua lista');
    assert.equal((await call(U('avisos'), null, { token: ana })).data.meus.length, 1);
    assert.equal((await call(U('prioridades'), null, { token: ana })).data.meus.length, 1);
    const dash = (await call('/api/solicitacoes/dashboard?dias=30', null, { cookie: admin })).data;
    assert.deepEqual(dash.fontes, { solicitacoes: 1, prioridades: 1, avisos: 1 });
    assert.deepEqual(dash.fila.map((f) => f.fonte).sort(), ['aviso', 'prioridade', 'solicitacao']);
    assert.equal(dash.periodo.dias, 30); assert.equal(dash.porDia.length, 30);
    assert.equal((await call('/api/solicitacoes/dashboard?dias=500', null, { cookie: admin })).data.periodo.dias, 90, 'máximo de 90 dias');
    assert.equal((await call('/api/solicitacoes/dashboard?dias=abc', null, { cookie: admin })).data.periodo.dias, 30);
    assert.equal(dash.kpis.abertas, 1);
  } finally { await fechar(); }
});
