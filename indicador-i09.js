'use strict';
/* Indicador BSC I 09 — Ordens atendidas no almoxarifado (modelo, sem tela e sem rede).
 *
 * São dois indicadores calculados da mesma SC2 do Protheus, com as mesmas regras da planilha de controle
 * (aba Indicators, tabelas dinâmicas sobre a SC2):
 *  - OM (o almoxarifado separa): Mod. OP = Montagem Produto Acabado ou Serviço Retrabalho, sequência 01,
 *    sem filtro de armazém nem de produto;
 *  - OS (o almoxarifado estoca): Mod. OP = Serviço de Componente, Serviço Intermediário, Serviço Semi-Acabado
 *    ou código 4; qualquer sequência e armazém; só produtos "usinados" (= que NÃO estão na lista "Não considera");
 *  - nos dois: quantidade = coluna Qtd.Produzid, mês = mês da DT Real Fim;
 *  - o tipo do produto (Type Korea) vem da lista de produtos (código → classificação); sem tipo = "(sem tipo)".
 * Perda = coluna Perda; "enviado" = coluna Quantidade da OP; % de perda = Perda ÷ Quantidade da OP.
 * Linha guardada por OP/sequência: [op, seq, produto, descrição, modOP, emissão ISO, real fim ISO, quantidade, produzida, perda, armazém]. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SC9IndicadorI09 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const OBRIGATORIAS = ['Numero da OP', 'Sequencia', 'Produto', 'Quantidade', 'Mod. OP', 'DT Emissao', 'DT Real Fim', 'Qtd.Produzid', 'Perda'];
  const BSC = 0.95;
  const SEM_TIPO = '(sem tipo)';
  const TIPOS_FIXOS = ['ABUTMENT', 'BIO-MATERIAL', 'COMPONENT', 'CONSUMABLE', 'IMPLANT/BODY', 'TOOL', SEM_TIPO];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const num = (v) => { const n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const cod = (v) => (typeof v === 'number' ? String(Math.trunc(v)) : txt(v, 40));

  /* Modalidades de OP de cada indicador (sem acento e minúsculas; "4" é um código que aparece na SC2). */
  const MODS = {
    om: ['montagem produto acabado', 'servico retrabalho'],
    os: ['servico de componente', 'servico intermediario', 'servico semi-acabado', '4'],
  };
  const NOMES = { om: 'OM', os: 'OS' };
  const DESCR = { om: 'Ordens de montagem (o almoxarifado separa)', os: 'Ordens de serviço (o almoxarifado estoca)' };
  const REGRA = {
    om: 'Montagem Produto Acabado e Serviço Retrabalho, sequência 01.',
    os: 'Serviço de Componente, Intermediário, Semi-Acabado e código 4, qualquer sequência, só produtos usinados.',
  };
  const modOM = (m) => MODS.om.includes(norm(m));
  const modOS = (m) => MODS.os.includes(norm(m));

  /* ---------- datas (tudo em ISO yyyy-mm-dd; sem fuso) ---------- */
  function toISO(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) { if (isNaN(v)) return ''; return iso(v.getFullYear(), v.getMonth() + 1, v.getDate()); }
    if (typeof v === 'number') { // serial do Excel
      if (!(v > 20000 && v < 80000)) return '';
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return iso(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return iso(+m[3], +m[2], +m[1]);
    return '';
  }
  const utc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const diasEntre = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const somaDias = (s, n) => { const d = new Date(utc(s) + n * 86400000); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
  const diaSemana = (s) => new Date(utc(s)).getUTCDay(); // 0 = domingo
  const ultimoDiaDoMes = (mes) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();
  const ehUtil = (s, feriados) => { const w = diaSemana(s); return w >= 1 && w <= 5 && !(feriados && feriados.has(s)); };
  const nomeMes = (mes) => MESES[+mes.slice(5, 7) - 1] + ' de ' + mes.slice(0, 4);

  /* ---------- leitura da SC2 (matriz de linhas, como vem do Excel) ---------- */
  // Guarda toda linha que entra em OM ou em OS (pela Mod. OP) e que tem DT Real Fim. O filtro fino (sequência,
  // usinado) é feito no cálculo, então mudar uma regra não exige subir a SC2 de novo.
  function lerSC2(aoa) {
    if (!Array.isArray(aoa)) return { erro: 'planilha vazia' };
    let h = -1;
    for (let i = 0; i < Math.min(aoa.length, 20); i++) {
      if ((aoa[i] || []).some((c) => norm(c) === 'numero da op')) { h = i; break; }
    }
    if (h < 0) return { erro: 'não achei a coluna "Numero da OP" nas primeiras linhas. Esta é a SC2?' };
    const col = {};
    (aoa[h] || []).forEach((c, j) => { const k = norm(c); if (k && !(k in col)) col[k] = j; });
    const falta = OBRIGATORIAS.filter((n) => !(norm(n) in col));
    if (falta.length) return { erro: 'faltam colunas na SC2: ' + falta.join(', ') };
    const idx = (n) => col[norm(n)];
    const iDesc = norm('DESCR. PROD') in col ? idx('DESCR. PROD') : -1;
    const iArm = norm('Armazem') in col ? idx('Armazem') : -1;
    const rows = [], modos = {}, vistos = new Set();
    let linhas = 0, escopo = 0, semRealFim = 0, repetidas = 0;
    for (let i = h + 1; i < aoa.length; i++) {
      const r = aoa[i]; if (!r) continue;
      const op = txt(r[idx('Numero da OP')], 20); if (!op) continue;
      linhas++;
      const mod = txt(r[idx('Mod. OP')], 60);
      if (!modOM(mod) && !modOS(mod)) continue;
      escopo++;
      modos[mod] = (modos[mod] || 0) + 1;
      const fim = toISO(r[idx('DT Real Fim')]);
      if (!fim) { semRealFim++; continue; }
      const seq = txt(r[idx('Sequencia')], 10);
      const item = norm('Item') in col ? txt(r[idx('Item')], 10) : '';
      const chave = op + '|' + item + '|' + seq;
      if (vistos.has(chave)) { repetidas++; continue; }
      vistos.add(chave);
      rows.push([op, seq, cod(r[idx('Produto')]), iDesc >= 0 ? txt(r[iDesc], 80) : '', mod, toISO(r[idx('DT Emissao')]), fim,
        num(r[idx('Quantidade')]), num(r[idx('Qtd.Produzid')]), num(r[idx('Perda')]), iArm >= 0 ? txt(r[iArm], 6) : '']);
    }
    return { rows, resumo: { linhas, escopo, apontadas: rows.length, semRealFim, repetidas, modos } };
  }
  /* ---------- listas de apoio (abas "Type Korea" e "Não considera" da planilha de controle) ---------- */
  function lerTipos(aoa) {
    if (!Array.isArray(aoa)) return { erro: 'planilha vazia' };
    let h = -1;
    for (let i = 0; i < Math.min(aoa.length, 10); i++) { const l = (aoa[i] || []).map(norm); if (l.includes('codigos') && l.includes('classificacao')) { h = i; break; } }
    if (h < 0) return { erro: 'não achei as colunas CODIGOS e CLASSIFICACAO (aba Type Korea)' };
    const l = aoa[h].map(norm), ip = l.indexOf('codigos'), it = l.indexOf('classificacao');
    const tipos = {};
    for (let i = h + 1; i < aoa.length; i++) {
      const r = aoa[i] || []; const c = cod(r[ip]); if (!c || c in tipos) continue; // vale a primeira ocorrência, como o PROCV
      tipos[c] = txt(r[it], 40) || '-';
    }
    return { tipos, total: Object.keys(tipos).length };
  }
  function lerNaoConsidera(aoa) {
    if (!Array.isArray(aoa)) return { erro: 'planilha vazia' };
    const out = [];
    for (const r of aoa) {
      const c = cod((r || [])[0]); if (!c || /^(produto|codigo|codigos|cod)$/i.test(norm(c))) continue;
      if (!out.includes(c)) out.push(c);
    }
    return { codigos: out, total: out.length };
  }
  function porMes(rows) {
    const out = {};
    for (const o of rows) { const m = o[6].slice(0, 7); (out[m] = out[m] || []).push(o); }
    return out;
  }
  function validarLinhas(mes, rows) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))) return 'mês inválido';
    if (!Array.isArray(rows)) return 'linhas inválidas';
    for (const r of rows) {
      if (!Array.isArray(r) || r.length < 10) return 'linha inválida';
      if (!txt(r[0], 20)) return 'OP vazia';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r[6])) || String(r[6]).slice(0, 7) !== mes) return 'OP fora do mês ' + mes;
      for (const k of [7, 8, 9]) if (!Number.isFinite(Number(r[k]))) return 'quantidade inválida';
    }
    return '';
  }

  /* ---------- classificação de uma linha ---------- */
  function preparar(cfg) {
    cfg = cfg || {};
    return { nao: new Set((cfg.naoConsidera || []).map(String)), tipos: cfg.tipos || {}, feriados: new Set(cfg.feriados || []), metas: cfg.metas || {} };
  }
  function tipoDe(prod, P) { const t = P.tipos[prod]; return !t || t === '-' ? SEM_TIPO : t; }
  function classificar(o, P) {
    const seq = /^\d+$/.test(String(o[1])) ? Number(o[1]) : -1;
    return { om: modOM(o[4]) && seq === 1, os: modOS(o[4]) && !P.nao.has(String(o[2])), tipo: tipoDe(o[2], P) };
  }
  const soma = (a, f) => a.reduce((s, x) => s + f(x), 0);

  /* ---------- cálculo de um indicador (OM ou OS) num mês ---------- */
  function calcularUm(k, mes, rows, ctx) {
    const { P, dias, utilTotal, ate, parcial } = ctx;
    const meta = Number((P.metas[k] || {})[mes]) > 0 ? Number((P.metas[k] || {})[mes]) : 0;
    const metaDia = meta && utilTotal ? meta / utilTotal : 0;
    const real = soma(rows, (o) => o[8]), enviado = soma(rows, (o) => o[7]), perda = soma(rows, (o) => o[9]);
    const porDia = new Map();
    for (const o of rows) { const x = porDia.get(o[6]) || { q: 0, n: 0, perda: 0, env: 0 }; x.q += o[8]; x.n += 1; x.perda += o[9]; x.env += o[7]; porDia.set(o[6], x); }
    let acc = 0, uteisAcc = 0;
    const diario = dias.map((d) => {
      const x = porDia.get(d) || { q: 0, n: 0, perda: 0, env: 0 };
      const util = ehUtil(d, P.feriados); if (util) uteisAcc++;
      acc += x.q;
      const dentro = d <= ate;
      const metaAcc = metaDia && dentro ? metaDia * uteisAcc : null;
      return { data: d, util, q: x.q, n: x.n, perda: x.perda, env: x.env, acc: dentro ? acc : null, metaAcc, pctAcc: metaAcc ? acc / metaAcc : null };
    });
    const uteis = diario.filter((d) => d.util && d.data <= ate);
    const comApont = uteis.filter((d) => d.q > 0);
    const uteisDecorridos = uteis.length;
    const metaAteHoje = metaDia * uteisDecorridos;
    const tipos = {};
    for (const o of rows) { const t = o._tipo; const x = tipos[t] || (tipos[t] = { tipo: t, q: 0, n: 0, env: 0, perda: 0 }); x.q += o[8]; x.n++; x.env += o[7]; x.perda += o[9]; }
    const lts = rows.filter((o) => o[5]).map((o) => diasEntre(o[5], o[6]));
    return {
      k, nome: NOMES[k], meta, real, ops: rows.length, enviado, perda, perdaPct: enviado ? perda / enviado : 0,
      pct: meta ? real / meta : null, saldo: meta ? real - meta : null,
      situacao: !meta ? 'Sem meta lançada' : real / meta >= 1 ? 'Meta do mês atingida' : real / meta >= BSC ? 'Dentro da meta do BSC' : 'Abaixo da meta do BSC',
      metaDia, metaAteHoje, pctRitmo: parcial && metaAteHoje ? real / metaAteHoje : null,
      pecasPorOp: rows.length ? real / rows.length : 0,
      diasComApontamento: comApont.length, mediaPorDiaUtil: comApont.length ? soma(comApont, (d) => d.q) / comApont.length : 0,
      maiorDia: Math.max(0, ...diario.map((d) => d.q)),
      leadTime: lts.length ? soma(lts, (x) => x) / lts.length : 0,
      diario, tipos,
    };
  }

  /* ---------- cálculo de um mês: OM, OS, comparativo ---------- */
  // cfg: { metas: { om: {mes: n}, os: {...} }, feriados: [iso], tipos: {produto: tipo}, naoConsidera: [produto], ate: iso }
  function calcularMes(mes, rows, cfg) {
    const P = preparar(cfg);
    const total = ultimoDiaDoMes(mes);
    const ini = mes + '-01', fim = mes + '-' + pad(total);
    const ate = cfg && cfg.ate && cfg.ate < fim ? (cfg.ate < ini ? ini : cfg.ate) : fim;
    const parcial = ate < fim;
    const dias = [];
    for (let d = 1; d <= total; d++) dias.push(mes + '-' + pad(d));
    const utilTotal = dias.filter((d) => ehUtil(d, P.feriados)).length;
    const ctx = { P, dias, utilTotal, ate, parcial };
    const om = [], os = [], foraMod = [];
    for (const r of rows) {
      const c = classificar(r, P); const o = r.slice(); o._tipo = c.tipo;
      if (c.om) om.push(o);
      else if (modOM(r[4])) foraMod.push({ motivo: 'OM: sequência diferente de 01', q: r[8] });
      if (c.os) os.push(o);
      else if (modOS(r[4])) foraMod.push({ motivo: 'OS: produto em Não considera', q: r[8] });
    }
    const a = calcularUm('om', mes, om, ctx), b = calcularUm('os', mes, os, ctx);
    // tipos juntos (OM e OS), na ordem fixa e depois os demais
    const nomes = new Set([...Object.keys(a.tipos), ...Object.keys(b.tipos)]);
    const lista = [...TIPOS_FIXOS.filter((t) => nomes.has(t)), ...[...nomes].filter((t) => !TIPOS_FIXOS.includes(t)).sort()];
    const vazio = { q: 0, n: 0, env: 0, perda: 0 };
    const porTipo = lista.map((t) => ({ tipo: t, om: a.tipos[t] || vazio, os: b.tipos[t] || vazio }));
    const dif = {};
    for (const f of foraMod) dif[f.motivo] = (dif[f.motivo] || 0) + f.q;
    const metaTotal = a.meta && b.meta ? a.meta + b.meta : 0;
    const realTotal = a.real + b.real;
    return {
      mes, nome: nomeMes(mes), ate, extracao: (cfg && cfg.ate) || '', parcial, diasUteis: utilTotal,
      uteisDecorridos: a.diario.filter((d) => d.util && d.data <= ate).length,
      om: a, os: b, porTipo,
      total: { real: realTotal, meta: metaTotal, pct: metaTotal ? realTotal / metaTotal : null, ops: a.ops + b.ops, enviado: a.enviado + b.enviado, perda: a.perda + b.perda, perdaPct: a.enviado + b.enviado ? (a.perda + b.perda) / (a.enviado + b.enviado) : 0 },
      fora: dif,
    };
  }

  /* ---------- base: substituir só os meses escolhidos ---------- */
  function substituirMeses(base, novos, info) {
    const meses = Object.assign({}, (base && base.meses) || {});
    for (const m of Object.keys(novos)) {
      meses[m] = { rows: novos[m], savedAt: (info && info.savedAt) || new Date().toISOString(), por: (info && info.por) || '', arquivo: (info && info.arquivo) || '', ate: (info && info.ate) || '' };
    }
    return { v: 2, savedAt: (info && info.savedAt) || new Date().toISOString(), meses };
  }
  function calcularBase(base, config) {
    const out = {};
    for (const m of Object.keys((base && base.meses) || {}).sort()) {
      const b = base.meses[m];
      out[m] = calcularMes(m, b.rows, Object.assign({}, config, { ate: b.ate }));
    }
    return out;
  }

  /* ---------- abas extras do Relatório Geral (compactas: um dashboard + o dia a dia do mês mais recente) ---------- */
  const r2 = (x) => Math.round(x * 100000) / 100000; // fração (0,9694); o Excel mostra como porcentagem pelo formato da célula
  const dm = (d) => d.split('-').reverse().join('/');
  const barra = (v, max, n) => '█'.repeat(max > 0 ? Math.round((v / max) * (n || 20)) : 0);
  function abasRelatorio(base, config) {
    const calc = calcularBase(base, config), chaves = Object.keys(calc);
    if (!chaves.length) return [];
    const ult = calc[chaves[chaves.length - 1]];
    const mesLabel = (c) => c.nome + (c.parcial ? ' (parcial até ' + dm(c.ate) + ')' : '');
    const lin = (rot, om, os, fmt) => ({ 'Indicador': rot, 'OM (separa)': om, 'OS (estoca)': os, 'OM + OS': fmt == null ? '' : fmt });
    const L = (c) => [
      lin('Meta do mês (peças)', c.om.meta || '', c.os.meta || '', c.total.meta || ''),
      lin('Real (peças)', c.om.real, c.os.real, c.total.real),
      lin('% da meta', c.om.pct == null ? '' : r2(c.om.pct), c.os.pct == null ? '' : r2(c.os.pct), c.total.pct == null ? '' : r2(c.total.pct)),
      lin('Saldo contra a meta', c.om.saldo == null ? '' : c.om.saldo, c.os.saldo == null ? '' : c.os.saldo, c.om.saldo != null && c.os.saldo != null ? c.om.saldo + c.os.saldo : ''),
      lin('OPs apontadas', c.om.ops, c.os.ops, c.total.ops),
      lin('Enviado (Quantidade das OPs)', c.om.enviado, c.os.enviado, c.total.enviado),
      lin('Perda (peças)', c.om.perda, c.os.perda, c.total.perda),
      lin('% de perda (perda ÷ enviado)', r2(c.om.perdaPct), r2(c.os.perdaPct), r2(c.total.perdaPct)),
      lin('Meta por dia útil', Math.round(c.om.metaDia) || '', Math.round(c.os.metaDia) || ''),
      lin('Média por dia útil com apontamento', Math.round(c.om.mediaPorDiaUtil), Math.round(c.os.mediaPorDiaUtil)),
      lin('Maior dia (peças)', c.om.maiorDia, c.os.maiorDia),
      lin('Situação', c.om.situacao, c.os.situacao),
    ];
    const dash = [{ 'Indicador': 'I 09 · ' + mesLabel(ult), 'OM (separa)': '', 'OS (estoca)': '', 'OM + OS': '' }, ...L(ult)];
    const mm = [];
    for (const m of chaves) { const c = calc[m]; for (const k of ['om', 'os']) { const x = c[k]; mm.push({ 'Mês': mesLabel(c), 'Indicador': NOMES[k], 'Meta (peças)': x.meta || '', 'Real (peças)': x.real, '% da meta': x.pct == null ? '' : r2(x.pct), 'Saldo': x.saldo == null ? '' : x.saldo, 'OPs': x.ops, 'Enviado': x.enviado, 'Perda': x.perda, '% de perda': r2(x.perdaPct) }); } }
    const maxT = Math.max(1, ...ult.porTipo.map((t) => Math.max(t.om.q, t.os.q)));
    const tipos = ult.porTipo.map((t) => ({ 'Tipo': t.tipo, 'OM peças': t.om.q, 'OM % de perda': r2(t.om.env ? t.om.perda / t.om.env : 0), 'OM': barra(t.om.q, maxT), 'OS peças': t.os.q, 'OS % de perda': r2(t.os.env ? t.os.perda / t.os.env : 0), 'OS': barra(t.os.q, maxT) }));
    const maxD = Math.max(1, ...ult.om.diario.map((d, i) => Math.max(d.q, ult.os.diario[i].q)));
    const dia = [];
    ult.om.diario.forEach((d, i) => {
      if (d.data > ult.ate) return; const e = ult.os.diario[i];
      dia.push({ 'Data': dm(d.data), 'Dia útil': d.util ? 'Sim' : 'Não', 'OM peças': d.q, 'OM acumulado': d.acc, 'OM % da meta acum.': d.pctAcc == null ? '' : r2(d.pctAcc), 'OM perda': d.perda, 'OM': barra(d.q, maxD),
        'OS peças': e.q, 'OS acumulado': e.acc, 'OS % da meta acum.': e.pctAcc == null ? '' : r2(e.pctAcc), 'OS perda': e.perda, 'OS': barra(e.q, maxD) });
    });
    // Formato de cada célula: porcentagem onde é porcentagem, número com separador de milhar onde é valor, texto onde é texto.
    const PCT1 = '0.0%', PCT2 = '0.00%', PCT0 = '0%', NUM = '#,##0', SALDO = '+#,##0;-#,##0;0';
    const zDash = (r, h) => {
      if (h === 'Indicador') return null;
      const rot = String(r['Indicador']);
      if (rot === '% da meta') return PCT1;
      if (rot.indexOf('% de perda') === 0) return PCT2;
      if (rot === 'Saldo contra a meta') return SALDO;
      if (rot === 'Situação' || rot.indexOf('I 09 ·') === 0) return null;
      return NUM;
    };
    const zCol = (r, h) => {
      if (h === '% de perda' || /% de perda$/.test(h)) return PCT2;
      if (/^(OM|OS) % da meta acum\./.test(h)) return PCT0;
      if (/% da meta/.test(h)) return PCT1;
      if (h === 'Saldo') return SALDO;
      if (/^(Mês|Indicador|Tipo|Data|Dia útil|OM|OS)$/.test(h)) return null;
      return typeof r[h] === 'number' ? NUM : null;
    };
    const larg = (rows) => { const ks = Object.keys(rows[0] || {}); return ks.map((k, i) => Math.max(k.length, ...rows.map((r) => String(r[k] == null ? '' : r[k]).length), 8) + 2); };
    return [{ name: 'I09 Dashboard', rows: dash, z: zDash, cols: [46, 18, 18, 18] }, { name: 'I09 Mês a mês', rows: mm, z: zCol, cols: larg(mm) },
      { name: 'I09 Por tipo', rows: tipos, z: zCol, cols: [16, 12, 14, 24, 12, 14, 24] }, { name: 'I09 Por dia', rows: dia, z: zCol, cols: larg(dia).map((w, i) => (i === 6 || i === 11 ? 24 : Math.min(w, 18))) }];
  }

  /* ---------- XLSX em paisagem ----------
   * O SheetJS gratuito não grava a orientação da página. Aqui o .xlsx pronto é reaberto (é um zip), cada aba pedida
   * ganha "paisagem + ajustar à largura de 1 página" e o zip é refeito. Só mexe nas abas indicadas; o resto fica igual. */
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function fluxo(Ctor, formato, u8) { const s = new Blob([u8]).stream().pipeThrough(new Ctor(formato)); return new Uint8Array(await new Response(s).arrayBuffer()); }
  const inflar = (u8) => fluxo(DecompressionStream, 'deflate-raw', u8);
  const deflar = (u8) => fluxo(CompressionStream, 'deflate-raw', u8);
  function lerZip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('zip inválido');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const itens = [];
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip inválido (diretório)');
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const it = { metodo: dv.getUint16(p + 10, true), hora: dv.getUint16(p + 12, true), data: dv.getUint16(p + 14, true), crc: dv.getUint32(p + 16, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true), nome: new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)), flags: dv.getUint16(p + 8, true) & ~8 };
      const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true), ini = off + 30 + lnl + lxl;
      it.bruto = u8.subarray(ini, ini + it.csize); itens.push(it); p += 46 + nl + xl + cl;
    }
    return itens;
  }
  function montarZip(itens) {
    const enc = new TextEncoder(), partes = [], cds = []; let pos = 0;
    for (const it of itens) {
      const nome = enc.encode(it.nome), h = new Uint8Array(30 + nome.length), dv = new DataView(h.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, it.flags | 0x0800, true); dv.setUint16(8, it.metodo, true);
      dv.setUint16(10, it.hora, true); dv.setUint16(12, it.data, true); dv.setUint32(14, it.crc, true); dv.setUint32(18, it.bruto.length, true); dv.setUint32(22, it.usize, true);
      dv.setUint16(26, nome.length, true); h.set(nome, 30);
      const c = new Uint8Array(46 + nome.length), cv = new DataView(c.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, it.flags | 0x0800, true); cv.setUint16(10, it.metodo, true);
      cv.setUint16(12, it.hora, true); cv.setUint16(14, it.data, true); cv.setUint32(16, it.crc, true); cv.setUint32(20, it.bruto.length, true); cv.setUint32(24, it.usize, true);
      cv.setUint16(28, nome.length, true); cv.setUint32(42, pos, true); c.set(nome, 46);
      partes.push(h, it.bruto); cds.push(c); pos += h.length + it.bruto.length;
    }
    const tam = cds.reduce((s, x) => s + x.length, 0), fim = new Uint8Array(22), fv = new DataView(fim.buffer);
    fv.setUint32(0, 0x06054b50, true); fv.setUint16(8, itens.length, true); fv.setUint16(10, itens.length, true); fv.setUint32(12, tam, true); fv.setUint32(16, pos, true);
    const out = new Uint8Array(pos + tam + 22); let o = 0; for (const x of [...partes, ...cds, fim]) { out.set(x, o); o += x.length; } return out;
  }
  const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const decXml = (s) => String(s).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  function paisagemNoXml(xml) {
    let s = xml;
    if (!/<pageSetup\b/.test(s)) {
      const ps = '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
      if (/<pageMargins\b[^>]*\/>/.test(s)) s = s.replace(/(<pageMargins\b[^>]*\/>)/, '$1' + ps);
      else {
        // o Excel exige a ordem do esquema: pageMargins e pageSetup vêm ANTES de headerFooter, ignoredErrors, drawing, tableParts etc.
        const novo = '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' + ps;
        const depois = /<(headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s/>]/.exec(s);
        if (depois) s = s.slice(0, depois.index) + novo + s.slice(depois.index);
        else s = s.replace('</worksheet>', novo + '</worksheet>');
      }
    }
    if (!/<pageSetUpPr\b/.test(s)) {
      if (/<sheetPr\s*\/>/.test(s)) s = s.replace(/<sheetPr\s*\/>/, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
      else if (/<sheetPr\b[^>]*\/>/.test(s)) s = s.replace(/<sheetPr\b([^>]*)\/>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/></sheetPr>');
      else if (/<sheetPr\b/.test(s)) s = s.replace('</sheetPr>', '<pageSetUpPr fitToPage="1"/></sheetPr>');
      else s = s.replace(/(<worksheet\b[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    }
    return s;
  }
  async function paisagemXlsx(bytes, nomesAbas) {
    const itens = lerZip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), por = {}; itens.forEach((i) => { por[i.nome] = i; });
    const texto = async (n) => { const it = por[n]; if (!it) return ''; return new TextDecoder().decode(it.metodo === 8 ? await inflar(it.bruto) : it.bruto); };
    const wb = await texto('xl/workbook.xml'), rels = await texto('xl/_rels/workbook.xml.rels'), alvo = new Set(nomesAbas);
    const destinos = [];
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const nome = (/\bname="([^"]*)"/.exec(m[0]) || [])[1], rid = (/\br:id="([^"]*)"/.exec(m[0]) || [])[1];
      if (nome == null || !alvo.has(decXml(nome))) continue;
      const rel = new RegExp('<Relationship\\b[^>]*\\bId="' + rid + '"[^>]*>').exec(rels), alvoArq = rel && /\bTarget="([^"]*)"/.exec(rel[0]);
      if (alvoArq) destinos.push(alvoArq[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'));
    }
    for (const d of destinos) {
      const it = por[d]; if (!it) continue;
      const novo = new TextEncoder().encode(paisagemNoXml(await texto(d)));
      const bruto = await deflar(novo);
      it.bruto = bruto; it.metodo = 8; it.crc = crc32(novo); it.usize = novo.length;
    }
    return montarZip(itens);
  }

  return { MODS, NOMES, DESCR, REGRA, MESES, BSC, SEM_TIPO, TIPOS_FIXOS, toISO, norm, lerSC2, lerTipos, lerNaoConsidera, porMes, validarLinhas, classificar, calcularMes, calcularBase, substituirMeses, abasRelatorio, paisagemXlsx, nomeMes, ehUtil };
});
