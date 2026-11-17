const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../consolidado.js');

const d = s => new Date(s + 'T00:00:00Z');
const item = (o) => ({ armazem: 'Cambuci', pedido: 'P1', produto: 'A', qt: 1, dt: d('2026-11-09'), nf: null, nome: 'Cliente', cliente: 'C1', separador: '', conferente: '', ...o });

test('semanas (segunda a domingo) e meses saem das linhas liberadas, a mais recente primeiro', () => {
  const p = C.periodos([item({ dt: d('2026-11-02') }), item({ dt: d('2026-11-06') }), item({ dt: d('2026-11-09') }), item({ dt: d('2026-11-13') }), item({ dt: d('2026-10-30') })]);
  assert.deepEqual(p.semanas.map(s => s.label), ['09/11 a 13/11/2026', '02/11 a 06/11/2026', '30/10 a 30/10/2026']);
  assert.deepEqual(p.meses.map(m => m.label), ['Novembro/2026 (parcial)', 'Outubro/2026']);
  assert.equal(p.ultimoDia, '2026-11-13');
});

test('semana que termina na sexta não é parcial; termina na quarta é', () => {
  assert.equal(C.periodos([item({ dt: d('2026-11-13') }), item({ dt: d('2026-11-09') })]).semanas[0].parcial, false);
  assert.equal(C.periodos([item({ dt: d('2026-11-11') }), item({ dt: d('2026-11-09') })]).semanas[0].parcial, true);
});

test('só Cambuci, BH, CE, DF e RJ entram; Implacil e Tamboré ficam de fora', () => {
  const p = C.periodos([item({ armazem: 'Tambore', dt: d('2026-11-03') }), item({ nome: 'IMPLACIL OSSTEM', dt: d('2026-11-04') }), item({ dt: d('2026-11-09') })]);
  assert.equal(p.semanas.length, 1);
  assert.equal(p.semanas[0].id, '2026-11-09');
});

test('status: Cambuci pela Entrega e por separado+conferido; filiais pela NF e pelo corte', () => {
  const sep = { pickEnd: d('2026-11-10'), confEnd: d('2026-11-10') };
  const itens = [
    item({ pedido: 'E', nf: '1' }),                                   // na Entrega
    item({ pedido: 'F', ...sep }),                                     // sem Entrega, separado+conferido
    item({ pedido: 'G' }),                                             // sem Entrega, nada feito
    item({ pedido: 'H', nf: '2' }),                                    // com NF mas fora da Entrega e sem separar: Atrasado
    item({ pedido: 'B1', armazem: 'BH', nf: '3' }),
    item({ pedido: 'B2', armazem: 'BH', dt: d('2026-11-12') }),        // sem NF antes do corte
    item({ pedido: 'B3', armazem: 'BH', dt: d('2026-11-13') })         // sem NF no dia do corte
  ];
  const r = C.construir({ items: itens, entregaCounts: new Map([['E', 1]]) }, '2026-11-09', '2026-11-13');
  const st = Object.fromEntries(r.abas[1].linhas.slice(1).map(l => [l[4], l[8]]));
  assert.deepEqual(st, { E: 'Enviado', F: 'Pendente', G: 'Atrasado', H: 'Atrasado', B1: 'Enviado', B2: 'Atrasado', B3: 'Pendente' });
  assert.deepEqual(r.resumo, { pedidos: 7, pecas: 7, enviados: 2, atrasados: 3, pendentes: 2 });
});

test('pedido liberado em partes conta em cada período só com as linhas daquele período', () => {
  const itens = [item({ qt: 3, dt: d('2026-11-06'), nf: '9' }), item({ qt: 5, dt: d('2026-11-09'), nf: '9' }), item({ pedido: 'P2', qt: 1, dt: d('2026-11-10') })];
  const e = new Map([['P1', 1], ['P2', 1]]);
  const a = C.construir({ items: itens, entregaCounts: e }, '2026-11-02', '2026-11-06');
  const b = C.construir({ items: itens, entregaCounts: e }, '2026-11-09', '2026-11-13');
  assert.deepEqual([a.resumo.pedidos, a.resumo.pecas], [1, 3]);
  assert.deepEqual([b.resumo.pedidos, b.resumo.pecas], [2, 6]);
});

