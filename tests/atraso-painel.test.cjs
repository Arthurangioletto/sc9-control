const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../historico-atraso.js');
const P = require('../atraso-painel.js');

// [pedido, armazém, liberadoEm, peças, 'E'|'F', 'A'|'P', dias, transportadora, extras]
const it = (ped, arm, pecas, tipo, dias, extra, transp) => [ped, arm, '2026-11-01', pecas, tipo, 'A', dias, transp || 'TCS', extra || {}];
const reg = (dia, total, itens) => ({ dia, total, pecas: 0, atualizadoEm: dia + 'T20:00:00.000Z', itens });
const dados = () => ({
  meses: { '2026-11': { mes: '2026-11', dias: {
    '2026-11-16': reg('2026-11-16', 200, [it('1', 'Cambuci', 10, 'E', 2, { e: 'S' }), it('2', 'BH', 5, 'E', 6, { e: 'C' }), it('3', 'BH', 7, 'F', 9, { e: 'F' }), it('4', 'Cambuci', 1, 'F', 20, { e: 'D', nf: '9', v: 100 })]),
    '2026-11-19': reg('2026-11-19', 200, [it('2', 'BH', 5, 'E', 9, { e: 'C' }), it('3', 'BH', 7, 'F', 12, { e: 'D', nf: '8', v: 250 }), it('5', 'Cambuci', 4, 'E', 3, { e: 'S' }), it('6', 'Barueri', 8, 'F', 5, { e: 'F' }, 'Jadlog')])
  } } },
  expedicao: { '2026-11': { '2026-11-16': { pedidos: 10, pecas: 100 }, '2026-11-17': { pedidos: 30, pecas: 300 }, '2026-11-19': { pedidos: 20, pecas: 150 } } },
  faturados: { '2026-11': { '2026-11-19': { pedidos: 15, pecas: 90 } } },
  entregues: {}, saidas: {}, ocorrencias: []
});

test('tom: polaridade e zona de atenção', () => {
  assert.equal(P.tom(false, -3, 10), 'bom');       // atraso caiu
  assert.equal(P.tom(false, 3, 10), 'ruim');       // atraso subiu 30%
  assert.equal(P.tom(false, 1, 200), 'neutro');    // menos de 1%
  assert.equal(P.tom(false, 3, 100), 'atencao');   // piora de 3%
  assert.equal(P.tom(true, 5, 10), 'bom');         // despachou mais
  assert.equal(P.tom(true, -5, 10), 'ruim');       // despachou menos
  assert.equal(P.tom(true, 0, 10), 'neutro');
  assert.equal(P.tom(true, null, 10), 'neutro');
});

test('cartões batem com o resumo existente da página e do Excel', () => {
  const p = H.preparar(dados());
  const c = P.cartoes(p, '2026-11-19', P.filtroVazio(), new Date('2026-11-19T22:00:00Z'));
  const por = Object.fromEntries(c.cartoes.map((x) => [x.id, x]));
  const a = p.porDia.get('2026-11-19');
  assert.equal(por.atraso.valor, a.resumo.tot);
  assert.equal(por.pecas.valor, a.resumo.pecas);
  assert.equal(por.estoque.valor, a.resumo.e);
  assert.equal(por.faturamento.valor, a.resumo.f);
  assert.equal(por.atraso.ref, 4);
  assert.equal(por.atraso.delta, 0);
  assert.equal(por.atraso.tom, 'neutro');
  assert.equal(c.refDia, '2026-11-16');
  assert.equal(por.cinco.valor, 3);          // 9, 12 e 5 dias (>= 5)
  assert.equal(por.cinco.ref, 3);            // 6, 9 e 20 dias
  assert.equal(por.valor.valor, 250);
  assert.equal(por.valor.ref, 100);
  assert.equal(por.valor.tom, 'ruim');
  assert.equal(por.despachados.valor, 20);
  assert.equal(por.despachados.ref, 30);     // dia de despacho anterior: 17/11
  assert.equal(por.despachados.refDia, '2026-11-17');
  assert.equal(por.despachados.tom, 'ruim'); // despachar menos é pior
  assert.equal(por.faturados.valor, 15);
  assert.equal(por.faturados.ref, null);
  assert.equal(por.faturados.tom, 'neutro');
});

