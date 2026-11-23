const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../atraso-historico-xlsx.js');
const ExcelJS = require('../vendor-exceljs.js');
const JSZip = require('../vendor-jszip.js');

// pedido, armazém, liberado em, peças, tipo, situação, dias, transportadora
const it = (p, arm, tipo, pecas, dias, transp, extra) => [p, arm, '2026-11-10', pecas, tipo, 'A', dias, transp || 'TCS'].concat(extra ? [extra] : []);
const CLI = { n: 'FUNDACAO EXEMPLO', c: '1', nf: '884285', v: 1234.5, e: 'D' };
const dia = (d, total, itens) => ({ dia: d, total, pecas: total * 5, atualizadoEm: d + 'T20:00:00Z', itens });
const meses = () => ({
  '2026-10': { dias: { '2026-10-30': dia('2026-10-30', 100, [it('A1', 'Cambuci', 'E', 5, 3), it('A2', 'BH', 'E', 2, 9)]) } },
  '2026-11': { dias: {
    '2026-11-03': dia('2026-11-03', 110, [it('A1', 'Cambuci', 'E', 5, 7), it('A3', 'RJ', 'F', 8, 1, 'Brasil'), it('A4', 'Cambuci', 'E', 1, 1)]),
    '2026-11-04': dia('2026-11-04', 120, [it('A1', 'Cambuci', 'F', 5, 8, 'TCS', CLI), it('A5', 'Cambuci', 'E', 4, 2)])
  } }
});

test('comparativo: saíram, continuam e entraram, atravessando a virada do mês', () => {
  const a = H.analisar(meses());
  assert.deepEqual(a.map(x => x.reg.dia), ['2026-10-30', '2026-11-03', '2026-11-04']);
  assert.equal(a[0].cmp, null, 'primeiro dia gravado não tem comparação');
  const d3 = a[1].cmp, d4 = a[2].cmp;
  assert.equal(d3.ant.dia, '2026-10-30', 'o dia anterior de 03/11 é o último de outubro');
  assert.deepEqual([d3.saiu.map(x => x[0]), d3.continuam.map(x => x[0]), d3.novos.map(x => x[0])], [['A2'], ['A1'], ['A3', 'A4']]);
  assert.deepEqual([d4.saiu.map(x => x[0]), d4.continuam.map(x => x[0]), d4.novos.map(x => x[0]), d4.mudou.map(x => x[0])], [['A3', 'A4'], ['A1'], ['A5'], ['A1']]);
  assert.match(H.frase(a[0]), /Primeiro dia gravado/);
  assert.equal(H.frase(a[2]), 'Melhorou: 1 pedido a menos em atraso que em 03/11 (3 → 2). 2 saíram do atraso, 1 continua e 1 entrou. 1 passou de Estoque para Faturamento.');
  assert.match(H.frase(a[1]), /^Piorou: 1 pedido a mais em atraso que em 30\/10 \(2 → 3\)\. 1 saiu do atraso, 1 continua e 2 entraram\.$/);
});

