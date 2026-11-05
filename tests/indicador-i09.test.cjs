'use strict';
// Modelo do indicador I 09 (OM e OS do almoxarifado). Só dados sintéticos.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../indicador-i09.js');

const CAB = ['Filial', 'Numero da OP', 'Item', 'Sequencia', 'Produto', 'DESCR. PROD', 'Quantidade', 'Mod. OP', 'DT Emissao', 'DT Real Fim', 'Qtd.Produzid', 'Perda', 'Armazem'];
// l(op, seq, produto, quantidade, mod, emissão, real fim, produzida, perda)
const l = (op, seq, prod, qtd, mod, emi, fim, prd, perda, item) => ['01', op, item || '01', seq, prod, 'Produto ' + prod, qtd, mod, emi, fim, prd, perda, '18'];
const sc2 = (linhas) => [['Relatório'], [''], CAB, ...linhas];
const MONT = 'Montagem Produto Acabado', RETR = 'Serviço Retrabalho', COMP = 'Servico de Componente', INTER = 'Serviço intermediario', SEMI = 'Serviço Semi-Acabado';

test('lerSC2: guarda só OM/OS com Real Fim, sem linha repetida', () => {
  const r = M.lerSC2(sc2([
    l('1', '001', 'P1', 100, MONT, '2026-10-01', '2026-10-05', 98, 2),
    l('1', '001', 'P1', 100, MONT, '2026-10-01', '2026-10-05', 98, 2), // repetida
    l('1', '002', 'P1', 100, MONT, '2026-10-01', '2026-10-06', 98, 2), // outra sequência: continua guardada (OS conta qualquer uma)
    l('2', '001', 'P2', 50, 'Outro modo', '2026-10-01', '2026-10-05', 50, 0), // fora de OM e OS
    l('3', '001', 'P3', 30, COMP, '2026-10-02', '', 0, 0), // sem Real Fim
    l('4', '001', 'P4', 40, SEMI, '2026-09-20', '2026-11-02', 40, 0),
    l('5', '001', 'P5', 10, '4', '2026-09-20', '2026-11-02', 10, 0),
  ]));
  assert.ok(!r.erro);
  assert.strictEqual(r.rows.length, 4);
  assert.strictEqual(r.resumo.semRealFim, 1);
  assert.strictEqual(r.resumo.repetidas, 1);
  assert.deepStrictEqual(Object.keys(M.porMes(r.rows)).sort(), ['2026-10', '2026-11']);
  assert.deepStrictEqual(r.rows[0].slice(0, 2), ['1', '001']);
  assert.strictEqual(r.rows[0][8], 98); // Qtd.Produzid
});
test('lerSC2: erros claros', () => {
  assert.match(M.lerSC2([]).erro, /./);
  assert.match(M.lerSC2([['a', 'b'], ['1', '2']]).erro, /SC2/);
  assert.match(M.lerSC2([['Numero da OP', 'Produto']]).erro, /faltam colunas/);
});
test('toISO aceita dd/mm/aaaa, ISO e data do Excel', () => {
  assert.strictEqual(M.toISO('04/11/2026'), '2026-11-04');
  assert.strictEqual(M.toISO('2026-11-04'), '2026-11-04');
  assert.strictEqual(M.toISO(46330), '2026-11-04');
  assert.ok(!M.toISO('lixo'));
});
test('listas de apoio: Type Korea (primeira ocorrência vale) e Não considera', () => {
  const t = M.lerTipos([['CODIGOS', 'DESCRIÇÃO', 'TIPO', 'CLASSIFICACAO'], [2271, 'x', 'PA', 'ABUTMENT'], ['2271', 'x', 'PA', 'TOOL'], ['IP1', 'y', '', '-']]);
  assert.deepStrictEqual(t.tipos, { 2271: 'ABUTMENT', IP1: '-' });
  assert.match(M.lerTipos([['a']]).erro, /CODIGOS/);
  assert.deepStrictEqual(M.lerNaoConsidera([['Produto', 'Descrição'], [21454, 'a'], ['30702', 'b'], [21454, 'c']]).codigos, ['21454', '30702']);
});

