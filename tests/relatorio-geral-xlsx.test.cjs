const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../atraso-historico.js');
const X = require('../relatorio-geral-xlsx.js');
const ExcelJS = require('../vendor-exceljs.js');
const JSZip = require('../vendor-jszip.js');

const d = s => new Date(s + 'T12:00:00Z');
const agora = d('2026-11-23');
const ped = (o) => ({ armazem: 'Cambuci', pedido: 'P1', qt: 4, dt: d('2026-11-18'), dayKey: '2026-11-18', nf: null, status: 'Pendente', separador: '', conferente: '', pickEnd: null, confEnd: null, ...o });

const abasDoPainel = () => ([
  { name: 'Resumo', rows: [{ Indicador: 'Recorte', Valor: 'Todos os armazéns' }, { Indicador: 'Data de corte', Valor: '2026-11-23' }, { Indicador: 'Pedidos', Valor: 120 }, { Indicador: 'Peças Liberadas', Valor: 900 }, { Indicador: 'Enviados', Valor: 100 }, { Indicador: '% Enviados', Valor: '83.3%' }, { Indicador: 'Atrasados', Valor: 8 }, { Indicador: 'Em Processo', Valor: 12 }, { Indicador: 'Atraso Faturamento (já conferido, só falta nota)', Valor: 5 }] },
  { name: 'Por Armazém', rows: [{ Armazém: 'Cambuci', 'Total Pedidos': 100, Atrasados: 6, '% Enviado': '84.0%', '% Atrasado (estoque)': '6.0%' }, { Armazém: 'BH', 'Total Pedidos': 20, Atrasados: 2, '% Enviado': '80.0%', '% Atrasado (estoque)': '10.0%' }, { Armazém: 'Total Geral', 'Total Pedidos': 120, Atrasados: 8, '% Enviado': '83.3%', '% Atrasado (estoque)': '6.7%' }] },
  { name: 'Tendência Diária', rows: [{ Dia: '2026-11-20', 'Total Pedidos': 40, 'Atrasados (estoque)': 3, '% Em Dia': '92.5%', '% Atrasado': '7.5%' }, { Dia: '2026-11-21', 'Total Pedidos': 30, 'Atrasados (estoque)': 1, '% Em Dia': '96.7%', '% Atrasado': '3.3%' }] },
  { name: 'Alertas', rows: [{ Tipo: 'Atraso', Nível: 'Crítico', Mensagem: 'Pedido P1 parado há 9 dias' }] }
]);

const reg = (dia, e, f) => ({ dia, total: 100, pecas: 800, atualizadoEm: 'x', itens: [].concat(
  Array.from({ length: e }, (_, i) => ['E' + i, 'Cambuci', '2026-11-10', 5, 'E', 'A', 7]),
  Array.from({ length: f }, (_, i) => ['F' + i, 'BH', '2026-11-12', 3, 'F', i % 2 ? 'P' : 'A', 2])) });

test('servidor: normaliza o registro, rejeita dia ruim e troca só o dia gravado', () => {
  const r = H.normalizarRegistro({ dia: '2026-11-23', total: 50, pecas: 10, itens: [['P1', 'Cambuci', '2026-11-20', 3, 'E', 'A', 3], ['P1', 'Cambuci', '2026-11-20', 3, 'E', 'A', 3], ['P2', 'BH', 'lixo', 2, 'F', 'P', 1], ['P3', 'BH', '', 1, 'X', 'A', 1], 'ruim'] });
  assert.equal(r.itens.length, 2, 'repetido, tipo inválido e linha fora do formato saem');
  assert.equal(r.itens[1][2], '', 'liberado em inválido vira vazio');
  assert.throws(() => H.normalizarRegistro({ dia: '2026-13-40', total: 1, itens: [] }), /Dia inválido/);
  assert.throws(() => H.normalizarRegistro({ dia: '2026-11-23', total: 0, itens: [] }), /nenhum pedido|pedidos/i);
  assert.throws(() => H.normalizarRegistro({ dia: '2026-11-23', total: 3 }), /lista/i);
  let mes = H.mesclarDia(null, H.normalizarRegistro({ dia: '2026-11-22', total: 10, itens: [['A', 'X', '', 1, 'E', 'A', 1]] }));
  mes = H.mesclarDia(mes, H.normalizarRegistro({ dia: '2026-11-23', total: 11, itens: [] }));
  mes = H.mesclarDia(mes, H.normalizarRegistro({ dia: '2026-11-22', total: 12, itens: [['B', 'X', '', 1, 'F', 'A', 1]] }));
  assert.deepEqual(Object.keys(mes.dias), ['2026-11-22', '2026-11-23']);
  assert.equal(mes.dias['2026-11-22'].total, 12, 'o mesmo dia é trocado');
  assert.equal(mes.dias['2026-11-23'].total, 11, 'o outro dia continua');
  assert.equal(mes.mes, '2026-11');
  assert.deepEqual(H.ultimosMeses('2026-02', 4), ['2026-02', '2026-01', '2025-12', '2025-11']);
});