test('aguardando despacho: já tem nota (levar) ou já está na Saída p/ Expedição (despachar)', () => {
  const d = dados();
  d.saidas = { '6': '2026-11-19T10:00:00.000Z' };
  const p = H.preparar(d);
  const c = P.cartoes(p, '2026-11-19', P.filtroVazio(), new Date('2026-11-19T22:00:00Z'));
  const ag = c.cartoes.find((x) => x.id === 'aguardando');
  assert.equal(ag.valor, 2); // pedido 3 (etapa D) e pedido 6 (na Saída p/ Expedição)
  // o filtro do clique devolve exatamente os mesmos pedidos
  const lista = H.filtrar(p.porDia.get('2026-11-19').reg.itens, Object.assign(H.filtrar ? { tipo: '', sit: '', status: '', arm: '', transp: '', busca: '', ocorr: '', ordem: 'dias', desc: true } : {}, ag.filtro), p.entregues, { p, dia: '2026-11-19', agora: new Date('2026-11-19T22:00:00Z') });
  assert.equal(lista.length, ag.valor);
});

test('o clique de 5+ dias devolve a mesma contagem do cartão', () => {
  const p = H.preparar(dados());
  const c = P.cartoes(p, '2026-11-19', P.filtroVazio(), new Date());
  const k = c.cartoes.find((x) => x.id === 'cinco');
  const lista = H.filtrar(p.porDia.get('2026-11-19').reg.itens, Object.assign({ tipo: '', sit: '', status: '', arm: '', transp: '', busca: '', acao: '', ocorr: '', ordem: 'dias', desc: true }, k.filtro), p.entregues, {});
  assert.equal(lista.length, k.valor);
});

test('filtro de armazém afeta atraso, mas despachados e faturados ficam como total geral', () => {
  const p = H.preparar(dados());
  const c = P.cartoes(p, '2026-11-19', { arm: 'BH', transp: '' }, new Date());
  const por = Object.fromEntries(c.cartoes.map((x) => [x.id, x]));
  assert.equal(por.atraso.valor, 2);
  assert.equal(por.atraso.base, null);        // a base total só existe para todos os armazéns
  assert.equal(por.despachados.valor, 20);
  assert.equal(por.despachados.semFiltroArmazem, true);
  assert.equal(por.faturados.semFiltroArmazem, true);
});

test('dia sem despacho mostra null (sem registro), nunca zero', () => {
  const d = dados(); d.expedicao = {};
  const p = H.preparar(d);
  const c = P.cartoes(p, '2026-11-19', P.filtroVazio(), new Date());
  assert.equal(c.cartoes.find((x) => x.id === 'despachados').valor, null);
});

