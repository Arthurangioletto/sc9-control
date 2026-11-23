/* Excel do Histórico de Atraso (botão ao lado do Relatório Geral): um arquivo por mês, com a aba "Resumo do Mês" e uma aba
 * por dia (DD-MM-AAAA). Cada aba do dia mostra os pedidos em atraso (pedido, armazém, dias, peças, transportadora, tipo) e o
 * COMPARATIVO com o dia anterior gravado: quem saiu do atraso, quem continua e quem entrou. Usa as fotos diárias que o servidor
 * guarda em /api/atraso-historico (nada é apagado: cada dia é uma foto). Visual e blocos de estilo vêm de relatorio-geral-xlsx.js. */
(function (root) {
  const base = () => {
    const m = (root.SC9RelatorioGeralXlsx && root.SC9RelatorioGeralXlsx.base) || (typeof require === 'function' ? require('./relatorio-geral-xlsx.js').base : null);
    if (!m) throw new Error('módulo do Relatório Geral indisponível');
    return m;
  };
  const RG = () => (root.SC9RelatorioGeralXlsx || (typeof require === 'function' ? require('./relatorio-geral-xlsx.js') : null));

  const chave = it => it[1] + '|' + it[0];
  const ddmm = dia => dia.slice(8, 10) + '/' + dia.slice(5, 7);
  const ddmmaaaa = dia => dia.slice(8, 10) + '/' + dia.slice(5, 7) + '/' + dia.slice(0, 4);
  const nomeDaAba = dia => dia.slice(8, 10) + '-' + dia.slice(5, 7) + '-' + dia.slice(0, 4);
  const pl = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
  const razao = (a, b) => (b ? a / b : 0);
  const diaDaSemana = dia => new Date(dia + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
  const rotuloMes = mes => { const [a, m] = mes.split('-'); return base().MESES[Number(m) - 1].toUpperCase() + '/' + a; };
  const soma = (lista, f) => lista.reduce((s, x) => s + f(x), 0);

  function resumoDoDia(reg) {
    let e = 0, ep = 0, f = 0, fp = 0;
    for (const it of reg.itens) { if (it[4] === 'F') { f++; fp += it[3]; } else { e++; ep += it[3]; } }
    return { total: reg.total, e, ep, f, fp, tot: e + f, pecas: ep + fp };
  }

  // Compara cada dia gravado com o dia gravado imediatamente antes (mesmo que seja de outro mês).
  function analisar(meses) {
    const regs = [];
    for (const m of Object.values(meses || {})) for (const r of Object.values((m && m.dias) || {})) regs.push(r);
    regs.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
    return regs.map((reg, i) => {
      const ant = i ? regs[i - 1] : null;
      const resumo = resumoDoDia(reg);
      let cmp = null;
      if (ant) {
        const antes = new Map(ant.itens.map(it => [chave(it), it]));
        const hoje = new Map(reg.itens.map(it => [chave(it), it]));
        const novos = reg.itens.filter(it => !antes.has(chave(it)));
        const continuam = reg.itens.filter(it => antes.has(chave(it)));
        const saiu = ant.itens.filter(it => !hoje.has(chave(it)));
        const mudou = continuam.filter(it => antes.get(chave(it))[4] !== it[4]);
        cmp = { ant, resumoAnt: resumoDoDia(ant), novos, continuam, saiu, mudou, antes };
      }
      return { reg, resumo, ant, cmp };
    });
  }

  function frase(a) {
    if (!a.cmp) return 'Primeiro dia gravado: ainda não há dia anterior para comparar.';
    const { cmp, resumo } = a;
    const dif = resumo.tot - cmp.resumoAnt.tot, ref = ddmm(cmp.ant.dia);
    const parte1 = dif < 0 ? 'Melhorou: ' + pl(-dif, 'pedido a menos', 'pedidos a menos') + ' em atraso que em ' + ref + ' (' + cmp.resumoAnt.tot + ' → ' + resumo.tot + ').'
      : dif > 0 ? 'Piorou: ' + pl(dif, 'pedido a mais', 'pedidos a mais') + ' em atraso que em ' + ref + ' (' + cmp.resumoAnt.tot + ' → ' + resumo.tot + ').'
        : 'Igual a ' + ref + ': ' + pl(resumo.tot, 'pedido', 'pedidos') + ' em atraso.';
    let t = parte1 + ' ' + pl(cmp.saiu.length, 'saiu', 'saíram') + ' do atraso, ' + pl(cmp.continuam.length, 'continua', 'continuam') + ' e ' + pl(cmp.novos.length, 'entrou', 'entraram') + '.';
    if (cmp.mudou.length) t += ' ' + pl(cmp.mudou.length, 'passou', 'passaram') + ' de Estoque para Faturamento.';
    return t;
  }

  /* ------------------------------ abas ------------------------------ */
  function montarResumo(wb, mes, doMes, ctx, usados) {
    const B = base();
    const ws = wb.addWorksheet(B.nomeAba('Resumo do Mês', usados), { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    [13, 12, 13, 11, 11, 14, 12, 12, 12, 12, 11, 11, 11, 11, 78].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    B.banner(ws, 15, 'HISTÓRICO DE ATRASO — ' + rotuloMes(mes), ctx.subtitulo);
    ws.getRow(3).height = 28;
    B.legenda(ws, 3, 15, 'Uma aba por dia, com a foto dos pedidos em atraso e o comparativo com o dia anterior gravado. Estoque = atrasado que ainda não saiu (separação, conferência ou despacho). Faturamento = já separado e conferido, falta só a nota. % = pedidos em atraso ÷ pedidos da base no dia. "Saíram" = estavam em atraso no dia anterior e não aparecem mais.');

    const ult = doMes[doMes.length - 1];
    const cartoes = [
      ['Em atraso (' + ddmm(ult.reg.dia) + ')', ult.resumo.tot, 'pedidos · ' + Math.round(ult.resumo.pecas).toLocaleString('pt-BR') + ' peças', COR().vermelho],
      ['Atraso de Estoque', ult.resumo.e, Math.round(ult.resumo.ep).toLocaleString('pt-BR') + ' peças', 'FFB87708'],
      ['Atraso de Faturamento', ult.resumo.f, Math.round(ult.resumo.fp).toLocaleString('pt-BR') + ' peças', COR().azul],
      ['Saíram do atraso', ult.cmp ? ult.cmp.saiu.length : '-', ult.cmp ? 'desde ' + ddmm(ult.cmp.ant.dia) : 'sem dia anterior', COR().verde],
      ['Entraram no atraso', ult.cmp ? ult.cmp.novos.length : '-', ult.cmp ? 'desde ' + ddmm(ult.cmp.ant.dia) : 'sem dia anterior', COR().navy]
    ];
    cartao(ws, 5, cartoes);

    // gráficos ficam acima da tabela (ancorados na linha 10)
    const t = 10 + 17;
    B.secao(ws, t, 15, 'EVOLUÇÃO DIA A DIA');
    B.cabecalho(ws, t + 1, 1, ['Dia', 'Pedidos na base', 'Atraso Estoque (pedidos)', 'Peças Estoque', '% Estoque', 'Atraso Faturamento (pedidos)', 'Peças Faturamento', '% Faturamento', 'Total em atraso', 'Peças em atraso', '% Total', 'Entraram', 'Saíram', 'Continuam', 'Comparativo com o dia anterior']);
    ws.getRow(t + 1).height = 42;
    const p1 = t + 2;
    doMes.forEach((a, i) => {
      const r = p1 + i, fundo = i % 2 ? COR().zebra : undefined, x = a.resumo, c = a.cmp;
      const dia = ws.getCell(r, 1);
      B.celula(ws, r, 1, { text: ddmmaaaa(a.reg.dia), hyperlink: "#'" + nomeDaAba(a.reg.dia) + "'!A1" }, { fundo, h: 'left' });
      dia.font = B.fonte(11, { bold: true, underline: true, color: { argb: COR().navy } });
      const n = (c2, v, o) => B.celula(ws, r, c2, v, Object.assign({ fundo, fmt: '#,##0', h: 'center' }, o || {}));
      n(2, x.total); n(3, x.e); n(4, Math.round(x.ep)); n(5, razao(x.e, x.total), { fmt: '0.0%', negrito: true, cor: 'FFB87708' });
      n(6, x.f); n(7, Math.round(x.fp)); n(8, razao(x.f, x.total), { fmt: '0.0%', negrito: true, cor: COR().azul });
      n(9, x.tot, { negrito: true }); n(10, Math.round(x.pecas)); n(11, razao(x.tot, x.total), { fmt: '0.0%', negrito: true, cor: COR().vermelho });
      if (c) { n(12, c.novos.length); n(13, c.saiu.length); n(14, c.continuam.length); } else { B.celula(ws, r, 12, '-', { fundo, h: 'center' }); B.celula(ws, r, 13, '-', { fundo, h: 'center' }); B.celula(ws, r, 14, '-', { fundo, h: 'center' }); }
      const f = B.celula(ws, r, 15, frase(a), { fundo, sz: 10 }); f.alignment = { vertical: 'middle', wrapText: true };
      ws.getRow(r).height = 30;
    });
    const u1 = p1 + doMes.length - 1;
    const teto = col => Math.max(0.01, Math.max(...doMes.map(a => (col === 5 ? razao(a.resumo.e, a.resumo.total) : col === 8 ? razao(a.resumo.f, a.resumo.total) : razao(a.resumo.tot, a.resumo.total)))) * 1.3);
    B.barras(ws, B.ref(5, p1) + ':' + B.ref(5, u1), 'FFF2C27B', teto(5));
    B.barras(ws, B.ref(8, p1) + ':' + B.ref(8, u1), 'FF9AA8F0', teto(8));
    B.barras(ws, B.ref(11, p1) + ':' + B.ref(11, u1), 'FFE9858D', teto(11));
    return {
      nome: ws.name,
      graficos: [
        { tipo: 'colunas', cat: { de: p1, ate: u1, cab: t + 1 }, cols: [{ col: 5, cor: 'F2A93B' }, { col: 8, cor: '4F63D2' }], titulo: '% de pedidos em atraso por dia — Estoque x Faturamento', eixo: '0.0%', ancora: { col: 0, linha: 9 } },
        { tipo: 'colunas', cat: { de: p1, ate: u1, cab: t + 1 }, cols: [{ col: 12, cor: 'D64550' }, { col: 13, cor: '00A896' }], titulo: 'Entraram x Saíram do atraso por dia', eixo: '#,##0', ancora: { col: 6, linha: 9 } }
      ]
    };
  }

  const COR = () => base().COR;
  // cartões de indicadores: lista de [rótulo, valor, legenda, cor]; cada um ocupa 2 colunas a partir da coluna 1
  function cartao(ws, linha, lista) {
    const B = base();
    ws.getRow(linha).height = 18; ws.getRow(linha + 3).height = 18;
    lista.forEach((k, i) => {
      const c = 1 + i * 2;
      for (let r = linha; r <= linha + 3; r++) for (let cc = c; cc <= c + 1; cc++) ws.getCell(r, cc).fill = B.solido(B.COR.claro);
      ws.mergeCells(linha, c, linha, c + 1); ws.mergeCells(linha + 1, c, linha + 2, c + 1); ws.mergeCells(linha + 3, c, linha + 3, c + 1);
      const rot = ws.getCell(linha, c); rot.value = k[0]; rot.font = B.fonte(10, { bold: true, color: { argb: B.COR.navy } }); rot.alignment = { horizontal: 'center', vertical: 'middle' };
      const val = ws.getCell(linha + 1, c); val.value = k[1]; val.numFmt = '#,##0'; val.font = B.fonte(24, { bold: true, color: { argb: k[3] } }); val.alignment = { horizontal: 'center', vertical: 'middle' };
      const leg = ws.getCell(linha + 3, c); leg.value = k[2]; leg.font = B.fonte(9, { color: { argb: B.COR.mudo } }); leg.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  }

  const ETAPA = { S: 'Separação', C: 'Conferência', F: 'Faturamento (falta a nota)', D: 'Despacho (já tem nota)' };

  function montarDia(wb, a, ctx, usados) {
    const B = base(), cor = B.COR;
    const nome = B.nomeAba(nomeDaAba(a.reg.dia), usados);
    const ws = wb.addWorksheet(nome, { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    [12, 30, 11, 12, 10, 10, 18, 13, 13, 18, 13, 14, 24, 3, 12, 30, 11, 9, 18, 13, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const dia = a.reg.dia, x = a.resumo;
    const sem = diaDaSemana(dia);
    B.banner(ws, 21, 'ATRASO DO DIA — ' + ddmmaaaa(dia) + ' · ' + sem, (isNaN(new Date(a.reg.atualizadoEm)) ? 'Foto do dia.' : 'Foto gravada em ' + new Date(a.reg.atualizadoEm).toLocaleString('pt-BR') + '.'));
    cartao(ws, 4, [
      ['Em atraso', x.tot, 'pedidos · ' + (razao(x.tot, x.total) * 100).toFixed(1).replace('.', ',') + '% da base', cor.vermelho],
      ['Atraso de Estoque', x.e, (razao(x.e, x.total) * 100).toFixed(1).replace('.', ',') + '% da base', 'FFB87708'],
      ['Atraso de Faturamento', x.f, (razao(x.f, x.total) * 100).toFixed(1).replace('.', ',') + '% da base', cor.azul],
      ['Peças em atraso', Math.round(x.pecas), 'estoque ' + Math.round(x.ep).toLocaleString('pt-BR') + ' · fat. ' + Math.round(x.fp).toLocaleString('pt-BR'), cor.navy],
      ['Pedidos na base', x.total, 'no dia da foto', cor.mudo]
    ]);

    // comparativo com o dia anterior
    let r = 9;
    B.secao(ws, r, 21, a.cmp ? 'COMPARATIVO COM ' + ddmmaaaa(a.cmp.ant.dia) + ' (' + diaDaSemana(a.cmp.ant.dia) + ')' : 'COMPARATIVO');
    r++;
    ws.mergeCells(r, 1, r, 21); ws.getRow(r).height = 36;
    const f = ws.getCell(r, 1); f.value = frase(a); f.font = B.fonte(12, { bold: true, color: { argb: a.cmp ? (x.tot < a.cmp.resumoAnt.tot ? cor.verde : x.tot > a.cmp.resumoAnt.tot ? cor.vermelho : cor.navy) : cor.mudo } });
    f.alignment = { vertical: 'middle', wrapText: true };
    r++;
    if (a.cmp) {
      const c = a.cmp;
      const linha = (rot, itens, resumo, cor_) => {
        const e = resumo ? resumo.e : itens.filter(i => i[4] === 'E').length;
        const fa = resumo ? resumo.f : itens.filter(i => i[4] === 'F').length;
        const pecas = resumo ? resumo.pecas : soma(itens, i => i[3]);
        return [rot, e, fa, e + fa, Math.round(pecas), cor_];
      };
      B.cabecalho(ws, r, 1, ['Situação', '', '', 'Estoque', 'Faturamento', 'Total (pedidos)', 'Peças']);
      ws.mergeCells(r, 1, r, 3); ws.getRow(r).height = 26;
      const linhas = [
        linha('Dia anterior (' + ddmm(c.ant.dia) + ')', null, c.resumoAnt),
        linha('Saíram do atraso', c.saiu, null, cor.verde),
        linha('Continuam em atraso', c.continuam),
        linha('Entraram no atraso', c.novos, null, cor.vermelho),
        linha('Hoje (' + ddmm(dia) + ')', null, x)
      ];
      linhas.forEach((l, i) => {
        const rr = r + 1 + i, ultima = i === linhas.length - 1, fundo = ultima ? cor.navy2 : i % 2 ? cor.zebra : undefined;
        const o = ultima ? { sz: 10, negrito: true, cor: cor.branco, fundo } : { fundo };
        for (let cc = 1; cc <= 3; cc++) B.celula(ws, rr, cc, cc === 1 ? l[0] : '', Object.assign({}, o, { negrito: true, cor: ultima ? cor.branco : (l[5] || cor.navy) }));
        ws.mergeCells(rr, 1, rr, 3);
        [l[1], l[2], l[3], l[4]].forEach((v, j) => B.celula(ws, rr, 4 + j, v, Object.assign({ fmt: '#,##0', h: 'center' }, o)));
      });
      r += linhas.length + 2;
    } else r++;

    // listas lado a lado: em atraso neste dia (esquerda) e saíram do atraso (direita)
    const t = r;
    ws.mergeCells(t, 1, t, 13); ws.mergeCells(t, 15, t, 21);
    const titulo1 = ws.getCell(t, 1); titulo1.value = 'PEDIDOS EM ATRASO NESTE DIA';
    for (let cc = 1; cc <= 13; cc++) ws.getCell(t, cc).fill = B.solido(cor.navy);
    titulo1.font = B.fonte(12, { bold: true, color: { argb: cor.branco } });
    const titulo2 = ws.getCell(t, 15); titulo2.value = a.cmp ? 'SAÍRAM DO ATRASO DESDE ' + ddmm(a.cmp.ant.dia) : 'SAÍRAM DO ATRASO';
    for (let cc = 15; cc <= 21; cc++) ws.getCell(t, cc).fill = B.solido(cor.verde);
    titulo2.font = B.fonte(12, { bold: true, color: { argb: cor.branco } });
    ws.getCell(t, 1).alignment = { vertical: 'middle' }; ws.getCell(t, 15).alignment = { vertical: 'middle' };
    ws.getRow(t).height = 20;

    B.cabecalho(ws, t + 1, 1, ['Pedido', 'Cliente', 'Armazém', 'Liberado em', 'Dias de atraso', 'Peças', 'Transportadora', 'Tipo', 'Situação', 'Etapa em que parou', 'Nota fiscal', 'Valor da nota', 'Comparativo']);
    ws.getRow(t + 1).height = 30;
    const ordem = (x1, x2) => (x1[4] === x2[4] ? 0 : x1[4] === 'E' ? -1 : 1) || x2[6] - x1[6] || String(x1[0]).localeCompare(String(x2[0]));
    const itens = a.reg.itens.slice().sort(ordem);
    itens.forEach((it, i) => {
      const rr = t + 2 + i, fundo = i % 2 ? cor.zebra : undefined;
      let cmpTxt = '-';
      if (a.cmp) {
        const antes = a.cmp.antes.get(chave(it));
        cmpTxt = !antes ? 'Novo (não estava em ' + ddmm(a.cmp.ant.dia) + ')' : antes[4] !== it[4] ? 'Passou de ' + (antes[4] === 'E' ? 'Estoque' : 'Faturamento') + ' p/ ' + (it[4] === 'E' ? 'Estoque' : 'Faturamento') : 'Continua desde antes de ' + ddmm(dia);
      }
      const x = (it[8] && typeof it[8] === 'object') ? it[8] : {};
      B.celula(ws, rr, 1, it[0], { fundo, h: 'center' });
      B.celula(ws, rr, 2, x.n || '-', { fundo, h: 'left', sz: 10 });
      B.celula(ws, rr, 3, it[1], { fundo, h: 'left' });
      B.celula(ws, rr, 4, it[2] ? ddmmaaaa(it[2]) : '-', { fundo, h: 'center' });
      B.celula(ws, rr, 5, it[6], { fundo, fmt: '#,##0', h: 'center' });
      B.celula(ws, rr, 6, it[3], { fundo, fmt: '#,##0', h: 'center', negrito: true });
      B.celula(ws, rr, 7, it[7] || '-', { fundo, h: 'left' });
      B.celula(ws, rr, 8, it[4] === 'F' ? 'Faturamento' : 'Estoque', { fundo, h: 'center', negrito: true, cor: it[4] === 'F' ? cor.azul : 'FFB87708' });
      B.celula(ws, rr, 9, it[5] === 'P' ? 'Em processo' : 'Atrasado', { fundo, h: 'center', negrito: true, cor: it[5] === 'P' ? cor.mudo : cor.vermelho });
      B.celula(ws, rr, 10, ETAPA[x.e] || '-', { fundo, h: 'left', sz: 10 });
      B.celula(ws, rr, 11, x.nf || '-', { fundo, h: 'center' });
      B.celula(ws, rr, 12, x.v ? x.v : '-', { fundo, h: 'right', fmt: x.v ? '"R$" #,##0.00' : undefined });
      B.celula(ws, rr, 13, cmpTxt, { fundo, h: 'left', sz: 10, negrito: !a.cmp ? false : /^Novo/.test(cmpTxt), cor: /^Novo/.test(cmpTxt) ? cor.vermelho : cor.preto });
    });
    if (itens.length) ws.autoFilter = { from: { row: t + 1, column: 1 }, to: { row: t + 1 + itens.length, column: 13 } };
    else B.legenda(ws, t + 2, 13, 'Nenhum pedido em atraso neste dia.');

    // aviso só sobre a tabela da direita (não cobre a lista da esquerda)
    const legendaDireita = (texto) => {
      ws.mergeCells(t + 2, 15, t + 2, 21);
      const c = ws.getCell(t + 2, 15);
      c.value = texto; c.font = B.fonte(9, { color: { argb: cor.mudo } }); c.alignment = { vertical: 'middle', wrapText: true };
    };
    B.cabecalho(ws, t + 1, 15, ['Pedido', 'Cliente', 'Armazém', 'Peças', 'Transportadora', 'Tipo que tinha', 'Dias de atraso que tinha']);
    if (a.cmp) {
      const saiu = a.cmp.saiu.slice().sort(ordem);
      saiu.forEach((it, i) => {
        const rr = t + 2 + i, fundo = i % 2 ? cor.zebra : undefined;
        B.celula(ws, rr, 15, it[0], { fundo, h: 'center' });
        B.celula(ws, rr, 16, (it[8] && it[8].n) || '-', { fundo, h: 'left', sz: 10 });
        B.celula(ws, rr, 17, it[1], { fundo, h: 'left' });
        B.celula(ws, rr, 18, it[3], { fundo, fmt: '#,##0', h: 'center', negrito: true });
        B.celula(ws, rr, 19, it[7] || '-', { fundo, h: 'left' });
        B.celula(ws, rr, 20, it[4] === 'F' ? 'Faturamento' : 'Estoque', { fundo, h: 'center', negrito: true, cor: it[4] === 'F' ? cor.azul : 'FFB87708' });
        B.celula(ws, rr, 21, it[6], { fundo, fmt: '#,##0', h: 'center' });
      });
      if (!saiu.length) legendaDireita('Nenhum pedido saiu do atraso desde ' + ddmm(a.cmp.ant.dia) + '.');
    } else legendaDireita('Sem dia anterior gravado para comparar.');
    return ws;
  }

  /* ------------------------------ geração ------------------------------ */
  // meses = { 'AAAA-MM': { dias: {...} } } (todos os meses gravados; o comparativo atravessa a virada do mês); mes = 'AAAA-MM' a exportar
  async function gerar(meses, mes, ctx, libs) {
    const { ExcelJS, JSZip } = libs || {};
    if (!ExcelJS || !JSZip) throw new Error('As bibliotecas do Excel não carregaram.');
    ctx = ctx || {};
    const analise = analisar(meses);
    const doMes = analise.filter(a => a.reg.dia.slice(0, 7) === mes);
    if (!doMes.length) throw new Error('Não há dias gravados em ' + mes + '.');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SC9 Control'; wb.created = new Date(); wb.title = 'Histórico de Atraso ' + mes;
    const usados = new Set();
    const resumo = montarResumo(wb, mes, doMes, ctx, usados);
    for (const a of doMes.slice().reverse()) montarDia(wb, a, ctx, usados); // dia mais recente logo depois do resumo
    const barras = {};
    wb.worksheets.forEach(ws => { barras[ws.name] = ws.__barras || []; });
    const bruto = await wb.xlsx.writeBuffer();
    return base().injetar(JSZip, bruto, barras, { [resumo.nome]: resumo.graficos });
  }

  const nomeArquivo = mes => 'SC9_Historico_Atraso_' + mes + '.xlsx';

  // dados = { orders, agora, sc5, entrega, mes }: grava a foto de hoje (e os despachados por dia da planilha de Entrega), lê o histórico e baixa o mês escolhido
  async function baixar(dados) {
    const B = base(), R = RG();
    await Promise.all([B.carregarScript('/vendor-exceljs.js', () => !!root.ExcelJS), B.carregarScript('/vendor-jszip.js', () => !!root.JSZip)]);
    const registro = R.registroDoDia(dados.orders, dados.agora, undefined, dados.sc5, dados.entrega, { faturamento: dados.faturamento, valores: dados.valores });
    let salvo = false, meses = {};
    if (registro.total) { try { await B.gravar(registro); salvo = true; } catch (e) { if (root.console) root.console.warn(e); } }
    try { meses = await B.ler(24); } catch (e) { if (root.console) root.console.warn(e); }
    if (registro.total) meses = R.mesclarLocal(meses, registro);
    const mes = dados.mes || B.diaDeHoje().slice(0, 7);
    const subtitulo = 'Gerado em ' + new Date().toLocaleString('pt-BR') + (salvo ? '' : ' · a foto de hoje não foi gravada no servidor (indisponível)');
    const bytes = await gerar(meses, mes, { subtitulo }, { ExcelJS: root.ExcelJS, JSZip: root.JSZip });
    B.baixarBytes(bytes, nomeArquivo(mes));
    return { mes, salvo };
  }

  // meses disponíveis para o seletor do botão (mais recente primeiro; sempre inclui o mês de hoje)
  async function listarMeses() {
    const B = base();
    let meses = {};
    try { meses = await B.ler(24); } catch (e) { /* servidor indisponível: só o mês atual */ }
    const lista = new Set(Object.keys(meses));
    lista.add(B.diaDeHoje().slice(0, 7));
    return Array.from(lista).sort().reverse().map(m => ({ id: m, label: rotuloMes(m), dias: meses[m] ? Object.keys(meses[m].dias).length : 0 }));
  }

  const api = { analisar, frase, gerar, baixar, listarMeses, nomeArquivo, nomeDaAba, rotuloMes };
  root.SC9AtrasoHistoricoXlsx = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
