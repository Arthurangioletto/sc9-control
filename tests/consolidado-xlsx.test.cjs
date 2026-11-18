const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../consolidado.js');
const X = require('../consolidado-xlsx.js');
const ExcelJS = require('../vendor-exceljs.js');
const JSZip = require('../vendor-jszip.js');

const d = s => new Date(s + 'T00:00:00Z');
const item = (o) => ({ armazem: 'Cambuci', pedido: 'P1', produto: 'A', qt: 1, dt: d('2026-11-09'), nf: null, nome: 'Cliente', cliente: 'C1', separador: '', conferente: '', ...o });

function semana() {
  const itens = [];
  const dias = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
  dias.forEach((dia, i) => {
    for (let k = 0; k < 3 + i; k++) itens.push(item({ pedido: 'C' + i + k, dt: d(dia), qt: 2 + k, produto: 'A' + (k % 2) }));
    itens.push(item({ pedido: 'B' + i, armazem: 'BH', dt: d(dia), nf: String(100 + i), qt: 5 }));
  });
  const entrega = new Map(); itens.filter(x => x.armazem === 'Cambuci' && !x.pedido.endsWith('0')).forEach(x => entrega.set(x.pedido, 1));
  return { items: itens, entregaCounts: entrega, itemNames: new Map([['A0', 'PARAFUSO'], ['A1', 'CONE']]) };
}
const gerar = async (data, de, ate) => { const r = C.construir(data, de, ate); const bytes = await X.gerar(r, { ExcelJS, JSZip }); return { r, bytes }; };

test('dados estruturados batem com as abas simples (mesmos números do Excel de sempre)', () => {
  const r = C.construir(semana(), '2026-11-09', '2026-11-13');
  const dash = r.abas[0].linhas, dd = r.dados;
  assert.equal(dd.kpis[0].valor, dash[5][0].v);
  assert.equal(dd.kpis[1].valor, dash[5][1].v);
  assert.equal(dd.kpis[2].valor, dash[5][2].v);
  assert.equal(dd.dias.length, 5);
  assert.equal(dd.base.length, r.abas[1].linhas.length - 1);
  assert.equal(dd.totalGeral.total, r.pedidos);
  assert.equal(dd.armazens.reduce((s, a) => s + a.total, 0), r.pedidos);
  assert.equal(dd.dias.reduce((s, x) => s + x.pedidos, 0), r.pedidos);
  assert.equal(dd.transportadoras.reduce((s, t) => s + t.pedidos, 0), r.pedidos);
  assert.deepEqual(r.abas.map(a => a.nome), ['Dashboard', 'Base de Dados', 'Ranking Itens por Armazém', 'Por Transportadora']);
});

test('Excel formatado: quatro abas, cartões, tabelas e base com os mesmos números', async () => {
  const { r, bytes } = await gerar(semana(), '2026-11-09', '2026-11-13');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(bytes));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Dashboard', 'Base de Dados', 'Ranking Itens por Armazém', 'Por Transportadora']);
  const ws = wb.getWorksheet('Dashboard');
  assert.match(ws.getCell('A1').value, /CONFERÊNCIA SC9 — CONSOLIDADO CAMBUCI \+ FILIAIS — 09\/11 A 13\/11\/2026/);
  assert.equal(ws.getCell('A1').fill.fgColor.argb, 'FF1E2761');
  assert.equal(ws.getCell('A6').value, r.dados.kpis[0].valor);
  assert.equal(ws.getCell('A5').value, 'Pedidos (Combinado)');
  assert.equal(ws.getCell('H18').value, r.dados.armazens[0].pct);
  assert.equal(ws.getCell('A23').value, 'Total Geral');
  assert.equal(ws.getCell('A29').value, '09/11/2026'); assert.equal(ws.getCell('B29').value, r.dados.dias[0].pedidos);
  const base = wb.getWorksheet('Base de Dados');
  assert.equal(base.getCell('A4').value, 'Armazém'); assert.equal(base.rowCount, 4 + r.pedidos);
  assert.ok(base.getCell('B5').value instanceof Date); assert.equal(base.getCell('B5').value.toISOString().slice(0, 10), '2026-11-09');
  assert.equal(base.views[0].state, 'frozen'); assert.equal(base.views[0].ySplit, 4);
  const rk = wb.getWorksheet('Ranking Itens por Armazém');
  assert.equal(rk.getCell('A3').value, 'Cambuci'); assert.equal(rk.getCell('F3').value, 'BH'); assert.equal(rk.getCell('C5').value, 'PARAFUSO');
  const tr = wb.getWorksheet('Por Transportadora');
  assert.equal(tr.getCell('A4').value, 'Transportadora'); assert.equal(tr.getCell('A5').value, '(não definida)');
});

