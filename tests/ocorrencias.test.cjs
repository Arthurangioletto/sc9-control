const { test } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../ocorrencias.js');
const S = require('../ocorrencias-store.js');

const HOJE = new Date('2026-11-24T15:00:00.000Z'); // terça-feira 12:00 em Brasília

test('datas digitadas: dd/mm/aaaa, mês primeiro quando só assim faz sentido, sem ano, ano com 2 dígitos', () => {
  const l = (t) => O.lerData(t, HOJE);
  assert.equal(l('16/11/2026'), '2026-11-16');
  assert.equal(l('11/16/2026'), '2026-11-16', 'formato americano que aparece na planilha da expedição');
  assert.equal(l('23/11/2026'), '2026-11-23');
  assert.equal(l('18/11'), '2026-11-18', 'sem ano = ano de hoje');
  assert.equal(l('05/03/26'), '2026-03-05');
  assert.equal(l('5-3-2026'), '2026-03-05');
  assert.equal(l('2026-11-18'), '2026-11-18');
  assert.equal(l('02/01'), '2026-01-02', 'ambígua: dia primeiro');
  assert.equal(l('30/12'), '2026-12-30', 'sem ano, até 60 dias à frente: ano de hoje');
  assert.equal(O.lerData('30/12', new Date('2027-01-10T15:00:00Z')), '2026-12-30', 'digitada em janeiro: dezembro é do ano anterior');
  assert.equal(l('31/02/2026'), '', 'data que não existe');
  assert.equal(l('13/13/2026'), '');
  assert.equal(l('abc'), ''); assert.equal(l(''), ''); assert.equal(l(null), '');
  assert.equal(O.lerData(new Date(2026, 10, 16), HOJE), '2026-11-16', 'célula de data do Excel');
  assert.equal(O.mostrarData('2026-11-16'), '16/11/2026'); assert.equal(O.curta('2026-11-16'), '16/11');
});

test('nota fiscal: só números, ignora zeros à esquerda e .0', () => {
  assert.equal(O.numeroDaNota('885234'), '885234');
  assert.equal(O.numeroDaNota(' 000885234.0 '), '885234');
  assert.equal(O.numeroDaNota(885234), '885234');
  assert.equal(O.numeroDaNota('12'), ''); assert.equal(O.numeroDaNota('abc'), ''); assert.equal(O.numeroDaNota(null), '');
  assert.equal(S.numeroDaNota('000885234.0'), '885234');
});

const oc = (x) => Object.assign({ id: 'a', nf: '885234', dataOcorrencia: '2026-11-16', detalhes: 'endereço', responsavel: 'Juliana', solucao: '', dataSolucao: '' }, x);
const pedido = (x) => Object.assign({ pedido: '355386', nome: 'CLIENTE X', liberadoEm: '2026-11-20', despachadoEm: '' }, x);

test('status: aberta, atrasada, em andamento, resolvida e o que falta no pedido', () => {
  const av = (o, p, saida) => O.avaliar(o, p, saida || '', HOJE);
  let a = av(oc({ dataOcorrencia: '2026-11-23' }), pedido());
  assert.deepEqual([a.status, a.nivel, a.dias], ['Aberta', 'atencao', 1]);
  assert.equal(a.acao, 'Acompanhar com Juliana.');
  a = av(oc(), pedido());
  assert.deepEqual([a.status, a.nivel, a.dias], ['Aberta · atrasada', 'urgente', 8]);
  assert.equal(a.acao, 'Cobrar Juliana: 8 dias sem solução.');
  assert.equal(av(oc({ responsavel: '' }), pedido()).acao, 'Definir quem é o responsável por resolver.');
  a = av(oc({ solucao: 'Retornou o e-mail hoje com endereço', dataOcorrencia: '2026-11-23' }), pedido());
  assert.deepEqual([a.situacao, a.status, a.nivel], ['andamento', 'Em andamento', 'andamento']);
  assert.match(a.acao, /^Há retorno registrado\. Confirme com Juliana/);
  a = av(oc({ solucao: 'Retornou', dataOcorrencia: '2026-11-18' }), pedido());
  assert.equal(a.nivel, 'urgente', 'em andamento há muito tempo também cobra');
  // resolvida com a data
  a = av(oc({ solucao: 'Resolvido', dataSolucao: '2026-11-18' }), pedido());
  assert.deepEqual([a.situacao, a.status, a.nivel, a.dias], ['resolvida', 'Resolvida · falta despachar', 'atencao', 2], 'os dias contam até a solução');
  assert.equal(a.pedido.texto, 'Pedido ainda não saiu (liberado há 4 dias)');
  a = av(oc({ solucao: 'Resolvido', dataSolucao: '2026-11-18' }), pedido(), '2026-11-19T12:00:00Z');
  assert.deepEqual([a.status, a.acao], ['Resolvida · falta despachar', 'Resolvida e o pedido já está na expedição: despachar.']);
  a = av(oc({ solucao: 'Resolvido', dataSolucao: '2026-11-18' }), pedido({ despachadoEm: '2026-11-22' }));
  assert.deepEqual([a.status, a.nivel], ['Resolvida e despachada', 'concluido']);
  assert.equal(av(oc({ solucao: 'resolvida por telefone' }), pedido({ despachadoEm: '2026-11-22' })).situacao, 'resolvida', 'a palavra "resolvido" na solução conta');
  // pedido despachado mas ocorrência ainda aberta
  a = av(oc(), pedido({ despachadoEm: '2026-11-22' }));
  assert.equal(a.status, 'Pedido despachado · fechar a ocorrência');
  // nota fora da base
  a = av(oc({ solucao: 'Resolvido', dataSolucao: '2026-11-18' }), undefined);
  assert.deepEqual([a.status, a.pedido.codigo], ['Resolvida', 'nao-achado']);
  assert.equal(av(oc(), undefined).pedido.texto, 'Nota ou pedido não encontrado na base do SC9');
});

