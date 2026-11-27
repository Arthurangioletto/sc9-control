const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../solicitacoes-store.js');
const D = require('../solicitacoes-dashboard.js');
const PR = require('../solicitacoes-produtos.js');

// Central de solicitações: regras puras do store, do dashboard e do índice de produtos (sem disco e sem servidor).
const t0 = Date.UTC(2026, 10, 24, 15); // 24/11/2026 12:00 em São Paulo
const MIN = 60000;
const base = (tipo, extra) => Object.assign({ acao: 'criar', tipo, pedidoPor: 'Ana' }, extra);
const criar = (linhas, corpo, agora, ctx) => { const r = S.aplicar(linhas, corpo, '', agora == null ? t0 : agora, ctx); assert.equal(r.erro, undefined, r.erro); return r; };
const transf = (dados) => Object.assign({ itens: [{ produto: 'P-100', qt: 5 }], origem: { filial: 'Cambuci', armazem: '01' }, destino: { filial: 'Tambore', armazem: '01' } }, dados);

test('tipos, prazos (SLA) e áreas seguem o contrato', () => {
  // os 7 tipos originais continuam na mesma ordem e com os mesmos prazos; os da entrada única vêm depois (ver o teste dos tipos novos)
  assert.deepEqual(S.TIPOS_IDS.slice(0, 7), ['cancelar_pedido', 'segurar_pedido', 'transferencia_peca', 'consulta_estoque', 'alterar_pedido', 'nota_fiscal', 'outro']);
  assert.deepEqual(S.TIPOS_IDS.slice(0, 7).map((t) => S.TIPOS[t].sla), [30, 60, 240, 60, 120, 120, 240]);
  assert.deepEqual(S.TIPOS_IDS.slice(0, 7).map((t) => S.TIPOS[t].area), ['estoque', 'estoque', 'estoque', 'estoque', 'expedicao', 'faturamento', 'expedicao']);
  assert.deepEqual(S.TIPOS_IDS.slice(0, 7).map((t) => S.TIPOS[t].pedido), [true, true, false, false, true, true, false]);
  assert.deepEqual(S.ATIVOS, ['recebida', 'em_analise', 'em_andamento', 'aguardando_aprovacao'], 'aguardando_aprovacao (motoboy) foi acrescentado no fim');
});

test('criar: protocolo S-AAMMDD-NNN, validações rígidas e limite por vendedora/dia', () => {
  assert.match(S.aplicar([], base('x'), '', t0).erro, /tipo/);
  assert.match(S.aplicar([], base('cancelar_pedido', { pedido: 'abc', dados: { motivo: 'cliente desistiu' } }), '', t0).erro, /Número do pedido/);
  assert.match(S.aplicar([], base('cancelar_pedido', { dados: { motivo: 'cliente desistiu' } }), '', t0).erro, /Número do pedido/, 'cancelar exige pedido');
  assert.match(S.aplicar([], base('cancelar_pedido', { pedido: '355386', dados: {} }), '', t0).erro, /motivo/);
  assert.match(S.aplicar([], base('cancelar_pedido', { pedido: '355386', dados: { motivo: 'cliente desistiu' }, pedidoPor: 'A' }), '', t0).erro, /nome/);
  assert.match(S.aplicar([], base('outro', { texto: 'oi' }), '', t0).erro, /mínimo 5/);
  assert.match(S.aplicar([], base('alterar_pedido', { pedido: '355386', dados: { o_que: 'x' } }), '', t0).erro, /mínimo 3/);
  assert.match(S.aplicar([], base('segurar_pedido', { pedido: '355386', dados: { motivo: 'aguardar cliente', ate: '2026-02-30' } }), '', t0).erro, /Data inválida/);
  assert.match(S.aplicar([], base('segurar_pedido', { pedido: '355386', dados: { motivo: 'aguardar cliente', ate: '2026-11-01' } }), '', t0).erro, /passado/);
  const r = criar([], base('cancelar_pedido', { pedido: '0355386', dados: { motivo: '  cliente   desistiu ' }, etapa: 'nao_separado' }));
  const l = r.linhas[0];
  assert.deepEqual([l.protocolo, l.pedido, l.dados.motivo, l.status, l.area, l.etapa, l.aTempo, l.prioridade], ['S-261124-001', '355386', 'cliente desistiu', 'recebida', 'estoque', 'nao_separado', true, 'urgente']);
  assert.equal(criar(r.linhas, base('outro', { texto: 'preciso de ajuda aqui' }), t0 + 1000).linhas[0].protocolo, 'S-261124-002');
  assert.match(S.aplicar(r.linhas, base('cancelar_pedido', { pedido: '355386', dados: { motivo: 'cliente desistiu' } }), '', t0 + 5).erro, /já pediu isso/, 'não duplica o mesmo pedido de cancelamento ativo');
  let linhas = [];
  for (let i = 0; i < S.LIMITE_POR_DIA; i++) linhas = criar(linhas, base('outro', { texto: 'ajuda número ' + i }), t0 + i).linhas;
  assert.match(S.aplicar(linhas, base('outro', { texto: 'mais uma ajuda' }), '', t0 + 99).erro, /15 solicitações hoje/);
  assert.equal(S.aplicar(linhas, base('outro', { texto: 'mais uma ajuda', pedidoPor: 'Bia' }), '', t0 + 99).erro, undefined, 'o limite é por vendedora');
});

