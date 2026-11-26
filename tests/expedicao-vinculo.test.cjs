const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const V = require('../expedicao-vinculo.js');

const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
const hojeSP = () => fmt.format(new Date());
const add = (dia, n) => V.addDias(dia, n);
const AGORA = new Date('2026-11-25T18:00:00.000Z'); // 15h em São Paulo
const HOJE = '2026-11-25';

// ---------------------------------------------------------------- módulo puro
test('Entrega: pedido sem zeros nem ".0", data ISO com horário vira o dia de São Paulo e a data mais NOVA vence', () => {
  const m = V.normalizarEntrega([
    ['0355386', { data: '2026-11-24T02:30:00.000Z', transportadora: ' TCS ' }], // 23h30 do dia 23 em São Paulo
    ['355386.0', { data: '2026-11-22', transportadora: 'Brasil' }],             // mesmo pedido, data mais velha: perde
    ['400001', { data: '2026-11-24T21:00:00.000Z' }],
    ['abc', { data: '2026-11-24' }], ['12', { data: '2026-11-24' }], ['500001', { data: 'lixo' }], 'solto', null
  ]);
  assert.deepEqual([...m.keys()].sort(), ['355386', '400001', '500001']);
  assert.deepEqual(m.get('355386'), { data: '2026-11-23', transportadora: 'TCS' });
  assert.equal(m.get('400001').data, '2026-11-24');
  assert.equal(m.get('500001').data, '', 'data inválida não vira dia');
  assert.equal(V.diaDeValor('2026-11-24T02:59:59.000Z'), '2026-11-23');
  assert.equal(V.diaDeValor('2026-02-30'), '', 'dia que não existe no calendário');
  assert.equal(V.normalizarPedido('0355386'), '355386');
  assert.equal(V.normalizarPedido('355386.0'), '355386');
});

test('intervalo: padrão é o mês até hoje, ate no futuro é cortado e o máximo é 62 dias', () => {
  assert.deepEqual(V.intervalo('', '', HOJE), { de: '2026-11-01', ate: HOJE });
  assert.deepEqual(V.intervalo('2026-11-10', '2026-12-31', HOJE), { de: '2026-11-10', ate: HOJE });
  assert.ok(V.intervalo('2026-11-20', '2026-11-10', HOJE).erro);
  assert.ok(V.intervalo('2026-13-01', HOJE, HOJE).erro);
  assert.ok(V.intervalo('26-11-01', HOJE, HOJE).erro);
  assert.ok(V.intervalo('2026-09-23', HOJE, HOJE).erro, '64 dias passa do limite');
  assert.equal(V.intervalo('2026-09-25', HOJE, HOJE).erro, undefined, '62 dias cabem');
});

test('info: só completa o que está vazio, nunca apaga nem troca dado preenchido, e o SC9 vazio não limpa nada', () => {
  const base = { cliente: 'NOVO NOME', transportadora: 'TCS', nf: '9001', armazem: 'Cambuci', linhas: 3, pecas: 10 };
  const m = V.mesclarInfo({ cliente: 'CLIENTE ANTIGO', transportadora: '', nf: null, armazem: 'Cambuci', linhas: 0 }, base);
  assert.equal(m.info.cliente, 'CLIENTE ANTIGO');
  assert.equal(m.info.nf, '9001'); assert.equal(m.info.transportadora, 'TCS'); assert.equal(m.info.linhas, 3);
  assert.deepEqual(m.campos.sort(), ['linhas', 'nf', 'pecas', 'transportadora']);
  const vazioBase = V.mesclarInfo({ cliente: 'X', nf: '55' }, { cliente: '', nf: '', transportadora: null });
  assert.deepEqual(vazioBase.campos, []);
  assert.equal(vazioBase.info.nf, '55');
  const e1 = { id: 'a', pedido: '111111', semDadoSC9: true, info: null };
  const e2 = { id: 'b', pedido: '222222', info: { cliente: 'C', nf: '1', transportadora: 'T', armazem: 'A', linhas: 1, pecas: 1, conferente: 'x', liberadoEm: 'y', fimConferencia: 'z' } };
  const r = V.reconciliarInfo([e1, e2], (p) => (p === '111111' ? base : { cliente: 'OUTRO', nf: '7' }), 'AGORA');
  assert.equal(r.mudou, true);
  assert.equal(r.entries[0].info.nf, '9001'); assert.equal(r.entries[0].semDadoSC9, false); assert.equal(r.entries[0].resolvidoEm, 'AGORA');
  assert.equal(r.entries[1], e2, 'entrada completa nem é copiada');
  assert.equal(e1.info, null, 'não muda o objeto original');
  const v = V.visaoEntrada({ pedido: '1', info: { nf: '' }, saiuEntrega: { transportadora: 'TCS' } }, null);
  assert.equal(v.aguardandoNota, true); assert.equal(v.info.transportadora, 'TCS', 'sem SC9, a visão usa a transportadora da Entrega');
});

const entrada = (id, pedido, extra) => Object.assign({ id, pedido, recebidoPorNome: 'Ana', recebidoPorUsuario: 'ana', recebidoEm: '2026-11-24T13:00:00.000Z', info: { cliente: 'CLIENTE ' + pedido, transportadora: 'Retira 02', nf: '5' + pedido, armazem: 'Cambuci' }, volumes: null, naoSaiHoje: null, saiuEntrega: null }, extra || {});
const saida = (id, pedido, em, extra) => Object.assign({ id, pedido, registradoEm: em, registradoPorNome: 'Beto', registradoPorUsuario: 'beto' }, extra || {});

function cenario() {
  const recebPorDia = {
    '2026-11-24': [
      entrada('r1', '100001', { volumes: 2, recebidoEm: '2026-11-24T14:00:00.000Z', saiuEntrega: { dataEntrega: '2026-11-24', transportadora: 'RETIRA 02' }, rastreio: { codigo: 'AB1', link: 'https://t.exemplo.com/AB1' } }),
      entrada('r2', '100002', { volumes: 1, recebidoEm: '2026-11-24T14:30:00.000Z' }),
      entrada('r3', '100003', { recebidoEm: '2026-11-24T15:00:00.000Z', naoSaiHoje: { motivo: 'Falta nota' } }),
      entrada('r4', '100004', { volumes: 3, recebidoEm: '2026-11-24T13:00:00.000Z', saiuEntrega: { dataEntrega: '2026-11-25', transportadora: 'TCS' } }), // saiu um dia depois; transportadora diferente
      entrada('r5', '100005', { origem: 'entrega', horaEstimada: true, recebidoEm: '2026-11-24T15:00:00.000Z', recebidoPorNome: 'Planilha de Entrega', saiuEntrega: { dataEntrega: '2026-11-24', transportadora: 'TCS' }, info: null, semDadoSC9: true })
    ],
    '2026-11-25': [entrada('r6', '100006', { recebidoEm: '2026-11-25T12:00:00.000Z' })]
  };
  const saidaPorDia = {
    '2026-11-24': [saida('s1', '100001', '2026-11-24T13:30:00.000Z'), saida('s2', '100002', '2026-11-24T13:50:00.000Z'), saida('s7', '100007', '2026-11-24T10:00:00.000Z'), saida('s8', '100008', '2026-11-24T11:00:00.000Z')],
    '2026-11-25': [saida('s6', '100006', '2026-11-25T11:00:00.000Z'), saida('s9', '100009', '2026-11-25T17:00:00.000Z')]
  };
  const entrega = V.normalizarEntrega([['100001', { data: '2026-11-24', transportadora: 'RETIRA 02' }], ['100004', { data: '2026-11-25', transportadora: 'TCS' }], ['100005', { data: '2026-11-24', transportadora: 'TCS' }], ['100008', { data: '2026-11-24', transportadora: 'Brasil' }], ['100010', { data: '2026-11-23', transportadora: 'TCS' }]]);
  const sc9 = { 100001: { transportadora: 'Retira 02' }, 100004: { transportadora: 'Brasil', cliente: 'C4', nf: '59', armazem: 'Cambuci' }, 100007: { cliente: 'CLIENTE 7', transportadora: 'TCS' }, 100010: { cliente: 'CLIENTE 10', nf: '77', transportadora: 'TCS' } };
  return { recebPorDia, saidaPorDia, entrega, resolver: (p) => sc9[p] || null, de: '2026-11-20', ate: HOJE, hoje: HOJE, agora: AGORA };
}

