const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../rastreio.js');
const Oc = require('../ocorrencias-store.js');
const O = require('../ocorrencias.js');

const AGORA = new Date('2026-11-24T15:00:00.000Z');
const linha = (o) => Object.assign({ pedido: '0355386', armazem: 'Cambuci', nf: '', nome: 'CLIENTE ALFA', cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Pendente', transportadora: '4', separador: 'JOSE', conferente: 'MARIA' }, o || {});
const snap = (orders, extra) => Object.assign({ savedAt: '2026-11-24T14:00:00.000Z', orders, faturamento: [], entregaInfo: [], valores: [['885234', { mercad: 900, fatura: 1000 }]] }, extra || {});

test('mensagem para a cliente: uma frase por situação, sem nome de funcionário, valor nem termo interno', () => {
  const base = { pickEnd: '2026-11-18T15:00:00.000Z', confEnd: '2026-11-19T11:00:00.000Z' };
  // atrasado, aguardando nota
  let r = R.montarRastreio(snap([linha(base)]), '355386', { agora: AGORA });
  assert.match(r.mensagemCliente, /^Olá! Sobre o pedido 355386: ele já foi separado e conferido e aguarda a emissão da nota fiscal\. Sei que passou do prazo/);
  // em andamento (recém-liberado, em separação)
  r = R.montarRastreio(snap([linha({ dtLiberacaoHora: '2026-11-24T12:10:00.000Z', pickStart: '2026-11-24T13:00:00.000Z', separador: '', conferente: '' })]), '355386', { agora: AGORA });
  assert.match(r.mensagemCliente, /^Olá! O pedido 355386 está sendo separado no estoque agora\. Assim que ele sair do estoque, aviso você\.$/);
  // pronto para despacho
  r = R.montarRastreio(snap([linha(Object.assign({ nf: '885234' }, base))], { faturamento: [['885234', '2026-11-20T18:00:00.000Z']] }), '355386', { saidaIso: '2026-11-24T13:00:00.000Z', agora: AGORA });
  assert.match(r.mensagemCliente, /já está separado, conferido e com a nota emitida, aguardando a coleta/);
  // despachado
  r = R.montarRastreio(snap([linha(Object.assign({ nf: '885234', status: 'Enviado' }, base))], { faturamento: [['885234', '2026-11-20T18:00:00.000Z']], entregaInfo: [['0355386', { data: '2026-11-22T12:00:00.000Z' }]] }), '355386', { saidaIso: '2026-11-21T13:00:00.000Z', agora: AGORA, nomeTransportadora: () => 'Retira 01' });
  assert.match(r.mensagemCliente, /^Olá! O seu pedido 355386 foi despachado em 22\/11 pela transportadora Retira 01\./);
  for (const proibido of ['JOSE', 'MARIA', '1000', '900', 'SC9', 'base', 'carga', 'conferente', 'separador']) assert.ok(!r.mensagemCliente.includes(proibido), proibido);
  assert.equal(R.mensagemParaCliente({ achado: false }), '');
});

test('mensagem com ocorrência aberta usa o tipo; resolvida não aparece na mensagem', () => {
  const base = { pickEnd: '2026-11-18T15:00:00.000Z', confEnd: '2026-11-19T11:00:00.000Z' };
  const oc = (extra) => Object.assign({ nf: '', pedido: '355386', dataOcorrencia: '2026-11-20', tipo: 'endereco', detalhes: 'faltou número', responsavel: 'Daniela', solucao: '', dataSolucao: '' }, extra || {});
  let r = R.montarRastreio(snap([linha(base)]), '355386', { agora: AGORA, ocorrencias: [oc()] });
  assert.match(r.mensagemCliente, /identificamos um ponto de atenção \(endereço errado ou incompleto\)/);
  assert.equal(r.ocorrencia.tipoTexto, 'Endereço errado ou incompleto');
  assert.equal(r.ocorrencia.quem, 'A vendedora confirma o endereço com a cliente.');
  assert.ok(!JSON.stringify(r).includes('Daniela'));
  r = R.montarRastreio(snap([linha(base)]), '355386', { agora: AGORA, ocorrencias: [oc({ solucao: 'ok', dataSolucao: '2026-11-21' })] });
  assert.ok(!/identificamos/.test(r.mensagemCliente));
});

test('maior espera: aponta a etapa que mais demorou e a espera de agora; abaixo de 4 horas não destaca', () => {
  // liberado 18/11 12:10; separado 18/11 15:00 (3 h); conferido 21/11 11:00 (~68 h) -> aguardando nota há ~3 dias
  let r = R.montarRastreio(snap([linha({ pickEnd: '2026-11-18T15:00:00.000Z', confEnd: '2026-11-21T14:00:00.000Z' })]), '355386', { agora: AGORA });
  assert.equal(r.espera.emCurso, true);
  assert.match(r.espera.texto, /^Está nesta etapa há 3 dias\./);
  r = R.montarRastreio(snap([linha({ pickEnd: '2026-11-18T15:00:00.000Z', confEnd: '2026-11-23T14:00:00.000Z' })]), '355386', { agora: AGORA });
  assert.equal(r.espera.emCurso, false);
  assert.match(r.espera.texto, /^A etapa que mais demorou foi "Conferência": 5 dias\./);
  r = R.montarRastreio(snap([linha({ dtLiberacaoHora: '2026-11-24T13:30:00.000Z', dt: '2026-11-24' })]), '355386', { agora: AGORA });
  assert.equal(r.espera, null, 'menos de 4 horas: nada a destacar');
});

test('ocorrência: tipo é lista fechada e fica guardado; tipo desconhecido vira vazio', () => {
  const nova = Oc.aplicar([], { acao: 'salvar', linha: { nf: '885234', dataOcorrencia: '2026-11-20', tipo: 'volume', detalhes: 'faltou 1 volume' } }, 'ana', Date.now());
  assert.equal(nova.linhas[0].tipo, 'volume');
  const estranha = Oc.aplicar([], { acao: 'salvar', linha: { nf: '885234', dataOcorrencia: '2026-11-20', tipo: 'qualquer coisa', detalhes: 'x' } }, 'ana', Date.now());
  assert.equal(estranha.linhas[0].tipo, '');
  const semTipo = Oc.aplicar([], { acao: 'salvar', linha: { nf: '885234', dataOcorrencia: '2026-11-20', detalhes: 'x' } }, 'ana', Date.now());
  assert.equal(semTipo.linhas[0].tipo, '', 'linhas antigas, sem tipo, continuam valendo');
  assert.deepEqual(Oc.TIPOS.slice().sort(), O.TIPOS.map((t) => t.id).sort(), 'as duas listas (servidor e tela) são a mesma');
});