test('prioridade: cancelar/segurar ainda não separado = urgente; já separado = alta; transferência com prazo curto = alta', () => {
  const p = (tipo, etapa) => criar([], base(tipo, { pedido: '355386', dados: { motivo: 'cliente desistiu' }, etapa })).linhas[0];
  assert.equal(p('cancelar_pedido', 'nao_separado').prioridade, 'urgente');
  assert.equal(p('segurar_pedido', 'nao_separado').prioridade, 'urgente');
  assert.equal(p('cancelar_pedido', 'separado').prioridade, 'alta');
  assert.equal(p('cancelar_pedido', 'separado').aTempo, false);
  assert.equal(p('cancelar_pedido', 'nao_achado').aTempo, false);
  assert.equal(criar([], base('transferencia_peca', { dados: transf({ prazo: '2026-11-25' }) })).linhas[0].prioridade, 'alta');
  assert.equal(criar([], base('transferencia_peca', { dados: transf({ prazo: '2026-12-20' }) })).linhas[0].prioridade, 'normal');
  assert.equal(criar([], base('consulta_estoque', { dados: { produto: 'P-100', qt: 2 } })).linhas[0].prioridade, 'normal');
});

test('etapa do pedido a partir do rastreio e avisos em português', () => {
  const r = (etapas, detalhes) => ({ achado: true, etapas, detalhes: detalhes || {} });
  const e = (cod, estado, titulo) => ({ cod, estado, titulo: titulo || cod });
  assert.equal(S.etapaDoRastreio({ achado: false }), 'nao_achado');
  assert.equal(S.etapaDoRastreio(r([e('sep', 'atual', 'Aguardando separação')])), 'nao_separado');
  assert.equal(S.etapaDoRastreio(r([e('sep', 'atual', 'Em separação')])), 'em_separacao');
  assert.equal(S.etapaDoRastreio(r([e('sep', 'feita'), e('conf', 'atual')])), 'separado');
  assert.equal(S.etapaDoRastreio(r([e('sep', 'feita'), e('conf', 'feita'), e('fat', 'atual')])), 'conferido');
  assert.equal(S.etapaDoRastreio(r([e('sep', 'feita'), e('conf', 'feita'), e('fat', 'feita')])), 'faturado');
  assert.equal(S.etapaDoRastreio(r([e('desp', 'feita')])), 'despachado');
  for (const et of S.ETAPAS) assert.ok(S.avisoDaEtapa(et).length > 20, 'aviso para ' + et);
  assert.match(S.avisoDaEtapa('separado'), /já foi separado/);
});

