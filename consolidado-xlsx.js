/* Excel formatado do Consolidado (Cambuci + filiais): mesmo visual do dashboard que a equipe recebe — faixa azul no topo,
 * cartões de indicadores, tabelas com cabeçalho azul, barras de % enviado e gráficos de verdade do Excel.
 * Recebe o resultado de SC9Consolidado.construir (campo `dados`) e devolve os bytes do .xlsx.
 * ExcelJS monta células/estilos; JSZip só acrescenta os gráficos (o ExcelJS não escreve gráficos).
 * As bibliotecas (/vendor-exceljs.js e /vendor-jszip.js) são carregadas só quando alguém exporta. */
(function (root) {
  const COR = {
    navy: 'FF1E2761', navy2: 'FF141B4D', claro: 'FFF4F6FB', zebra: 'FFEFF2F9', borda: 'FFD5DAE6', mudo: 'FF5B6472',
    verde: 'FF00A896', vermelho: 'FFD64550', ambar: 'FFF2A93B', tile: 'FF161B38', tileMudo: 'FF9AA3B8', branco: 'FFFFFFFF', preto: 'FF000000'
  };
  const LARGURA_GRAFICO = 5400000, ALTURA_GRAFICO = 2700000; // EMU (15 cm × 7,5 cm)
  const LINHAS_GRAFICO = 15; // linhas de altura padrão que o gráfico ocupa

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
    for (let c = c1; c <= c2; c++) {
      const x = ws.getCell(r, c);
      if (estilo.fill) x.fill = estilo.fill;
      if (estilo.border) x.border = estilo.border;
    }
    cel.font = estilo.font; cel.alignment = estilo.alignment || { vertical: 'middle' };
    return cel;
  }

  function cabecalho(ws, r, c0, rotulos, alinhar) {
    rotulos.forEach((t, i) => {
      const cel = ws.getCell(r, c0 + i);
      cel.value = t; cel.fill = solido(COR.navy); cel.font = fonte(10, { bold: true, color: { argb: COR.branco } }); cel.border = bordas;
      cel.alignment = { horizontal: i === 0 ? 'left' : (alinhar || 'center'), vertical: 'middle', wrapText: true };
    });
  }

  function celula(ws, r, c, valor, o) {
    o = o || {};
    const cel = ws.getCell(r, c);
    cel.value = valor;
    cel.font = fonte(o.sz || 11, { bold: !!o.negrito, color: { argb: o.cor || COR.preto } });
    if (o.fundo) cel.fill = solido(o.fundo);
    cel.border = o.semBorda ? undefined : bordas;
    if (o.fmt) cel.numFmt = o.fmt;
    if (o.h) cel.alignment = { horizontal: o.h, vertical: 'middle' };
    return cel;
  }

  const titulo = (ws, r, texto) => { const c = ws.getCell(r, 1); c.value = texto; c.font = fonte(12, { bold: true, color: { argb: COR.navy } }); };
  const barraSecao = (ws, r, texto, ate) => faixa(ws, r, 1, ate || 8, texto, { fill: solido(COR.navy), font: fonte(13, { bold: true, color: { argb: COR.branco } }), alignment: { vertical: 'middle', indent: 0 } });
  const legenda = (ws, r, texto, ate) => faixa(ws, r, 1, ate || 8, texto, { font: fonte(9, { color: { argb: COR.mudo } }), alignment: { vertical: 'middle', wrapText: false } });
  const corStatus = s => (s === 'Enviado' ? COR.verde : s === 'Atrasado' ? COR.vermelho : COR.ambar);
  // Barras de dados (formatação condicional): só registradas aqui; o XML é escrito em acrescentarGraficos, porque o ExcelJS
  // grava um bloco de extensão incompleto para dataBar e o Excel pode pedir reparo do arquivo.
  const barrasPct = (ws, intervalo, argb, max) => { (ws.__barras = ws.__barras || []).push({ ref: intervalo, cor: argb, max: max || 1 }); };

  /* ------------------------------ Dashboard ------------------------------ */
  function montarDashboard(wb, d) {
    const ws = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    [16, 14, 16, 20, 16, 12, 12, 12, 14, 14, 12, 12, 12, 12, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    ws.getRow(1).height = 28;
    faixa(ws, 1, 1, 15, d.titulo, { fill: solido(COR.navy), font: fonte(18, { bold: true, color: { argb: COR.branco } }), alignment: { vertical: 'middle' } });
    legenda(ws, 2, d.subtitulo, 15);
    ws.getRow(3).height = 14;
    legenda(ws, 3, d.regra, 15);

    // cartões de indicadores (5 cartões, 2 colunas cada: A:B, C:D, E:F, G:H, I:J)
    ws.getRow(5).height = 18; ws.getRow(8).height = 26;
    d.kpis.forEach((k, i) => {
      const c = 1 + i * 2;
      for (let r = 5; r <= 8; r++) for (let cc = c; cc <= c + 1; cc++) ws.getCell(r, cc).fill = solido(COR.claro);
      ws.mergeCells(5, c, 5, c + 1); ws.mergeCells(6, c, 7, c + 1); ws.mergeCells(8, c, 8, c + 1);
      const rot = ws.getCell(5, c); rot.value = k.rotulo; rot.font = fonte(10, { bold: true, color: { argb: COR.navy } }); rot.alignment = { horizontal: 'center', vertical: 'middle' };
      const val = ws.getCell(6, c); val.value = k.valor; val.numFmt = '#,##0'; val.font = fonte(26, { bold: true, color: { argb: COR.navy } }); val.alignment = { horizontal: 'center', vertical: 'middle' };
      const leg = ws.getCell(8, c); leg.value = k.legenda; leg.font = fonte(9, { color: { argb: COR.mudo } }); leg.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });

    // Status geral
    titulo(ws, 10, 'Status Geral');
    cabecalho(ws, 11, 1, ['Status', 'Pedidos', '%']);
    d.status.forEach((s, i) => {
      const r = 12 + i;
      celula(ws, r, 1, s.nome, { sz: 10, negrito: true, cor: corStatus(s.nome) });
      celula(ws, r, 2, s.pedidos, { sz: 10, cor: COR.navy, fmt: '#,##0', h: 'center' });
      celula(ws, r, 3, s.pct, { fmt: '0.0%', h: 'center' });
    });

    // Por armazém
    titulo(ws, 16, 'Por Armazém — Pedidos e Peças que Saíram (Enviados)');
    cabecalho(ws, 17, 1, ['Armazém', 'Total Pedidos', 'Pedidos Enviados', 'Peças Liberadas (Total)', 'Peças Enviadas', 'Atrasados', 'Pendentes', '% Enviado']);
    ws.getRow(17).height = 30;
    const linhaArm = (r, a, total) => {
      const o = total ? { sz: 10, negrito: true, cor: COR.branco, fundo: COR.navy2 } : {};
      celula(ws, r, 1, a.nome, o);
      [a.total, a.enviados, a.pecas, a.pecasEnviadas, a.atrasados, a.pendentes].forEach((v, i) => celula(ws, r, 2 + i, v, Object.assign({}, o, { fmt: '#,##0' })));
      celula(ws, r, 8, a.pct, Object.assign({}, o, { fmt: '0.0%' }));
    };
    d.armazens.forEach((a, i) => linhaArm(18 + i, a, false));
    linhaArm(18 + d.armazens.length, d.totalGeral, true);

    // Tendência diária
    const t1 = 26;
    barraSecao(ws, t1, 'TENDÊNCIA DIÁRIA');
    legenda(ws, t1 + 1, 'Pedidos liberados por dia, e quantos já saíram (Cambuci: está na Entrega · Filiais: tem NF)');
    cabecalho(ws, t1 + 2, 1, ['Dia', 'Pedidos', 'Enviados', 'Atrasados', 'Pendentes', '% Enviado']);
    const p1 = t1 + 3;
    d.dias.forEach((x, i) => {
      const r = p1 + i, fundo = i % 2 ? COR.zebra : undefined;
      celula(ws, r, 1, x.dia, { fundo, h: 'left' });
      [x.pedidos, x.enviados, x.atrasados, x.pendentes].forEach((v, j) => celula(ws, r, 2 + j, v, { fundo, fmt: '#,##0', h: 'center' }));
      celula(ws, r, 6, x.pct, { fundo, negrito: true, cor: COR.verde, fmt: '0.0%', h: 'center' });
    });
    const u1 = p1 + d.dias.length - 1;
    barrasPct(ws, ref(6, p1) + ':' + ref(6, u1), COR.verde);

    // Tendência de pedidos × peças
    const t2 = Math.max(u1, t1 + 2 + LINHAS_GRAFICO) + 3;
    barraSecao(ws, t2, 'TENDÊNCIA DE PEDIDOS — Pedidos x Peças');
    legenda(ws, t2 + 1, 'Pedidos (linha azul, eixo da esquerda) e Peças (linha laranja, eixo da direita), por dia.');
    cabecalho(ws, t2 + 2, 1, ['Dia', 'Pedidos', 'Peças']);
    const p2 = t2 + 3;
    d.dias.forEach((x, i) => {
      const r = p2 + i, fundo = i % 2 ? COR.zebra : undefined;
      celula(ws, r, 1, x.dia, { fundo, h: 'left' });
      celula(ws, r, 2, x.pedidos, { fundo, fmt: '#,##0', h: 'center' });
      celula(ws, r, 3, x.pecas, { fundo, fmt: '#,##0', h: 'center' });
    });
    const u2 = p2 + d.dias.length - 1;

    // Resumo dia a dia (cartões escuros): fica abaixo do gráfico para não ficar escondido atrás dele
    let r = Math.max(u2, t2 + 2 + LINHAS_GRAFICO) + 2;
    titulo(ws, r, 'Dia a dia — pedidos, peças e variação de peças em relação ao dia anterior');
    r += 1;
    d.dias.forEach((x, i) => {
      const c = 1 + (i % 5) * 2, linha = r + Math.floor(i / 5) * 3;
      for (let cc = c; cc <= c + 1; cc++) { ws.getCell(linha, cc).fill = solido(COR.tile); ws.getCell(linha + 1, cc).fill = solido(COR.tile); }
      ws.mergeCells(linha, c, linha, c + 1); ws.mergeCells(linha + 1, c, linha + 1, c + 1);
      const a = ws.getCell(linha, c); a.value = x.dia; a.font = fonte(9, { color: { argb: COR.tileMudo } }); a.alignment = { vertical: 'middle', indent: 1 };
      const ant = d.dias[i - 1], v = ws.getCell(linha + 1, c);
      const base = fonte(10, { bold: true, color: { argb: COR.branco } });
      const partes = [{ font: base, text: x.pedidos + ' ped.  ' + x.pecas.toLocaleString('pt-BR') + ' pç' }];
      if (ant && ant.pecas > 0) {
        const var_ = (x.pecas - ant.pecas) / ant.pecas;
        partes.push({ font: fonte(10, { bold: true, color: { argb: var_ >= 0 ? 'FF5CE0CF' : 'FFFF8A93' } }), text: '  ' + (var_ >= 0 ? '▲' : '▼') + ' ' + (Math.abs(var_) * 100).toFixed(1).replace('.', ',') + '%' });
      }
      v.value = { richText: partes }; v.alignment = { vertical: 'middle', indent: 1 };
      ws.getRow(linha).height = 16; ws.getRow(linha + 1).height = 20;
    });
    r += Math.ceil(d.dias.length / 5) * 3 + 1;

    // Por semana (só quando o recorte passa de 7 dias)
    if (d.semanas.length) {
      barraSecao(ws, r, 'POR SEMANA');
      cabecalho(ws, r + 1, 1, ['Semana', 'Pedidos', 'Peças', 'Enviados', 'Atrasados', 'Pendentes', '% Enviado']);
      d.semanas.forEach((x, i) => {
        const rr = r + 2 + i, fundo = i % 2 ? COR.zebra : undefined;
        celula(ws, rr, 1, x.semana, { fundo, h: 'left' });
        [x.pedidos, x.pecas, x.enviados, x.atrasados, x.pendentes].forEach((v, j) => celula(ws, rr, 2 + j, v, { fundo, fmt: '#,##0', h: 'center' }));
        celula(ws, rr, 7, x.pct, { fundo, negrito: true, cor: COR.verde, fmt: '0.0%', h: 'center' });
      });
      barrasPct(ws, ref(7, r + 2) + ':' + ref(7, r + 1 + d.semanas.length), COR.verde);
    }
    return { cat1: { de: p1, ate: u1, cab: t1 + 2 }, cat2: { de: p2, ate: u2, cab: t2 + 2 }, ancora1: t1 + 2, ancora2: t2 + 2 };
  }

  /* ------------------------------ Base de dados ------------------------------ */
  function montarBase(wb, d) {
    const cab = ['Armazém', 'Data Liberação', 'Cliente', 'Nome Cliente', 'Pedido', 'Itens', 'Nota Fiscal', 'Tem NF?', 'Status', 'Qt Liberada', 'Separador(a)', 'Conferente', 'Transportadora'];
    const ws = wb.addWorksheet('Base de Dados', { views: [{ state: 'frozen', xSplit: 0, ySplit: 4, showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    [12, 15, 12, 34, 10, 8, 12, 9, 11, 12, 28, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getRow(1).height = 26;
    faixa(ws, 1, 1, 13, d.baseTitulo, { fill: solido(COR.navy), font: fonte(14, { bold: true, color: { argb: COR.branco } }), alignment: { vertical: 'middle' } });
    ws.getRow(2).height = 38;
    faixa(ws, 2, 1, 13, d.baseFonte, { font: fonte(9, { color: { argb: COR.mudo } }), alignment: { vertical: 'top', wrapText: true } });
    cabecalho(ws, 4, 1, cab); ws.getRow(4).height = 22;
    d.base.forEach((p, i) => {
      const r = 5 + i;
      const dia = new Date(p.serial * 86400000 - 25569 * 86400000);
      const vals = [p.armazem, dia, p.cliente, p.nome, p.pedido, p.itens, p.nf, p.temNF, p.status, p.qt, p.separador, p.conferente, p.transportadora];
      vals.forEach((v, j) => {
        const cel = ws.getCell(r, 1 + j);
        cel.value = v; cel.font = fonte(11); cel.border = bordas;
        if (j === 1) cel.numFmt = 'dd/mm/yyyy';
        if (j === 5 || j === 9) cel.numFmt = '#,##0';
        if (j === 1 || j === 4 || j === 5 || j === 7) cel.alignment = { horizontal: 'center' };
      });
    });
    const ult = 4 + d.base.length;
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: ult, column: 13 } };
    const regra = (texto, cor, fundo, prioridade) => ({ type: 'cellIs', operator: 'equal', formulae: ['"' + texto + '"'], priority: prioridade, style: { font: { bold: true, color: { argb: cor } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: fundo } } } });
    ws.addConditionalFormatting({ ref: 'I5:I' + Math.max(ult, 5), rules: [regra('Enviado', COR.verde, 'FFE3F6F3', 1), regra('Atrasado', COR.vermelho, 'FFFBE6E8', 2), regra('Pendente', 'FFB87708', 'FFFEF1DA', 3)] });
    return ws;
  }

  /* ------------------------------ Ranking ------------------------------ */
  function montarRanking(wb, d) {
    const ws = wb.addWorksheet('Ranking Itens por Armazém', { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    d.ranking.forEach((_, b) => { const c = 1 + b * 5; [6, 10, 46, 12, 3].forEach((w, i) => { ws.getColumn(c + i).width = w; }); });
    ws.getRow(1).height = 26;
    faixa(ws, 1, 1, d.ranking.length * 5 - 1, 'RANKING DE ITENS POR ARMAZÉM (TOP 10 — QT LIBERADA)', { fill: solido(COR.navy), font: fonte(14, { bold: true, color: { argb: COR.branco } }), alignment: { vertical: 'middle' } });
    legenda(ws, 2, 'Ranking por soma de Qt Liberada (itens válidos, mesmo filtro de bloqueio). Nomes dos itens vêm da planilha de descrição.', d.ranking.length * 5 - 1);
    d.ranking.forEach((bloco, b) => {
      const c = 1 + b * 5;
      const nome = ws.getCell(3, c); nome.value = bloco.armazem; nome.font = fonte(12, { bold: true, color: { argb: COR.navy } });
      cabecalho(ws, 4, c, ['Rank', 'Cód. Item', 'Nome do Item', 'Qt Liberada']);
      bloco.itens.forEach((it, i) => {
        const r = 5 + i, fundo = i % 2 ? COR.zebra : undefined;
        celula(ws, r, c, it.pos, { fundo, h: 'center' });
        celula(ws, r, c + 1, it.codigo, { fundo, h: 'center' });
        celula(ws, r, c + 2, it.nome, { fundo });
        celula(ws, r, c + 3, it.qt, { fundo, fmt: '#,##0', negrito: true });
      });
      if (bloco.itens.length) barrasPct(ws, ref(c + 3, 5) + ':' + ref(c + 3, 4 + bloco.itens.length), 'FF7C93FF', Math.max(...bloco.itens.map(x => x.qt)) || 1);
    });
    return ws;
  }

  /* ------------------------------ Transportadora ------------------------------ */
  function montarTransportadora(wb, d) {
    const ws = wb.addWorksheet('Por Transportadora', { views: [{ showGridLines: false }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    [24, 12, 12, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getRow(1).height = 26;
    faixa(ws, 1, 1, 4, 'VOLUME POR TRANSPORTADORA', { fill: solido(COR.navy), font: fonte(14, { bold: true, color: { argb: COR.branco } }), alignment: { vertical: 'middle' } });
    ws.getRow(2).height = 38;
    faixa(ws, 2, 1, 4, "Transportadora resolvida via SC5 (código -> nome). 'Código X' = código não mapeado ainda; '(não definida)' = pedido sem transportadora identificada.", { font: fonte(9, { color: { argb: COR.mudo } }), alignment: { vertical: 'top', wrapText: true } });
    cabecalho(ws, 4, 1, ['Transportadora', 'Pedidos', 'Peças', '% do Total de Peças']);
    d.transportadoras.forEach((t, i) => {
      const r = 5 + i, fundo = i % 2 ? COR.zebra : undefined;
      celula(ws, r, 1, t.nome, { fundo });
      celula(ws, r, 2, t.pedidos, { fundo, fmt: '#,##0', h: 'center' });
      celula(ws, r, 3, t.pecas, { fundo, fmt: '#,##0', h: 'center' });
      celula(ws, r, 4, t.pct, { fundo, fmt: '0.0%', h: 'center' });
    });
    const ult = 4 + d.transportadoras.length;
    if (d.transportadoras.length) barrasPct(ws, 'D5:D' + ult, 'FF7C93FF');
    const tot = ult + 1, o = { sz: 10, negrito: true, cor: COR.branco, fundo: COR.navy2 };
    celula(ws, tot, 1, 'Total', o);
    celula(ws, tot, 2, d.transportadoras.reduce((s, t) => s + t.pedidos, 0), Object.assign({ fmt: '#,##0', h: 'center' }, o));
    celula(ws, tot, 3, d.transportadoras.reduce((s, t) => s + t.pecas, 0), Object.assign({ fmt: '#,##0', h: 'center' }, o));
    celula(ws, tot, 4, d.transportadoras.length ? 1 : 0, Object.assign({ fmt: '0.0%', h: 'center' }, o));
    return ws;
  }

  /* ------------------------------ gráficos (XML do Excel) ------------------------------ */
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const txt = (sz, bold, cor) => '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '" b="' + (bold ? 1 : 0) + '"><a:solidFill><a:srgbClr val="' + cor + '"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>';
  const tituloXml = (t, sz) => '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '" b="1"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="' + sz + '" b="1"><a:solidFill><a:srgbClr val="1E2761"/></a:solidFill></a:rPr><a:t>' + esc(t) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
  const rotuloEixo = t => '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="900" b="0"><a:solidFill><a:srgbClr val="5B6472"/></a:solidFill></a:rPr><a:t>' + esc(t) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
  const grade = '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E7F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';
  const linhaEixo = '<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="C4CBDB"/></a:solidFill></a:ln></c:spPr>';
  const refSerie = (col, c) => "'Dashboard'!$" + letra(col) + '$' + c.de + ':$' + letra(col) + '$' + c.ate;
  const refNome = (col, c) => "'Dashboard'!$" + letra(col) + '$' + c.cab;
  const cats = c => '<c:cat><c:strRef><c:f>' + refSerie(1, c) + '</c:f></c:strRef></c:cat>';
  const vals = (col, c) => '<c:val><c:numRef><c:f>' + refSerie(col, c) + '</c:f></c:numRef></c:val>';
  const nome = (col, c) => '<c:tx><c:strRef><c:f>' + refNome(col, c) + '</c:f></c:strRef></c:tx>';
  const eixoCat = (id, cruza, apagado) => '<c:catAx><c:axId val="' + id + '"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="' + (apagado ? 1 : 0) + '"/><c:axPos val="b"/>' + (apagado ? '' : rotuloEixo('Dia')) + '<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' + linhaEixo + txt(900, false, '5B6472') + '<c:crossAx val="' + cruza + '"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>';
  const eixoVal = (id, cruza, titulo_, direita) => '<c:valAx><c:axId val="' + id + '"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="' + (direita ? 'r' : 'l') + '"/>' + (direita ? '' : grade) + rotuloEixo(titulo_) + '<c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>' + txt(900, false, '5B6472') + '<c:crossAx val="' + cruza + '"/><c:crosses val="' + (direita ? 'max' : 'autoZero') + '"/><c:crossBetween val="between"/></c:valAx>';
  const fim = '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D5DAE6"/></a:solidFill></a:ln></c:spPr></c:chartSpace>';
  const legendaXml = '<c:legend><c:legendPos val="b"/><c:overlay val="0"/>' + txt(900, false, '1E2761') + '</c:legend>';

  function graficoBarras(c) {
    const serie = (i, col, cor) => '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/>' + nome(col, c) + '<c:spPr><a:solidFill><a:srgbClr val="' + cor + '"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>' + cats(c) + vals(col, c) + '</c:ser>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace ' + NS + '><c:roundedCorners val="0"/><c:chart>' + tituloXml('Pedidos por dia — Enviado x Atrasado x Pendente', 1200) + '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="stacked"/><c:varyColors val="0"/>' +
      serie(0, 3, '00A896') + serie(1, 4, 'D64550') + serie(2, 5, 'F2A93B') + '<c:gapWidth val="60"/><c:overlap val="100"/><c:axId val="111"/><c:axId val="112"/></c:barChart>' +
      eixoCat(111, 112) + eixoVal(112, 111, 'Pedidos') + '</c:plotArea>' + legendaXml + fim;
  }

  function graficoLinhas(c) {
    const serie = (i, col, cor) => '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/>' + nome(col, c) + '<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="' + cor + '"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="' + cor + '"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>' + cats(c) + vals(col, c) + '<c:smooth val="0"/></c:ser>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace ' + NS + '><c:roundedCorners val="0"/><c:chart>' + tituloXml('Tendência de Pedidos — Pedidos x Peças', 1200) + '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' +
      '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' + serie(0, 2, '4F63D2') + '<c:marker val="1"/><c:axId val="211"/><c:axId val="212"/></c:lineChart>' +
      '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' + serie(1, 3, 'F2A93B') + '<c:marker val="1"/><c:axId val="221"/><c:axId val="222"/></c:lineChart>' +
      eixoCat(211, 212) + eixoVal(212, 211, 'Pedidos') + eixoCat(221, 222, true) + eixoVal(222, 221, 'Peças', true) + '</c:plotArea>' + legendaXml + fim;
  }

  const ancora = (id, nome_, linha0, rid) => '<xdr:oneCellAnchor><xdr:from><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + linha0 + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="' + LARGURA_GRAFICO + '" cy="' + ALTURA_GRAFICO + '"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + id + '" name="' + nome_ + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="' + rid + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>';

  const caminhoDaAba = (livro, rels, nomeAba) => {
    const id = (new RegExp('<sheet [^>]*name="' + esc(nomeAba) + '"[^>]*r:id="([^"]+)"').exec(livro) || new RegExp('<sheet [^>]*r:id="([^"]+)"[^>]*name="' + esc(nomeAba) + '"').exec(livro) || [])[1];
    const alvo = id && new RegExp('<Relationship [^>]*Id="' + id + '"[^>]*>').exec(rels);
    const destino = alvo && /Target="([^"]+)"/.exec(alvo[0]);
    if (!destino) throw new Error('não achei a aba ' + nomeAba + ' no arquivo gerado');
    return destino[1].replace(/^\/?(xl\/)?/, 'xl/');
  };
  const xmlBarras = barras => barras.map((b, i) => '<conditionalFormatting sqref="' + b.ref + '"><cfRule type="dataBar" priority="' + (i + 1) + '"><dataBar><cfvo type="num" val="0"/><cfvo type="num" val="' + b.max + '"/><color rgb="' + b.cor + '"/></dataBar></cfRule></conditionalFormatting>').join('');

  async function acrescentarGraficos(JSZip, buffer, pos, barrasPorAba) {
    const zip = await JSZip.loadAsync(buffer);
    const livro = await zip.file('xl/workbook.xml').async('string');
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');

    // barras de dados: entram antes das margens da página (ordem exigida pelo formato)
    for (const [nomeAba, barras] of Object.entries(barrasPorAba || {})) {
      if (!barras.length) continue;
      const cam = caminhoDaAba(livro, rels, nomeAba);
      let xml = await zip.file(cam).async('string');
      const i = xml.indexOf('<pageMargins');
      if (i < 0) throw new Error('aba ' + nomeAba + ' sem margens de página');
      zip.file(cam, xml.slice(0, i) + xmlBarras(barras) + xml.slice(i));
    }

    const caminho = caminhoDaAba(livro, rels, 'Dashboard');
    const nomeAba = caminho.split('/').pop();
    const relCaminho = 'xl/worksheets/_rels/' + nomeAba + '.rels';

    zip.file('xl/charts/chart1.xml', graficoBarras(pos.cat1));
    zip.file('xl/charts/chart2.xml', graficoLinhas(pos.cat2));
    zip.file('xl/drawings/drawing1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      ancora(2, 'Gráfico Pedidos por dia', pos.ancora1 - 1, 'rId1') + ancora(3, 'Gráfico Tendência', pos.ancora2 - 1, 'rId2') + '</xdr:wsDr>');
    zip.file('xl/drawings/_rels/drawing1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/></Relationships>');

    let tipos = await zip.file('[Content_Types].xml').async('string');
    tipos = tipos.replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>');
    zip.file('[Content_Types].xml', tipos);

    const existente = zip.file(relCaminho);
    const novaRel = '<Relationship Id="rIdSC9Graficos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>';
    if (existente) zip.file(relCaminho, (await existente.async('string')).replace('</Relationships>', novaRel + '</Relationships>'));
    else zip.file(relCaminho, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + novaRel + '</Relationships>');

    let aba = await zip.file(caminho).async('string');
    const tag = '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdSC9Graficos"/>';
    const depoisDasMargens = aba.indexOf('<pageMargins');
    let corte = aba.lastIndexOf('</worksheet>');
    for (const t of ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst']) { const i = aba.indexOf(t, depoisDasMargens); if (i >= 0 && i < corte) corte = i; }
    aba = aba.slice(0, corte) + tag + aba.slice(corte);
    zip.file(caminho, aba);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  // libs = { ExcelJS, JSZip }; resultado = retorno de SC9Consolidado.construir
  async function gerar(resultado, libs) {
    const d = resultado && resultado.dados;
    if (!d) throw new Error('Resultado do consolidado sem os dados estruturados.');
    const { ExcelJS, JSZip } = libs || {};
    if (!ExcelJS || !JSZip) throw new Error('As bibliotecas do Excel não carregaram.');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SC9 Control'; wb.created = new Date(); wb.title = d.titulo;
    const pos = montarDashboard(wb, d);
    montarBase(wb, d); montarRanking(wb, d); montarTransportadora(wb, d);
    const barras = {};
    wb.worksheets.forEach(ws => { barras[ws.name] = ws.__barras || []; });
    const bruto = await wb.xlsx.writeBuffer();
    return acrescentarGraficos(JSZip, bruto, pos, barras);
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
  async function baixar(resultado, nomeArquivo) {
    await Promise.all([carregarScript('/vendor-exceljs.js', () => !!root.ExcelJS), carregarScript('/vendor-jszip.js', () => !!root.JSZip)]);
    const bytes = await gerar(resultado, { ExcelJS: root.ExcelJS, JSZip: root.JSZip });
    const url = root.URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = root.document.createElement('a'); a.href = url; a.download = nomeArquivo; root.document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => root.URL.revokeObjectURL(url), 4000);
  }

  const api = { gerar, baixar };
  root.SC9ConsolidadoXlsx = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