test('classificação: saiu, recebido, não sai hoje, desceu e não recebido, e saiu sem recebimento', () => {
  const m = V.montarRegistros(cenario());
  const sit = Object.fromEntries(m.registros.map((r) => [r.pedido, r.situacao]));
  assert.deepEqual(sit, { 100001: 'saiu', 100002: 'recebido', 100003: 'nao_sai_hoje', 100004: 'saiu', 100005: 'saiu', 100006: 'recebido', 100007: 'desceu_nao_recebido', 100009: 'desceu_nao_recebido', 100008: 'saiu_sem_recebimento', 100010: 'saiu_sem_recebimento' });
  const r8 = m.registros.find((r) => r.pedido === '100008');
  assert.equal(r8.desceuEm, '2026-11-24T11:00:00.000Z', 'quem saiu sem receber mostra quando desceu');
  assert.equal(r8.dia, '2026-11-24'); assert.equal(r8.dataEntrega, '2026-11-24');
  const r4 = m.registros.find((r) => r.pedido === '100004');
  assert.equal(r4.nf, '5100004', 'o que já está na entrada vale; o SC9 só completa o vazio');
  assert.equal(r4.transportadoraDiferente, true); assert.equal(r4.transportadoraEntrega, 'TCS');
  const r1 = m.registros.find((r) => r.pedido === '100001');
  assert.equal(r1.transportadoraDiferente, false, '"Retira 02" e "RETIRA 02" são a mesma');
  const r5 = m.registros.find((r) => r.pedido === '100005');
  assert.equal(r5.transportadora, 'TCS', 'entrada da planilha sem SC9 usa a transportadora da Entrega'); assert.equal(r5.transportadoraDiferente, false, 'sem a do SC9 é "sem informação", não divergência');
  assert.equal(r5.origem, 'entrega'); assert.equal(r5.horaEstimada, true);
});

test('painel: totais, dias, transportadoras, pendências e tempos (só com hora real)', () => {
  const c = cenario();
  const m = V.montarRegistros(c);
  const p = V.montarPainel(m, { de: c.de, ate: c.ate, hoje: HOJE, geradoEm: 'x', extras: { baseEntregaEm: '2026-11-25T12:00:00.000Z', pedidosNaEntrega: 5, pedidosNaEntregaAnterior: 9, podeImportar: true } });
  const t = p.totais;
  assert.deepEqual([t.desceram, t.recebidos, t.bipados, t.daPlanilha, t.saiuEntrega, t.naoSaiHoje, t.pendentesDeSaida], [6, 6, 5, 1, 3, 1, 2]);
  assert.deepEqual([t.desceuNaoRecebido, t.saiuSemRecebimento, t.volumes, t.comRastreio], [2, 2, 6, 1]);
  assert.equal(p.entregaPossivelmenteCortada, true, 'a Entrega veio com menos pedidos que a anterior');
  assert.equal(p.pedidosNaEntrega, 5); assert.equal(p.pedidosNaEntregaAnterior, 9); assert.equal(p.podeImportar, true);
  // permanência: 100001 (mesmo dia = 0 h) e 100004 (1 dia = 24 h); a da planilha (hora estimada) fica fora
  assert.equal(t.permanenciaMediaHoras, 12); assert.equal(t.permanenciaP90Horas, 24);
  // desceu -> recebido: 100001 = 30 min, 100002 = 40 min, 100006 = 60 min (100004 não tem saída)
  assert.equal(t.desceuAteReceberMediaMin, 43); assert.equal(t.desceuAteReceberP90Min, 60);
  assert.equal(t.rastreioPct, 33.3);
  assert.equal(t.transportadoraDiferente, 1);
  // saída no mesmo dia: dos 5 bipados antes de hoje, só o 100001 saiu no próprio dia (100004 saiu no outro)
  assert.equal(t.saidaMesmoDiaPct, 25, '4 bipados em dias anteriores a hoje (r1..r4); 1 saiu no mesmo dia');
  assert.equal(p.dias.length, 6); assert.equal(p.dias[4].dia, '2026-11-24');
  assert.deepEqual([p.dias[4].desceram, p.dias[4].recebidos, p.dias[4].saiu, p.dias[4].pendentes, p.dias[4].naoSaiHoje, p.dias[4].volumes], [4, 5, 3, 1, 1, 6]);
  assert.equal(p.dias.reduce((s, d) => s + d.recebidos, 0), t.recebidos);
  assert.equal(p.mes.base, '2026-11'); assert.equal(p.mes.diasComDados, 2);
  const tcs = p.transportadoras.find((g) => g.nome === 'TCS');
  assert.deepEqual([tcs.recebidos, tcs.saiu, tcs.permanenciaMediaHoras], [1, 1, null], 'a entrada da planilha entra na conta, mas sem tempo');
  const r02 = p.transportadoras.find((g) => g.nome === 'Retira 02');
  assert.equal(r02.recebidos, 5); assert.equal(r02.saiu, 2); assert.equal(r02.comRastreio, 1);
  assert.equal(r02.permanenciaMediaHoras, 12, 'por transportadora também');
  assert.deepEqual(p.pendenciasTotal, { desceuNaoRecebido: 2, recebidoNaoSaiu: 3, saiuSemRecebimento: 2 });
  assert.equal(p.pendencias.desceuNaoRecebido[0].pedido, '100007', 'o que está parado há mais tempo vem primeiro');
  assert.equal(p.pendencias.recebidoNaoSaiu.find((x) => x.pedido === '100003').motivo, 'Falta nota');
  assert.equal(p.pendencias.saiuSemRecebimento[0].pedido, '100008');
  // tempos por pedido
  const l = Object.fromEntries(m.registros.map((r) => [r.pedido, r]));
  assert.equal(l['100001'].minutosDesceuAteReceber, 30); assert.equal(l['100001'].diasAteSair, 0);
  assert.equal(l['100004'].diasAteSair, 1); assert.equal(l['100004'].minutosDesceuAteReceber, null, 'sem saída do estoque');
  assert.equal(l['100005'].diasAteSair, null, 'hora estimada fica fora'); assert.equal(l['100005'].horasNaExpedicao, null);
  assert.equal(l['100002'].horasNaExpedicao, 27.5, 'agora - recebidoEm (14:30Z do dia 24 até 18:00Z do dia 25)');
  assert.equal(l['100001'].horasNaExpedicao, null, 'quem já saiu mostra diasAteSair, não horas');
});

test('listas das pendências cortam em 200 mas informam o total', () => {
  const entrada200 = Array.from({ length: 230 }, (_, i) => entrada('x' + i, String(300000 + i), { recebidoEm: '2026-11-24T13:00:00.000Z' }));
  const c = Object.assign(cenario(), { recebPorDia: { '2026-11-24': entrada200 }, saidaPorDia: {}, entrega: new Map() });
  const p = V.montarPainel(V.montarRegistros(c), { de: c.de, ate: c.ate, hoje: HOJE });
  assert.equal(p.pendencias.recebidoNaoSaiu.length, 200); assert.equal(p.pendenciasTotal.recebidoNaoSaiu, 230);
});

test('linhas: filtros por transportadora, situação e busca; paginação; exportação', () => {
  const c = cenario(), m = V.montarRegistros(c);
  const nomes = (l) => l.map((r) => r.pedido).sort();
  assert.deepEqual(nomes(V.filtrar(m.registros, { situacao: 'saiu' })), ['100001', '100004', '100005']);
  assert.deepEqual(nomes(V.filtrar(m.registros, { transportadora: 'retira 02' })), ['100001', '100002', '100003', '100004', '100006']);
  assert.deepEqual(nomes(V.filtrar(m.registros, { q: 'cliente 100002' })), ['100002']);
  assert.deepEqual(nomes(V.filtrar(m.registros, { q: 'falta NOTA' })), ['100003'], 'busca sem acento nem maiúsculas, também no motivo');
  assert.deepEqual(nomes(V.filtrar(m.registros, { q: 'ab1' })), ['100001'], 'e no código de rastreio');
  assert.deepEqual(nomes(V.filtrar(m.registros, { somentePendentes: true })), ['100002', '100003', '100006', '100007', '100009']);
  const pg = V.paginar(m.registros, 2, 4);
  assert.equal(pg.total, 10); assert.equal(pg.linhas.length, 4); assert.equal(pg.pagina, 2); assert.equal(pg.paginas, 3);
  assert.ok(pg.linhas.every((r) => !('_entry' in r)), 'a resposta não carrega o objeto interno');
  assert.equal(V.paginar(m.registros, 9, 4).linhas.length, 0);
  assert.equal(V.paginar(m.registros, 1, 9999).limite, 500);
  const ex = V.linhasExportacao(m.registros, { somentePendentes: true });
  assert.equal(ex.linhas.length, 5); assert.deepEqual(Object.keys(ex.linhas[0]), ['dia', 'pedido', 'nf', 'cliente', 'armazem', 'transportadora', 'volumes', 'recebidoEm', 'dataEntrega', 'situacao', 'motivo', 'rastreioCodigo', 'rastreioLink']);
  const todos = V.linhasExportacao(m.registros, {}).linhas;
  assert.equal(todos.find((l) => l.pedido === '100001').rastreioLink, 'https://t.exemplo.com/AB1');
  assert.ok(V.palavrasDaBusca('12 ab').join() === 'ab', 'número solto curto é ignorado');
});