test('transferência: itens, origem, destino, tipo (entre filiais / entre armazéns), saldos e sinal acima do saldo', () => {
  const ctx = { produto: (cod, onde) => ({ descricao: 'Descrição de ' + cod, saldoOrigem: cod === 'P-100' ? 3 : 50, onde }) };
  const r = criar([], base('transferencia_peca', {
    dados: transf({ itens: [{ produto: 'P-100', descricao: 'MENTIRA DO APARELHO', lote: 'L1', qt: '5', saldoOrigem: 9999, acimaDoSaldo: false }, { produto: 'P-200', qt: 2 }], motivo: ' venda para obra ', prazo: '2026-12-01' })
  }), t0, ctx);
  const d = r.linhas[0].dados;
  assert.equal(d.itens[0].descricao, 'Descrição de P-100', 'a descrição é a do servidor');
  assert.equal(d.itens[0].saldoOrigem, 3, 'o saldo é o do servidor');
  assert.deepEqual([d.itens[0].acimaDoSaldo, d.itens[1].acimaDoSaldo, d.acimaDoSaldo], [true, false, true]);
  assert.deepEqual([d.itens[0].lote, d.itens[0].qt, d.itens[1].lote], ['L1', 5, '']);
  assert.deepEqual(d.origem, { filial: 'Cambuci', codigo: '01', nome: 'Cambuci', armazem: '01' });
  assert.deepEqual(d.destino, { filial: 'Tambore', codigo: '03', nome: 'Tamboré', armazem: '01' });
  assert.deepEqual([d.tipoTransferencia, d.totalPecas, d.totalProdutos, d.prazo, d.motivo], ['entre_filiais', 7, 2, '2026-12-01', 'venda para obra']);
  assert.equal(r.linhas[0].filial, 'Cambuci', 'a filial da linha é a de origem');
  const entre = criar([], base('transferencia_peca', { dados: transf({ destino: { filial: '1', armazem: '2' } }) })).linhas[0].dados;
  assert.equal(entre.tipoTransferencia, 'entre_armazens');
  assert.deepEqual(entre.destino, { filial: 'Cambuci', codigo: '01', nome: 'Cambuci', armazem: '02' }, 'filial pelo código e armazém "2" vira "02"');
  assert.equal(criar([], base('transferencia_peca', { dados: transf({ origem: { filial: 'tamboré', armazem: 'zz2' }, destino: { filial: '03', armazem: '01' } }) })).linhas[0].dados.origem.armazem, 'ZZ2');
  // sem catálogo/saldo: aceita, sem descrição nem saldo (só sinaliza, nunca bloqueia)
  const sem = criar([], base('transferencia_peca', { dados: transf() })).linhas[0].dados.itens[0];
  assert.deepEqual([sem.descricao, sem.saldoOrigem, sem.acimaDoSaldo], ['', null, false]);
});

test('transferência: validações (itens 1 a 30, qt inteira 1..99999, origem ≠ destino, filiais da lista, prazo)', () => {
  const erro = (dados, re) => assert.match(S.aplicar([], base('transferencia_peca', { dados }), '', t0).erro, re);
  erro(transf({ itens: [] }), /pelo menos um produto/);
  erro(transf({ itens: undefined }), /pelo menos um produto/);
  erro(transf({ itens: Array.from({ length: 31 }, (_, i) => ({ produto: 'P' + i, qt: 1 })) }), /No máximo 30/);
  assert.equal(S.aplicar([], base('transferencia_peca', { dados: transf({ itens: Array.from({ length: 30 }, (_, i) => ({ produto: 'P' + i, qt: 1 })) }) }), '', t0).erro, undefined);
  erro(transf({ itens: [{ produto: '', qt: 1 }] }), /código do produto/);
  erro(transf({ itens: [{ produto: 'P1', qt: 0 }] }), /1 a 99999/);
  erro(transf({ itens: [{ produto: 'P1', qt: 100000 }] }), /1 a 99999/);
  erro(transf({ itens: [{ produto: 'P1', qt: 1.5 }] }), /1 a 99999/);
  erro(transf({ itens: [{ produto: 'P1', qt: 'abc' }] }), /1 a 99999/);
  erro(transf({ itens: [{ produto: 'P1', qt: 1 }, { produto: 'p1', qt: 2 }] }), /mais de uma vez/);
  assert.equal(S.aplicar([], base('transferencia_peca', { dados: transf({ itens: [{ produto: 'P1', lote: 'A', qt: 1 }, { produto: 'P1', lote: 'B', qt: 2 }] }) }), '', t0).erro, undefined, 'o mesmo produto em lotes diferentes é permitido');
  erro(transf({ origem: { filial: 'Marte', armazem: '01' } }), /filial de origem da lista/);
  erro(transf({ origem: { filial: 'Cambuci', armazem: '' } }), /armazém de origem/);
  erro(transf({ destino: { filial: 'Cambuci', armazem: '01' } }), /precisam ser diferentes/);
  erro(transf({ destino: { filial: 'Tambore' } }), /armazém de destino/);
  erro(transf({ prazo: '2026-11-01' }), /passado/);
  erro(transf({ prazo: '31/12/2026' }), /Data inválida/);
  erro(transf({ prazo: '2029-01-01' }), /muito distante/);
  erro(transf({ motivo: 'x' }), /motivo/);
  assert.equal(S.aplicar([], base('transferencia_peca', { dados: 'texto solto' }), '', t0).erro.length > 0, true);
});