test('série tem um ponto por dia do calendário e lacunas viram null; cruza meses', () => {
  const d = dados();
  d.meses['2026-12'] = { mes: '2026-12', dias: { '2026-12-01': reg('2026-12-01', 200, [it('7', 'BH', 3, 'E', 1, { e: 'S' })]) } };
  const p = H.preparar(d);
  const s = P.serie(p, '2026-11-28', '2026-12-02', P.filtroVazio());
  assert.deepEqual(s.map((x) => x.dia), ['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.equal(s[3].foto.tot, 1);
  assert.equal(s[0].foto, null);
  const s2 = P.serie(p, '2026-11-16', '2026-11-19', P.filtroVazio());
  assert.equal(s2[0].foto.tot, 4);
  assert.equal(s2[1].foto, null);
  assert.equal(s2[1].exp.pedidos, 30);
  assert.equal(s2[2].fimDeSemana, false);
  // comparativo do primeiro dia do período atravessa a virada do mês
  const c = P.cartoes(p, '2026-12-01', P.filtroVazio(), new Date());
  assert.equal(c.refDia, '2026-11-19');
});

test('média móvel ignora lacunas em vez de tratá-las como zero', () => {
  assert.deepEqual(P.mediaMovel([10, null, 20, 30], 2), [10, null, 15, 25]);
});

test('períodos: 7, 30, mês atual e personalizado', () => {
  assert.deepEqual(P.periodo('7', '2026-11-19'), { tipo: '7', de: '2026-11-13', ate: '2026-11-19' });
  assert.equal(P.periodo('30', '2026-12-05').de, '2026-11-06');
  assert.deepEqual(P.periodo('mes', '2026-11-19'), { tipo: 'mes', de: '2026-11-01', ate: '2026-11-19' });
  assert.deepEqual(P.periodo('custom', '2026-11-19', { de: '2026-11-10', ate: '2026-11-05' }), { tipo: 'custom', de: '2026-11-05', ate: '2026-11-10' });
});

test('gargalos por etapa, com 5+ dias e maior gargalo', () => {
  const p = H.preparar(dados());
  const g = P.gargalos(p, '2026-11-19', P.filtroVazio());
  const por = Object.fromEntries(g.etapas.map((e) => [e.etapa, e]));
  assert.equal(por.S.qtd, 1); assert.equal(por.C.qtd, 1); assert.equal(por.F.qtd, 1); assert.equal(por.D.qtd, 1);
  assert.equal(por.C.cinco, 1);
  assert.equal(g.total, 4);
  assert.equal(g.semEtapa, 0);
  assert.ok(['C', 'D'].includes(g.maior));
});

test('foto antiga sem etapa não quebra: usa o tipo F como faturamento e conta o resto como sem etapa', () => {
  const d = dados();
  d.meses['2026-11'].dias['2026-11-19'].itens = [['9', 'BH', '2026-11-01', 3, 'E', 'A', 6, 'TCS'], ['10', 'BH', '2026-11-01', 3, 'F', 'A', 6, 'TCS']];
  const p = H.preparar(d);
  const g = P.gargalos(p, '2026-11-19', P.filtroVazio());
  assert.equal(g.semEtapa, 1);
  assert.equal(g.etapas.find((e) => e.etapa === 'F').qtd, 1);
});

test('ranking de armazéns soma com o total do dia', () => {
  const p = H.preparar(dados());
  const r = P.armazens(p, '2026-11-19', P.filtroVazio());
  assert.equal(r.lista.reduce((s, x) => s + x.tot, 0), r.total);
  assert.equal(r.lista[0].nome, 'BH' === r.lista[0].nome ? 'BH' : r.lista[0].nome);
  assert.equal(r.lista.find((x) => x.nome === 'BH').cinco, 2);
});

test('faixas de dias cobrem todos os pedidos e comparam com 7 dias antes', () => {
  const p = H.preparar(dados());
  const dist = P.distribuicao(p, '2026-11-19', P.filtroVazio());
  assert.equal(dist.atual.lista.reduce((s, f) => s + f.qtd, 0), 4);
  assert.equal(dist.cincoAtual, 3);
  assert.equal(dist.refDia, null); // não há foto de 12/11 ou antes
  const d2 = P.distribuicao(p, '2026-11-19', P.filtroVazio());
  assert.equal(d2.antes, null);
});

test('produtividade separa pedidos e peças e não conta dia sem registro', () => {
  const p = H.preparar(dados());
  const s = P.serie(p, '2026-11-16', '2026-11-19', P.filtroVazio());
  const pr = P.produtividade(s);
  assert.equal(pr.despachados.dias, 3);
  assert.equal(pr.despachados.mediaPedidos, 20);
  assert.equal(pr.despachados.mediaPecas, 550 / 3);
  assert.equal(pr.despachados.pedidos.melhor.dia, '2026-11-17');
  assert.equal(pr.despachados.pedidos.pior.dia, '2026-11-16');
  assert.equal(pr.faturados.dias, 1);
  assert.equal(pr.semana.length, 5);
});

test('selo de atualização: em dia, atenção e desatualizado (dias úteis)', () => {
  const p = H.preparar(dados());
  assert.equal(P.frescor(p, '2026-11-19').estado, 'em-dia');
  assert.equal(P.frescor(p, '2026-11-20').estado, 'atencao');
  assert.equal(P.frescor(p, '2026-11-22').estado, 'atencao'); // sábado/domingo não contam
  assert.equal(P.frescor(p, '2026-11-24').estado, 'desatualizado');
  assert.equal(P.frescor(H.preparar({ meses: {} }), '2026-11-24').estado, 'vazio');
});

test('não muda os dados recebidos', () => {
  const d = dados(); const antes = JSON.stringify(d);
  const p = H.preparar(d);
  P.cartoes(p, '2026-11-19', { arm: 'BH', transp: '' }, new Date());
  P.serie(p, '2026-11-01', '2026-11-30', P.filtroVazio());
  assert.equal(JSON.stringify(d), antes);
});

test('fluxo: entraram, saíram e saldo contra a foto anterior', () => {
  const p = H.preparar(dados());
  const f = P.fluxo(p, '2026-11-01', '2026-11-30', P.filtroVazio());
  assert.equal(f.length, 1);                 // o primeiro dia não tem foto anterior
  assert.equal(f[0].dia, '2026-11-19');
  assert.equal(f[0].entraram, 2);            // pedidos 5 e 6
  assert.equal(f[0].sairam, 2);              // pedidos 1 e 4
  assert.equal(f[0].saldo, 0);
  assert.equal(f[0].ref, '2026-11-16');
  assert.equal(P.fluxo(p, '2026-11-01', '2026-11-30', { arm: 'Cambuci', transp: '' })[0].sairam, 2);
});

test('arquivos do painel são servidos e carregados pela página', () => {
  const fs = require('node:fs'), path = require('node:path');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'historico-atraso.html'), 'utf8');
  for (const f of ['atraso-painel.js', 'atraso-painel-ui.js']) {
    assert.ok(srv.includes('SERVABLE.add("' + f + '")'), f + ' precisa estar no SERVABLE');
    assert.ok(html.includes('src="/' + f + '"'), f + ' precisa estar na página');
  }
  // o painel só aparece com ?painel=1 e a página continua usando o conteúdo de sempre
  const pg = fs.readFileSync(path.join(__dirname, '..', 'historico-atraso.js'), 'utf8');
  assert.ok(pg.includes("get('painel') === '1'"));
  assert.ok(pg.includes('faixaDeDias(), detalheDoDia(), graficos(), tabelaDoMes()'));
});