test('registro do dia: estoque só quando atrasado (com ou sem nota); faturamento também em processo, só sem nota', () => {
  const r = X.registroDoDia([
    ped({ pedido: 'E1', status: 'Atrasado' }),
    ped({ pedido: 'E2', status: 'Pendente' }),
    ped({ pedido: 'F1', status: 'Atrasado', separador: 'ANA', conferente: 'LUIZ' }),
    ped({ pedido: 'F2', status: 'Pendente', pickEnd: d('2026-11-22'), confEnd: d('2026-11-22'), armazem: 'Tambore' }),
    ped({ pedido: 'OK', status: 'Enviado' }),
    ped({ pedido: 'NF', status: 'Atrasado', nf: '123' })
  ], agora, '2026-11-23');
  assert.equal(r.total, 6);
  assert.deepEqual(r.itens.map(i => [i[0], i[4], i[5]]), [['E1', 'E', 'A'], ['F1', 'F', 'A'], ['F2', 'F', 'P'], ['NF', 'E', 'A']], 'atrasado já faturado e sem saída conta como estoque');
  assert.equal(r.itens[2][1], 'Tamboré');
  assert.equal(r.itens[0][6], 5, 'dias de atraso desde a liberação');
  assert.equal(H.normalizarRegistro(r).itens.length, 4, 'o servidor aceita o que o navegador manda');
});

test('Excel do Relatório Geral: abas do painel com formato novo e uma aba de histórico por mês', async () => {
  const meses = {
    '2026-11': { dias: { '2026-11-20': reg('2026-11-20', 3, 2), '2026-11-21': reg('2026-11-21', 1, 4) } },
    '2026-10': { dias: { '2026-10-30': reg('2026-10-30', 2, 0) } }
  };
  const bytes = await X.gerar(abasDoPainel(), { escopo: 'Todos os armazéns', subtitulo: 'Gerado em teste' }, meses, { ExcelJS, JSZip });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(bytes));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Resumo', 'Por Armazém', 'Tendência Diária', 'Alertas', 'Histórico de Atraso 11-2026', 'Histórico de Atraso 10-2026']);

  const resumo = wb.getWorksheet('Resumo');
  assert.match(String(resumo.getCell('A1').value), /RELATÓRIO GERAL SC9/);
  assert.equal(resumo.getCell('A5').value, 120, 'cartão de pedidos');
  assert.equal(resumo.getCell('I5').value, 8, 'cartão de atrasados');
  const indicadores = []; resumo.eachRow((row, n) => { if (n >= 11) indicadores.push(row.getCell(1).value); });
  assert.equal(indicadores.length, 9, 'todos os indicadores continuam na tabela');

  const arm = wb.getWorksheet('Por Armazém');
  assert.equal(arm.getCell('A4').value, 'Armazém');
  assert.equal(arm.getCell('D5').value, 0.84, 'porcentagem vira número com formato %');
  assert.equal(arm.getCell('D5').numFmt, '0.0%');
  assert.equal(arm.getCell('A7').value, 'Total Geral');
  assert.equal(wb.getWorksheet('Tendência Diária').getCell('A5').value, '20/11/2026');

  const h = wb.getWorksheet('Histórico de Atraso 11-2026');
  assert.match(String(h.getCell('A1').value), /NOVEMBRO\/2026/);
  assert.equal(h.getCell('A7').value, '20/11/2026');
  assert.equal(h.getCell('C7').value, 3); assert.equal(h.getCell('F7').value, 2);
  assert.equal(h.getCell('E7').value, 0.03, '% estoque = pedidos em atraso ÷ pedidos da base');
  assert.equal(h.getCell('H8').value, 0.04);
  assert.equal(h.getCell('A9').value, 'Média do mês');
  // lista dos pedidos: 5 + 5 linhas, cada uma com dia, pedido, peças e tipo
  const linhas = []; h.eachRow((row, n) => { if (/^\d\d\/\d\d\/\d{4}$/.test(String(row.getCell(1).value)) && row.getCell(2).value && typeof row.getCell(7).value === 'string') linhas.push(row); });
  assert.equal(linhas.length, 10);
  assert.ok(linhas.some(l => l.getCell(2).value === 'F0' && l.getCell(7).value === 'Faturamento'));
  assert.ok(linhas.some(l => l.getCell(2).value === 'E0' && l.getCell(7).value === 'Estoque' && l.getCell(6).value === 5));

  const zip = await JSZip.loadAsync(bytes);
  const tipos = await zip.file('[Content_Types].xml').async('string');
  assert.equal((tipos.match(/chart\+xml/g) || []).length, 3, 'gráfico da tendência + um por mês de histórico');
  const grafico = await zip.file('xl/charts/chart2.xml').async('string');
  assert.match(grafico, /Hist[^!]*Atraso 11-2026'!\$E\$7:\$E\$8/);
  assert.ok(!/<x14:id\/>/.test(await zip.file('xl/worksheets/sheet5.xml').async('string')));
});

test('sem histórico nem Tendência Diária o arquivo sai só com as abas do painel', async () => {
  const bytes = await X.gerar([abasDoPainel()[0]], { escopo: 'X' }, {}, { ExcelJS, JSZip });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(bytes));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Resumo']);
  await assert.rejects(() => X.gerar([], {}, {}, { ExcelJS, JSZip }), /abas/);
  await assert.rejects(() => X.gerar(abasDoPainel(), {}, {}, {}), /bibliotecas/);
});

test('histórico local: o dia de hoje entra sem apagar os anteriores', () => {
  const novo = X.mesclarLocal({ '2026-11': { dias: { '2026-11-20': reg('2026-11-20', 1, 1) } } }, reg('2026-11-23', 2, 2));
  assert.deepEqual(Object.keys(novo['2026-11'].dias), ['2026-11-20', '2026-11-23']);
  assert.deepEqual(Object.keys(X.mesclarLocal({}, reg('2026-12-01', 1, 0))), ['2026-12']);
});