test('equipe: assumir, status, negar exige resposta, interno, prioridade, área; histórico só cresce; primeira resposta e conclusão', () => {
  let r = criar([], base('nota_fiscal', { pedido: '355386', dados: { o_que: 'reenviar a nota por e-mail' } }));
  const id = r.resultado.id;
  assert.equal(r.linhas[0].primeiraRespostaEm, '');
  assert.match(S.aplicar(r.linhas, { acao: 'assumir', id }, '', t0).erro, /Quem/);
  r = S.aplicar(r.linhas, { acao: 'assumir', id }, 'Eva', t0 + 10 * MIN); assert.equal(r.erro, undefined);
  assert.deepEqual([r.linhas[0].status, r.linhas[0].responsavel, r.linhas[0].primeiraRespostaEm], ['em_analise', 'Eva', new Date(t0 + 10 * MIN).toISOString()]);
  r = S.aplicar(r.linhas, { acao: 'interno', id, texto: 'falei com o financeiro' }, 'Eva', t0 + 11 * MIN);
  assert.match(S.aplicar(r.linhas, { acao: 'interno', id, texto: ' ' }, 'Eva', t0).erro, /comentário/);
  r = S.aplicar(r.linhas, { acao: 'prioridade', id, prioridade: 'alta' }, 'Eva', t0 + 12 * MIN); assert.equal(r.linhas[0].prioridade, 'alta');
  assert.match(S.aplicar(r.linhas, { acao: 'prioridade', id, prioridade: 'máxima' }, 'Eva', t0).erro, /Prioridade inválida/);
  r = S.aplicar(r.linhas, { acao: 'area', id, area: 'expedicao' }, 'Eva', t0 + 13 * MIN); assert.equal(r.linhas[0].area, 'expedicao');
  assert.match(S.aplicar(r.linhas, { acao: 'area', id, area: 'rh' }, 'Eva', t0).erro, /Área inválida/);
  assert.match(S.aplicar(r.linhas, { acao: 'status', id, status: 'negada' }, 'Eva', t0).erro, /resposta obrigatória/);
  assert.match(S.aplicar(r.linhas, { acao: 'status', id, status: 'voando' }, 'Eva', t0).erro, /Status inválido/);
  r = S.aplicar(r.linhas, { acao: 'status', id, status: 'em_andamento', resposta: 'estou emitindo' }, 'Eva', t0 + 20 * MIN);
  r = S.aplicar(r.linhas, { acao: 'status', id, status: 'concluida', resposta: 'nota enviada' }, 'Eva', t0 + 30 * MIN);
  const l = r.linhas[0];
  assert.deepEqual([l.status, l.resposta, l.concluidaEm, l.primeiraRespostaEm], ['concluida', 'nota enviada', new Date(t0 + 30 * MIN).toISOString(), new Date(t0 + 10 * MIN).toISOString()]);
  assert.match(S.aplicar(r.linhas, { acao: 'assumir', id }, 'Eva', t0 + 40 * MIN).erro, /já foi encerrada/);
  assert.match(S.aplicar(r.linhas, { acao: 'status', id: 'nao-existe', status: 'concluida' }, 'Eva', t0).erro, /não encontrada/);
  assert.deepEqual(l.historico.map((h) => h.acao), ['criado', 'assumir', 'interno', 'prioridade', 'area', 'status', 'status']);
  assert.equal(S.aplicar(r.linhas, { acao: 'status', id, status: 'em_andamento' }, 'Eva', t0 + 50 * MIN).linhas[0].concluidaEm, '', 'reabrir limpa a conclusão');
  // negar com resposta
  const neg = S.aplicar(criar([], base('outro', { texto: 'preciso de algo estranho' })).linhas, { acao: 'status', id: undefined, status: 'negada', resposta: 'não dá' }, 'Eva', t0);
  assert.match(neg.erro, /não encontrada/);
});