test('ordem e resumo', () => {
  const l = [
    oc({ id: '1', nf: '100001', dataOcorrencia: '2026-11-16', solucao: 'Resolvido', dataSolucao: '2026-11-18' }),
    oc({ id: '2', nf: '100002', dataOcorrencia: '2026-11-21' }),
    oc({ id: '3', nf: '100003', dataOcorrencia: '2026-11-24' }),
    oc({ id: '4', nf: '100004', dataOcorrencia: '2026-11-22', solucao: 'Retornou' }),
    oc({ id: '5', nf: '100005', dataOcorrencia: '2026-11-10', solucao: 'Resolvido', dataSolucao: '2026-11-15' })
  ].map((o) => ({ oc: o, av: O.avaliar(o, o.nf === '100005' ? pedido({ despachadoEm: '2026-11-22' }) : o.nf === '100004' ? undefined : pedido(), '', HOJE) }));
  assert.deepEqual(O.ordenar(l).map((x) => x.oc.id), ['2', '1', '3', '4', '5'], 'urgentes primeiro, depois atenção (mais antigas antes), em andamento; concluídas por último');
  const r = O.resumo(l);
  assert.deepEqual([r.total, r.abertas, r.andamento, r.resolvidas, r.atrasadas, r.faltaDespachar, r.naoAchadas], [5, 2, 1, 2, 1, 1, 1]);
  assert.equal(r.mediaDiasParaResolver, 3.5, '(2 + 5) ÷ 2');
  assert.equal(r.maisAntigaEmAberto, 3);
});

test('colar da planilha da expedição (Excel separa por TAB) com os 3 exemplos', () => {
  const t = [
    'Nº da Nota Fiscal\tData da Ocorrência\tDetalhes da Ocorrência\tResponsável \tSolução da Ocorrência\tData da Solução',
    '885234\t11/16/2026\tendereço insuficiente- vendedor está verificando e cadastro precisa atualizar\tJuliana Abranches\tResolvido\t18/11',
    '886039\t11/21/2026\tcliente mudou de endereço- vendedora está retornando hoje o e-mail.\tDaniela Anselmo\tRetornou o e-mail hoje com endereço\t',
    '886511\t23/11/2026\tcliente mudou de endereço- vendedora está retornando hoje o e-mail.\tNatalia (Qualidade)\tRetornou o e-mail dia 24/11',
    '',
    'xyz\t23/11/2026\tnota ruim',
    '887000\tontem\tdata ruim',
    'linha sem tab'
  ].join('\r\n');
  const r = O.lerColado(t, HOJE);
  assert.equal(r.linhas.length, 3);
  assert.deepEqual(r.linhas[0], { nf: '885234', pedido: '', dataOcorrencia: '2026-11-16', detalhes: 'endereço insuficiente- vendedor está verificando e cadastro precisa atualizar', responsavel: 'Juliana Abranches', solucao: 'Resolvido', dataSolucao: '2026-11-18' });
  assert.equal(r.linhas[1].dataOcorrencia, '2026-11-21'); assert.equal(r.linhas[1].dataSolucao, '');
  assert.equal(r.linhas[2].solucao, 'Retornou o e-mail dia 24/11'); assert.equal(r.linhas[2].dataSolucao, '', 'linha com menos colunas');
  assert.deepEqual(r.invalidas.map((x) => x.linha), [6, 7, 8]);
});

