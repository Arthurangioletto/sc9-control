const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../historico-atraso.js');

const AGORA = new Date('2026-11-24T15:00:00.000Z'); // terça 12h em Brasília
// [pedido, armazém, liberadoEm, peças, 'E'|'F', 'A'|'P', dias, transportadora, extras]
const item = (pedido, nf, e, dias, extra) => [pedido, 'Cambuci', '2026-11-10', 5, e === 'F' ? 'F' : 'E', 'A', dias, 'TCS', Object.assign({ n: 'CLIENTE ' + pedido, nf, e }, extra || {})];
const oc = (nf, o) => Object.assign({ nf, dataOcorrencia: '2026-11-16', detalhes: 'endereço insuficiente', responsavel: 'Juliana', solucao: '', dataSolucao: '' }, o || {});
const dados = (ocorrencias, entregues, itens) => ({ meses: { '2026-11': { mes: '2026-11', dias: { '2026-11-24': { dia: '2026-11-24', total: 100, pecas: 0, atualizadoEm: '2026-11-24T14:00:00.000Z', itens } } } }, expedicao: {}, entregues: entregues || {}, saidas: {}, ocorrencias });

test('a ocorrência chega ao pedido pela nota fiscal, ignorando zeros e ".0"', () => {
  const it = item('1001', '000885234.0', 'F', 8);
  const p = H.preparar(dados([oc('885234')], {}, [it]));
  const o = H.ocorrenciaDoPedido(p, it, AGORA);
  assert.equal(o.oc.responsavel, 'Juliana');
  assert.equal(o.av.status, 'Aberta · atrasada');
  assert.equal(o.av.dias, 8);
  assert.equal(H.ocorrenciaDoPedido(p, item('1002', '999999', 'F', 3), AGORA), null);
  assert.equal(H.ocorrenciaDoPedido(p, item('1003', '', 'F', 3), AGORA), null, 'pedido sem nota não casa com nada');
});

test('com várias ocorrências na nota vale a aberta mais antiga; resolvida só se não houver aberta', () => {
  const it = item('1001', '885234', 'F', 8);
  const p = H.preparar(dados([oc('885234', { dataOcorrencia: '2026-11-20', detalhes: 'nova' }), oc('885234', { dataOcorrencia: '2026-11-10', detalhes: 'velha' }), oc('885234', { dataOcorrencia: '2026-11-05', solucao: 'Resolvido', dataSolucao: '2026-11-06', detalhes: 'fechada' })], {}, [it]));
  const o = H.ocorrenciaDoPedido(p, it, AGORA);
  assert.equal(o.oc.detalhes, 'velha');
  assert.equal(o.total, 3);
  const p2 = H.preparar(dados([oc('885234', { solucao: 'Resolvido', dataSolucao: '2026-11-18' })], {}, [it]));
  assert.equal(H.ocorrenciaDoPedido(p2, it, AGORA).av.resolvida, true);
});

test('o que fazer: depende da etapa, da ocorrência e do despacho', () => {
  const acao = (it, entregues, ocs) => { const p = H.preparar(dados(ocs || [], entregues || {}, [it])); return H.avaliarPedido(p, it, '2026-11-24', AGORA).acao; };
  assert.equal(acao(item('1', '', 'S', 2)).cod, 'separar');
  assert.equal(acao(item('2', '', 'C', 2)).cod, 'conferir');
  assert.equal(acao(item('3', '', 'F', 2)).cod, 'faturar');
  assert.match(acao(item('3', '', 'F', 6)).texto, /Atrasado há 6 dias: prioridade/);
  assert.equal(acao(item('4', '777777', 'D', 2)).cod, 'levar');
  assert.equal(acao(item('5', '', 'F', 2, {}), { 5: '2026-11-23' }).cod, 'ok', 'despachado: nada a fazer');
  const comOc = item('6', '885234', 'F', 4);
  assert.equal(acao(comOc, {}, [oc('885234')]).cod, 'ocorrencia', 'ocorrência aberta vem antes da etapa');
  assert.equal(acao(comOc, { 6: '2026-11-23' }, [oc('885234')]).cod, 'fechar', 'despachado com ocorrência aberta: fechar');
  const resolvida = acao(comOc, {}, [oc('885234', { solucao: 'Resolvido', dataSolucao: '2026-11-20' })]);
  assert.equal(resolvida.cod, 'faturar');
  assert.match(resolvida.texto, /^Ocorrência resolvida\./);
  const naExp = item('7', '', 'F', 2); naExp[9] = '2026-11-24T13:00:00.000Z';
  assert.equal(acao(naExp).cod, 'despachar');
});