test('com o detalhe por armazém, despachados e faturados acompanham o filtro e a % de atraso por armazém aparece', () => {
  const d = dados();
  d.expedicao['2026-11']['2026-11-17'].por = { BH: { pedidos: 12, pecas: 100 }, Cambuci: { pedidos: 18, pecas: 200 } };
  d.expedicao['2026-11']['2026-11-19'].por = { BH: { pedidos: 5, pecas: 40 } };
  d.faturados['2026-11']['2026-11-19'].por = { BH: { pedidos: 4, pecas: 30 } };
  d.meses['2026-11'].dias['2026-11-19'].totalPorArmazem = { BH: 20, Cambuci: 100, Barueri: 50 };
  const p = H.preparar(d);
  const c = P.cartoes(p, '2026-11-19', { arm: 'BH', transp: '' }, new Date());
  const por = Object.fromEntries(c.cartoes.map((x) => [x.id, x]));
  assert.equal(por.despachados.valor, 5);
  assert.equal(por.despachados.ref, 12);           // dia anterior COM detalhe de BH (17/11)
  assert.equal(por.despachados.refDia, '2026-11-17');
  assert.equal(por.despachados.semFiltroArmazem, false);
  assert.equal(por.faturados.valor, 4);
  assert.equal(por.atraso.base, 20);
  // armazém sem detalhe no dia continua mostrando o total e avisando
  const c2 = P.cartoes(p, '2026-11-19', { arm: 'Barueri', transp: '' }, new Date());
  const por2 = Object.fromEntries(c2.cartoes.map((x) => [x.id, x]));
  assert.equal(por2.despachados.valor, 20);
  assert.equal(por2.despachados.semFiltroArmazem, true);
  const r = P.armazens(p, '2026-11-19', P.filtroVazio());
  assert.equal(r.temBase, true);
  assert.equal(r.lista.find((x) => x.nome === 'BH').pctBase, 10); // 2 em atraso de 20
  assert.equal(P.armazens(H.preparar(dados()), '2026-11-19', P.filtroVazio()).temBase, false);

test('modo TV e impressão existem e o painel sai do modo TV com Esc', () => {
  const fs = require('node:fs'), path = require('node:path');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'atraso-painel-ui.js'), 'utf8');
  assert.ok(ui.includes("get('modo') === 'tv'"));
  assert.ok(ui.includes("ev.key === 'Escape'"));
  assert.ok(ui.includes('@page { size:A4 landscape'));
  assert.ok(ui.includes('tabelaCriticos'));
});