test('histórico só cresce até 60 e a vendedora não vê nomes da equipe nem comentários internos', () => {
  let r = criar([], base('consulta_estoque', { dados: { produto: 'P-100', qt: 3, filial: 'BH' } }));
  const id = r.resultado.id;
  for (let i = 0; i < 70; i++) r = S.aplicar(r.linhas, { acao: 'interno', id, texto: 'nota ' + i }, 'Eva', t0 + i * 1000);
  assert.equal(r.linhas[0].historico.length, S.MAX_HISTORICO);
  assert.equal(r.linhas[0].historico[S.MAX_HISTORICO - 1].texto, 'nota 69');
  r = S.aplicar(r.linhas, { acao: 'assumir', id }, 'Eva', t0 + 80000);
  r = S.aplicar(r.linhas, { acao: 'status', id, status: 'concluida', resposta: 'tem 10 peças em BH' }, 'Eva', t0 + 90000);
  const pub = S.visaoMeu(r.linhas[0]), txt = JSON.stringify(pub);
  assert.ok(!txt.includes('Eva') && !txt.includes('nota 69'));
  assert.deepEqual(pub.historico.map((h) => h.status), ['em_analise', 'concluida']);
  assert.equal(pub.rotulo, 'Consulta de estoque');
});

test('normalizar: dado quebrado vira linha segura, sem perder o que existe; limpar só apaga concluídas antigas; vincular conta', () => {
  assert.equal(S.normalizarLinha(null), null);
  assert.equal(S.normalizarLinha({ pedido: '123456' }), null, 'sem id não vale');
  const l = S.normalizarLinha({ id: 'a1', tipo: 'voar', status: 'xx', prioridade: 'zz', dados: 7, historico: [{ acao: '??', status: 'xx' }] });
  assert.deepEqual([l.tipo, l.status, l.prioridade, l.area, l.dados, l.historico.length, l.historico[0].acao], ['outro', 'recebida', 'normal', 'expedicao', {}, 1, 'status']);
  const velha = (id, status, dias) => Object.assign(S.normalizarLinha({ id, tipo: 'outro', status, criadoEm: new Date(t0 - dias * 864e5).toISOString() }), { concluidaEm: new Date(t0 - dias * 864e5).toISOString() });
  const lista = S.limpar([velha('ativa', 'recebida', 400), velha('fim-velha', 'concluida', 130), velha('fim-nova', 'negada', 10)], t0).map((x) => x.id);
  assert.deepEqual(lista, ['ativa', 'fim-nova']);
  const dup = S.normalizarLista({ linhas: [{ id: 'x' }, { id: 'x' }, { id: 'y' }, null, 'lixo'] });
  assert.deepEqual(dup.map((x) => x.id), ['x', 'y']);
  const mine = criar([], base('outro', { texto: 'preciso de ajuda' })).linhas[0];
  const v = S.vincularConta([Object.assign({}, mine, { id: 'x1' }), Object.assign({}, mine, { id: 'x2', pedidoPor: 'Outra' }), Object.assign({}, mine, { id: 'x3', conta: 'bia' })], ['x1', 'x2', 'x3'], 'ana', 'ana.v');
  assert.deepEqual(v.linhas.map((x) => x.conta), ['ana.v', '', 'bia']);
  assert.deepEqual([S.ehDela(v.linhas[0], 'ana.v'), S.ehDela(v.linhas[0], ''), S.ehDonoPorNome(v.linhas[1], 'outra')], [true, false, true]);
});

test('SLA: vence no prazo do tipo; atrasada só se ativa e sem 1ª resposta', () => {
  const l = criar([], base('cancelar_pedido', { pedido: '355386', dados: { motivo: 'cliente desistiu' }, etapa: 'nao_separado' })).linhas[0];
  assert.equal(S.slaDe(l, t0 + 29 * MIN).atrasada, false);
  assert.equal(S.slaDe(l, t0 + 31 * MIN).atrasada, true);
  assert.equal(S.slaDe(l, t0 + 31 * MIN).slaVenceEm, new Date(t0 + 30 * MIN).toISOString());
  assert.equal(S.slaDe(Object.assign({}, l, { primeiraRespostaEm: new Date(t0 + MIN).toISOString() }), t0 + 99 * MIN).atrasada, false);
  assert.equal(S.slaDe(Object.assign({}, l, { status: 'concluida' }), t0 + 99 * MIN).atrasada, false);
});