// ------------------------------------------------------------------ servidor (lista)
test('lista de ocorrências: valida, cria, troca, remove, importa sem repetir', () => {
  const agora = Date.UTC(2026, 10, 24, 15);
  const bom = { nf: '885234', dataOcorrencia: '2026-11-16', detalhes: '  endereço   insuficiente ', responsavel: 'Juliana', solucao: '', dataSolucao: '' };
  assert.ok(S.aplicar([], { acao: 'salvar', linha: { ...bom, nf: '12' } }, 'x', agora).erro);
  assert.ok(S.aplicar([], { acao: 'salvar', linha: { ...bom, dataOcorrencia: '16/11/2026' } }, 'x', agora).erro, 'o servidor só aceita AAAA-MM-DD');
  assert.ok(S.aplicar([], { acao: 'salvar', linha: { ...bom, dataSolucao: '2026-11-10' } }, 'x', agora).erro, 'solução antes da ocorrência');
  assert.ok(S.aplicar([], { acao: 'xyz' }, 'x', agora).erro);
  let r = S.aplicar([], { acao: 'salvar', linha: bom }, 'arthur', agora);
  assert.equal(r.linhas.length, 1); assert.equal(r.linhas[0].detalhes, 'endereço insuficiente'); assert.equal(r.linhas[0].criadoPor, 'arthur');
  const id = r.resultado.id;
  r = S.aplicar(r.linhas, { acao: 'salvar', linha: { ...bom, id, solucao: 'Resolvido', dataSolucao: '2026-11-18' } }, 'victor', agora + 1000);
  assert.equal(r.linhas.length, 1, 'trocou a mesma linha');
  assert.deepEqual([r.linhas[0].solucao, r.linhas[0].criadoPor, r.linhas[0].atualizadoPor], ['Resolvido', 'arthur', 'victor']);
  r = S.aplicar(r.linhas, { acao: 'importar', linhas: [bom, { ...bom, nf: '886039', detalhes: 'outra' }, { ...bom, nf: 'x' }, { ...bom, dataOcorrencia: 'ontem' }] }, 'arthur', agora);
  assert.deepEqual([r.resultado.novas, r.resultado.repetidas, r.resultado.invalidas.length], [1, 1, 2]);
  assert.equal(r.linhas.length, 2);
  assert.ok(S.aplicar(r.linhas, { acao: 'remover', id: 'nao-existe' }, 'x', agora).erro);
  r = S.aplicar(r.linhas, { acao: 'remover', id }, 'x', agora);
  assert.equal(r.linhas.length, 1);
  assert.deepEqual(S.linhasIniciais(agora).map((l) => [l.nf, l.dataOcorrencia, l.dataSolucao]), [['885234', '2026-11-16', '2026-11-18'], ['886039', '2026-11-21', ''], ['886511', '2026-11-23', '']]);
  assert.equal(S.normalizarLista({ linhas: S.linhasIniciais(agora) }).length, 3, 'as linhas iniciais passam na validação');
});