function aplicarPlano(plano, recebPorDia) {
  const novo = {};
  for (const d of Object.keys(recebPorDia)) novo[d] = recebPorDia[d];
  for (const a of plano.alteracoes) novo[a.dia] = V.aplicarAlteracao(novo[a.dia] || [], a);
  return novo;
}
test('importação da Entrega: cria só o que falta, confirma o que já foi bipado, e a 2ª rodada não faz nada', () => {
  const c = cenario();
  const entrega = V.normalizarEntrega([
    ['100002', { data: '2026-11-24', transportadora: 'TCS' }],      // já recebido, ainda não confirmado: só confirma
    ['100001', { data: '2026-11-24', transportadora: 'TCS' }],      // já confirmado: nada
    ['100008', { data: '2026-11-24T21:00:00.000Z', transportadora: 'Brasil' }], // novo, tem saída do estoque
    ['100010', { data: '2026-11-23', transportadora: 'TCS' }],      // novo, tem dado do SC9
    ['100011', { data: '2026-11-20', transportadora: 'Brasil' }],   // novo, sem SC9 e sem saída
    ['100012', { data: '2026-11-10', transportadora: 'Brasil' }],   // fora do período
    ['100006', { data: '2026-11-24', transportadora: 'TCS' }]       // consta com data ANTES de ser recebido (dia 25): só sinaliza
  ]);
  const args = { de: '2026-11-20', ate: HOJE, hoje: HOJE, agora: AGORA, entrega, recebPorDia: c.recebPorDia, saidaPorDia: c.saidaPorDia, resolver: c.resolver, por: 'dono', nome: 'Dono', gerarId: (p) => 'rx_' + p };
  const plano = V.planejarImportacao(args);
  assert.deepEqual([plano.candidatos, plano.novos, plano.jaExistiam, plano.confirmados, plano.anteriores, plano.semInfoSC9], [6, 3, 3, 1, 1, 2]);
  assert.deepEqual(plano.porDia, [{ dia: '2026-11-20', novos: 1 }, { dia: '2026-11-23', novos: 1 }, { dia: '2026-11-24', novos: 1 }]);
  assert.deepEqual(plano.porTransportadora, [{ nome: 'Brasil', novos: 2 }, { nome: 'TCS', novos: 1 }]);
  const novo10 = plano.alteracoes.find((a) => a.dia === '2026-11-23').novas[0];
  assert.equal(novo10.recebidoEm, '2026-11-23T15:00:00.000Z', 'meio-dia de São Paulo'); assert.equal(novo10.horaEstimada, true); assert.equal(novo10.origem, 'entrega');
  assert.equal(novo10.recebidoPorNome, 'Planilha de Entrega'); assert.equal(novo10.recebidoPorUsuario, 'sistema');
  assert.equal(novo10.info.nf, '77'); assert.equal(novo10.semDadoSC9, false); assert.equal(novo10.saiuEntrega.dataEntrega, '2026-11-23'); assert.equal(novo10.saiuEntrega.por, 'dono');
  assert.equal(novo10.desceuNaHora, 'sem_saida');
  const n8 = plano.alteracoes.find((a) => a.dia === '2026-11-24').novas[0];
  assert.equal(n8.pedido, '100008'); assert.equal(n8.desceuNaHora, 'ok'); assert.equal(n8.semDadoSC9, true); assert.equal(n8.info, null);
  const conf = plano.alteracoes.find((a) => a.dia === '2026-11-24').confirmar;
  assert.deepEqual(conf.map((x) => x.pedido), ['100002']);
  // aplicar não apaga nada e as novas entram depois das que já existiam
  const depois = aplicarPlano(plano, c.recebPorDia);
  assert.equal(depois['2026-11-24'].length, 6);
  assert.equal(depois['2026-11-24'][1].saiuEntrega.dataEntrega, '2026-11-24'); assert.equal(depois['2026-11-24'][1].id, 'r2');
  assert.equal(c.recebPorDia['2026-11-24'].length, 5, 'a lista original não foi alterada');
  // 2ª rodada: nada novo, nada para confirmar
  const de2 = V.planejarImportacao(Object.assign({}, args, { recebPorDia: depois }));
  assert.deepEqual([de2.novos, de2.confirmados, de2.alteracoes.length], [0, 0, 0]);
  assert.equal(de2.jaExistiam, 6);
  // desceuNaHora usa o cache de 1ª saída quando o dia já saiu da Saída guardada
  const p3 = V.planejarImportacao(Object.assign({}, args, { entrega: V.normalizarEntrega([['100011', { data: '2026-11-20' }]]), fallbackSaida: new Map([['100011', '2026-11-19T12:00:00.000Z']]) }));
  assert.equal(p3.alteracoes[0].novas[0].desceuNaHora, 'ok');
});

test('importação: pedido recebido há mais dias que a janela de duplicado mas dentro de 10 dias só é confirmado (não duplica)', () => {
  const rec = { '2026-11-15': [entrada('z1', '600001', { recebidoEm: '2026-11-15T13:00:00.000Z' })] };
  const p = V.planejarImportacao({ de: '2026-11-20', ate: HOJE, hoje: HOJE, agora: AGORA, entrega: V.normalizarEntrega([['600001', { data: '2026-11-22' }]]), recebPorDia: rec, saidaPorDia: {}, resolver: () => null });
  assert.deepEqual([p.novos, p.confirmados], [0, 1]);
  assert.equal(p.alteracoes[0].dia, '2026-11-15');
});

test('rastreio: link só https, sem lixo; campo vazio não apaga o que já existe', () => {
  assert.deepEqual(V.validarRastreio(' ab 123 ', 'https://rastreio.exemplo.com/x?c=1'), { codigo: 'ab 123', link: 'https://rastreio.exemplo.com/x?c=1' });
  assert.ok(V.validarRastreio('', '').erro);
  for (const ruim of ['http://x.com/a', 'javascript:alert(1)', 'ftp://x.com', 'https://user:senha@x.com/', 'https://x .com', 'https://x.com/"><script>', 'naoeumlink', 'https://' + 'a'.repeat(600)]) assert.ok(V.validarRastreio('', ruim).erro, ruim);
  assert.ok(V.validarRastreio('x'.repeat(61), '').erro);
  assert.ok(V.validarRastreio('a<b', '').erro);
  assert.ok(V.validarRastreio(123, '').erro);
  assert.ok(V.validarRastreio('a\u0000b', '').erro);
  const e = { id: 'a', rastreio: { codigo: 'AB1', link: 'https://x.com/1', por: 'ana', em: 'antes' } };
  const n = V.aplicarRastreio(e, { codigo: 'CD2', link: '' }, 'beto', 'agora');
  assert.deepEqual(n.rastreio, { codigo: 'CD2', link: 'https://x.com/1', por: 'beto', em: 'agora' });
  assert.equal(e.rastreio.codigo, 'AB1');
});