test('filtros e busca (inclui itens da transferência) e CSV seguro', () => {
  let linhas = criar([], base('transferencia_peca', { dados: transf({ itens: [{ produto: 'P-100', qt: 5 }] }) }), t0, { produto: () => ({ descricao: 'Cabo de aço 8 mm', saldoOrigem: 10 }) }).linhas;
  linhas = criar(linhas, base('cancelar_pedido', { pedido: '355386', dados: { motivo: '=1+1 cliente desistiu' }, etapa: 'separado', pedidoPor: 'Bia' }), t0 + 1000).linhas;
  assert.equal(S.filtrar(linhas, { q: 'cabo ACO' }).length, 1, 'acha pela descrição, sem acento');
  assert.equal(S.filtrar(linhas, { q: 'tamboré' }).length, 1, 'acha pelo destino');
  assert.equal(S.filtrar(linhas, { tipo: 'cancelar_pedido' }).length, 1);
  assert.equal(S.filtrar(linhas, { status: 'concluida' }).length, 0);
  assert.equal(S.filtrar(linhas, { area: 'estoque' }).length, 2);
  assert.equal(S.filtrar(linhas, { de: '2026-11-25' }).length, 0);
  assert.equal(S.filtrar(linhas, { de: '2026-11-24', ate: '2026-11-24' }).length, 2);
  assert.deepEqual(S.ordenarFila(linhas).map((l) => l.tipo), ['cancelar_pedido', 'transferencia_peca'], 'alta antes de normal');
  const csv = S.paraCsv(linhas);
  assert.ok(csv.startsWith('﻿id;protocolo;tipo;pedido;vendedora;filial;status;prioridade;criada;1ª resposta;concluída;minutos até resposta;minutos até conclusão;para quando;pedidos do lote;pedidos atendidos\r\n'), 'as colunas antigas seguem na ordem; as novas ficam no fim');
  assert.equal(csv.trim().split('\r\n').length, 3);
  assert.ok(csv.includes('Transferência de peça') && csv.includes('Tamboré') === false && csv.includes('Cambuci'));
});