// ------------------------------------------------------------------ servidor (rota)
test('servidor: ocorrências exigem o acesso, começam com as 3 linhas da expedição, achem a nota no SC9 e guardam as alterações', async () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-ocorr-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'ocorrencias-store.js', 'ocorrencias-lookup.js', 'consolidado.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data);
  const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  fs.writeFileSync(path.join(data, 'latest.json'), JSON.stringify({
    orders: [
      { pedido: '355386', armazem: 'Cambuci', nf: '885234.0', nome: 'CLIENTE ALFA LTDA', cliente: '001', dt: '2026-11-15T12:00:00.000Z', qt: 5 },
      { pedido: '355999', armazem: 'Cambuci', nf: '886039', nome: 'CLIENTE BETA SA', cliente: '002', dt: '2026-11-18T12:00:00.000Z', qt: 2 }
    ],
    valores: [['885234', { mercad: 900, fatura: 1000.5 }]],
    entregaInfo: [['355999', { data: '2026-11-23T12:00:00.000Z', transportadora: 'Brasil' }]]
  }));
  fs.writeFileSync(path.join(data, 'saida-dias.json'), JSON.stringify({ dias: [hoje], exportados: {}, pendentes: {} }));
  fs.writeFileSync(path.join(data, 'saida-pv-' + hoje + '.json'), JSON.stringify({ dia: hoje, versao: 1, removidos: [], entries: [{ id: 'a', pedido: '0355386', registradoEm: hoje + 'T18:00:00.000Z', itens: [] }] }));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, body, cookie, metodo) => {
    const r = await fetch(base + url, { method: metodo || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  };
  try {
    const admin = (await call('/api/login', { password: process.env.APP_PASSWORD })).cookie;
    for (const [usuario, perfis] of [['eva', ['ocorrencias']], ['bia', ['saida']]]) assert.equal((await call('/api/usuarios', { acao: 'criar', usuario, nome: usuario, senha: 'ficticio-123', perfis }, admin)).status, 200);
    const eva = (await call('/api/login', { usuario: 'eva', password: 'ficticio-123' })).cookie;
    const bia = (await call('/api/login', { usuario: 'bia', password: 'ficticio-123' })).cookie;
    assert.equal((await call('/api/ocorrencias')).status, 401);
    // link sem senha do histórico (?k=): lê, registra e edita; apagar e importar continuam exigindo usuário e senha
    const k = (await call('/api/atraso-historico-link', { acao: 'gerar' }, admin)).data.token;
    assert.ok(k);
    assert.equal((await call('/api/ocorrencias?k=' + k)).status, 200, 'o link lê as ocorrências');
    assert.equal((await call('/api/ocorrencias?k=errado' + k)).status, 401, 'código errado não lê');
    assert.equal((await call('/api/ocorrencias?k=errado' + k, { acao: 'salvar', linha: { nf: '700001', dataOcorrencia: '2026-11-24', detalhes: 'x' } })).status, 401, 'código errado não grava');
    assert.equal((await call('/api/ocorrencias', { acao: 'salvar', linha: { nf: '700001', dataOcorrencia: '2026-11-24', detalhes: 'x' } })).status, 401, 'sem link e sem login não grava');
    const viaLink = await call('/api/ocorrencias?k=' + k, { acao: 'salvar', linha: { nf: '700001', dataOcorrencia: '2026-11-24', detalhes: 'cliente pediu para segurar' } });
    assert.equal(viaLink.status, 200, 'o link registra');
    const criada = viaLink.data.linhas.find((l) => l.nf === '700001');
    assert.equal(criada.criadoPor, 'Link do histórico', 'fica registrado que veio do link');
    const editada = await call('/api/ocorrencias?k=' + k, { acao: 'salvar', linha: { id: criada.id, nf: '700001', dataOcorrencia: '2026-11-24', detalhes: 'cliente pediu para segurar', solucao: 'liberado', dataSolucao: '2026-11-25' } });
    assert.equal(editada.status, 200, 'o link edita');
    assert.equal(editada.data.linhas.find((l) => l.id === criada.id).solucao, 'liberado');
    assert.equal((await call('/api/ocorrencias?k=' + k, { acao: 'remover', id: criada.id })).status, 403, 'o link não apaga');
    assert.equal((await call('/api/ocorrencias?k=' + k, { acao: 'importar', linhas: [{ nf: '1', dataOcorrencia: '2026-11-24' }] })).status, 403, 'o link não importa');
    assert.equal((await call('/api/ocorrencias', { acao: 'remover', id: criada.id }, admin)).status, 200, 'com login apaga (limpa o teste)');
    assert.equal((await call('/api/ocorrencias', null, bia)).status, 403, 'sem o acesso Ocorrências não entra');
    let r = await call('/api/ocorrencias', null, eva);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.linhas.map((l) => l.nf).sort(), ['885234', '886039', '886511'], 'entram as 3 linhas que a expedição já tinha');
    assert.equal(r.data.notas['885234'].nome, 'CLIENTE ALFA LTDA');
    assert.equal(r.data.notas['885234'].pedido, '355386');
    assert.equal(r.data.notas['885234'].valor, 1000.5);
    assert.equal(r.data.notas['886039'].despachadoEm, '2026-11-23');
    assert.equal(r.data.notas['886511'], undefined, 'nota que não está na base não inventa cliente');
    assert.equal(r.data.saidas['355386'], hoje + 'T18:00:00.000Z', 'acha o pedido na Saída p/ Expedição');
    assert.equal((await call('/api/ocorrencias', null, eva)).data.linhas.length, 3, 'não repete as iniciais');
    r = await call('/api/ocorrencias', { acao: 'salvar', linha: { nf: '000885234', dataOcorrencia: '2026-11-24', detalhes: 'sem número da casa', responsavel: 'Eva' } }, eva);
    assert.equal(r.status, 200);
    assert.equal(r.data.linhas.length, 4);
    const nova = r.data.linhas.find((l) => l.detalhes === 'sem número da casa');
    assert.equal(nova.nf, '885234');
    assert.equal(nova.criadoPor, 'eva');
    assert.equal((await call('/api/ocorrencias', { acao: 'salvar', linha: { nf: 'abc', dataOcorrencia: '2026-11-24' } }, eva)).status, 400);
    r = await call('/api/ocorrencias', { acao: 'salvar', linha: Object.assign({}, nova, { solucao: 'resolvido', dataSolucao: '2026-11-25' }) }, eva);
    assert.equal(r.data.linhas.find((l) => l.id === nova.id).dataSolucao, '2026-11-25');
    assert.equal(r.data.linhas.length, 4, 'editar não duplica');
    r = await call('/api/ocorrencias', { acao: 'importar', linhas: [{ nf: '887000', dataOcorrencia: '2026-11-24', detalhes: 'x' }, { nf: '885234', dataOcorrencia: '2026-11-16', detalhes: 'endereço insuficiente- vendedor está verificando e cadastro precisa atualizar' }] }, eva);
    assert.equal(r.data.resultado.novas, 1);
    assert.equal(r.data.resultado.repetidas, 1);
    r = await call('/api/ocorrencias', { acao: 'remover', id: nova.id }, eva);
    assert.equal(r.data.linhas.some((l) => l.id === nova.id), false);
    assert.equal((await call('/api/ocorrencias', { acao: 'remover', id: 'naoexiste' }, eva)).status, 404);
    assert.ok(fs.existsSync(path.join(data, 'ocorrencias-expedicao.json')));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('ocorrência por pedido: vale sem nota, exige nota ou pedido, acha o pedido na base e aceita a 7ª coluna na colagem', () => {
  const L = require('../ocorrencias-lookup.js');
  const agora = Date.UTC(2026, 10, 24, 15);
  const base = { dataOcorrencia: '2026-11-24', detalhes: 'cliente sem cadastro', responsavel: 'Eva', solucao: '', dataSolucao: '' };
  let r = S.aplicar([], { acao: 'salvar', linha: Object.assign({ nf: '', pedido: '0355386' }, base) }, 'eva', agora);
  assert.equal(r.erro, undefined);
  assert.deepEqual([r.linhas[0].nf, r.linhas[0].pedido], ['', '355386'], 'sem nota, com o pedido limpo');
  assert.ok(S.aplicar([], { acao: 'salvar', linha: Object.assign({ nf: '', pedido: '' }, base) }, 'eva', agora).erro, 'sem nota e sem pedido não vale');
  assert.ok(S.aplicar([], { acao: 'salvar', linha: Object.assign({ nf: '', pedido: '12' }, base) }, 'eva', agora).erro, 'pedido inválido');
  r = S.aplicar(r.linhas, { acao: 'importar', linhas: [Object.assign({ nf: '', pedido: '355386' }, base), Object.assign({ nf: '', pedido: '355999' }, base)] }, 'eva', agora);
  assert.deepEqual([r.resultado.novas, r.resultado.repetidas], [1, 1], 'a mesma ocorrência do mesmo pedido não repete');
  const snap = { orders: [{ pedido: '0355386', armazem: 'Cambuci', nf: '', nome: 'CLIENTE ALFA', cliente: '1', dt: '2026-11-15T12:00:00.000Z', qt: 4 }] };
  const ped = L.procurarPedidos(snap, ['355386', '999999']);
  assert.equal(ped['355386'].nome, 'CLIENTE ALFA');
  assert.equal(ped['999999'], undefined);
  const col = O.lerColado('885234\t24/11/2026\tdetalhe\tJu\t\t\t\n\t24/11/2026\tsem nota\tJu\t\t\t355386\nabc\t24/11/2026\tx', agora ? new Date(agora) : undefined);
  assert.equal(col.linhas.length, 2);
  assert.deepEqual([col.linhas[1].nf, col.linhas[1].pedido], ['', '355386']);
  assert.equal(col.invalidas.length, 1);
});