test('Excel do histórico: resumo do mês + uma aba por dia, com peças, transportadora e comparativo', async () => {
  const bytes = await H.gerar(meses(), '2026-11', { subtitulo: 'Gerado em teste' }, { ExcelJS, JSZip });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(bytes));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Resumo do Mês', '04-11-2026', '03-11-2026'], 'dia mais recente logo depois do resumo; só dias do mês pedido');

  const res = wb.getWorksheet('Resumo do Mês');
  assert.match(String(res.getCell('A1').value), /NOVEMBRO\/2026/);
  assert.equal(res.getCell('A6').value, 2, 'cartão: em atraso no último dia');
  assert.equal(res.getCell('G6').value, 2, 'cartão: saíram');
  assert.equal(res.getCell('I6').value, 1, 'cartão: entraram');
  const linhas = []; res.eachRow((row, n) => { if (n >= 29 && row.getCell(2).value) linhas.push(row); });
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].getCell(3).value, 2, 'atraso de estoque em 03/11');
  assert.equal(linhas[0].getCell(5).value, 2 / 110, '% estoque = pedidos em atraso ÷ pedidos da base');
  assert.equal(linhas[1].getCell(6).value, 1); assert.equal(linhas[1].getCell(12).value, 1); assert.equal(linhas[1].getCell(13).value, 2);
  assert.match(String(linhas[1].getCell(15).value), /^Melhorou: 1 pedido a menos/);

  const d4 = wb.getWorksheet('04-11-2026');
  assert.match(String(d4.getCell('A1').value), /ATRASO DO DIA — 04\/11\/2026/);
  assert.match(String(d4.getCell('A9').value), /COMPARATIVO COM 03\/11\/2026/);
  assert.match(String(d4.getCell('A10').value), /^Melhorou/);
  const todas = []; d4.eachRow(row => todas.push([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(c => row.getCell(c).value)));
  const a1 = todas.find(l => l[0] === 'A1'), a5 = todas.find(l => l[0] === 'A5');
  assert.deepEqual([a1[5], a1[6], a1[7], a1[12]], [5, 'TCS', 'Faturamento', 'Passou de Estoque p/ Faturamento']);
  assert.deepEqual([a1[1], a1[9], a1[10], a1[11]], ['FUNDACAO EXEMPLO', 'Despacho (já tem nota)', '884285', 1234.5], 'cliente, etapa, nota e valor');
  assert.deepEqual([a5[1], a5[5], a5[12]], ['-', 4, 'Novo (não estava em 03/11)'], 'sem dados do cliente aparece como traço');
  const saiu = []; d4.eachRow(row => { if (['A3', 'A4'].includes(row.getCell(15).value)) saiu.push([row.getCell(15).value, row.getCell(18).value, row.getCell(19).value]); });
  assert.deepEqual(saiu, [['A4', 1, 'TCS'], ['A3', 8, 'Brasil']], 'saíram do atraso, com peças e transportadora');

  const d3 = wb.getWorksheet('03-11-2026');
  assert.match(String(d3.getCell('A9').value), /COMPARATIVO COM 30\/10\/2026/, 'o comparativo cruza o mês');

  const zip = await JSZip.loadAsync(bytes);
  assert.equal(((await zip.file('[Content_Types].xml').async('string')).match(/chart\+xml/g) || []).length, 2);
});

test('primeiro dia gravado sai sem comparativo e mês sem dias dá erro claro', async () => {
  const so = { '2026-11': { dias: { '2026-11-23': dia('2026-11-23', 50, [it('Z1', 'Cambuci', 'E', 3, 1)]) } } };
  const bytes = await H.gerar(so, '2026-11', {}, { ExcelJS, JSZip });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(bytes));
  const d = wb.getWorksheet('23-11-2026');
  assert.equal(d.getCell('A9').value, 'COMPARATIVO');
  assert.match(String(d.getCell('A10').value), /Primeiro dia gravado/);
  await assert.rejects(() => H.gerar(so, '2026-09', {}, { ExcelJS, JSZip }), /Não há dias gravados em 2026-09/);
  await assert.rejects(() => H.gerar(so, '2026-11', {}, {}), /bibliotecas/);
});

test('aviso "sem dia anterior" não cobre a primeira linha da lista de pedidos', async () => {
  const so = { '2026-11': { dias: { '2026-11-03': dia('2026-11-03', 10, [it('Z1', 'Cambuci', 'E', 3, 2, 'TCS', { n: 'CLIENTE Z' })]) } } };
  const bytes = await H.gerar(so, '2026-11', {}, { ExcelJS, JSZip });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(bytes));
  const ws = wb.getWorksheet('03-11-2026');
  let linha = null; ws.eachRow(row => { if (row.getCell(1).value === 'Z1') linha = row; });
  assert.ok(linha, 'o pedido Z1 continua na lista');
  assert.equal(linha.getCell(2).value, 'CLIENTE Z');
  assert.match(String(linha.getCell(15).value), /^Sem dia anterior gravado/);
});