test('"O que fazer agora": agrupa pelo próximo passo e conta os 5+ dias sem ocorrência', () => {
  const itens = [item('1', '', 'F', 9), item('2', '', 'F', 2), item('3', '', 'C', 7), item('4', '885234', 'F', 6), item('5', '', 'S', 1), item('6', '', 'F', 3)];
  const p = H.preparar(dados([oc('885234')], { 6: '2026-11-23' }, itens));
  const r = H.prioridades(p, itens, '2026-11-24', AGORA);
  assert.deepEqual(r.grupos.map((g) => [g.cod, g.qtd, g.antigos]), [['ocorrencia', 1, 1], ['faturar', 2, 1], ['conferir', 1, 1], ['separar', 1, 0]]);
  assert.equal(r.despachados, 1);
  assert.equal(r.semOcorrencia.qtd, 2, 'pedidos 1 e 3 estão há 5+ dias sem ocorrência (o 4 tem; o 6 já saiu)');
});

test('filtros por "o que fazer" e por ocorrência', () => {
  const itens = [item('1', '', 'F', 9), item('2', '885234', 'F', 2), item('3', '', 'C', 7)];
  const p = H.preparar(dados([oc('885234')], {}, itens));
  const ctx = { p, dia: '2026-11-24', agora: AGORA };
  const f = (extra) => H.filtrar(itens, Object.assign({ ordem: 'dias', desc: true }, extra), p.entregues, ctx).map((i) => i[0]);
  assert.deepEqual(f({ acao: 'faturar' }), ['1']);
  assert.deepEqual(f({ ocorr: 'aberta' }), ['2']);
  assert.deepEqual(f({ ocorr: 'sem' }), ['1', '3']);
  assert.deepEqual(f({ ocorr: 'sem5' }), ['1', '3']);
  assert.deepEqual(f({ ocorr: 'com' }), ['2']);
  assert.deepEqual(H.filtrar(itens, { ordem: 'dias', desc: true, acao: 'faturar' }, p.entregues).length, 3, 'sem ctx o filtro novo é ignorado');
});

test('csv leva o que fazer e a ocorrência', () => {
  const it = item('1', '885234', 'F', 6);
  const p = H.preparar(dados([oc('885234', { solucao: 'Retornou o e-mail', dataSolucao: '' })], {}, [it]));
  const linhas = H.csv([it], p.entregues, '2026-11-24', 'atraso', { p, agora: AGORA }).slice(1).split('\r\n');
  assert.ok(linhas[0].endsWith('"O que fazer";"Ocorrência";"Detalhes da ocorrência";"Responsável";"Solução";"Data da solução"'));
  assert.match(linhas[1], /"Em andamento";"endereço insuficiente";"Juliana";"Retornou o e-mail";""$/);
});

test('ocorrência sem nota: chega ao pedido pelo número do pedido (e também a que tem as duas coisas)', () => {
  const semNota = item('355386', '', 'F', 6);
  const comNota = item('355999', '886039', 'F', 7);
  const p = H.preparar(dados([oc('', { pedido: '0355386', detalhes: 'cliente ainda não confirmou o endereço' }), oc('886039', { pedido: '355999', detalhes: 'outra' }), oc('', { pedido: '355999', detalhes: 'e esta, sem nota' })], {}, [semNota, comNota]));
  const a = H.ocorrenciaDoPedido(p, semNota, AGORA);
  assert.equal(a.oc.detalhes, 'cliente ainda não confirmou o endereço');
  assert.equal(a.av.status, 'Aberta · atrasada');
  const b = H.ocorrenciaDoPedido(p, comNota, AGORA);
  assert.equal(b.total, 2, 'a da nota e a do pedido aparecem juntas');
  assert.equal(H.ocorrenciaDoPedido(p, item('777777', '', 'F', 4), AGORA), null);
});

test('lista de ocorrências do pedido: nota e pedido juntos, sem repetir a mesma linha', () => {
  const it = item('355999', '886039', 'F', 7);
  const comAmbos = oc('886039', { pedido: '355999', detalhes: 'tem nota e pedido' });
  const p = H.preparar(dados([comAmbos, oc('', { pedido: '0355999', detalhes: 'só pedido' })], {}, [it]));
  const lista = H.ocorrenciasDoPedido(p, it);
  assert.deepEqual(lista.map((x) => x.detalhes).sort(), ['só pedido', 'tem nota e pedido'], 'a linha com nota e pedido aparece uma vez só');
  assert.deepEqual(H.ocorrenciasDoPedido(p, item('1', '', 'F', 1)), []);
});
