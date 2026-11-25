/* Manifesto da transportadora (Painel da Expedição): Excel formatado e CSV a partir de GET /api/expedicao/exportar.
 * Uma aba por transportadora, pedidos agrupados por dia, coluna "Conferido" em branco para a transportadora marcar.
 * ExcelJS só é carregado (/vendor-exceljs.js) quando alguém pede o Excel. JavaScript puro, sem nada de fora. */
(function (root) {
  'use strict';
  const COR = { azul: 'FF1D4ED8', azulEscuro: 'FF14307F', azulClaro: 'FFE8EFFF', linha: 'FFD5DCEE', zebra: 'FFF6F8FD', mudo: 'FF5B6784', branco: 'FFFFFFFF', laranja: 'FFFFF1E0', verde: 'FFE3F6EC' };
  const SITUACAO = { saiu: 'Saiu', recebido: 'Recebido, aguardando sair', nao_sai_hoje: 'Não sai hoje', desceu_nao_recebido: 'Desceu, não recebido', saiu_sem_recebimento: 'Saiu sem recebimento' };
  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const FUSO = 'America/Sao_Paulo';

  const dmy = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }) : '');
  const diaIso = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: FUSO }) : '');
  const nomeDia = (d) => { const i = new Date(d + 'T12:00:00Z').getUTCDay(); return DIAS[i][0].toUpperCase() + DIAS[i].slice(1); };
  const dataSaida = (l) => (l.dataEntrega ? dmy(String(l.dataEntrega).slice(0, 10)) : '');
  const dataHoraReceb = (l) => (l.recebidoEm ? dmy(diaIso(l.recebidoEm)) + (l.horaEstimada ? '' : ' ' + hora(l.recebidoEm)) : '');
  const situacaoTexto = (l) => (SITUACAO[l.situacao] || l.situacao || '') + (l.motivo && l.situacao === 'nao_sai_hoje' ? ': ' + l.motivo : '');
  const porTransportadora = (linhas) => {
    const m = new Map();
    for (const l of linhas) { const k = l.transportadora || 'Sem transportadora'; if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  };
  const ordenar = (a, b) => (a.dia === b.dia ? String(a.pedido).localeCompare(String(b.pedido), 'pt-BR', { numeric: true }) : a.dia < b.dia ? -1 : 1);

  /* ---------- CSV: uma linha por pedido, todas as colunas ---------- */
  const CAB_CSV = ['Dia', 'Pedido', 'Nota', 'Cliente', 'Transportadora', 'Volumes', 'Recebido em', 'Data de saída', 'Situação', 'Rastreio (código)', 'Rastreio (link)', 'Armazém'];
  function linhasCsv(linhas) {
    return linhas.slice().sort((a, b) => (a.transportadora || '').localeCompare(b.transportadora || '', 'pt-BR') || ordenar(a, b)).map((l) => [dmy(l.dia), l.pedido, l.nf || 'Aguardando nota', l.cliente || '', l.transportadora || '', l.volumes == null ? '' : l.volumes, dataHoraReceb(l), dataSaida(l), situacaoTexto(l), l.rastreioCodigo || '', l.rastreioLink || '', l.armazem || '']);
  }

  /* ---------- Excel ---------- */
  const solido = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const fio = { style: 'thin', color: { argb: COR.linha } };
  const bordas = { top: fio, left: fio, bottom: fio, right: fio };
  const fonte = (sz, extra) => Object.assign({ name: 'Calibri', size: sz }, extra || {});
  const nomeAba = (nome, usados) => {
    let base = String(nome).replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Aba', n = base, i = 2;
    while (usados.has(n.toLowerCase())) n = base.slice(0, 26) + ' ' + i++;
    usados.add(n.toLowerCase()); return n;
  };
  const COLS = [['Dia', 11], ['Pedido', 12], ['Nota', 14], ['Cliente', 38], ['Volumes', 9], ['Situação', 26], ['Data de saída', 14], ['Rastreio (código)', 22], ['Rastreio (link)', 30], ['Conferido', 12]];

  function abaTransportadora(wb, nome, linhas, meta, usados) {
    const ws = wb.addWorksheet(nomeAba(nome, usados), { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c[1]; });
    const n = COLS.length;
    ws.mergeCells(1, 1, 1, n); const t = ws.getCell(1, 1);
    t.value = 'Manifesto de saída · ' + nome; t.font = fonte(16, { bold: true, color: { argb: COR.branco } }); t.fill = solido(COR.azul); t.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(1).height = 30;
    ws.mergeCells(2, 1, 2, n); const s = ws.getCell(2, 1);
    const vol = linhas.reduce((a, l) => a + (Number(l.volumes) || 0), 0);
    s.value = meta.periodo + ' · ' + linhas.length + (linhas.length === 1 ? ' pedido' : ' pedidos') + ' · ' + vol + (vol === 1 ? ' volume' : ' volumes') + (meta.soPendentes ? ' · só o que falta sair' : '') + ' · gerado em ' + meta.geradoEm;
    s.font = fonte(10, { color: { argb: COR.azulEscuro } }); s.fill = solido(COR.azulClaro); s.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(2).height = 20;
    ws.getRow(3).height = 6;
    const cab = ws.getRow(4); cab.height = 24;
    COLS.forEach((c, i) => { const cel = cab.getCell(i + 1); cel.value = c[0]; cel.font = fonte(10, { bold: true, color: { argb: COR.branco } }); cel.fill = solido(COR.azulEscuro); cel.border = bordas; cel.alignment = { vertical: 'middle', horizontal: [4, 6, 8, 9].includes(i + 1) ? 'left' : 'center', wrapText: true }; });
    let r = 5; const dias = new Map();
    for (const l of linhas.slice().sort(ordenar)) { if (!dias.has(l.dia)) dias.set(l.dia, []); dias.get(l.dia).push(l); }
    for (const [dia, lista] of dias) {
      ws.mergeCells(r, 1, r, n); const d = ws.getCell(r, 1);
      const v = lista.reduce((a, l) => a + (Number(l.volumes) || 0), 0);
      d.value = nomeDia(dia) + ', ' + dmy(dia) + ' · ' + lista.length + (lista.length === 1 ? ' pedido' : ' pedidos') + ' · ' + v + (v === 1 ? ' volume' : ' volumes');
      d.font = fonte(11, { bold: true, color: { argb: COR.azulEscuro } }); d.fill = solido(COR.azulClaro); d.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(r).height = 22; r++;
      lista.forEach((l, i) => {
        const row = ws.getRow(r); row.height = 20;
        const vals = [dmy(l.dia), l.pedido, l.nf || 'Aguardando nota', l.cliente || '', l.volumes == null ? '' : Number(l.volumes), situacaoTexto(l), dataSaida(l), l.rastreioCodigo || '', l.rastreioLink || '', ''];
        vals.forEach((v2, k) => {
          const c = row.getCell(k + 1); c.value = v2; c.border = bordas; c.font = fonte(10, k === 1 ? { bold: true } : (k === 2 && !l.nf ? { italic: true, color: { argb: COR.mudo } } : {}));
          c.alignment = { vertical: 'middle', horizontal: [4, 6, 8, 9].includes(k + 1) ? 'left' : 'center', wrapText: k === 3 || k === 5 };
          if (i % 2) c.fill = solido(COR.zebra);
        });
        if (l.situacao !== 'saiu') row.getCell(6).fill = solido(COR.laranja); else row.getCell(6).fill = solido(COR.verde);
        if (l.rastreioLink && /^https:\/\//i.test(l.rastreioLink)) { const c = row.getCell(9); c.value = { text: l.rastreioLink, hyperlink: l.rastreioLink }; c.font = fonte(10, { underline: true, color: { argb: COR.azul } }); }
        r++;
      });
    }
    ws.getRow(r).height = 22; ws.mergeCells(r, 1, r, 4); const tot = ws.getCell(r, 1);
    tot.value = 'Total'; tot.font = fonte(11, { bold: true }); tot.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    const cv = ws.getCell(r, 5); cv.value = vol; cv.font = fonte(11, { bold: true }); cv.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let c = 1; c <= n; c++) { const x = ws.getCell(r, c); x.border = { top: { style: 'medium', color: { argb: COR.azulEscuro } } }; }
    return ws;
  }

  function resumo(wb, grupos, meta, usados) {
    const ws = wb.addWorksheet(nomeAba('Resumo', usados), { views: [{ showGridLines: false }] });
    [30, 12, 12, 12, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.mergeCells('A1:E1'); const t = ws.getCell('A1'); t.value = 'Painel da Expedição · manifesto'; t.font = fonte(16, { bold: true, color: { argb: COR.branco } }); t.fill = solido(COR.azul); t.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(1).height = 30;
    ws.mergeCells('A2:E2'); const s = ws.getCell('A2'); s.value = meta.periodo + ' · gerado em ' + meta.geradoEm; s.font = fonte(10, { color: { argb: COR.azulEscuro } }); s.fill = solido(COR.azulClaro); s.alignment = { vertical: 'middle', indent: 1 };
    const cab = ws.getRow(4); cab.height = 22;
    ['Transportadora', 'Pedidos', 'Volumes', 'Saíram', 'Faltam sair'].forEach((x, i) => { const c = cab.getCell(i + 1); c.value = x; c.font = fonte(10, { bold: true, color: { argb: COR.branco } }); c.fill = solido(COR.azulEscuro); c.border = bordas; c.alignment = { horizontal: i ? 'center' : 'left', vertical: 'middle' }; });
    let r = 5, ts = [0, 0, 0, 0];
    for (const [nome, linhas] of grupos) {
      const vol = linhas.reduce((a, l) => a + (Number(l.volumes) || 0), 0), saiu = linhas.filter((l) => l.situacao === 'saiu').length;
      [nome, linhas.length, vol, saiu, linhas.length - saiu].forEach((v, i) => { const c = ws.getCell(r, i + 1); c.value = v; c.border = bordas; c.font = fonte(10, i === 0 ? { bold: true } : {}); c.alignment = { horizontal: i ? 'center' : 'left', vertical: 'middle' }; });
      ts[0] += linhas.length; ts[1] += vol; ts[2] += saiu; ts[3] += linhas.length - saiu; r++;
    }
    ['Todas', ts[0], ts[1], ts[2], ts[3]].forEach((v, i) => { const c = ws.getCell(r, i + 1); c.value = v; c.font = fonte(11, { bold: true }); c.fill = solido(COR.azulClaro); c.border = bordas; c.alignment = { horizontal: i ? 'center' : 'left', vertical: 'middle' }; });
  }

  async function gerar(ExcelJS, dados, opcoes) {
    if (!ExcelJS) throw new Error('A biblioteca do Excel não carregou.');
    const o = opcoes || {};
    const geradoEm = dmy(diaIso(dados.geradoEm || new Date().toISOString())) + ' ' + hora(dados.geradoEm || new Date().toISOString());
    const meta = { periodo: o.periodoTexto || '', soPendentes: Boolean(o.soPendentes), geradoEm };
    const grupos = porTransportadora(dados.linhas || []);
    const wb = new ExcelJS.Workbook(); wb.creator = 'Central de Pedidos'; wb.created = new Date();
    const usados = new Set();
    if (grupos.length > 1) resumo(wb, grupos, meta, usados);
    for (const [nome, linhas] of grupos) abaTransportadora(wb, nome, linhas, meta, usados);
    return wb.xlsx.writeBuffer();
  }

  /* ---------- navegador ---------- */
  const carregando = {};
  function carregarScript(src, pronto) {
    if (pronto()) return Promise.resolve();
    if (carregando[src]) return carregando[src];
    return (carregando[src] = new Promise((ok, no) => {
      const s = root.document.createElement('script');
      s.src = src; s.onload = () => (pronto() ? ok() : no(new Error('biblioteca do Excel indisponível'))); s.onerror = () => { delete carregando[src]; no(new Error('Não consegui carregar o Excel. Tente de novo ou baixe o CSV.')); };
      root.document.head.appendChild(s);
    }));
  }
  function baixarBlob(blob, nome) {
    const url = root.URL.createObjectURL(blob);
    const a = root.document.createElement('a'); a.href = url; a.download = nome; a.style.display = 'none'; root.document.body.appendChild(a); a.click(); a.remove();
    root.setTimeout(() => root.URL.revokeObjectURL(url), 4000);
  }
  async function baixarExcel(dados, opcoes, nomeArquivo) {
    await carregarScript('/vendor-exceljs.js', () => !!root.ExcelJS);
    const bytes = await gerar(root.ExcelJS, dados, opcoes);
    baixarBlob(new root.Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nomeArquivo);
  }
  function baixarCsv(dados, nomeArquivo) {
    const Central = root.Central;
    const texto = '﻿' + Central.montarCsv(CAB_CSV, linhasCsv(dados.linhas || []));
    baixarBlob(new root.Blob([texto], { type: 'text/csv;charset=utf-8' }), nomeArquivo);
  }

  const api = { gerar, baixarExcel, baixarCsv, linhasCsv, CAB_CSV, situacaoTexto, porTransportadora };
  root.SC9ExpedicaoXlsx = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
