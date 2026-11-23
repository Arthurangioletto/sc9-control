/* Excel formatado do Relatório Geral: mesmo visual do Consolidado (faixa azul, cartões, tabelas com cabeçalho azul,
 * barras de % e gráficos de verdade do Excel) e, por mês, a aba "Histórico de Atraso" com os pedidos em atraso de
 * estoque e de faturamento, dia a dia. O histórico é guardado no servidor (/api/atraso-historico): cada exportação
 * grava só o dia de hoje e os dias anteriores continuam lá.
 * Recebe as abas que o painel já montava ([{ name, rows }]) e devolve os bytes do .xlsx.
 * ExcelJS monta células/estilos; JSZip só acrescenta barras de dados e gráficos (o ExcelJS não escreve gráficos). */
(function (root) {
  const COR = {
    navy: 'FF1E2761', navy2: 'FF141B4D', claro: 'FFF4F6FB', zebra: 'FFEFF2F9', borda: 'FFD5DAE6', mudo: 'FF5B6472',
    verde: 'FF00A896', vermelho: 'FFD64550', ambar: 'FFF2A93B', branco: 'FFFFFFFF', preto: 'FF000000', azul: 'FF4F63D2'
  };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const LARGURA_GRAFICO = 5400000, ALTURA_GRAFICO = 2700000; // EMU (15 cm × 7,5 cm)
  const LINHAS_GRAFICO = 15;

  const solido = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const fio = { style: 'thin', color: { argb: COR.borda } };
  const bordas = { top: fio, left: fio, bottom: fio, right: fio };
  const fonte = (sz, extra) => Object.assign({ name: 'Calibri', size: sz }, extra || {});
  const letra = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const ref = (c, r) => letra(c) + r;

  function faixa(ws, r, c1, c2, valor, estilo) {
    if (c2 > c1) ws.mergeCells(r, c1, r, c2);
    const cel = ws.getCell(r, c1);
    cel.value = valor;
    for (let c = c1; c <= c2; c++) { const x = ws.getCell(r, c); if (estilo.fill) x.fill = estilo.fill; }
    cel.font = estilo.font; cel.alignment = estilo.alignment || { vertical: 'middle' };
    return cel;
  }
  const banner = (ws, ate, texto, sub) => {
    ws.getRow(1).height = 28;
    faixa(ws, 1, 1, ate, texto, { fill: solido(COR.navy), font: fonte(16, { bold: true, color: { argb: COR.branco } }) });
    if (sub) faixa(ws, 2, 1, ate, sub, { font: fonte(9, { color: { argb: COR.mudo } }), alignment: { vertical: 'middle' } });
  };
  const secao = (ws, r, ate, texto) => faixa(ws, r, 1, ate, texto, { fill: solido(COR.navy), font: fonte(12, { bold: true, color: { argb: COR.branco } }) });
  const legenda = (ws, r, ate, texto) => faixa(ws, r, 1, ate, texto, { font: fonte(9, { color: { argb: COR.mudo } }), alignment: { vertical: 'middle', wrapText: true } });

  function cabecalho(ws, r, c0, rotulos) {
    rotulos.forEach((t, i) => {
      const cel = ws.getCell(r, c0 + i);
      cel.value = t; cel.fill = solido(COR.navy); cel.font = fonte(10, { bold: true, color: { argb: COR.branco } }); cel.border = bordas;
      cel.alignment = { horizontal: i === 0 ? 'left' : 'center', vertical: 'middle', wrapText: true };
    });
  }
  function celula(ws, r, c, valor, o) {
    o = o || {};
    const cel = ws.getCell(r, c);
    cel.value = valor;
    cel.font = fonte(o.sz || 11, { bold: !!o.negrito, color: { argb: o.cor || COR.preto } });
    if (o.fundo) cel.fill = solido(o.fundo);
    cel.border = bordas;
    if (o.fmt) cel.numFmt = o.fmt;
    cel.alignment = { horizontal: o.h || (typeof valor === 'number' ? 'right' : 'left'), vertical: 'middle' };
    return cel;
  }
  // Barras de dados: só registradas aqui; o XML é escrito em injetar(), porque o ExcelJS grava um bloco de extensão
  // incompleto para dataBar e o Excel pode pedir reparo do arquivo.
  const barras = (ws, intervalo, argb, max) => { (ws.__barras = ws.__barras || []).push({ ref: intervalo, cor: argb, max: max || 1 }); };

  /* ------------------------------ valores ------------------------------ */
  const PCT = /^(-?\d+(?:[.,]\d+)?)%$/;
  const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
  const brData = s => { const m = DIA_ISO.exec(s); return m ? m[3] + '/' + m[2] + '/' + m[1] : s; };
  // número, porcentagem (vira fração com formato %), data (vira dd/mm/aaaa) ou texto
  function converter(v) {
    if (v == null || v === '') return { v: '', tipo: 'txt' };
    if (typeof v === 'number') return { v, tipo: 'num' };
    if (v instanceof Date) return { v: ('0' + v.getDate()).slice(-2) + '/' + ('0' + (v.getMonth() + 1)).slice(-2) + '/' + v.getFullYear(), tipo: 'txt' };
    const s = String(v), m = PCT.exec(s);
    if (m) return { v: Number(m[1].replace(',', '.')) / 100, tipo: 'pct' };
    if (DIA_ISO.test(s)) return { v: brData(s), tipo: 'txt' };
    return { v: s, tipo: 'txt' };
  }
  const corNivel = n => (/cr[ií]tic|alt/i.test(n) ? COR.vermelho : /aten|alert|m[eé]d/i.test(n) ? 'FFB87708' : /risco|baix/i.test(n) ? COR.azul : COR.preto);

  /* ------------------------------ abas do painel ------------------------------ */
  const nomeAba = (nome, usados) => {
    let n = String(nome).replace(/[\\/*?:[\]]/g, ' ').slice(0, 31).trim() || 'Aba', k = 2, base = n;
    while (usados.has(n.toLowerCase())) n = base.slice(0, 28) + ' ' + k++;
    usados.add(n.toLowerCase());
    return n;
  };

  function montarResumo(wb, aba, ctx, usados) {
    const ws = wb.addWorksheet(nomeAba(aba.name, usados), { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    for (let c = 1; c <= 14; c++) ws.getColumn(c).width = 12.5;
    banner(ws, 14, 'RELATÓRIO GERAL SC9 — ' + String(ctx.escopo || 'Todos os armazéns').toUpperCase(), ctx.subtitulo);
    const por = {};
    aba.rows.forEach(l => { por[l.Indicador] = l.Valor; });
    const achar = re => { const k = Object.keys(por).find(x => re.test(x)); return k ? por[k] : undefined; };
    const cartoes = [
      ['Pedidos', achar(/^Pedidos$/), '#,##0', 'no recorte'],
      ['Peças Liberadas', achar(/^Peças Liberadas/), '#,##0', 'soma de Qt Liberada'],
      ['Enviados', achar(/^Enviados$/), '#,##0', 'pedidos que já saíram'],
      ['% Enviados', achar(/^% Enviados/), '0.0%', 'enviados ÷ pedidos'],
      ['Atrasados', achar(/^Atrasados$/), '#,##0', 'passaram do prazo'],
      ['Em Processo', achar(/^Em Processo/), '#,##0', 'aguardando'],
      ['Atraso Faturamento', achar(/^Atraso Faturamento/), '#,##0', 'conferido, só falta nota']
    ];
    ws.getRow(4).height = 18; ws.getRow(7).height = 26;
    cartoes.forEach((k, i) => {
      const c = 1 + i * 2, x = converter(k[1]);
      for (let r = 4; r <= 7; r++) for (let cc = c; cc <= c + 1; cc++) ws.getCell(r, cc).fill = solido(COR.claro);
      ws.mergeCells(4, c, 4, c + 1); ws.mergeCells(5, c, 6, c + 1); ws.mergeCells(7, c, 7, c + 1);
      const rot = ws.getCell(4, c); rot.value = k[0]; rot.font = fonte(10, { bold: true, color: { argb: COR.navy } }); rot.alignment = { horizontal: 'center', vertical: 'middle' };
      const val = ws.getCell(5, c); val.value = x.v === '' ? '-' : x.v; val.numFmt = x.tipo === 'pct' ? '0.0%' : '#,##0';
      val.font = fonte(24, { bold: true, color: { argb: i === 4 ? COR.vermelho : i === 6 ? 'FFB87708' : COR.navy } }); val.alignment = { horizontal: 'center', vertical: 'middle' };
      const leg = ws.getCell(7, c); leg.value = k[3]; leg.font = fonte(9, { color: { argb: COR.mudo } }); leg.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    secao(ws, 9, 14, 'TODOS OS INDICADORES');
    cabecalho(ws, 10, 1, ['Indicador', '', '', '', 'Valor', '']);
    ws.mergeCells(10, 1, 10, 4); ws.mergeCells(10, 5, 10, 6);
    aba.rows.forEach((l, i) => {
      const r = 11 + i, fundo = i % 2 ? COR.zebra : undefined, x = converter(l.Valor);
      for (let c = 1; c <= 6; c++) celula(ws, r, c, '', { fundo });
      celula(ws, r, 1, l.Indicador, { fundo });
      celula(ws, r, 5, x.v === '' ? '-' : x.v, { fundo, fmt: x.tipo === 'pct' ? '0.0%' : '#,##0', h: 'right', negrito: true, cor: COR.navy });
      ws.mergeCells(r, 1, r, 4); ws.mergeCells(r, 5, r, 6);
    });
    return ws;
  }

  // Tabela genérica para as demais abas: nada some, só ganha título, cabeçalho azul, listras, formatos e barras.
  function montarTabela(wb, aba, ctx, usados) {
    const nome = nomeAba(aba.name, usados);
    const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', xSplit: 0, ySplit: 4, showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const cols = aba.rows.length ? Object.keys(aba.rows[0]) : [];
    const conv = aba.rows.map(l => cols.map(k => converter(l[k])));
    cols.forEach((k, j) => {
      let w = String(k).length + 4;
      conv.forEach(l => { const t = l[j].tipo === 'num' ? Math.round(l[j].v).toLocaleString('pt-BR') : l[j].tipo === 'pct' ? '100,0%' : String(l[j].v); w = Math.max(w, Math.min(60, t.length + 3)); });
      ws.getColumn(j + 1).width = Math.min(60, Math.max(11, w));
    });
    const ate = Math.max(cols.length, 6);
    banner(ws, ate, String(aba.name).toUpperCase(), ctx.subtitulo);
    cabecalho(ws, 4, 1, cols); ws.getRow(4).height = 32;
    const totalLinha = i => /^total/i.test(String((aba.rows[i] || {})[cols[0]] || ''));
    conv.forEach((l, i) => {
      const r = 5 + i, total = totalLinha(i), fundo = total ? COR.navy2 : i % 2 ? COR.zebra : undefined;
      l.forEach((x, j) => {
        const base = { fundo, fmt: x.tipo === 'pct' ? '0.0%' : x.tipo === 'num' ? (Number.isInteger(x.v) ? '#,##0' : '#,##0.00') : undefined, h: x.tipo === 'txt' ? (j === 0 || String(x.v).length > 10 ? 'left' : 'center') : 'center' };
        if (total) { base.negrito = true; base.cor = COR.branco; base.sz = 10; }
        const cel = celula(ws, r, 1 + j, x.v === '' ? '-' : x.v, base);
        if (!total && /^n[ií]vel$/i.test(cols[j])) { cel.font = fonte(11, { bold: true, color: { argb: corNivel(String(x.v)) } }); }
      });
    });
    const ult = 4 + conv.length;
    if (conv.length) {
      cols.forEach((k, j) => {
        if (!conv.some(l => l[j].tipo === 'pct')) return;
        const ruim = /atras/i.test(k);
        barras(ws, ref(j + 1, 5) + ':' + ref(j + 1, ult - (totalLinha(conv.length - 1) ? 1 : 0)), ruim ? 'FFE9858D' : 'FF67CDBF', 1);
      });
      ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: ult, column: cols.length } };
    }
    return { ws, nome, cols, ult };
  }

  /* ------------------------------ histórico de atraso ------------------------------ */
  const pct = (a, b) => (b ? a / b : 0);
  const rotuloMes = mes => { const [a, m] = mes.split('-'); return MESES[Number(m) - 1].toUpperCase() + '/' + a; };

  function resumoDoDia(reg) {
    let e = 0, ep = 0, f = 0, fp = 0;
    for (const it of reg.itens) { if (it[4] === 'F') { f++; fp += it[3]; } else { e++; ep += it[3]; } }
    return { dia: reg.dia, total: reg.total, e, ep, f, fp };
  }

  function montarHistorico(wb, mes, dados, ctx, usados) {
    const nome = nomeAba('Histórico de Atraso ' + mes.slice(5) + '-' + mes.slice(0, 4), usados);
    const ws = wb.addWorksheet(nome, { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    [14, 14, 14, 14, 13, 16, 14, 14, 14, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const dias = Object.keys(dados.dias).sort().map(d => dados.dias[d]);
    banner(ws, 10, 'HISTÓRICO DE ATRASO — ' + rotuloMes(mes), 'Uma foto por dia, gravada a cada exportação: os dias anteriores não são apagados. Atualizado até ' + brData(dias[dias.length - 1].dia) + '.');
    ws.getRow(3).height = 28;
    legenda(ws, 3, 10, 'Estoque = pedido atrasado que ainda não saiu (separação, conferência ou despacho). Faturamento = já separado e conferido, falta só a nota fiscal. % = pedidos em atraso ÷ pedidos da base no dia.');

    secao(ws, 5, 10, 'RESUMO POR DIA');
    cabecalho(ws, 6, 1, ['Dia', 'Pedidos na base', 'Atraso Estoque (pedidos)', 'Peças Estoque', '% Estoque', 'Atraso Faturamento (pedidos)', 'Peças Faturamento', '% Faturamento', 'Total em atraso', '% Total']);
    ws.getRow(6).height = 42;
    const resumos = dias.map(resumoDoDia);
    resumos.forEach((x, i) => {
      const r = 7 + i, fundo = i % 2 ? COR.zebra : undefined, tot = x.e + x.f;
      celula(ws, r, 1, brData(x.dia), { fundo, h: 'left' });
      [x.total, x.e, x.ep, null, x.f, x.fp, null, tot].forEach((v, j) => { if (v !== null) celula(ws, r, 2 + j, v, { fundo, fmt: '#,##0', h: 'center' }); });
      celula(ws, r, 5, pct(x.e, x.total), { fundo, fmt: '0.0%', h: 'center', negrito: true, cor: 'FFB87708' });
      celula(ws, r, 8, pct(x.f, x.total), { fundo, fmt: '0.0%', h: 'center', negrito: true, cor: COR.azul });
      celula(ws, r, 10, pct(tot, x.total), { fundo, fmt: '0.0%', h: 'center', negrito: true, cor: COR.vermelho });
    });
    const p1 = 7, u1 = 6 + resumos.length;
    const mediaR = u1 + 1, o = { sz: 10, negrito: true, cor: COR.branco, fundo: COR.navy2, h: 'center' };
    const media = (f) => resumos.length ? resumos.reduce((s, x) => s + f(x), 0) / resumos.length : 0;
    celula(ws, mediaR, 1, 'Média do mês', Object.assign({}, o, { h: 'left' }));
    celula(ws, mediaR, 2, Math.round(media(x => x.total)), Object.assign({ fmt: '#,##0' }, o));
    celula(ws, mediaR, 3, Math.round(media(x => x.e)), Object.assign({ fmt: '#,##0' }, o));
    celula(ws, mediaR, 4, Math.round(media(x => x.ep)), Object.assign({ fmt: '#,##0' }, o));
    celula(ws, mediaR, 5, media(x => pct(x.e, x.total)), Object.assign({ fmt: '0.0%' }, o));
    celula(ws, mediaR, 6, Math.round(media(x => x.f)), Object.assign({ fmt: '#,##0' }, o));
    celula(ws, mediaR, 7, Math.round(media(x => x.fp)), Object.assign({ fmt: '#,##0' }, o));
    celula(ws, mediaR, 8, media(x => pct(x.f, x.total)), Object.assign({ fmt: '0.0%' }, o));
    celula(ws, mediaR, 9, Math.round(media(x => x.e + x.f)), Object.assign({ fmt: '#,##0' }, o));
    celula(ws, mediaR, 10, media(x => pct(x.e + x.f, x.total)), Object.assign({ fmt: '0.0%' }, o));
    barras(ws, ref(10, p1) + ':' + ref(10, u1), 'FFE9858D', 0.1);

    // pedidos em atraso, dia a dia (cada pedido uma linha; filtro na linha de cabeçalho)
    const t2 = Math.max(mediaR, 6 + LINHAS_GRAFICO) + 3;
    secao(ws, t2, 10, 'PEDIDOS EM ATRASO, DIA A DIA');
    cabecalho(ws, t2 + 1, 1, ['Dia', 'Pedido', 'Armazém', 'Liberado em', 'Dias de atraso', 'Peças', 'Tipo', 'Situação']);
    ws.getRow(t2 + 1).height = 24;
    let r = t2 + 2;
    for (const reg of dias) {
      const linhas = reg.itens.slice().sort((a, b) => (a[4] === b[4] ? b[6] - a[6] : a[4] === 'E' ? -1 : 1) || String(a[0]).localeCompare(String(b[0])));
      for (const it of linhas) {
        const fundo = (r - t2) % 2 ? COR.zebra : undefined;
        celula(ws, r, 1, brData(reg.dia), { fundo, h: 'center' });
        celula(ws, r, 2, it[0], { fundo, h: 'center' });
        celula(ws, r, 3, it[1], { fundo, h: 'left' });
        celula(ws, r, 4, it[2] ? brData(it[2]) : '-', { fundo, h: 'center' });
        celula(ws, r, 5, it[6], { fundo, fmt: '#,##0', h: 'center' });
        celula(ws, r, 6, it[3], { fundo, fmt: '#,##0', h: 'center' });
        celula(ws, r, 7, it[4] === 'F' ? 'Faturamento' : 'Estoque', { fundo, h: 'center', negrito: true, cor: it[4] === 'F' ? COR.azul : 'FFB87708' });
        celula(ws, r, 8, it[5] === 'P' ? 'Em processo' : 'Atrasado', { fundo, h: 'center', negrito: true, cor: it[5] === 'P' ? COR.mudo : COR.vermelho });
        r++;
      }
    }
    const ult = r - 1;
    if (ult >= t2 + 2) ws.autoFilter = { from: { row: t2 + 1, column: 1 }, to: { row: ult, column: 8 } };
    else legenda(ws, t2 + 2, 10, 'Nenhum pedido em atraso nos dias gravados.');
    return { nome, graficos: [{ tipo: 'colunas', cat: { de: p1, ate: u1, cab: 6 }, cols: [{ col: 5, cor: 'F2A93B' }, { col: 8, cor: '4F63D2' }], titulo: '% de atraso por dia — Estoque x Faturamento', eixo: '0%', ancora: { col: 11, linha: 5 } }] };
  }

  /* ------------------------------ gráficos (XML do Excel) ------------------------------ */
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const txt = (sz, bold, cor) => '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '" b="' + (bold ? 1 : 0) + '"><a:solidFill><a:srgbClr val="' + cor + '"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>';
  const tituloXml = (t, sz) => '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '" b="1"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="' + sz + '" b="1"><a:solidFill><a:srgbClr val="1E2761"/></a:solidFill></a:rPr><a:t>' + esc(t) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
  const grade = '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E7F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';
  const linhaEixo = '<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="C4CBDB"/></a:solidFill></a:ln></c:spPr>';

  function graficoColunas(g, nomeDaAba) {
    const q = "'" + nomeDaAba.replace(/'/g, "''") + "'!";
    const serie = (i, s) => '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/><c:tx><c:strRef><c:f>' + q + '$' + letra(s.col) + '$' + g.cat.cab + '</c:f></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="' + s.cor + '"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>' +
      '<c:cat><c:strRef><c:f>' + q + '$A$' + g.cat.de + ':$A$' + g.cat.ate + '</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>' + q + '$' + letra(s.col) + '$' + g.cat.de + ':$' + letra(s.col) + '$' + g.cat.ate + '</c:f></c:numRef></c:val></c:ser>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace ' + NS + '><c:roundedCorners val="0"/><c:chart>' + tituloXml(g.titulo, 1200) + '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
      g.cols.map((s, i) => serie(i, s)).join('') + '<c:gapWidth val="60"/><c:axId val="111"/><c:axId val="112"/></c:barChart>' +
      '<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' + linhaEixo + txt(900, false, '5B6472') + '<c:crossAx val="112"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
      '<c:valAx><c:axId val="112"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>' + grade + '<c:numFmt formatCode="' + esc(g.eixo || '#,##0') + '" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>' + txt(900, false, '5B6472') + '<c:crossAx val="111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea>' +
      '<c:legend><c:legendPos val="b"/><c:overlay val="0"/>' + txt(900, false, '1E2761') + '</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D5DAE6"/></a:solidFill></a:ln></c:spPr></c:chartSpace>';
  }

  const ancora = (id, nome, col0, linha0, rid) => '<xdr:oneCellAnchor><xdr:from><xdr:col>' + col0 + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + linha0 + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="' + LARGURA_GRAFICO + '" cy="' + ALTURA_GRAFICO + '"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + id + '" name="' + esc(nome) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="' + rid + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>';

  const caminhoDaAba = (livro, rels, nomeDaAba) => {
    const nomeXml = esc(nomeDaAba);
    const id = (new RegExp('<sheet [^>]*name="' + nomeXml.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*r:id="([^"]+)"').exec(livro) || new RegExp('<sheet [^>]*r:id="([^"]+)"[^>]*name="' + nomeXml.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').exec(livro) || [])[1];
    const alvo = id && new RegExp('<Relationship [^>]*Id="' + id + '"[^>]*>').exec(rels);
    const destino = alvo && /Target="([^"]+)"/.exec(alvo[0]);
    if (!destino) throw new Error('não achei a aba ' + nomeDaAba + ' no arquivo gerado');
    return destino[1].replace(/^\/?(xl\/)?/, 'xl/');
  };
  const xmlBarras = lista => lista.map((b, i) => '<conditionalFormatting sqref="' + b.ref + '"><cfRule type="dataBar" priority="' + (i + 1) + '"><dataBar><cfvo type="num" val="0"/><cfvo type="num" val="' + b.max + '"/><color rgb="' + b.cor + '"/></dataBar></cfRule></conditionalFormatting>').join('');

  // barrasPorAba = { aba: [{ref,cor,max}] } · graficosPorAba = { aba: [grafico] }
  async function injetar(JSZip, buffer, barrasPorAba, graficosPorAba) {
    const zip = await JSZip.loadAsync(buffer);
    const livro = await zip.file('xl/workbook.xml').async('string');
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');

    // barras de dados: entram antes das margens da página (ordem exigida pelo formato)
    for (const [aba, lista] of Object.entries(barrasPorAba || {})) {
      if (!lista.length) continue;
      const cam = caminhoDaAba(livro, rels, aba);
      const xml = await zip.file(cam).async('string');
      const i = xml.indexOf('<pageMargins');
      if (i < 0) throw new Error('aba ' + aba + ' sem margens de página');
      zip.file(cam, xml.slice(0, i) + xmlBarras(lista) + xml.slice(i));
    }

    let tipos = await zip.file('[Content_Types].xml').async('string');
    let nChart = 0, nDraw = 0;
    for (const [aba, lista] of Object.entries(graficosPorAba || {})) {
      if (!lista.length) continue;
      const caminho = caminhoDaAba(livro, rels, aba);
      const arquivo = caminho.split('/').pop();
      const relCaminho = 'xl/worksheets/_rels/' + arquivo + '.rels';
      nDraw++;
      let ancoras = '', relsDesenho = '';
      lista.forEach((g, i) => {
        nChart++;
        zip.file('xl/charts/chart' + nChart + '.xml', graficoColunas(g, aba));
        ancoras += ancora(i + 2, 'Gráfico ' + (i + 1), g.ancora.col, g.ancora.linha, 'rId' + (i + 1));
        relsDesenho += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + nChart + '.xml"/>';
        tipos = tipos.replace('</Types>', '<Override PartName="/xl/charts/chart' + nChart + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>');
      });
      zip.file('xl/drawings/drawing' + nDraw + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + ancoras + '</xdr:wsDr>');
      zip.file('xl/drawings/_rels/drawing' + nDraw + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relsDesenho + '</Relationships>');
      tipos = tipos.replace('</Types>', '<Override PartName="/xl/drawings/drawing' + nDraw + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');

      const existente = zip.file(relCaminho);
      const novaRel = '<Relationship Id="rIdSC9Graficos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + nDraw + '.xml"/>';
      if (existente) zip.file(relCaminho, (await existente.async('string')).replace('</Relationships>', novaRel + '</Relationships>'));
      else zip.file(relCaminho, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + novaRel + '</Relationships>');

      let xml = await zip.file(caminho).async('string');
      const tag = '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdSC9Graficos"/>';
      const depoisDasMargens = xml.indexOf('<pageMargins');
      let corte = xml.lastIndexOf('</worksheet>');
      for (const t of ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst']) { const i = xml.indexOf(t, depoisDasMargens); if (i >= 0 && i < corte) corte = i; }
      zip.file(caminho, xml.slice(0, corte) + tag + xml.slice(corte));
    }
    zip.file('[Content_Types].xml', tipos);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  /* ------------------------------ registro do dia ------------------------------ */
  const FORMATADOR_DIA = typeof Intl === 'object' ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }) : null;
  const diaDeHoje = (d) => (FORMATADOR_DIA ? FORMATADOR_DIA.format(d || new Date()) : (d || new Date()).toISOString().slice(0, 10));
  const chaveDia = (d) => (d instanceof Date && !isNaN(d) ? ('' + d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)) : '');

  // Mesma regra do painel: sem nota, já separado e conferido = atraso de faturamento (entra também em processo, como o
  // "Atraso Faturamento" do Resumo); qualquer outro pedido Atrasado conta como estoque (ainda não separado/conferido ou,
  // se já tem nota, ainda não saiu na Entrega), igual ao "Atrasados" do painel.
  function registroDoDia(pedidos, agora, dia) {
    const itens = [];
    let pecas = 0;
    const texto = v => (v == null ? '' : String(v)).trim();
    for (const o of pedidos || []) {
      pecas += Number(o.qt) || 0;
      if (o.status !== 'Atrasado' && o.status !== 'Pendente') continue;
      const sep = texto(o.separador), conf = texto(o.conferente);
      const separado = !!((sep && sep !== '0') || o.pickEnd), conferido = !!((conf && conf !== '0') || o.confEnd);
      const tipo = !o.nf && separado && conferido ? 'F' : 'E';
      if (tipo === 'E' && o.status !== 'Atrasado') continue;
      const dias = o.dt && agora ? Math.max(0, Math.round((agora - o.dt) / 864e5)) : 0;
      itens.push([texto(o.pedido), o.armazem === 'Tambore' ? 'Tamboré' : texto(o.armazem), o.dayKey || chaveDia(o.dt), Math.round((Number(o.qt) || 0) * 100) / 100, tipo, o.status === 'Atrasado' ? 'A' : 'P', dias]);
    }
    return { dia: dia || diaDeHoje(), total: (pedidos || []).length, pecas: Math.round(pecas), itens };
  }

  // junta o registro de hoje no histórico lido do servidor (vale o de hoje se o servidor não respondeu)
  function mesclarLocal(meses, registro) {
    const mes = registro.dia.slice(0, 7);
    const copia = {};
    for (const [m, v] of Object.entries(meses || {})) copia[m] = { mes: m, dias: Object.assign({}, v.dias) };
    copia[mes] = copia[mes] || { mes, dias: {} };
    copia[mes].dias[registro.dia] = registro;
    return copia;
  }

  /* ------------------------------ geração ------------------------------ */
  // abas = retorno do painel ([{name, rows}]); ctx = { escopo, subtitulo }; meses = { 'AAAA-MM': { dias: {...} } }
  async function gerar(abas, ctx, meses, libs) {
    const { ExcelJS, JSZip } = libs || {};
    if (!ExcelJS || !JSZip) throw new Error('As bibliotecas do Excel não carregaram.');
    if (!Array.isArray(abas) || !abas.length) throw new Error('Não há abas para exportar.');
    ctx = ctx || {};
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SC9 Control'; wb.created = new Date(); wb.title = 'Relatório Geral SC9';
    const usados = new Set();
    const graficos = {};
    for (const aba of abas) {
      if (!aba || !Array.isArray(aba.rows)) continue;
      if (aba.name === 'Resumo') { montarResumo(wb, aba, ctx, usados); continue; }
      const t = montarTabela(wb, aba, ctx, usados);
      if (aba.name === 'Tendência Diária' && t.cols.includes('Total Pedidos') && aba.rows.length) {
        const col = n => t.cols.indexOf(n) + 1;
        const cols = [{ col: col('Total Pedidos'), cor: '4F63D2' }];
        if (col('Atrasados (estoque)') > 0) cols.push({ col: col('Atrasados (estoque)'), cor: 'D64550' });
        graficos[t.nome] = [{ tipo: 'colunas', cat: { de: 5, ate: 4 + aba.rows.length, cab: 4 }, cols, titulo: 'Pedidos por dia de liberação — total x atrasados', eixo: '#,##0', ancora: { col: t.cols.length + 1, linha: 3 } }];
      }
    }
    for (const mes of Object.keys(meses || {}).sort().reverse()) {
      const dados = meses[mes];
      if (!dados || !dados.dias || !Object.keys(dados.dias).length) continue;
      const h = montarHistorico(wb, mes, dados, ctx, usados);
      graficos[h.nome] = h.graficos;
    }
    const porBarras = {};
    wb.worksheets.forEach(ws => { porBarras[ws.name] = ws.__barras || []; });
    const bruto = await wb.xlsx.writeBuffer();
    return injetar(JSZip, bruto, porBarras, graficos);
  }

  /* ------------------------------ navegador ------------------------------ */
  const carregando = {};
  function carregarScript(src, pronto) {
    if (pronto()) return Promise.resolve();
    if (carregando[src]) return carregando[src];
    return (carregando[src] = new Promise((ok, no) => {
      const s = root.document.createElement('script');
      s.src = src; s.onload = () => (pronto() ? ok() : no(new Error('biblioteca do Excel indisponível'))); s.onerror = () => { delete carregando[src]; no(new Error('não consegui carregar ' + src)); };
      root.document.head.appendChild(s);
    }));
  }
  const CABECALHOS = { 'Content-Type': 'application/json', 'X-Sc9-App': '1' };
  async function gravar(registro) {
    const r = await root.fetch('/api/atraso-historico', { method: 'POST', headers: CABECALHOS, body: JSON.stringify(registro) });
    if (!r.ok) throw new Error('histórico de atraso: ' + r.status);
  }
  async function ler(n) {
    const r = await root.fetch('/api/atraso-historico?meses=' + (n || 12), { cache: 'no-store' });
    if (!r.ok) throw new Error('histórico de atraso: ' + r.status);
    return (await r.json()).meses || {};
  }

  // Grava a foto de hoje sem baixar nada (chamado quando o SC9 é carregado); erros não atrapalham ninguém.
  async function registrarSilencioso(pedidos, agora) {
    try {
      const reg = registroDoDia(pedidos, agora);
      if (reg.total) await gravar(reg);
    } catch (e) { if (root.console) root.console.warn('Histórico de atraso não gravado:', e && e.message); }
  }

  // dados = { abas, pedidos, agora, escopo, corte }
  async function baixar(dados, nomeArquivo) {
    await Promise.all([carregarScript('/vendor-exceljs.js', () => !!root.ExcelJS), carregarScript('/vendor-jszip.js', () => !!root.JSZip)]);
    const registro = registroDoDia(dados.pedidos, dados.agora);
    let meses = {}, salvo = false;
    if (registro.total) { try { await gravar(registro); salvo = true; } catch (e) { if (root.console) root.console.warn(e); } }
    try { meses = await ler(12); } catch (e) { if (root.console) root.console.warn(e); }
    if (registro.total) meses = mesclarLocal(meses, registro);
    const corte = dados.corte instanceof Date ? dados.corte.toLocaleDateString('pt-BR') : String(dados.corte || '');
    const subtitulo = 'Gerado em ' + new Date().toLocaleString('pt-BR') + (corte ? ' · data de corte ' + corte : '') + (salvo ? '' : ' · histórico de atraso sem gravar hoje (servidor indisponível)');
    const bytes = await gerar(dados.abas, { escopo: dados.escopo, subtitulo }, meses, { ExcelJS: root.ExcelJS, JSZip: root.JSZip });
    const url = root.URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = root.document.createElement('a'); a.href = url; a.download = nomeArquivo; root.document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => root.URL.revokeObjectURL(url), 4000);
  }

  const api = { gerar, baixar, registrarSilencioso, registroDoDia, mesclarLocal, resumoDoDia };
  root.SC9RelatorioGeralXlsx = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