const CFG = {
  metas: { om: { '2026-10': 1000 }, os: { '2026-10': 2000 } }, feriados: ['2026-10-12'],
  tipos: { A: 'ABUTMENT', B: 'TOOL', C: '-' }, naoConsidera: ['N1'],
};
const L = (op, seq, prod, qtd, mod, fim, prd, perda) => [op, seq, prod, 'Produto ' + prod, mod, '2026-10-01', fim, qtd, prd, perda, '18'];
const ROWS = [
  L('1', '001', 'A', 110, MONT, '2026-10-05', 100, 10),   // OM, ABUTMENT
  L('1', '002', 'A', 110, MONT, '2026-10-06', 100, 10),   // OM não conta sequência 2
  L('2', '001', 'B', 50, RETR, '2026-10-05', 50, 0),      // OM, retrabalho
  L('3', '001', 'A', 300, COMP, '2026-10-05', 280, 20),   // OS usinado
  L('3', '002', 'A', 300, COMP, '2026-10-06', 290, 10),   // OS qualquer sequência
  L('4', '001', 'N1', 500, COMP, '2026-10-05', 500, 0),   // OS em Não considera: fora
  L('5', '001', 'C', 70, INTER, '2026-10-07', 60, 10),    // OS sem tipo
  L('6', '001', 'B', 40, SEMI, '2026-10-20', 40, 0),      // OS
  L('7', '001', 'A', 99, 'Outro', '2026-10-05', 99, 0),   // nenhum
];
test('classificar: OM = montagem/retrabalho na sequência 1; OS = serviços usinados em qualquer sequência', () => {
  const calc = M.calcularMes('2026-10', ROWS, CFG);
  assert.strictEqual(calc.om.real, 150);       // 100 + 50
  assert.strictEqual(calc.om.ops, 2);
  assert.strictEqual(calc.os.real, 280 + 290 + 60 + 40); // sem N1
  assert.strictEqual(calc.os.ops, 4);
  assert.strictEqual(calc.fora['OS: produto em Não considera'], 500);
  assert.strictEqual(calc.fora['OM: sequência diferente de 01'], 100);
});
test('calcularMes: meta, %, saldo, perda e tipos', () => {
  const c = M.calcularMes('2026-10', ROWS, CFG);
  assert.strictEqual(c.om.meta, 1000); assert.strictEqual(c.om.pct, 0.15); assert.strictEqual(c.om.saldo, -850);
  assert.strictEqual(c.om.situacao, 'Abaixo da meta do BSC');
  assert.strictEqual(c.om.enviado, 160); assert.strictEqual(c.om.perda, 10);
  assert.ok(Math.abs(c.om.perdaPct - 10 / 160) < 1e-9);
  const tipo = (t) => c.porTipo.find((x) => x.tipo === t);
  assert.strictEqual(tipo('ABUTMENT').om.q, 100); assert.strictEqual(tipo('TOOL').om.q, 50);
  assert.strictEqual(tipo('ABUTMENT').os.q, 570);
  assert.strictEqual(tipo('(sem tipo)').os.q, 60);
  assert.strictEqual(c.total.real, c.om.real + c.os.real);
  assert.strictEqual(c.total.meta, 3000);
});
test('calcularMes: dias úteis, meta por dia, acumulado, mês parcial e % acumulado', () => {
  const c = M.calcularMes('2026-10', ROWS, Object.assign({}, CFG, { ate: '2026-10-07' }));
  assert.strictEqual(c.diasUteis, 21);          // 22 dias de semana menos o feriado de 12/10
  assert.strictEqual(c.parcial, true);
  assert.strictEqual(c.uteisDecorridos, 5);
  assert.ok(Math.abs(c.om.metaDia - 1000 / 21) < 1e-9);
  const d5 = c.om.diario[4]; // 05/10
  assert.strictEqual(d5.q, 150); assert.strictEqual(d5.n, 2); assert.strictEqual(d5.acc, 150);
  assert.ok(Math.abs(d5.metaAcc - (1000 / 21) * 3) < 1e-9); // 01/10 é quinta: 01, 02, 05
  assert.strictEqual(c.om.diario[7].acc, null);  // depois da extração
  assert.strictEqual(c.om.diario[11].util, false); // feriado
  assert.ok(c.om.pctRitmo > 0);
});
test('sem meta: não calcula % da meta', () => {
  const c = M.calcularMes('2026-10', ROWS, { feriados: [], tipos: {}, naoConsidera: [] });
  assert.strictEqual(c.om.pct, null); assert.strictEqual(c.om.situacao, 'Sem meta lançada'); assert.strictEqual(c.total.pct, null);
});
test('base: substituir só o mês enviado e calcular todos', () => {
  let base = M.substituirMeses(null, { '2026-09': [L('9', '001', 'A', 10, MONT, '2026-09-10', 10, 0)] }, { ate: '2026-10-01' });
  base = M.substituirMeses(base, { '2026-10': ROWS }, { ate: '2026-10-31' });
  assert.deepStrictEqual(Object.keys(base.meses), ['2026-09', '2026-10']);
  base = M.substituirMeses(base, { '2026-10': ROWS.slice(0, 3) }, {});
  assert.strictEqual(base.meses['2026-09'].rows.length, 1);
  const calc = M.calcularBase(base, CFG);
  assert.strictEqual(calc['2026-09'].om.real, 10);
  assert.strictEqual(calc['2026-10'].os.real, 0);
});
test('validarLinhas: mês e quantidades', () => {
  assert.strictEqual(M.validarLinhas('2026-10', ROWS), '');
  assert.match(M.validarLinhas('2026-11', ROWS), /fora do mês/);
  assert.match(M.validarLinhas('x', ROWS), /mês/);
  assert.match(M.validarLinhas('2026-10', [['1']]), /linha inválida/);
});
test('abasRelatorio: dashboard compacto, mês a mês, por tipo e por dia', () => {
  const base = M.substituirMeses(null, { '2026-10': ROWS }, { ate: '2026-10-08' });
  const abas = M.abasRelatorio(base, CFG);
  assert.deepStrictEqual(abas.map((a) => a.name), ['I09 Dashboard', 'I09 Mês a mês', 'I09 Por tipo', 'I09 Por dia']);
  const dash = abas[0].rows;
  const real = dash.find((r) => r['Indicador'] === 'Real (peças)');
  assert.strictEqual(real['OM (separa)'], 150); assert.strictEqual(real['OS (estoca)'], 670); assert.strictEqual(real['OM + OS'], 820);
  assert.strictEqual(dash.find((r) => r['Indicador'] === '% da meta')['OM (separa)'], 0.15); // fração: o Excel mostra 15,0%
  const z = abas[0].z, linhaPct = dash.find((r) => r['Indicador'] === '% da meta'), linhaReal = dash.find((r) => r['Indicador'] === 'Real (peças)');
  assert.strictEqual(z(linhaPct, 'OM (separa)'), '0.0%'); assert.strictEqual(z(linhaReal, 'OM (separa)'), '#,##0');
  assert.strictEqual(z(dash.find((r) => r['Indicador'] === '% de perda (perda ÷ enviado)'), 'OS (estoca)'), '0.00%');
  assert.strictEqual(abas[1].z(abas[1].rows[0], '% de perda'), '0.00%'); assert.strictEqual(abas[1].z(abas[1].rows[0], 'Real (peças)'), '#,##0');
  assert.strictEqual(abas[1].rows.length, 2);
  assert.strictEqual(abas[3].rows.length, 8); // até 08/10
  assert.deepStrictEqual(M.abasRelatorio({ meses: {} }, CFG), []);
});