test('dashboard: números por tipo, dia, vendedora, filial, cancelamentos a tempo, transferências e fila; sem dados nunca dá erro', () => {
  const vazio = D.montarDashboard({ agora: t0, dias: 7 });
  assert.deepEqual([vazio.kpis.abertas, vazio.kpis.tempoMedio1aRespostaMin, vazio.kpis.pctNoPrazo, vazio.porDia.length, vazio.fila.length, vazio.cancelamentos.pctATempo, vazio.transferencias.total], [0, null, null, 7, 0, null, 0]);
  assert.equal(D.montarDashboard().periodo.dias, 30);
  assert.equal(D.montarDashboard({ dias: 500 }).periodo.dias, 90);
  const ctx = { produto: (c) => ({ descricao: 'Peça ' + c, saldoOrigem: 100 }) };
  let l = criar([], base('cancelar_pedido', { pedido: '355386', dados: { motivo: 'cliente desistiu' }, etapa: 'nao_separado' }), t0 - 2 * 864e5).linhas;
  l = criar(l, base('cancelar_pedido', { pedido: '355387', dados: { motivo: 'cliente desistiu' }, etapa: 'faturado', pedidoPor: 'Bia' }), t0 - 864e5).linhas;
  l = criar(l, base('transferencia_peca', { dados: transf({ itens: [{ produto: 'P-100', qt: 10 }, { produto: 'P-200', qt: 4 }] }) }), t0 - 3600000, ctx).linhas;
  l = criar(l, base('transferencia_peca', { dados: transf({ itens: [{ produto: 'P-100', qt: 6 }], destino: { filial: 'Cambuci', armazem: '02' } }), pedidoPor: 'Bia' }), t0 - 1800000, ctx).linhas;
  l = criar(l, base('outro', { texto: 'algo diferente aqui' }), t0 - 60 * MIN).linhas;
  const porTexto = (txt) => l.find((x) => x.texto === txt);
  const idCanc = l.find((x) => x.pedido === '355386').id;
  l = S.aplicar(l, { acao: 'assumir', id: idCanc }, 'Eva', t0 - 2 * 864e5 + 10 * MIN, undefined).linhas;
  l = S.aplicar(l, { acao: 'status', id: idCanc, status: 'concluida', resposta: 'parado a tempo' }, 'Eva', t0 - 2 * 864e5 + 40 * MIN).linhas;
  const d = D.montarDashboard({ solicitacoes: l, prioridades: [{ id: 'p1', protocolo: 'P-1', pedido: '111111', pedidoPor: 'Ana', status: 'recebida', nivel: 'alta', responsavel: '', criadoEm: new Date(t0 - 5 * 3600000).toISOString() }], avisos: [{ id: 'a1', protocolo: 'AVI-1', pedido: '222222', tipo: 'endereco', pedidoPor: 'Ana', status: 'recebido', responsavel: '', criadoEm: new Date(t0 - 4 * 3600000).toISOString() }], agora: t0, dias: 7 });
  assert.deepEqual(d.periodo, { de: '2026-11-18', ate: '2026-11-24', dias: 7 });
  assert.deepEqual([d.kpis.criadasNoPeriodo, d.kpis.abertas, d.kpis.concluidasNoPeriodo, d.kpis.negadas], [5, 4, 1, 0]);
  assert.equal(d.kpis.tempoMedio1aRespostaMin, 10); assert.equal(d.kpis.tempoMedioResolucaoMin, 40);
  assert.ok(d.kpis.atrasadasSla >= 1, 'o cancelamento de 2 dias atrás sem resposta (o outro) já passou de 30 min');
  assert.deepEqual(d.fontes, { solicitacoes: 5, prioridades: 1, avisos: 1 });
  assert.equal(d.porTipo.length, S.TIPOS_IDS.length); assert.equal(d.porTipo.find((x) => x.tipo === 'cancelar_pedido').total, 2);
  assert.equal(d.porTipo.find((x) => x.tipo === 'cancelar_pedido').medResp, 10);
  assert.equal(d.porDia.length, 7); assert.equal(d.porDia[6].dia, '2026-11-24'); assert.equal(d.porDia[6].prioridades, 1); assert.equal(d.porDia[6].avisos, 1);
  assert.equal(d.porDia.reduce((a, x) => a + x.solicitacoes, 0), 5);
  assert.deepEqual(d.cancelamentos, { total: 2, aTempo: 1, tarde: 1, pctATempo: 50 });
  assert.equal(d.porVendedora[0].nome.length > 0, true); assert.ok(d.porVendedora.length <= 15);
  assert.deepEqual(d.porFilial.map((x) => x.filial), ['Cambuci'], 'filial = a de origem (transferência) ou a do pedido');
  assert.deepEqual([d.transferencias.total, d.transferencias.totalPecas, d.transferencias.totalProdutos], [2, 20, 2]);
  assert.deepEqual(d.transferencias.rotas.map((r) => [r.origemRotulo, r.destinoRotulo, r.tipoTransferencia, r.total, r.pecas]), [['Cambuci 01', 'Tamboré 01', 'entre_filiais', 1, 14], ['Cambuci 01', 'Cambuci 02', 'entre_armazens', 1, 6]]);
  assert.deepEqual(d.transferencias.produtos[0], { produto: 'P-100', descricao: 'Peça P-100', pedidos: 2, pecas: 16 });
  assert.equal(d.fila.length, 6, '4 solicitações abertas + 1 prioridade + 1 aviso');
  assert.deepEqual(d.fila.map((f) => f.fonte).sort(), ['aviso', 'prioridade', 'solicitacao', 'solicitacao', 'solicitacao', 'solicitacao']);
  assert.deepEqual(d.fila.map((f) => f.criadoEm), d.fila.map((f) => f.criadoEm).slice().sort(), 'mais antigos primeiro');
  assert.ok(porTexto('algo diferente aqui'));
});