test('transportadora vem do SC5 sem zeros à esquerda; código sem nome aparece como Código N; sem informação, não definida', () => {
  assert.equal(C.nomeTransportadora('000006'), 'Retira 03');
  assert.equal(C.nomeTransportadora('010023'), 'São Paulo');
  assert.equal(C.nomeTransportadora('10099'), 'Código 10099');
  const r = C.construir({
    items: [item({ pedido: 'A' }), item({ pedido: 'B' }), item({ pedido: 'C', transportadora: '4' })],
    sc5PorPedido: new Map([['A', '000002']])
  }, '2026-11-09', '2026-11-09');
  const nomes = r.abas[1].linhas.slice(1).map(l => l[12]);
  assert.deepEqual(nomes, ['Brasil', '(não definida)', 'Retira 01']);
});

test('ranking traz os 10 itens com mais peças por armazém, com o nome da planilha de descrição', () => {
  const itens = [];
  for (let i = 0; i < 12; i++) itens.push(item({ pedido: 'P' + i, produto: 'X' + i, qt: i + 1 }));
  const r = C.construir({ items: itens, itemNames: new Map([['X11', 'Item onze']]) }, '2026-11-09', '2026-11-09');
  const rk = r.abas[2].linhas;
  assert.equal(rk.length, 11);
  assert.deepEqual(rk[1], ['Cambuci', 1, 'X11', 'Item onze', 12]);
  assert.equal(rk[2][3], '(sem descrição)');
});

test('as quatro abas, tendência diária, semanas dentro do mês e nome do arquivo', () => {
  const itens = [3, 4, 5, 6, 9, 10, 11, 12, 17].map(n => item({ pedido: 'P' + n, dt: d('2026-11-' + String(n).padStart(2, '0')) }));
  const r = C.construir({ items: itens, entregaCounts: new Map() }, '2026-11-01', '2026-11-30');
  assert.deepEqual(r.abas.map(a => a.nome), ['Dashboard', 'Base de Dados', 'Ranking Itens por Armazém', 'Por Transportadora']);
  assert.ok(r.abas[0].linhas.some(l => l[0] === 'POR SEMANA'));
  assert.equal(C.nomeArquivo('2026-11-09', '2026-11-13', 'semana'), 'Consolidado_Cambuci_09a13Nov2026.xlsx');
  assert.equal(C.nomeArquivo('2026-11-03', '2026-11-17', 'mes'), 'Consolidado_Cambuci_Novembro2026.xlsx');
  assert.throws(() => C.construir({ items: itens }, '2026-12-01', '2026-12-31'), /Não há pedidos/);
  assert.throws(() => C.construir({}, '2026-11-01', '2026-11-30'), /Carregue a base SC9/);
});

test('sem a aba Entrega o Cambuci é classificado só pela nota e o aviso aparece', () => {
  const r = C.construir({ items: [item({ nf: '5' }), item({ pedido: 'P2' })] }, '2026-11-09', '2026-11-13');
  assert.equal(r.resumo.enviados, 1);
  assert.equal(r.avisos.length, 1);
});

test('monta o livro com as quatro abas, larguras e filtro na Base de Dados', () => {
  const abas = [];
  const X = { utils: { book_new: () => ({ abas }), aoa_to_sheet: linhas => ({ linhas, '!ref': 'A1:M2' }), book_append_sheet: (livro, ws, nome) => abas.push({ nome, ws }) } };
  const r = C.construir({ items: [item({ nf: '5' })], entregaCounts: new Map([['P1', 1]]) }, '2026-11-09', '2026-11-09');
  C.paraPlanilha(r, X);
  assert.deepEqual(abas.map(a => a.nome), ['Dashboard', 'Base de Dados', 'Ranking Itens por Armazém', 'Por Transportadora']);
  assert.ok(abas[1].ws['!autofilter'] && abas[1].ws['!cols'].length === 13);
  assert.equal(abas[1].ws.linhas[1][1].z, 'dd/mm/yyyy');
});

test('o painel mostra o botão Consolidado antes do Relatório Geral e as datas numéricas do Protheus são lidas', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'bundle.js'), 'utf8');
  assert.ok(bundle.includes('window.SC9Consolidado.button({data:p}),React.createElement("button",{onClick:()=>Mc({scopeLabel:ye,'));
  assert.ok(bundle.includes('function Co(t,a){typeof t=="number"&&t>2e4&&t<8e4&&(t=new Date(Math.round((t-25569)*864e5))),t instanceof Date&&(t=no(t))'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('/consolidado.js') > 0 && html.indexOf('/consolidado-ui.js') > html.indexOf('/consolidado.js') && html.indexOf('/consolidado-ui.js') < html.indexOf('/bundle.js'));
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /SERVABLE\.add\("consolidado\.js"\);\r?\nSERVABLE\.add\("consolidado-ui\.js"\);/);
});