test('Excel formatado traz os dois gráficos do Excel apontando para as linhas certas, sem sobrepor os cartões do rodapé', async () => {
  const { r, bytes } = await gerar(semana(), '2026-11-09', '2026-11-13');
  const zip = await JSZip.loadAsync(bytes);
  for (const f of ['xl/charts/chart1.xml', 'xl/charts/chart2.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels', 'xl/worksheets/_rels/sheet1.xml.rels']) assert.ok(zip.file(f), f);
  const tipos = await zip.file('[Content_Types].xml').async('string');
  assert.match(tipos, /\/xl\/charts\/chart1\.xml/); assert.match(tipos, /\/xl\/drawings\/drawing1\.xml/);
  const c1 = await zip.file('xl/charts/chart1.xml').async('string'), c2 = await zip.file('xl/charts/chart2.xml').async('string');
  assert.match(c1, /<c:barChart>/); assert.match(c1, /grouping val="stacked"/);
  assert.match(c1, /'Dashboard'!\$A\$29:\$A\$33/); assert.match(c1, /'Dashboard'!\$C\$29:\$C\$33/); assert.match(c1, /'Dashboard'!\$E\$29:\$E\$33/);
  assert.equal((c2.match(/<c:lineChart>/g) || []).length, 2); // Pedidos (eixo esquerdo) e Peças (eixo direito)
  assert.match(c2, /<c:crosses val="max"\/>/);
  const mesa = /'Dashboard'!\$A\$(\d+):\$A\$(\d+)/.exec(c2);
  assert.equal(+mesa[2] - +mesa[1] + 1, r.dados.dias.length);
  const aba = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.ok(aba.indexOf('<drawing ') > aba.indexOf('<pageSetup'), 'drawing vem depois de pageSetup');
  assert.match(aba, /<cfRule type="dataBar"/); assert.doesNotMatch(aba, /x14:id\/>/); // barras de % enviado, sem bloco de extensão incompleto
  // o resumo "Dia a dia" começa depois do fim do gráfico de tendência (ancorado numa linha + ~15 linhas de altura)
  const desenho = await zip.file('xl/drawings/drawing1.xml').async('string');
  const linhas = [...desenho.matchAll(/<xdr:row>(\d+)<\/xdr:row>/g)].map(m => +m[1]);
  assert.equal(linhas.length, 2);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(bytes));
  let linhaResumo = 0; wb.getWorksheet('Dashboard').eachRow((row, n) => { if (row.getCell(1).value && /^Dia a dia/.test(String(row.getCell(1).value))) linhaResumo = n; });
  assert.ok(linhaResumo > linhas[1] + 15, 'resumo (linha ' + linhaResumo + ') abaixo do gráfico que termina perto da linha ' + (linhas[1] + 15));
});

test('recorte de mês: cartões dia a dia em linhas de 5, tabela por semana e variação de peças', async () => {
  const itens = [];
  for (let dia = 2; dia <= 20; dia++) { const s = '2026-11-' + String(dia).padStart(2, '0'); if ([0, 6].includes(d(s).getUTCDay())) continue; for (let k = 0; k < 3; k++) itens.push(item({ pedido: 'M' + dia + k, dt: d(s), qt: dia })); }
  const { r, bytes } = await gerar({ items: itens, entregaCounts: new Map() }, '2026-11-02', '2026-11-20');
  assert.ok(r.dados.semanas.length >= 3);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(bytes));
  const ws = wb.getWorksheet('Dashboard');
  let achouSemana = false, achouTile = false;
  ws.eachRow(row => row.eachCell(c => { if (c.value === 'POR SEMANA') achouSemana = true; if (c.value && c.value.richText && /▲|▼/.test(JSON.stringify(c.value.richText))) achouTile = true; }));
  assert.ok(achouSemana, 'tabela por semana'); assert.ok(achouTile, 'variação de peças vs. dia anterior');
});

test('sem as bibliotecas ou sem os dados estruturados, avisa em vez de gerar arquivo quebrado', async () => {
  await assert.rejects(() => X.gerar({}, { ExcelJS, JSZip }), /dados estruturados/);
  await assert.rejects(() => X.gerar(C.construir(semana(), '2026-11-09', '2026-11-13'), {}), /bibliotecas/);
});