test('produtos: índice em memória (código igual/prefixo, descrição sem acento e todas as palavras), saldo por origem, lotes e sem saldo', () => {
  const itemNames = [['10.100', 'Cabo de Aço 8 mm'], ['10.101', 'Cabo de aço 10 mm'], ['20.500', 'Luva Térmica'], ['30.001', 'Parafuso sem saldo']];
  const saldoPorLote = [
    ['L1', { produto: 'x', porArmazem: [], itens: [{ arm: '01', produto: '10.100', saldo: 30 }, { arm: '1', produto: '10.100', saldo: 5 }, { arm: '02', produto: '10.100', saldo: 7 }] }],
    ['L2', { produto: 'x', porArmazem: [], itens: [{ arm: '01', produto: '10.100', saldo: 12 }, { arm: '59', produto: '10.101', saldo: 4 }] }]
  ];
  const ind = PR.montarIndice({ itemNames, saldoPorLote });
  assert.equal(ind.fonte, 'saldo-lotes');
  assert.deepEqual(PR.buscar(ind, '10.100').map((p) => p.codigo), ['10.100'], 'código igual vem primeiro');
  assert.deepEqual(PR.buscar(ind, '10.1').map((p) => p.codigo), ['10.100', '10.101'], 'prefixo do código');
  assert.deepEqual(PR.buscar(ind, 'CABO aco').map((p) => p.codigo), ['10.100', '10.101'], 'sem acento, sem caixa, todas as palavras');
  assert.deepEqual(PR.buscar(ind, 'aço 10').map((p) => p.codigo), ['10.101']);
  assert.deepEqual(PR.buscar(ind, 'cabo zzz'), []);
  assert.deepEqual(PR.buscar(ind, 'a'), [], 'mínimo de 2 caracteres');
  const p = PR.buscar(ind, '10.100')[0];
  assert.deepEqual([p.descricao, p.saldoTotal, p.saldoDisponivel], ['Cabo de Aço 8 mm', 54, true]);
  assert.deepEqual(p.saldos, [{ filial: 'Cambuci', armazem: '01', saldo: 47 }, { filial: 'Cambuci', armazem: '02', saldo: 7 }]);
  assert.deepEqual(p.lotes.map((l) => [l.lote, l.armazem, l.saldo]), [['L1', '01', 35], ['L2', '01', 12], ['L1', '02', 7]]);
  const naOrigem = PR.buscar(ind, '10.100', { filial: 'Cambuci', armazem: '2' })[0];
  assert.deepEqual([naOrigem.saldoOrigem, naOrigem.lotes.length], [7, 1], 'com origem, mostra só os lotes dela');
  assert.equal(PR.buscar(ind, '10.100', { filial: 'Tamboré', armazem: '01' })[0].saldoOrigem, 0);
  const sem = PR.buscar(ind, 'parafuso')[0];
  assert.deepEqual([sem.codigo, sem.saldoTotal, sem.saldoDisponivel, sem.lotes, sem.saldos], ['30.001', null, false, [], []], 'sem saldo: só a descrição, nunca erro');
  assert.deepEqual(PR.consultarProduto(ind, '10.100', { filial: 'Cambuci', armazem: '01', lote: 'l1' }), { codigo: '10.100', descricao: 'Cabo de Aço 8 mm', saldoOrigem: 35 });
  assert.equal(PR.consultarProduto(ind, '30.001', { filial: 'Cambuci', armazem: '01' }).saldoOrigem, null);
  assert.equal(PR.consultarProduto(ind, 'nao-existe', { filial: 'Cambuci', armazem: '01' }), null);
  assert.deepEqual(PR.buscar(null, 'cabo'), []);
  assert.deepEqual(PR.buscar(PR.montarIndice({}), 'cabo'), []);
  assert.ok(!/custo|valor|fornecedor|cliente/i.test(JSON.stringify(PR.buscar(ind, 'cabo'))));
});

test('produtos: sem saldo-lotes usa a posição do SB8 (com filial, armazém e validade); limite de 10 resultados', () => {
  const ind = PR.montarIndice({
    itemNames: Array.from({ length: 25 }, (_, i) => ['K' + String(i).padStart(2, '0'), 'Kit número ' + i]),
    saldoPorLote: [],
    posicao: { rows: [{ filial: '03', armazem: '01', produto: 'K01', lote: 'LT', saldo: 9, dtValidade: '2027-05-01' }, { filial: '1', armazem: '01', produto: 'K01', lote: 'LT', saldo: 2 }] }
  });
  assert.equal(ind.fonte, 'posicao-sb8');
  const p = PR.buscar(ind, 'k01', { filial: 'Tambore', armazem: '01' })[0];
  assert.deepEqual([p.saldoOrigem, p.saldoTotal, p.lotes], [9, 11, [{ lote: 'LT', saldo: 9, filial: 'Tambore', armazem: '01', validade: '2027-05-01' }]]);
  assert.equal(PR.buscar(ind, 'kit').length, 10);
});

test('revisão: tipo "constructor"/"__proto__" é tratado como inválido (nunca erro 500) e CSV usa ponto e vírgula', () => {
  assert.equal(S.TIPOS['constructor'], undefined);
  assert.equal(S.TIPOS['__proto__'], undefined);
  const r = S.aplicar([], { acao: 'criar', tipo: 'constructor', pedidoPor: 'Ana (Vendas)', texto: 'oi tudo bem' }, '', Date.now());
  assert.ok(r.erro, 'deve recusar com mensagem');
  const r2 = S.aplicar([], { acao: 'criar', tipo: '__proto__', pedidoPor: 'Ana (Vendas)', texto: 'oi tudo bem' }, '', Date.now());
  assert.ok(r2.erro);
});
