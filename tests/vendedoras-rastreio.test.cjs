const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const R = require('../rastreio.js');
const P = require('../prioridades-store.js');

const AGORA = new Date('2026-11-24T15:00:00.000Z');
const linha = (o) => Object.assign({ pedido: '0355386', armazem: 'Cambuci', nf: '', nome: 'CLIENTE ALFA', cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Pendente', transportadora: '4', separador: 'JOSE', conferente: 'MARIA' }, o || {});
const snap = (orders, extra) => Object.assign({ savedAt: '2026-11-24T14:00:00.000Z', orders, faturamento: [], entregaInfo: [], valores: [['885234', { mercad: 900, fatura: 1000 }]] }, extra || {});
const titulos = (r) => r.etapas.map((e) => e.titulo + ':' + e.estado);

test('rastreio: etapas na ordem real, com horário, atual destacada e só campos permitidos', () => {
  const s = snap([linha({ pickStart: '2026-11-18T13:00:00.000Z', pickEnd: '2026-11-18T15:00:00.000Z', confStart: '2026-11-19T10:00:00.000Z', conferente: '' })]);
  const r = R.montarRastreio(s, '355386', { agora: AGORA });
  assert.equal(r.achado, true);
  assert.deepEqual(titulos(r), ['Pedido liberado:feita', 'Separação:feita', 'Em conferência:atual', 'Faturado (nota fiscal):pendente', 'Saída para expedição:pendente', 'Despachado para a transportadora:pendente']);
  assert.equal(r.etapas[1].quando, '2026-11-18T15:00:00.000Z');
  assert.equal(r.resumo.nivel, 'atraso'); assert.equal(r.resumo.dias, 6);
  const json = JSON.stringify(r);
  for (const proibido of ['JOSE', 'MARIA', '1000', 'valor', 'separador', 'conferente', 'itens"']) assert.ok(!json.includes(proibido), 'não pode vazar: ' + proibido);
  assert.equal(R.montarRastreio(s, '0355386', { agora: AGORA }).achado, true, 'zeros à esquerda');
  assert.equal(R.montarRastreio(s, '999999', { agora: AGORA }).achado, false);
  assert.equal(R.montarRastreio(s, 'abc', { agora: AGORA }).achado, false);
});

test('rastreio: saída antes da nota deixa "aguardando nota fiscal"; despachado fecha tudo; etapa sem horário não inventa hora', () => {
  const base = { pickEnd: '2026-11-18T15:00:00.000Z', confEnd: '2026-11-19T11:00:00.000Z' };
  let r = R.montarRastreio(snap([linha(base)]), '355386', { saidaIso: '2026-11-21T13:00:00.000Z', agora: AGORA });
  assert.deepEqual(titulos(r).slice(3), ['Saída para expedição:feita', 'Aguardando nota fiscal:atual', 'Despachado para a transportadora:pendente']);
  r = R.montarRastreio(snap([linha(Object.assign({ nf: '885234', status: 'Enviado' }, base))], { faturamento: [['885234', '2026-11-20T18:00:00.000Z']], entregaInfo: [['0355386', { data: '2026-11-22T03:00:00.000Z' }]] }), '355386', { saidaIso: '2026-11-21T13:00:00.000Z', agora: AGORA });
  assert.ok(r.etapas.every((e) => e.estado === 'feita'));
  assert.equal(r.resumo.nivel, 'concluido'); assert.match(r.resumo.texto, /^Despachado em 22\/11/);
  assert.equal(r.etapas[5].soData, true, 'despacho só tem a data');
  // só tem a nota (sem SF2 e sem horários das etapas anteriores): anteriores viram "concluída, horário não registrado"
  r = R.montarRastreio(snap([linha({ nf: '885234', status: 'Enviado', separador: '', conferente: '' })]), '355386', { agora: AGORA });
  assert.equal(r.etapas[1].estado, 'feita'); assert.equal(r.etapas[1].semHorario, true); assert.equal(r.etapas[1].nota, 'Horário não registrado');
  assert.equal(r.etapas[3].semHorario, true, 'nota sem data de emissão');
});

test('rastreio: ocorrência da expedição entra sem o nome do responsável; pedido em dois armazéns junta tudo', () => {
  const s = snap([linha({ armazem: 'Cambuci', pickEnd: '2026-11-18T15:00:00.000Z', confEnd: '2026-11-19T11:00:00.000Z', qt: 3 }), linha({ armazem: 'BH', qt: 2, separador: '', conferente: '' })]);
  const r = R.montarRastreio(s, '355386', { agora: AGORA, ocorrencias: [{ nf: '', pedido: '355386', dataOcorrencia: '2026-11-20', detalhes: 'cliente mudou de endereço', responsavel: 'Daniela', solucao: '', dataSolucao: '' }] });
  assert.equal(r.detalhes.pecas, 5); assert.equal(r.detalhes.armazem, 'Cambuci, BH');
  assert.equal(r.etapas[1].estado, 'atual', 'um dos armazéns ainda não separou');
  assert.equal(r.ocorrencia.detalhes, 'cliente mudou de endereço');
  assert.ok(!JSON.stringify(r).includes('Daniela'));
});

test('prioridades: protocolo, motivo, 4 níveis, não duplica, assume, comenta, histórico público sem nomes da equipe, limite por dia e limpeza', () => {
  const t0 = Date.UTC(2026, 10, 24, 15);
  const base = { acao: 'criar', pedido: '0355386', nivel: 'alta', motivo: 'cliente_aguardando', observacao: '  cliente  retira hoje ', pedidoPor: 'Ana', filial: 'Cambuci' };
  let r = P.aplicar([], base, 'Ana', t0);
  assert.equal(r.erro, undefined); assert.equal(r.linhas.length, 1);
  assert.deepEqual([r.linhas[0].pedido, r.linhas[0].status, r.linhas[0].observacao, r.linhas[0].protocolo, r.linhas[0].filial, r.linhas[0].motivo], ['355386', 'recebida', 'cliente retira hoje', 'PRI-20261124-001', 'Cambuci', 'cliente_aguardando']);
  const id = r.resultado.id;
  const outro = P.aplicar(r.linhas, Object.assign({}, base, { pedido: '355400', nivel: 'media' }), 'Ana', t0 + 500);
  assert.equal(outro.linhas[0].protocolo, 'PRI-20261124-002', 'o protocolo segue a ordem do dia'); assert.equal(outro.linhas[0].nivel, 'media');
  r = P.aplicar(r.linhas, Object.assign({}, base, { nivel: 'urgente', observacao: 'agora é urgente', pedidoPor: 'Bia' }), 'Bia', t0 + 1000);
  assert.equal(r.linhas.length, 1, 'mesmo pedido ativo não cria outro'); assert.equal(r.resultado.duplicado, true); assert.equal(r.linhas[0].nivel, 'urgente');
  assert.ok(P.aplicar([], Object.assign({}, base, { pedido: '12' }), 'x', t0).erro, 'pedido inválido');
  assert.ok(P.aplicar([], Object.assign({}, base, { nivel: 'super' }), 'x', t0).erro, 'nível inválido');
  assert.ok(P.aplicar([], Object.assign({}, base, { motivo: '' }), 'x', t0).erro, 'motivo obrigatório');
  assert.ok(P.aplicar([], Object.assign({}, base, { motivo: 'outro', observacao: '' }), 'x', t0).erro, 'motivo "outro" exige explicação');
  assert.ok(P.aplicar([], Object.assign({}, base, { pedidoPor: 'A' }), 'x', t0).erro, 'nome obrigatório');
  // a equipe assume (recebida vira em análise), comenta por dentro e responde
  assert.ok(P.aplicar(r.linhas, { acao: 'interno', id, texto: '' }, 'eva', t0).erro, 'comentário vazio');
  r = P.aplicar(r.linhas, { acao: 'assumir', id }, 'eva', t0 + 1500);
  assert.deepEqual([r.linhas[0].responsavel, r.linhas[0].status], ['eva', 'em_analise']);
  r = P.aplicar(r.linhas, { acao: 'interno', id, texto: 'falta 1 item no estoque' }, 'eva', t0 + 1600);
  assert.ok(P.aplicar(r.linhas, { acao: 'status', id, status: 'nao_aprovada' }, 'eva', t0).erro, 'não aprovada exige resposta');
  r = P.aplicar(r.linhas, { acao: 'status', id, status: 'aprovada', resposta: 'aprovado, separando agora' }, 'eva', t0 + 2000);
  assert.deepEqual([r.linhas[0].status, r.linhas[0].resposta, r.linhas[0].respondidoPor], ['aprovada', 'aprovado, separando agora', 'eva']);
  r = P.aplicar(r.linhas, { acao: 'status', id, status: 'em_atendimento' }, 'eva', t0 + 2500);
  r = P.aplicar(r.linhas, { acao: 'status', id, status: 'concluida', resposta: 'separado, sai às 16h' }, 'eva', t0 + 2800);
  assert.equal(r.linhas[0].status, 'concluida');
  assert.ok(P.aplicar(r.linhas, { acao: 'assumir', id }, 'eva', t0 + 2900).erro, 'finalizado não se assume');
  // o histórico completo fica para a equipe; a vendedora recebe só o que aconteceu, sem nomes nem comentário interno
  assert.deepEqual(r.linhas[0].historico.map((x) => x.acao), ['criado', 'reforco', 'assumir', 'interno', 'status', 'status', 'status']);
  const meu = P.visaoMeu(r.linhas[0]);
  assert.deepEqual(meu.historico.map((x) => x.status), ['recebida', '', 'em_analise', 'aprovada', 'em_atendimento', 'concluida']);
  const bruto = JSON.stringify(meu);
  for (const proibido of ['eva', 'falta 1 item', 'responsavel', 'respondidoPor']) assert.ok(!bruto.includes(proibido), 'vazou ' + proibido);
  r = P.aplicar(r.linhas, Object.assign({}, base, { pedidoPor: 'Ana' }), 'Ana', t0 + 3000);
  assert.equal(r.linhas.length, 2, 'depois de concluída pode pedir de novo');
  const antigo = P.aplicar(r.linhas, { acao: 'status', id: r.resultado.id, status: 'nao_aprovada', resposta: 'sem estoque' }, 'eva', t0 + 4000).linhas;
  assert.equal(P.aplicar(antigo, Object.assign({}, base, { pedido: '777777' }), 'Ana', t0 + 70 * 864e5).linhas.length, 1, 'finalizados com mais de 60 dias saem');
  const fila = P.ordenarFila([{ nivel: 'normal', criadoEm: '2026-11-24T10:00:00Z' }, { nivel: 'urgente', criadoEm: '2026-11-24T12:00:00Z' }, { nivel: 'urgente', criadoEm: '2026-11-24T11:00:00Z' }, { nivel: 'media', criadoEm: '2026-11-24T09:00:00Z' }]);
  assert.deepEqual(fila.map((x) => x.criadoEm.slice(11, 13)), ['11', '12', '09', '10']);
  assert.deepEqual(Object.keys(P.visaoFila(antigo[0])).sort(), ['criadoEm', 'nivel', 'pedido', 'status'], 'a fila geral não mostra observação, nome nem resposta');
  // limite por vendedora em 24 h
  let lista = [], ultimo;
  for (let i = 0; i < P.LIMITE_POR_DIA + 1; i++) { ultimo = P.aplicar(lista, Object.assign({}, base, { pedido: String(500000 + i), pedidoPor: 'Carla' }), 'Carla', t0 + i); lista = ultimo.linhas; }
  assert.match(ultimo.erro, /pedidos de prioridade hoje/);
  // pedido despachado: o sistema conclui sozinho
  const aberto = P.aplicar([], base, 'Ana', t0).linhas;
  const fechado = P.fecharDespachados(aberto, new Set(['355386']), t0 + 1000);
  assert.equal(fechado.mudou, 1); assert.deepEqual([fechado.linhas[0].status, fechado.linhas[0].respondidoPor], ['concluida', 'Sistema']);
  assert.equal(P.fecharDespachados(fechado.linhas, new Set(['355386']), t0 + 2000).mudou, 0, 'já finalizado não muda de novo');
  // linhas da versão de teste (nomes antigos) continuam valendo
  assert.equal(P.normalizarLinha({ id: 'x1', pedido: '355386', status: 'atendido', nivel: 'alta' }).status, 'concluida');
});

test('servidor: link das vendedoras, rastreio sem vazar dados, pedido de prioridade com limites e painel da equipe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-vend-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'ocorrencias-store.js', 'ocorrencias-lookup.js', 'ocorrencias.js', 'consolidado.js', 'rastreio.js', 'prioridades-store.js', 'vendedoras-contas.js', 'central.css', 'central-ui.js', 'vendedoras.html', 'vendedoras.js', 'prioridades.html', 'prioridades.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  fs.writeFileSync(path.join(data, 'latest.json'), JSON.stringify(snap([
    linha({ pedido: '355386', pickEnd: '2026-11-18T15:00:00.000Z', confEnd: '2026-11-19T11:00:00.000Z' }),
    linha({ pedido: '355999', nf: '886039', status: 'Enviado', pickEnd: '2026-11-18T15:00:00.000Z', confEnd: '2026-11-19T11:00:00.000Z' })
  ], { entregaInfo: [['355999', { data: '2026-11-22T03:00:00.000Z' }]] })));
  fs.writeFileSync(path.join(data, 'saida-dias.json'), JSON.stringify({ dias: [hoje], exportados: {}, pendentes: {} }));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, body, cookie, metodo) => {
    const r = await fetch(base + url, { method: metodo || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0], headers: r.headers };
  };
  try {
    const admin = (await call('/api/login', { password: process.env.APP_PASSWORD })).cookie;
    assert.equal((await call('/api/vendedoras-link')).status, 401, 'o link só o administrador vê');
    assert.equal((await call('/api/vendedoras/pedido?pedido=355386&k=qualquer')).status, 401, 'sem link ativo ninguém entra');
    const k = (await call('/api/vendedoras-link', { acao: 'gerar' }, admin)).data.token;
    assert.ok(k && k.length >= 30);
    const kHist = (await call('/api/atraso-historico-link', { acao: 'gerar' }, admin)).data.token;
    assert.equal((await call('/api/vendedoras/pedido?pedido=355386&k=' + kHist)).status, 401, 'o código do histórico de atraso não abre a área das vendedoras');
    assert.equal((await call('/api/atraso-historico?k=' + k)).status, 401, 'nem o contrário');

    let r = await call('/api/vendedoras/pedido?pedido=355386&k=' + k);
    assert.equal(r.status, 200); assert.equal(r.data.achado, true);
    assert.equal(r.data.etapas[2].estado, 'feita'); assert.equal(r.data.etapas[3].estado, 'atual');
    const bruto = JSON.stringify(r.data);
    for (const proibido of ['JOSE', 'MARIA', '1000', 'separador']) assert.ok(!bruto.includes(proibido), 'vazou ' + proibido);
    assert.equal((await call('/api/vendedoras/pedido?pedido=999999&k=' + k)).data.achado, false);
    assert.equal((await call('/api/vendedoras/pedido?pedido=ab&k=' + k)).status, 400);
    r = await call('/api/vendedoras/pedido?pedido=355999&k=' + k);
    assert.equal(r.data.resumo.nivel, 'concluido');

    assert.equal((await call('/api/vendedoras/prioridade?k=' + k, { pedido: '355999', nivel: 'alta', motivo: 'cliente_aguardando', pedidoPor: 'Ana' })).status, 400, 'pedido já despachado não precisa de prioridade');
    r = await call('/api/vendedoras/prioridade?k=' + k, { pedido: '355386', nivel: 'urgente', motivo: 'cliente_aguardando', observacao: '<script>alert(1)</script> cliente espera', pedidoPor: 'Ana' });
    assert.equal(r.status, 200); assert.equal(r.data.duplicado, false);
    assert.match(r.data.linha.protocolo, /^PRI-\d{8}-001$/); assert.equal((await call('/api/vendedoras/prioridade?k=' + k, { pedido: '355386', nivel: 'alta', pedidoPor: 'Bia' })).status, 400, 'sem motivo não envia');
    const id = r.data.linha.id;
    assert.equal((await call('/api/vendedoras/prioridade?k=' + k, { pedido: '355386', nivel: 'alta', motivo: 'prazo_combinado', pedidoPor: 'Bia' })).data.duplicado, true, 'mesmo pedido: reforça');
    assert.equal((await call('/api/vendedoras/prioridade?k=' + k, { pedido: '355386', nivel: 'alta', motivo: 'prazo_combinado', pedidoPor: 'Bia' }, null, 'POST')).status, 200);
    const sem = await fetch(base + '/api/vendedoras/prioridade?k=' + k, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(sem.status, 403, 'POST sem o cabeçalho do app');
    r = await call('/api/vendedoras/prioridades?ids=' + id + '&k=' + k);
    assert.equal(r.data.meus.length, 1); assert.equal(r.data.meus[0].status, 'recebida'); assert.equal(r.data.meus[0].historico[0].status, 'recebida');
    assert.equal(r.data.fila, undefined, 'não existe mais lista geral para as vendedoras: cada uma vê só o que é dela');
    assert.equal((await call('/api/vendedoras/prioridades?ids=outro&k=' + k)).data.meus.length, 0, 'só vê o que é dela (id)');

    // equipe
    for (const [usuario, perfis] of [['eva', ['ocorrencias']], ['bia', ['saida']]]) assert.equal((await call('/api/usuarios', { acao: 'criar', usuario, nome: usuario, senha: 'ficticio-123', perfis }, admin)).status, 200);
    const eva = (await call('/api/login', { usuario: 'eva', password: 'ficticio-123' })).cookie;
    const bia = (await call('/api/login', { usuario: 'bia', password: 'ficticio-123' })).cookie;
    assert.equal((await call('/api/prioridades')).status, 401);
    assert.equal((await call('/api/prioridades', null, bia)).status, 403, 'sem o acesso não entra');
    r = await call('/api/prioridades', null, eva);
    assert.equal(r.status, 200); assert.equal(r.data.ativos.length, 1);
    assert.equal(r.data.ativos[0].situacao.cliente, 'CLIENTE ALFA', 'a equipe vê a situação do pedido');
    assert.equal(r.data.ativos[0].filial, 'Cambuci'); assert.equal(r.data.ativos[0].motivo, 'cliente_aguardando');
    assert.equal((await call('/api/prioridades', { id, status: 'nao_aprovada' }, eva)).status, 400, 'precisa de motivo');
    r = await call('/api/prioridades', { id, acao: 'assumir' }, eva);
    assert.equal(r.status, 200); assert.equal(r.data.ativos[0].responsavel, 'eva'); assert.equal(r.data.ativos[0].status, 'em_analise');
    assert.equal((await call('/api/prioridades', { id, acao: 'interno', texto: 'falta 1 item' }, eva)).status, 200);
    r = await call('/api/vendedoras/prioridades?ids=' + id + '&k=' + k);
    assert.equal(r.data.meus[0].status, 'em_analise'); assert.ok(!JSON.stringify(r.data).includes('falta 1 item') && !JSON.stringify(r.data).includes('eva'), 'comentário interno e nome da equipe não vão para a vendedora');
    r = await call('/api/prioridades', { id, status: 'concluida', resposta: 'separado, sai às 16h' }, eva);
    assert.equal(r.status, 200); assert.equal(r.data.ativos.length, 0); assert.equal(r.data.demais[0].respondidoPor, 'eva');
    r = await call('/api/vendedoras/prioridades?ids=' + id + '&k=' + k);
    assert.equal(r.data.meus[0].resposta, 'separado, sai às 16h'); assert.equal(r.data.meus[0].status, 'concluida');

    // limites: 5 pedidos de prioridade por IP a cada 10 min
    let ultimo = 200;
    for (let i = 0; i < 6 && ultimo === 200; i++) ultimo = (await call('/api/vendedoras/prioridade?k=' + k, { pedido: String(400000 + i), nivel: 'normal', motivo: 'retirada', pedidoPor: 'Ana' })).status;
    assert.equal(ultimo, 429, 'o limite de envios por IP vale');
    // trocar o link derruba o antigo
    const k2 = (await call('/api/vendedoras-link', { acao: 'gerar' }, admin)).data.token;
    assert.notEqual(k2, k);
    assert.equal((await call('/api/vendedoras/pedido?pedido=355386&k=' + k)).status, 401);
    assert.equal((await call('/api/vendedoras/pedido?pedido=355386&k=' + k2)).status, 200);
    await call('/api/vendedoras-link', { acao: 'desativar' }, admin);
    assert.equal((await call('/api/vendedoras/pedido?pedido=355386&k=' + k2)).status, 401, 'desativado');
    const pagina = await fetch(base + '/vendedoras.html');
    assert.match(pagina.headers.get('content-security-policy') || '', /default-src 'none'/);
    assert.match(pagina.headers.get('referrer-policy') || '', /no-referrer/);
    assert.match(pagina.headers.get('content-security-policy') || '', /style-src 'self'/);
    for (const arq of ['central.css', 'central-ui.js']) assert.equal((await fetch(base + '/' + arq)).status, 200, arq + ' precisa ser servido');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