// ---------------------------------------------------------------- servidor
async function subir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-exp-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..'))) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const hdr = { 'Content-Type': 'application/json', 'X-Sc9-App': '1' };
  const login = async (corpo) => { const r = await fetch(base + '/api/login', { method: 'POST', headers: hdr, body: JSON.stringify(corpo) }); return r.headers.get('set-cookie') ? r.headers.get('set-cookie').split(';')[0] : null; };
  const adminCk = await login({ password: process.env.APP_PASSWORD });
  const como = (cookie) => (rota, corpo) => fetch(base + rota, { method: corpo ? 'POST' : 'GET', headers: Object.assign({}, hdr, cookie ? { Cookie: cookie } : {}), body: corpo ? JSON.stringify(corpo) : undefined });
  const adm = como(adminCk);
  const criar = async (usuario, perfis) => { await adm('/api/usuarios', { acao: 'criar', usuario, nome: 'Fulano ' + usuario, senha: 'senha-' + usuario + '-xyz', perfis }); return como(await login({ usuario, password: 'senha-' + usuario + '-xyz' })); };
  return { server, adm, base, dir, como, criar, sem: como(null) };
}
const ordem = (pedido, extra) => Object.assign({ pedido, armazem: 'Cambuci', nf: '', nome: 'CLIENTE ' + pedido, cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Pendente', transportadora: 'Retira 02', separador: '', conferente: '', pickEnd: '2026-11-18T15:00:00.000Z' }, extra || {});
const snapshot = (orders, entregaInfo) => ({ orders, items: [], itemNames: [], warehousesPresent: ['Cambuci'], cutoff: hojeSP(), entregaInfo, faturamento: [], valores: [] });

test('servidor: importar o mês da Entrega, simulação sem gravar, 2ª rodada sem novos, painel e lista, rastreio, exportação, permissões e validação', async () => {
  const { server, adm, base, dir, criar, sem } = await subir();
  try {
    const hoje = hojeSP();
    const velho = add(hoje, -30), velho2 = add(hoje, -35);
    const de = add(hoje, -40);
    // SC9 com 7 pedidos: o da Entrega de hoje entra sozinho no Recebimento ao salvar; os de 30+ dias atrás só pela importação
    const orders = [ordem('710001', { nf: '9001', transportadora: 'Brasil' }), ordem('710002', { nf: '9002' }), ordem('710003', { nf: '9003', transportadora: 'TCS' }), ordem('710004'), ordem('710005', { transportadora: 'TCS' }), ordem('710006', { transportadora: 'TCS' }), ordem('710007', { nf: '9007' })];
    const entregaInfo = [['0710001', { data: hoje + 'T15:30:00.000Z', transportadora: 'TCS' }], ['710002', { data: velho + 'T03:00:00.000Z', transportadora: 'Retira 02' }], ['710003', { data: velho2, transportadora: 'TCS' }], ['710099', { data: velho, transportadora: 'Brasil' }]];
    const salvo = await (await adm('/api/save', snapshot(orders, entregaInfo))).json();
    assert.equal(salvo.ok, true); assert.equal(salvo.avisos, undefined);
    assert.equal(salvo.expedicao.criados, 1, 'ao salvar, o pedido da Entrega de hoje já vira recebimento');
    let rec = await (await adm('/api/recebimento')).json();
    const e1 = rec.entries.find((e) => e.pedido === '710001');
    assert.equal(e1.origem, 'entrega'); assert.equal(e1.horaEstimada, true); assert.equal(e1.info.nf, '9001'); assert.equal(e1.saiuEntrega.dataEntrega, hoje); assert.equal(e1.info.transportadora, 'Brasil');

    // antes de importar: os de 30+ dias aparecem como "saiu sem recebimento"
    let painel = await (await adm(`/api/expedicao/painel?de=${de}&ate=${hoje}`)).json();
    assert.equal(painel.totais.saiuSemRecebimento, 3); assert.equal(painel.totais.recebidos, 1); assert.equal(painel.totais.daPlanilha, 1);
    assert.equal(painel.pedidosNaEntrega, 4); assert.equal(painel.podeImportar, true); assert.ok(painel.baseEntregaEm);
    assert.equal(painel.totais.transportadoraDiferente, 1, 'SC9 diz Brasil, a Entrega diz TCS');

    // simulação não grava; sem "simular" também só simula
    const arquivoDia = (d) => path.join(dir, 'data', `recebimento-exp-${d}.json`);
    const sim = await (await adm('/api/expedicao/importar-entrega', { de, ate: hoje, simular: true })).json();
    assert.deepEqual([sim.simulacao, sim.candidatos, sim.novos, sim.jaExistiam, sim.semInfoSC9], [true, 4, 3, 1, 1]);
    assert.equal(fs.existsSync(arquivoDia(velho)), false);
    const semDizer = await (await adm('/api/expedicao/importar-entrega', { de, ate: hoje })).json();
    assert.equal(semDizer.simulacao, true); assert.equal(fs.existsSync(arquivoDia(velho)), false);

    const real = await (await adm('/api/expedicao/importar-entrega', { de, ate: hoje, simular: false })).json();
    assert.equal(real.simulacao, false); assert.equal(real.novos, 3); assert.equal(real.gravados.novos, 3);
    assert.deepEqual(real.porDia.map((x) => x.dia), [velho2, velho]);
    const gravado = JSON.parse(fs.readFileSync(arquivoDia(velho), 'utf8'));
    assert.equal(gravado.entries.length, 2); // 710002 e 710099
    const g2 = gravado.entries.find((e) => e.pedido === '710002');
    assert.equal(g2.recebidoEm, velho + 'T15:00:00.000Z'); assert.equal(g2.info.nf, '9002'); assert.equal(g2.saiuEntrega.arquivo, 'importação do SC9');
    const log = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'recebimento-entregas.json'), 'utf8'));
    assert.equal(log.uploads[log.uploads.length - 1].origem, 'importação do SC9'); assert.ok(log.bases.length >= 1, 'guarda quantos pedidos a Entrega tinha');
    const novamente = await (await adm('/api/expedicao/importar-entrega', { de, ate: hoje, simular: false })).json();
    assert.deepEqual([novamente.novos, novamente.confirmados, novamente.jaExistiam], [0, 0, 4], 'idempotente');
    assert.equal(JSON.parse(fs.readFileSync(arquivoDia(velho), 'utf8')).entries.length, 2, 'nada duplicado');
    assert.equal(JSON.parse(fs.readFileSync(arquivoDia(velho), 'utf8')).versao, gravado.versao, 'e nem regravou');

    painel = await (await adm(`/api/expedicao/painel?de=${de}&ate=${hoje}`)).json();
    assert.deepEqual([painel.totais.recebidos, painel.totais.daPlanilha, painel.totais.saiuEntrega, painel.totais.saiuSemRecebimento], [4, 4, 4, 0]);
    assert.equal(painel.totais.permanenciaMediaHoras, null, 'planilha não tem hora real');
    assert.equal(painel.dias.length, 41);

    // lista: filtros, busca e paginação
    const lista = async (q) => (await adm('/api/expedicao/pedidos?' + q)).json();
    let l = await lista(`de=${de}&ate=${hoje}&limite=2&pagina=2`);
    assert.equal(l.total, 4); assert.equal(l.linhas.length, 2); assert.equal(l.pagina, 2);
    l = await lista(`de=${de}&ate=${hoje}&transportadora=tcs`);
    assert.deepEqual(l.linhas.map((x) => x.pedido), ['710003'], 'filtra pela transportadora');
    l = await lista(`de=${de}&ate=${hoje}&transportadora=brasil`);
    assert.deepEqual(l.linhas.map((x) => x.pedido).sort(), ['710001', '710099'], '710099 não está no SC9: vale a transportadora da Entrega');
    l = await lista(`de=${de}&ate=${hoje}&q=9002`);
    assert.deepEqual(l.linhas.map((x) => x.pedido), ['710002']);
    l = await lista(`de=${de}&ate=${hoje}&situacao=saiu_sem_recebimento`);
    assert.equal(l.total, 0);
    const um = (await lista(`de=${de}&ate=${hoje}&q=9002`)).linhas[0];
    for (const k of ['id', 'dia', 'pedido', 'nf', 'cliente', 'armazem', 'transportadora', 'volumes', 'desceuEm', 'desceuPor', 'recebidoEm', 'recebidoPor', 'origem', 'horaEstimada', 'dataEntrega', 'situacao', 'motivo', 'rastreio', 'minutosDesceuAteReceber', 'horasNaExpedicao', 'diasAteSair']) assert.ok(k in um, 'campo ' + k);

    // rastreio
    const rast = (corpo, quem) => (quem || adm)('/api/expedicao/rastreio', corpo);
    let r = await rast({ id: um.id, dia: um.dia, codigo: 'BR123', link: 'https://rastreio.exemplo.com/BR123' });
    assert.equal(r.status, 200);
    r = await rast({ id: um.id, dia: um.dia, codigo: 'BR999', link: '' });
    assert.equal((await r.json()).rastreio.link, 'https://rastreio.exemplo.com/BR123', 'link vazio não apaga o que já estava');
    assert.equal((await rast({ id: um.id, dia: um.dia, codigo: '', link: 'http://inseguro.com/x' })).status, 400);
    assert.equal((await rast({ id: um.id, dia: um.dia, codigo: '', link: 'javascript:alert(1)' })).status, 400);
    assert.equal((await rast({ id: um.id, dia: um.dia, codigo: '', link: '' })).status, 400);
    assert.equal((await rast({ id: 'nao-existe', dia: um.dia, codigo: 'x' })).status, 404);
    assert.equal((await rast({ id: um.id, dia: '2026-02-30', codigo: 'x' })).status, 400);
    assert.equal((await rast({ id: um.id, dia: add(hoje, 3), codigo: 'x' })).status, 400);
    assert.equal((await rast({ id: '../etc', dia: um.dia, codigo: 'x' })).status, 400);
    assert.equal((await rast({ id: 'a'.repeat(100), dia: um.dia, codigo: 'x' })).status, 400);
    l = await lista(`de=${de}&ate=${hoje}&q=br999`);
    assert.equal(l.linhas[0].rastreio.codigo, 'BR999');
    assert.equal((await (await adm(`/api/expedicao/painel?de=${de}&ate=${hoje}`)).json()).totais.comRastreio, 1);

    // exportação
    const ex = await (await adm(`/api/expedicao/exportar?de=${de}&ate=${hoje}`)).json();
    assert.equal(ex.linhas.length, 4); assert.ok(ex.geradoEm);
    assert.equal(ex.linhas.find((x) => x.pedido === '710002').rastreioCodigo, 'BR999');
    assert.equal((await (await adm(`/api/expedicao/exportar?de=${de}&ate=${hoje}&somentePendentes=1`)).json()).linhas.length, 0);

    // validação de entrada
    const ruins = ['painel?de=2026-13-01', 'painel?de=abc', `painel?de=${add(hoje, -63)}&ate=${hoje}`, `painel?de=${hoje}&ate=${add(hoje, -2)}`, 'pedidos?limite=501', 'pedidos?limite=0', 'pedidos?pagina=0', 'pedidos?pagina=x', 'pedidos?situacao=qualquer', 'pedidos?q=' + 'a'.repeat(81), 'pedidos?q=12', 'pedidos?transportadora=' + 'a'.repeat(61), 'exportar?somentePendentes=2'];
    for (const q of ruins) assert.equal((await adm('/api/expedicao/' + q)).status, 400, q);
    assert.equal((await adm('/api/expedicao/importar-entrega', { de: 'x', simular: true })).status, 400);
    assert.equal((await adm('/api/expedicao/importar-entrega', { simular: 'sim' })).status, 400);
    assert.equal((await adm('/api/expedicao/importar-entrega', { de: add(hoje, -80), ate: hoje, simular: true })).status, 400);
    assert.equal((await adm('/api/expedicao/painel?ate=' + add(hoje, 30))).status, 200, 'data futura é cortada em hoje');
    assert.equal((await adm('/api/expedicao/nao-existe')).status, 404);
    const resp = await adm('/api/expedicao/painel');
    assert.equal(resp.headers.get('cache-control'), 'no-store');

    // permissões
    for (const [rota, corpo] of [['painel'], ['pedidos'], ['exportar'], ['importar-entrega', { simular: true }], ['rastreio', { id: 'a', dia: hoje, codigo: 'x' }]]) assert.equal((await sem('/api/expedicao/' + rota, corpo)).status, 401, rota);
    const soSaida = await criar('soSaida', ['saida']);
    for (const [rota, corpo] of [['painel'], ['pedidos'], ['exportar'], ['importar-entrega', { simular: true }], ['rastreio', { id: 'a', dia: hoje, codigo: 'x' }]]) assert.equal((await soSaida('/api/expedicao/' + rota, corpo)).status, 403, rota);
    const recebe = await criar('recebe', ['recebimento']);
    assert.equal((await recebe('/api/expedicao/painel')).status, 200);
    assert.equal((await (await recebe('/api/expedicao/painel')).json()).podeImportar, false);
    assert.equal((await recebe('/api/expedicao/importar-entrega', { simular: true })).status, 403, 'quem só recebe não importa');
    assert.equal((await recebe('/api/expedicao/rastreio', { id: um.id, dia: um.dia, codigo: 'Z1' })).status, 200);
    const despacha = await criar('despacha', ['despacho']);
    assert.equal((await despacha('/api/expedicao/importar-entrega', { de, ate: hoje, simular: true })).status, 200);
    assert.equal((await fetch(base + '/api/expedicao/rastreio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403, 'sem o cabeçalho do app');
  } finally { server.close(); }
});

test('servidor: bipe traz tudo do pedido e os tempos, promove a entrada da planilha, a nota aparece sozinha no SC9 novo e dado preenchido não é apagado', async () => {
  const { server, adm, criar } = await subir();
  try {
    const hoje = hojeSP();
    const rec = await criar('rec', ['recebimento', 'saida']);
    const saidaOp = await criar('est', ['saida']);
    const bipe = (p) => rec('/api/recebimento/bipar', { pedido: p });
    // 720001: desceu do estoque e ainda não tem nota; 720002: vem só da planilha; 720003: ninguém desceu
    const base1 = [ordem('720001', { transportadora: 'Retira 02' }), ordem('720002', { nf: '8002', transportadora: 'TCS' }), ordem('720003', { transportadora: 'Brasil' })];
    assert.equal((await adm('/api/save', snapshot(base1, [['720002', { data: hoje + 'T14:00:00.000Z', transportadora: 'TCS' }]]))).status, 200);
    assert.equal((await saidaOp('/api/saida/bipar', { pedido: '720001' })).status, 200);

    let r = await bipe('720001');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true); assert.equal(j.entry.pedido, '720001'); assert.ok(j.desceu && j.info, 'contrato antigo preservado'); assert.equal(typeof j.totalHoje, 'number');
    assert.equal(j.resumo.cliente, 'CLIENTE 720001'); assert.equal(j.resumo.transportadora, 'Retira 02'); assert.equal(j.resumo.linhas, 2); assert.equal(j.resumo.pecas, 5);
    assert.equal(j.resumo.desceu, true); assert.ok(j.resumo.desceuEm); assert.ok(j.resumo.desceuPor);
    assert.equal(j.resumo.aguardandoNota, true); assert.equal(j.resumo.nf, '');
    assert.equal(j.tempos.desceuEm, j.resumo.desceuEm); assert.equal(typeof j.tempos.minutosDesceuAteReceber, 'number');
    assert.equal((await bipe('720001')).status, 409);

    const sem = await (await bipe('720003')).json();
    assert.deepEqual(sem.tempos, { desceuEm: null, minutosDesceuAteReceber: null }, 'sem saída do estoque');
    assert.equal(sem.resumo.desceu, false);

    // 720002 já veio da planilha: o bipe promove, não dá 409, e mantém "saiu"
    r = await bipe('720002');
    assert.equal(r.status, 200);
    const p = await r.json();
    assert.equal(p.promovido, true); assert.equal(p.entry.origem, 'bipe'); assert.equal(p.entry.recebidoPorUsuario, 'rec'); assert.equal(p.entry.horaEstimada, undefined);
    assert.ok(p.entry.saiuEntrega && p.entry.saiuEntrega.dataEntrega === hoje); assert.equal(p.resumo.nf, '8002'); assert.equal(p.resumo.aguardandoNota, false);
    assert.equal((await bipe('720002')).status, 409, 'depois de promovido, é um bipe como outro qualquer');
    let lista = await (await rec('/api/recebimento')).json();
    assert.equal(lista.entries.filter((e) => e.pedido === '720002').length, 1, 'não duplicou');

    // a nota só existe depois de um SC9 novo: aparece sozinha, na leitura e gravada na entrada
    let e = lista.entries.find((x) => x.pedido === '720001');
    assert.equal(e.aguardandoNota, true); assert.equal(e.info.nf, '');
    const v1 = lista.versao;
    const base2 = [ordem('720001', { nf: '8001', transportadora: 'Retira 02' }), ordem('720002', { nf: '8002', transportadora: 'TCS' }), ordem('720003', { nf: '8003', transportadora: 'Brasil' })];
    const s2 = await (await adm('/api/save', snapshot(base2, [['720002', { data: hoje, transportadora: 'TCS' }]]))).json();
    assert.ok(s2.expedicao.preenchidos >= 2, 'preencheu a nota de 720001 e 720003');
    lista = await (await rec('/api/recebimento')).json();
    e = lista.entries.find((x) => x.pedido === '720001');
    assert.equal(e.info.nf, '8001'); assert.equal(e.aguardandoNota, false);
    assert.notEqual(lista.versao, v1, 'a versão muda e as telas abertas se atualizam');
    assert.equal((await (await rec('/api/recebimento?v=' + encodeURIComponent(lista.versao))).json()).igual, true);
    // SC9 seguinte vem SEM nota (ex.: planilha parcial): o que já estava preenchido continua
    await adm('/api/save', snapshot([ordem('720001', { nf: '', transportadora: '' })], []));
    lista = await (await rec('/api/recebimento')).json();
    e = lista.entries.find((x) => x.pedido === '720001');
    assert.equal(e.info.nf, '8001', 'nunca apaga dado preenchido'); assert.equal(e.info.transportadora, 'Retira 02');

    // idempotente: salvar o mesmo SC9 de novo não cria nem regrava nada
    const antes = await (await rec('/api/recebimento')).json();
    const s3 = await (await adm('/api/save', snapshot(base2, [['720002', { data: hoje, transportadora: 'TCS' }]]))).json();
    assert.equal(s3.expedicao, undefined, 'nada a fazer');
    assert.equal((await (await rec('/api/recebimento')).json()).entries.length, antes.entries.length);
  } finally { server.close(); }
});

test('servidor: Entrega com data ISO com horário cai no dia de São Paulo e pedido que o expedição já recebeu só é confirmado ao salvar o SC9', async () => {
  const { server, adm, criar } = await subir();
  try {
    const hoje = hojeSP();
    const rec = await criar('rec2', ['recebimento']);
    assert.equal((await rec('/api/recebimento/bipar', { pedido: '730001' })).status, 200);
    // 01:30 UTC de amanhã ainda é "hoje" em São Paulo (22:30)
    const iso = add(hoje, 1) + 'T01:30:00.000Z';
    const s = await (await adm('/api/save', snapshot([ordem('730001', { nf: '1' }), ordem('730002', { nf: '2' })], [['730001', { data: iso, transportadora: 'TCS' }], ['730002', { data: iso, transportadora: 'TCS' }]]))).json();
    assert.equal(s.expedicao.confirmados, 1); assert.equal(s.expedicao.criados, 1);
    const lista = await (await rec('/api/recebimento')).json();
    const a = lista.entries.find((x) => x.pedido === '730001'), b = lista.entries.find((x) => x.pedido === '730002');
    assert.equal(a.origem, undefined, 'continua sendo o bipe'); assert.equal(a.saiuEntrega.dataEntrega, hoje);
    assert.equal(b.origem, 'entrega'); assert.equal(b.saiuEntrega.dataEntrega, hoje);
    const fech = await (await rec('/api/recebimento/fechamento')).json();
    assert.equal(fech.totais.confirmados, 2);
  } finally { server.close(); }
});

test('servidor: a importação tem limite por minuto (429) e não deixa o painel quebrar sem SC9 carregado', async () => {
  const { server, adm } = await subir();
  try {
    const p = await adm('/api/expedicao/painel');
    assert.equal(p.status, 200, 'sem SC9 nem recebimentos o painel abre vazio');
    const j = await p.json();
    assert.equal(j.totais.recebidos, 0); assert.equal(j.pedidosNaEntrega, null); assert.equal(j.baseEntregaEm, null);
    assert.equal((await adm('/api/expedicao/importar-entrega', { simular: true })).status, 404, 'sem SC9 não há o que importar');
    let ultimo = 0;
    for (let i = 0; i < 12; i++) ultimo = (await adm('/api/expedicao/importar-entrega', { simular: true })).status;
    assert.equal(ultimo, 429);
  } finally { server.close(); }
});

test('importação: Entrega com data bem ANTES do bipe não duplica (qualquer recebimento posterior vale) e pedido desfeito não é recriado', () => {
  const rec = { '2026-11-20': [entrada('q1', '610001', { recebidoEm: '2026-11-20T13:00:00.000Z' })] };
  const entrega = V.normalizarEntrega([['610001', { data: '2026-11-10', transportadora: 'TCS' }], ['610002', { data: '2026-11-12', transportadora: 'TCS' }], ['610003', { data: '2026-11-13' }]]);
  const rem = { '2026-11-12': [{ id: 'x', pedido: '610002', origem: 'entrega' }] };
  const p = V.planejarImportacao({ de: '2026-11-01', ate: HOJE, hoje: HOJE, agora: AGORA, entrega, recebPorDia: rec, removidosPorDia: rem, saidaPorDia: {}, resolver: () => null });
  assert.deepEqual([p.candidatos, p.novos, p.confirmados, p.anteriores, p.removidosIgnorados], [3, 1, 0, 1, 1]);
  assert.deepEqual(p.alteracoes.map((a) => a.novas.map((n) => n.pedido)), [['610003']], 'só o 610003 é criado: o 610001 já foi recebido depois e o 610002 foi desfeito');
});

test('servidor: administrador desfaz entrada importada e ela não volta; bipe de pedido que saiu em outro dia dá 409 sem mexer; leituras simultâneas e limite do painel', async () => {
  const { server, adm, criar } = await subir();
  try {
    const hoje = hojeSP(), ontem = add(hoje, -1), de = add(hoje, -5);
    const rec = await criar('rec3', ['recebimento']);
    const orders = [ordem('740001', { nf: '1' }), ordem('740002', { nf: '2' }), ordem('740003', { nf: '3' })];
    const entrega = [['740001', { data: ontem, transportadora: 'TCS' }], ['740002', { data: hoje, transportadora: 'TCS' }], ['740003', { data: ontem, transportadora: 'TCS' }]];
    const s1 = await (await adm('/api/save', snapshot(orders, entrega))).json();
    assert.equal(s1.expedicao.criados, 3);
    let lista = await (await adm('/api/recebimento?dia=' + hoje)).json();
    const e2 = lista.entries.find((x) => x.pedido === '740002');
    assert.equal(e2.origem, 'entrega');

    // (3) o 740001 saiu ontem pela planilha: bipar hoje não promove, não altera e explica
    const antesOntem = JSON.stringify((await (await adm('/api/recebimento?dia=' + ontem)).json()).entries);
    const b = await rec('/api/recebimento/bipar', { pedido: '740001' });
    assert.equal(b.status, 409);
    const bj = await b.json();
    assert.match(bj.mensagem, /já consta como saído na planilha de Entrega em \d\d\/\d\d/);
    assert.equal(bj.duplicado.pedido, '740001');
    assert.equal(JSON.stringify((await (await adm('/api/recebimento?dia=' + ontem)).json()).entries), antesOntem, 'nada foi alterado');
    assert.equal((await (await adm('/api/recebimento?dia=' + hoje)).json()).entries.some((x) => x.pedido === '740001'), false);

    // (1) só o administrador desfaz entrada que veio da planilha
    assert.equal((await rec('/api/recebimento/desfazer', { id: e2.id })).status, 403);
    assert.equal((await adm('/api/recebimento/desfazer', { id: e2.id })).status, 200);
    lista = await (await adm('/api/recebimento?dia=' + hoje)).json();
    assert.equal(lista.entries.some((x) => x.pedido === '740002'), false);
    // novo SC9 e nova importação: não recria
    const s2 = await (await adm('/api/save', snapshot(orders, entrega))).json();
    assert.equal(s2.expedicao, undefined, 'nada criado de novo');
    lista = await (await adm('/api/recebimento?dia=' + hoje)).json();
    assert.equal(lista.entries.some((x) => x.pedido === '740002'), false, 'o save não recriou o pedido desfeito');
    const imp = await (await adm('/api/expedicao/importar-entrega', { de, ate: hoje, simular: false })).json();
    assert.equal(imp.novos, 0); assert.equal(imp.removidosIgnorados, 1);
    // a entrada importada que NÃO foi desfeita continua só podendo ser desfeita pelo administrador
    const e3 = (await (await adm('/api/recebimento?dia=' + ontem)).json()).entries.find((x) => x.pedido === '740003');
    assert.equal((await rec('/api/recebimento/desfazer', { id: e3.id })).status, 403);

    // (5) painel, lista e exportação ao mesmo tempo dão a mesma resposta
    const [p, l, x] = await Promise.all([adm(`/api/expedicao/painel?de=${de}&ate=${hoje}`), adm(`/api/expedicao/pedidos?de=${de}&ate=${hoje}`), adm(`/api/expedicao/exportar?de=${de}&ate=${hoje}`)]);
    assert.deepEqual([p.status, l.status, x.status], [200, 200, 200]);
    const lj = await l.json(); assert.equal(lj.total, 3, 'o desfeito aparece como saiu sem recebimento'); assert.equal(lj.linhas.find((r) => r.pedido === '740002').situacao, 'saiu_sem_recebimento'); assert.equal((await x.json()).linhas.length, 3);

    // (4) painel e lista: 60 por minuto por pessoa
    let ultimo = 0;
    for (let i = 0; i < 70; i++) ultimo = (await adm(`/api/expedicao/painel?de=${de}&ate=${hoje}`)).status;
    assert.equal(ultimo, 429);
  } finally { server.close(); }
});

// ---------------------------------------------------------------- Expedição em 3 abas (funções puras)
test('3 abas: perfis (acessoDe) e transportadora efetiva na visão da entrada, sem tocar na original', () => {
  const a = (role, perfis) => V.acessoDe(role, perfis);
  assert.deepEqual(a('admin', []), { admin: true, bipar: true, planilha: true, pod: true, importar: true });
  assert.deepEqual(a('operador', ['exp_bipar']), { admin: false, bipar: true, planilha: false, pod: false, importar: false });
  assert.deepEqual(a('operador', ['exp_planilha']), { admin: false, bipar: false, planilha: true, pod: false, importar: false });
  assert.deepEqual(a('operador', ['exp_pod']), { admin: false, bipar: false, planilha: false, pod: true, importar: false });
  assert.deepEqual(a('operador', ['recebimento']), { admin: false, bipar: true, planilha: true, pod: false, importar: false });
  assert.deepEqual(a('operador', ['despacho']), { admin: false, bipar: false, planilha: true, pod: false, importar: true });
  assert.deepEqual(a('operador', ['saida', 'geral']), { admin: false, bipar: false, planilha: false, pod: false, importar: false });
  assert.deepEqual(a('operador', undefined), { admin: false, bipar: false, planilha: false, pod: false, importar: false });

  const e = { id: 'x', pedido: '100001', info: { transportadora: 'Retira 04', nf: '' }, transportadoraSaiu: { de: 'Retira 04', para: ' Brasil ', motivo: 'cliente pediu' } };
  const v = V.visaoEntrada(e, null);
  assert.equal(v.info.transportadora, 'Brasil'); assert.equal(v.transportadoraOriginal, 'Retira 04'); assert.equal(v.trocada, true); assert.equal(v.aguardandoNota, true);
  assert.equal(e.info.transportadora, 'Retira 04', 'a entrada original não muda');
  const sem = V.visaoEntrada({ id: 'y', pedido: '100002', info: { transportadora: 'TCE' } }, null);
  assert.equal(sem.trocada, undefined); assert.equal(sem.transportadoraOriginal, undefined, 'sem troca, a visão não ganha campos novos');
  // o registro do painel (v1) agrupa pela efetiva e compara a da Entrega com ela
  const m = V.montarRegistros({ de: '2026-11-24', ate: '2026-11-24', hoje: HOJE, agora: AGORA, recebPorDia: { '2026-11-24': [{ ...e, recebidoEm: '2026-11-24T14:00:00.000Z', saiuEntrega: { dataEntrega: '2026-11-24', transportadora: 'Brasil' } }] }, saidaPorDia: {}, entrega: new Map(), resolver: () => null });
  assert.equal(m.registros[0].transportadora, 'Brasil'); assert.equal(m.registros[0].transportadoraDiferente, false, 'saiu como Brasil e a efetiva é Brasil: não há divergência');
});

test('3 abas: validações de observação, troca e POD', () => {
  assert.deepEqual(V.validarObservacao('  oi   tudo\n bem '), { texto: 'oi tudo bem' });
  for (const t of ['', '  ', 'x'.repeat(401), null, undefined, 3, {}]) assert.ok(V.validarObservacao(t).erro, String(t));
  assert.equal(V.validarObservacao('x'.repeat(400)).texto.length, 400);
  assert.deepEqual(V.validarTroca(' Brasil ', 'Cliente pediu'), { para: 'Brasil', motivo: 'Cliente pediu' });
  for (const [p, m] of [['Brasil', ''], ['Brasil', 'ab'], ['Brasil', 'x'.repeat(201)], ['', 'motivo'], ['T'.repeat(41), 'motivo'], ['<b>', 'motivo'], [5, 'motivo'], ['Brasil', 9], ['Br\u0000asil', 'motivo']]) assert.ok(V.validarTroca(p, m).erro, p + '/' + m);
  assert.equal(V.validarTroca('T'.repeat(40), 'abc').para.length, 40);
  const ok = V.validarPod({ status: 'entregue', link: 'https://velox.exemplo.com/a?b=1', codigo: ' AB 1 ', fotoConfere: 'nao_vi', obs: ' ok ' });
  assert.deepEqual(ok, { status: 'entregue', link: 'https://velox.exemplo.com/a?b=1', codigo: 'AB 1', fotoConfere: 'nao_vi', obs: 'ok' });
  assert.deepEqual(V.validarPod({ status: 'pendente' }), { status: 'pendente', link: '', codigo: '', fotoConfere: '', obs: '' });
  for (const c of [null, {}, { status: 'x' }, { status: 'entregue', link: 'http://a.com' }, { status: 'entregue', link: 'javascript:alert(1)' }, { status: 'entregue', link: 'https://a.com/ b' }, { status: 'entregue', fotoConfere: 'sei la' }, { status: 'entregue', obs: 'x'.repeat(401) }, { status: 'entregue', link: 5 }, { status: 'entregue', codigo: '<a>' }]) assert.ok(V.validarPod(c).erro, JSON.stringify(c));
});

test('3 abas: observação, troca, impressão e POD só acrescentam (limites e duplo clique)', () => {
  const base = { id: 'e1', pedido: '100001', info: { transportadora: 'Retira 02' } };
  let r = V.aplicarObservacao(base, 'primeira', 'ana', 'Ana', '2026-11-25T15:00:00.000Z');
  assert.equal(r.entry.observacoes.length, 1); assert.equal(base.observacoes, undefined, 'não muda o original');
  assert.equal(V.aplicarObservacao(r.entry, 'primeira', 'ana', 'Ana', '2026-11-25T15:00:10.000Z').semMudanca, true, 'duplo clique');
  assert.equal(V.aplicarObservacao(r.entry, 'primeira', 'beto', 'Beto', '2026-11-25T15:00:10.000Z').entry.observacoes.length, 2, 'outra pessoa pode escrever igual');
  assert.equal(V.aplicarObservacao(r.entry, 'primeira', 'ana', 'Ana', '2026-11-25T15:05:00.000Z').entry.observacoes.length, 2, 'depois de um tempo é outra observação');
  let e = base;
  for (let i = 0; i < V.MAX_OBSERVACOES; i++) e = V.aplicarObservacao(e, 'o' + i, 'ana', 'Ana', '2026-11-25T15:0' + (i % 10) + ':00.000Z').entry;
  assert.equal(e.observacoes.length, 30); assert.ok(V.aplicarObservacao(e, 'a 31', 'ana', 'Ana', '2026-11-25T18:00:00.000Z').erro);

  const v = V.validarTroca('Brasil', 'Retira lotou');
  let t = V.aplicarTroca(base, 'Retira 02', v, 'ana', 'Ana', 'T1');
  assert.deepEqual(t.entry.transportadoraSaiu, { de: 'Retira 02', para: 'Brasil', motivo: 'Retira lotou', por: 'ana', nome: 'Ana', em: 'T1' }); assert.equal(t.entry.info.transportadora, 'Retira 02');
  assert.equal(V.aplicarTroca(t.entry, 'Brasil', v, 'ana', 'Ana', 'T2').semMudanca, true);
  let u = t.entry;
  for (let i = 0; i < 25; i++) u = V.aplicarTroca(u, V.trocaAtual(u).para, V.validarTroca('Transp ' + i, 'motivo ' + i), 'ana', 'Ana', 'T' + i).entry;
  assert.equal(u.trocas.length, V.MAX_TROCAS); assert.equal(u.trocas[u.trocas.length - 1].para, 'Transp 24'); assert.equal(u.transportadoraSaiu.para, 'Transp 24'); assert.equal(u.info.transportadora, 'Retira 02');

  let imp = base;
  for (let i = 0; i < 12; i++) imp = V.aplicarImpressao(imp, { listaId: 'L' + i, em: 'T' + i, por: 'ana', nome: 'Ana', transportadora: 'Brasil' });
  assert.equal(imp.impressoes.length, 10); assert.equal(imp.impressoes[0].listaId, 'L2'); assert.equal(imp.impressoes[9].listaId, 'L11');

  const p1 = V.aplicarPod(base, { status: 'entregue', link: 'https://a.com/1', codigo: 'C1', fotoConfere: 'sim', obs: '' }, 'bia', 'Bia', 'T1').entry;
  assert.equal(p1.pod.verificadoPor, 'bia'); assert.equal(p1.pod.verificadoEm, 'T1'); assert.equal(p1.podHistorico.length, 1);
  const p2 = V.aplicarPod(p1, { status: 'divergente', link: '', codigo: '', fotoConfere: 'nao', obs: 'outra foto' }, 'bia', 'Bia', 'T2').entry;
  assert.equal(p2.pod.link, 'https://a.com/1', 'vazio não apaga o link'); assert.equal(p2.pod.codigo, 'C1'); assert.equal(p2.podHistorico.length, 2);
  assert.equal(V.aplicarPod(p2, { status: 'divergente', link: '', codigo: '', fotoConfere: 'nao', obs: 'outra foto' }, 'bia', 'Bia', 'T3').semMudanca, true);
  let q = p2;
  for (let i = 0; i < 25; i++) q = V.aplicarPod(q, { status: i % 2 ? 'entregue' : 'pendente', link: '', codigo: '', fotoConfere: '', obs: 'n' + i }, 'bia', 'Bia', 'T' + i).entry;
  assert.equal(q.podHistorico.length, V.MAX_POD_HISTORICO);
});

test('3 abas: planilhaDoDia filtra várias transportadoras, usa a efetiva e conta tudo certo', () => {
  const entries = [
    entrada('a', '200001', { recebidoEm: '2026-11-25T12:00:00.000Z', volumes: 2, info: { cliente: 'ANA', transportadora: 'Retira 04', nf: '10' }, observacoes: [{ texto: 'a1', por: 'x', nome: 'X', em: 'T' }, { texto: 'a2', por: 'x', nome: 'X', em: 'T' }], transportadoraSaiu: { de: 'Retira 04', para: 'Brasil', motivo: 'm', por: 'x', nome: 'X', em: 'T' }, impressoes: [{ listaId: 'L1', em: 'IMP', por: 'x', nome: 'X', transportadora: 'Brasil' }], pod: { status: 'entregue' } }),
    entrada('b', '200002', { recebidoEm: '2026-11-25T11:00:00.000Z', info: { cliente: 'BETO', transportadora: 'TCE', nf: '' }, saiuEntrega: { dataEntrega: '2026-11-25', transportadora: 'TCE' } }),
    entrada('c', '200003', { recebidoEm: '2026-11-25T13:00:00.000Z', info: { cliente: 'CIDA', transportadora: '' }, naoSaiHoje: { motivo: 'Falta nota' } }),
  ];
  const resolver = (p) => (p === '200003' ? { transportadora: 'Retira 02', nf: '33' } : null);
  const t = (filtros) => V.planilhaDoDia({ dia: '2026-11-25', hoje: '2026-11-25', entries, resolver, filtros, geradoEm: 'G', baseEntregaEm: 'B' });
  let r = t({});
  assert.deepEqual(r.linhas.map((l) => l.pedido), ['200002', '200001', '200003'], 'ordem do bipe');
  assert.deepEqual([r.dia, r.geradoEm, r.baseEntregaEm, r.truncado], ['2026-11-25', 'G', 'B', false]);
  const a = r.linhas[1];
  assert.deepEqual([a.transportadora, a.transportadoraOriginal, a.trocada, a.observacao, a.observacoes.length, a.impressoEm, a.podStatus, a.volumes], ['Brasil', 'Retira 04', true, 'a2', 2, 'IMP', 'entregue', 2]);
  assert.equal(r.linhas[0].aguardandoNota, true); assert.equal(r.linhas[0].situacao, 'saiu'); assert.equal(r.linhas[2].nf, '33', 'a nota vem do SC9 mais novo'); assert.equal(r.linhas[2].transportadora, 'Retira 02'); assert.equal(r.linhas[2].situacao, 'nao_sai_hoje');
  assert.deepEqual(r.totais, { pedidos: 3, volumes: 2, aguardandoNota: 1, trocadas: 1, impressos: 1 });
  assert.deepEqual(r.transportadoras.map((x) => [x.nome, x.total, x.impressos]).sort(), [['Brasil', 1, 1], ['Retira 02', 1, 0], ['TCE', 1, 0]]);
  r = t({ transportadoras: ['brasil', 'TCE'] });
  assert.deepEqual(r.linhas.map((l) => l.pedido), ['200002', '200001']); assert.equal(r.transportadoras.length, 3, 'os chips mostram todas'); assert.equal(r.totais.pedidos, 2);
  assert.equal(t({ transportadoras: ['Retira 04'] }).linhas.length, 0, 'filtra pela efetiva, não pela original');
  assert.equal(t({ q: 'cida' }).linhas.length, 1); assert.equal(t({ q: '200001 ana' }).linhas.length, 1); assert.equal(t({ situacao: 'saiu' }).linhas.length, 1);
  assert.equal(t({ transportadoras: ['Sem transportadora'] }).linhas.length, 0);
  assert.equal(V.planilhaDoDia({ dia: '2026-11-25', entries: [{ id: 'z', pedido: '200009', info: null }], filtros: { transportadoras: ['sem transportadora'] } }).linhas.length, 1);
  const muitas = Array.from({ length: 2005 }, (_, i) => ({ id: 'm' + i, pedido: String(300000 + i), recebidoEm: '2026-11-25T10:00:00.000Z', info: { transportadora: 'T' } }));
  const g = V.planilhaDoDia({ dia: '2026-11-25', entries: muitas, filtros: {} });
  assert.equal(g.linhas.length, 2000); assert.equal(g.truncado, true);
});

test('3 abas: montarLista (ids do dia OU transportadoras), um grupo por transportadora e listaId', () => {
  const linhas = [
    { id: 'a', pedido: '1', nf: '10', aguardandoNota: false, cliente: 'A', volumes: 2, observacao: 'o', transportadora: 'Brasil' },
    { id: 'b', pedido: '2', nf: '', aguardandoNota: true, cliente: 'B', volumes: null, observacao: '', transportadora: 'TCE' },
    { id: 'c', pedido: '3', nf: '12', aguardandoNota: false, cliente: 'C', volumes: 1, observacao: '', transportadora: 'brasil' },
    { id: 'd', pedido: '4', nf: '', aguardandoNota: true, cliente: 'D', volumes: 4, observacao: '', transportadora: '' },
  ];
  const agora = new Date('2026-11-25T18:03:09.000Z'); // 15:03:09 em São Paulo
  assert.equal(V.gerarListaId(agora, 'AB12'), 'L-20261125-150309-ab12');
  assert.match(V.gerarListaId(agora), /^L-20261125-150309-[a-z0-9]{4}$/);
  const r = V.montarLista({ dia: '2026-11-25', linhas, ids: ['c', 'a', 'd', 'a'], agora, geradoPor: 'Ana', sufixo: 'zz99' });
  assert.equal(r.lista.listaId, 'L-20261125-150309-zz99'); assert.equal(r.lista.geradoPor, 'Ana'); assert.equal(r.lista.geradoEm, agora.toISOString());
  assert.deepEqual(r.lista.grupos.map((g) => [g.transportadora, g.totalPedidos, g.totalVolumes]), [['Brasil', 2, 3], ['Sem transportadora', 1, 4]]);
  assert.deepEqual(r.lista.grupos[0].linhas.map((l) => l.pedido), ['1', '3'], 'ordem da planilha');
  assert.deepEqual(r.selecionadas.map((x) => x.id), ['a', 'c', 'd']);
  assert.equal(V.montarLista({ dia: 'D', linhas, transportadoras: ['TCE'], agora }).lista.grupos[0].linhas[0].aguardandoNota, true);
  assert.equal(V.montarLista({ dia: 'D', linhas, transportadoras: ['BRASIL', 'tce'], agora }).lista.grupos.length, 2);
  for (const o of [{ ids: ['zzz'] }, { ids: ['a', 'zzz'] }, { ids: [] }, { ids: 'a' }, { ids: [3] }, { ids: ['../x'] }, { transportadoras: [] }, { transportadoras: ['Nenhuma'] }, { transportadoras: [5] }, {}, { ids: ['a'], transportadoras: ['TCE'] }]) assert.ok(V.montarLista({ dia: 'D', linhas, agora, ...o }).erro, JSON.stringify(o));
});

test('3 abas: entregasPod lista só quem saiu, resume por status e filtra/pagina', () => {
  const recebPorDia = {
    '2026-11-24': [
      entrada('a', '400001', { info: { cliente: 'ANA', transportadora: 'Brasil', nf: '1' }, saiuEntrega: { dataEntrega: '2026-11-24', transportadora: 'Brasil' }, rastreio: { codigo: 'RA1', link: 'https://t.com/RA1' } }),
      entrada('b', '400002', { info: { cliente: 'BETO', transportadora: 'TCE', nf: '' }, impressoes: [{ listaId: 'L', em: '2026-11-24T20:00:00.000Z', por: 'x', nome: 'X', transportadora: 'TCE' }], pod: { status: 'entregue', link: 'https://t.com/2', fotoConfere: 'sim' }, podHistorico: [{ status: 'entregue' }] }),
      entrada('c', '400003', { info: { cliente: 'CIDA', transportadora: 'Retira 02', nf: '3' } }), // não saiu
    ],
    '2026-11-25': [entrada('d', '400004', { info: { cliente: 'DUDA', transportadora: 'Retira 02', nf: '4' }, transportadoraSaiu: { de: 'Retira 02', para: 'Brasil', motivo: 'm' }, impressoes: [{ listaId: 'L2', em: '2026-11-25T15:00:00.000Z' }], pod: { status: 'divergente' } })],
  };
  const t = (filtros, extra) => V.entregasPod({ de: '2026-11-20', ate: '2026-11-25', recebPorDia, resolver: () => null, filtros, ...extra });
  let r = t({});
  assert.deepEqual(r.linhas.map((l) => l.pedido), ['400004', '400001', '400002'], 'mais recentes primeiro; quem não saiu fica de fora');
  assert.deepEqual(r.resumo, { pendente: 1, entregue: 1, divergente: 1, nao_entregue: 0 }); assert.equal(r.total, 3);
  const l1 = r.linhas.find((l) => l.pedido === '400001'), l2 = r.linhas.find((l) => l.pedido === '400002');
  assert.equal(l1.pod, null); assert.deepEqual(l1.rastreio, { codigo: 'RA1', link: 'https://t.com/RA1' }); assert.equal(l1.dataSaida, '2026-11-24'); assert.equal(l2.pod.status, 'entregue'); assert.equal(l2.dataSaida, '2026-11-24'); assert.equal(l2.aguardandoNota, true);
  assert.equal(r.linhas[0].transportadora, 'Brasil', 'efetiva');
  assert.deepEqual(t({ status: 'entregue' }).linhas.map((l) => l.pedido), ['400002']); assert.equal(t({ status: 'entregue' }).resumo.pendente, 1);
  assert.deepEqual(t({ transportadora: 'brasil' }).linhas.map((l) => l.pedido), ['400004', '400001']);
  assert.deepEqual(t({ q: 'ra1' }).linhas.map((l) => l.pedido), ['400001']);
  r = t({}, { limite: 2, pagina: 2 }); assert.equal(r.linhas.length, 1); assert.equal(r.paginas, 2); assert.equal(r.total, 3);
  assert.deepEqual(V.intervaloEntregas('', '', '2026-11-25'), { de: '2026-11-11', ate: '2026-11-25' }, 'padrão: 15 dias');
  assert.deepEqual(V.intervaloEntregas('', '2026-11-20', '2026-11-25'), { de: '2026-11-06', ate: '2026-11-20' });
  assert.ok(V.intervaloEntregas('2026-09-01', '2026-11-25', '2026-11-25').erro, 'mais de 62 dias');
});
