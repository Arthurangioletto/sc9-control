/* Painel executivo do Histórico de Atraso (tela). Aparece em /historico-atraso.html?painel=1 e fica acima do conteúdo que já existe:
 * nada da página atual foi removido. Só lê o que a página já carregou; não grava nada. Gráficos em SVG/HTML puros, sem biblioteca.
 * Cores: vermelho = pior, verde = melhor, amarelo = atenção, cinza = neutro. Os gráficos usam azul e cinza (cor de dado, nunca de estado).
 * A cor nunca é o único sinal: sempre vem com seta ou texto ("pior", "melhor", "atenção", "estável"). */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  const P = () => root.SC9AtrasoPainel;
  const T = () => root.SC9HistAtrasoTela;
  const NS = 'http://www.w3.org/2000/svg';
  const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const fmtI = (n) => Number(Math.round(n || 0)).toLocaleString('pt-BR');
  const ddmm = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const ddmmaaaa = (d) => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
  const brlCurto = (v) => (v >= 999500 ? 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : v >= 1e3 ? 'R$ ' + Math.round(v / 1e3).toLocaleString('pt-BR') + ' mil' : 'R$ ' + Math.round(v).toLocaleString('pt-BR'));
  const semanaLonga = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' }).replace(/^./, (c) => c.toUpperCase());
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const TOM_TXT = { bom: 'melhor', ruim: 'pior', atencao: 'atenção', neutro: 'estável' };
  const TOM_ICONE = { bom: '✔', ruim: '✖', atencao: '⚠', neutro: '●' };
  const COR = { estoque: '#1c5cab', faturamento: '#86b6ef', linha: '#14233d', ref: '#8a94a8', grade: '#e3e9f2', texto: '#5b6a84' };

  const h = (tag, props, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k.startsWith('aria-') && typeof v === 'boolean') { e.setAttribute(k, String(v)); continue; } // aria-pressed/selected/expanded precisam de "true"/"false" (antes saía vazio ou sumia)
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const f of filhos.flat(Infinity)) { if (f == null || f === false) continue; e.appendChild(typeof f === 'string' || typeof f === 'number' ? document.createTextNode(String(f)) : f); }
    return e;
  };
  const s = (tag, attrs, ...filhos) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    for (const f of filhos.flat(Infinity)) if (f) e.appendChild(f);
    return e;
  };

  // ---------- estado do painel (período e filtros globais; vai para a URL) ----------
  const q = new URLSearchParams(location.search);
  const TV = q.get('modo') === 'tv';
  const MOB = !TV && typeof matchMedia === 'function' && matchMedia('(max-width:640px)').matches; // gráficos em viewBox estreito no celular: rótulos legíveis
  const TV_SLIDES = 6; // telas do rodízio da TV
  const dataIsoValida = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
  const S = { slide: 0, timer: 0, per: ['7', '15', '30', 'mes', 'custom'].includes(q.get('p')) ? q.get('p') : '30', arm: q.get('arm') || '', transp: q.get('tr') || '', de: q.get('de') || '', ate: q.get('ate') || '', ver: {}, taxa: 'semana', prod: 'pedidos', calor: 'faixa', mais: false };
  // período personalizado da URL com data inválida ou faltando: volta para 30 dias (antes derrubava a página)
  if (S.per === 'custom' && !(dataIsoValida(S.de) && dataIsoValida(S.ate))) { S.per = '30'; S.de = ''; S.ate = ''; }
  let sincArm = '', sincTr = ''; // último valor dos filtros que o painel e a lista já combinaram entre si
  function guardarNaUrl() {
    try {
      const u = new URL(location.href);
      const set = (k, v, padrao) => { if (v && v !== padrao) u.searchParams.set(k, v); else u.searchParams.delete(k); };
      set('p', S.per, '30'); set('arm', S.arm, ''); set('tr', S.transp, '');
      if (S.per === 'custom') { set('de', S.de, ''); set('ate', S.ate, ''); } else { u.searchParams.delete('de'); u.searchParams.delete('ate'); }
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* sem histórico de navegação */ }
  }
  const mudar = (fn) => { fn(); guardarNaUrl(); const f = T().estado.filtro; f.arm = S.arm; f.transp = S.transp; sincArm = S.arm; sincTr = S.transp; T().desenhar(); };
  const global = () => ({ arm: S.arm, transp: S.transp });

  // ---------- estilos ----------
  const CSS = `
  body.com-painel header.topo .sobre, body.com-painel header.topo h1, body.com-painel header.topo .mudo, body.com-painel header.topo .atualizado { display:none; }
  body.com-painel header.topo { justify-content:flex-end; margin-bottom:-4px; }
  .pn { display:flex; flex-direction:column; gap:18px; }
  .pn-hero { position:relative; overflow:hidden; border-radius:20px; padding:26px 28px 22px; color:#fff; background:linear-gradient(135deg,#0c2347 0%,#123b7a 55%,#1c5cab 100%); box-shadow:0 10px 30px rgba(18,59,122,.25); }
  .pn-hero::after { content:''; position:absolute; right:-60px; top:-80px; width:300px; height:300px; border-radius:50%; background:rgba(255,255,255,.06); }
  .pn-hero-topo { display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:flex-start; position:relative; z-index:1; }
  .pn-kicker { margin:0; font-size:12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:#b9cdf0; }
  .pn-h1 { margin:4px 0 0; font-size:30px; font-weight:800; letter-spacing:-.02em; line-height:1.15; }
  .pn-frase { position:relative; z-index:1; margin:14px 0 0; font-size:19px; line-height:1.4; font-weight:600; color:#eaf1ff; max-width:980px; }
  .pn-hero-meta { position:relative; z-index:1; margin-top:14px; display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; font-size:13px; color:#b9cdf0; }
  .pn-veredito-chip { display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:99px; font-weight:800; font-size:13.5px; background:rgba(255,255,255,.16); color:#fff; }
  .pn-veredito-chip.bom { background:#1f8a4c; } .pn-veredito-chip.ruim { background:#c63828; } .pn-veredito-chip.atencao { background:#e8a200; color:#1b1500; }
  .pn-barra { background:#fff; border:1px solid var(--line); border-radius:14px; padding:10px 14px; display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; justify-content:space-between; box-shadow:0 1px 2px rgba(20,35,61,.04); }
  .pn-barra .grupo-c { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
  .pn-barra label { display:flex; flex-direction:column; gap:3px; font-size:11.5px; font-weight:700; color:#5b6a84; letter-spacing:.02em; }
  .pn-selo { display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:99px; font-size:12.5px; font-weight:700; background:rgba(255,255,255,.14); color:#fff; border:1px solid rgba(255,255,255,.25); }
  .pn-selo.atencao { background:#fff4d6; color:#7a5200; border-color:#f1d78f; } .pn-selo.desatualizado { background:#fdf1ef; color:#a62a1c; border-color:#f3cfc9; }
  .pn-aviso { background:#fff4d6; border:1px solid #f1d78f; color:#6d4700; border-radius:12px; padding:10px 14px; font-size:13px; font-weight:600; }
  .pn-cards { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:14px; }
  .pn-card { grid-column:span 1; text-align:left; font:inherit; background:#fff; border:1px solid var(--line); border-radius:16px; padding:16px 16px 14px; cursor:pointer; position:relative; overflow:hidden; display:flex; flex-direction:column; gap:4px; min-width:0; color:var(--ink); box-shadow:0 1px 2px rgba(20,35,61,.04); }
  .pn-card::before { content:''; position:absolute; left:0; right:0; top:0; height:4px; background:#d3dae7; } .pn-card.bom::before { background:var(--green); } .pn-card.ruim::before { background:var(--red); } .pn-card.atencao::before { background:#e8a200; }
  .pn-card:hover { border-color:#9fb4d6; box-shadow:0 6px 18px rgba(20,35,61,.10); transform:translateY(-1px); }
  .pn-card.destaque { grid-column:span 2; background:linear-gradient(180deg,#fff,#f6f9ff); } .pn-card .t { font-size:12.5px; font-weight:700; color:#5b6a84; min-height:2.4em; line-height:1.2; }
  .pn-card .v { font-size:38px; font-weight:800; line-height:1.05; letter-spacing:-.03em; font-variant-numeric:tabular-nums; } .pn-card.destaque .v { font-size:56px; }
  .pn-card .v.brl { font-size:28px; }
  .pn-card .d { font-size:12px; font-weight:700; display:flex; flex-wrap:wrap; gap:4px 6px; align-items:center; margin-top:2px; }
  .pn-chip { display:inline-flex; gap:4px; align-items:center; padding:3px 9px; border-radius:99px; font-size:12px; font-weight:700; background:#eef1f6; color:#43506a; white-space:nowrap; }
  .pn-chip.bom { background:#e6f6ec; color:#0f6b3a; } .pn-chip.ruim { background:#fdeceb; color:#a62a1c; } .pn-chip.atencao { background:#fff1cc; color:#7a5200; }
  .pn-tom { font-size:12px; font-weight:800; color:#5b6a84; } .pn-tom.bom { color:#0f6b3a; } .pn-tom.ruim { color:#a62a1c; } .pn-tom.atencao { color:#7a5200; }
  .pn-card .s { font-size:11.5px; color:#6b7890; } .pn-card svg.spark { margin-top:6px; }
  .pn-split { display:flex; height:8px; border-radius:99px; overflow:hidden; background:#eef1f6; margin-top:8px; } .pn-split span { display:block; height:100%; }
  .pn-mais summary { cursor:pointer; font-weight:700; color:var(--accent); font-size:13.5px; margin:0 0 12px; list-style:none; } .pn-mais summary::-webkit-details-marker { display:none; } .pn-mais summary::before { content:'＋ '; } .pn-mais[open] summary::before { content:'－ '; }
  .pn-mais .pn-cards { grid-template-columns:repeat(5,minmax(0,1fr)); }
  .pn-par { display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:18px; }
  .pn-bloco { grid-column:span 12; background:#fff; border:1px solid var(--line); border-radius:18px; padding:20px 22px; min-width:0; box-shadow:0 1px 2px rgba(20,35,61,.04); }
  .pn-bloco.m12 { grid-column:span 12; } .pn-bloco.m7 { grid-column:span 7; } .pn-bloco.m5 { grid-column:span 5; } .pn-bloco.m4 { grid-column:span 4; } .pn-bloco.m6 { grid-column:span 6; }
  .pn-bloco h2 { font-size:18px; margin:0; letter-spacing:-.01em; } .pn-bloco .sub { font-size:13px; color:#5b6a84; margin:3px 0 10px; font-weight:500; }
  .pn-topo { display:flex; flex-wrap:wrap; gap:8px; justify-content:space-between; align-items:flex-start; }
  .pn-seg { display:inline-flex; background:#eef1f6; border-radius:10px; padding:3px; gap:2px; } .pn-seg button { font:inherit; font-size:12.5px; font-weight:700; padding:5px 12px; border:0; border-radius:8px; background:transparent; color:#43506a; cursor:pointer; }
  .pn-seg button[aria-pressed=true] { background:#fff; color:var(--accent); box-shadow:0 1px 3px rgba(20,35,61,.15); }
  .pn-link { font:inherit; font-size:12.5px; font-weight:700; color:var(--accent); background:none; border:0; padding:6px 4px; cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
  .pn-kpis { display:flex; flex-wrap:wrap; gap:10px; margin:2px 0 10px; } .pn-kpi { background:#eef3fb; border-radius:12px; padding:8px 14px; flex:1 1 130px; } .pn-kpi b { display:block; font-size:24px; line-height:1.1; color:#14233d; font-variant-numeric:tabular-nums; } .pn-kpi span { display:block; font-size:12px; color:#5b6a84; margin-top:2px; } .pn-kpi.principal { background:#14233d; } .pn-kpi.principal b, .pn-kpi.principal span { color:#fff; }
  .pn-leg { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:12px; color:#5b6a84; margin-top:8px; } .pn-leg i { display:inline-block; width:11px; height:11px; border-radius:3px; margin-right:5px; vertical-align:-1px; } .pn-leg i.linha { height:3px; border-radius:2px; vertical-align:3px; }
  .pn-svg { width:100%; height:auto; display:block; } .pn-svg text { font:11px system-ui,sans-serif; fill:#6b7890; } .pn-svg .ponto { cursor:pointer; outline:none; } .pn-svg .ponto:focus-visible rect.foco { stroke:#123b7a; stroke-width:2; }
  .pn-svg .ponto:hover rect.fundo { fill:#123b7a; fill-opacity:.08; }
  .pn-tab { width:100%; border-collapse:collapse; font-size:13px; } .pn-tab th { text-align:left; background:var(--soft); padding:7px 9px; font-size:12px; } .pn-tab td { padding:6px 9px; border-top:1px solid var(--line); font-variant-numeric:tabular-nums; } .pn-tab .num { text-align:right; }
  .pn-rolagem { max-height:320px; overflow:auto; border:1px solid var(--line); border-radius:12px; }
  .pn-linha { display:grid; grid-template-columns:150px minmax(120px,1fr) 210px; gap:12px; align-items:center; width:100%; text-align:left; font:inherit; background:none; border:0; padding:8px 6px; border-radius:10px; cursor:pointer; color:var(--ink); } .pn-linha:hover { background:#f3f6fb; } .pn-linha.sel { background:#eaf1ff; }
  .pn-linha .nome { font-weight:700; font-size:14px; } .pn-linha .nome small { display:block; font-weight:500; font-size:11.5px; color:#6b7890; } .pn-linha .num { font-size:12.5px; color:#43506a; text-align:right; font-variant-numeric:tabular-nums; line-height:1.3; }
  .pn-trilho { display:flex; height:20px; background:#f1f4f9; border-radius:99px; overflow:hidden; } .pn-trilho span { display:block; height:100%; }
  .pn-colunas { display:flex; align-items:flex-end; gap:14px; height:190px; padding-top:14px; } .pn-col { flex:1 1 0; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:3px; font-size:12px; min-width:0; }
  .pn-col .barra { width:100%; border-radius:8px 8px 0 0; min-height:3px; } .pn-col .fantasma { position:absolute; left:0; right:0; bottom:0; border:2px dashed #14233d; border-bottom:0; border-radius:8px 8px 0 0; pointer-events:none; }
  .pn-col .qtd { font-weight:800; font-size:20px; line-height:1; } .pn-col .lab { font-size:12px; color:#43506a; text-align:center; line-height:1.2; font-weight:600; }
  .pn-nota { font-size:12px; color:#6b7890; margin-top:8px; }
  .pn-vazio { text-align:center; padding:26px 10px; color:#5b6a84; font-weight:600; }
  .pn-sep { margin:10px 0 -6px; font-size:13px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:#5b6a84; }
  .pn-so-print { display:none; }
  body.modo-tv { background:#0c1b36; } body.modo-tv #app { max-width:none; padding:18px 30px 30px; }
  body.modo-tv #app > :not(#pn-raiz), body.modo-tv #ocorrencias-box { display:none !important; }
  body.modo-tv .pn-barra, body.modo-tv .pn-link, body.modo-tv .pn-seg, body.modo-tv .pn-mais, body.modo-tv .pn-sep, body.modo-tv .pn-nota, body.modo-tv .pn-fluxo, body.modo-tv .pn-dow { display:none !important; }
  .pn-cards.cinco { grid-template-columns:repeat(5,minmax(0,1fr)); }
  .pn-mini { display:flex; flex-wrap:wrap; gap:8px 18px; align-items:center; justify-content:space-between; color:#fff; padding:12px 18px; border-radius:16px; background:linear-gradient(135deg,#0c2347,#123b7a); } .pn-mini b { font-size:22px; } .pn-mini span { font-size:15px; color:#cfe0ff; }
  body.modo-tv .pn-slide { display:none; flex-direction:column; gap:18px; } body.modo-tv .pn-slide.ativo { display:flex; }
  body.modo-tv .pn-hero { box-shadow:none; border:1px solid rgba(255,255,255,.15); }
  .pn-tv-rodape { display:flex; justify-content:space-between; align-items:center; gap:12px; color:#9fb4d6; font-size:13px; }
  .pn-pontos { display:flex; gap:8px; } .pn-pontos i { width:34px; height:6px; border-radius:99px; background:rgba(255,255,255,.25); } .pn-pontos i.ativo { background:#fff; }
  .pn-prio-grid { display:grid; grid-template-columns:1fr 1fr; gap:22px; } .pn-prio-item { display:grid; grid-template-columns:58px 1fr; gap:10px; align-items:baseline; padding:8px 0; border-top:1px solid var(--line); font-size:14px; }
  .pn-prio-item:first-child { border-top:0; } .pn-prio-item b { font-size:22px; font-weight:800; font-variant-numeric:tabular-nums; text-align:right; } .pn-prio-item.crit b { color:var(--red); } .pn-prio-item small { display:block; color:#6b7890; font-size:12px; }
  body.modo-tv .pn-linha { padding:22px 8px; } body.modo-tv .pn-linha .nome { font-size:17px; } body.modo-tv .pn-linha .num { font-size:15px; } body.modo-tv .pn-trilho { height:26px; }
  body.modo-tv #pn-distribuicao { grid-column:span 5; } body.modo-tv #pn-prioridades { grid-column:span 7; } body.modo-tv .pn-prio-item { padding:5px 0; } body.modo-tv .pn-colunas { height:230px; }
  @media (min-width:1700px) { body.modo-tv .pn { zoom:1.4; } }
  @media (min-width:2400px) { body.modo-tv .pn { zoom:2; } }
  @media (max-width:1100px) { .pn-prio-grid { grid-template-columns:1fr; } }
  @media (max-width:1100px) { .pn-cards { grid-template-columns:repeat(3,minmax(0,1fr)); } .pn-mais .pn-cards { grid-template-columns:repeat(3,minmax(0,1fr)); } .pn-bloco.m7,.pn-bloco.m5,.pn-bloco.m4,.pn-bloco.m6 { grid-column:span 12; } }
  @media (max-width:640px) { .pn-hero { padding:20px 18px; } .pn-h1 { font-size:23px; } .pn-frase { font-size:16px; } .pn-cards,.pn-mais .pn-cards { grid-template-columns:repeat(2,minmax(0,1fr)); } .pn-card.destaque { grid-column:span 2; } .pn-card .v { font-size:30px; } .pn-card.destaque .v { font-size:46px; } .pn-linha { grid-template-columns:96px 1fr; } .pn-linha .num { grid-column:1 / -1; text-align:left; } .pn-bloco { padding:16px; } }
  @media (prefers-reduced-motion:no-preference) { .pn-card { transition:box-shadow .15s, border-color .15s, transform .15s; } }
  @media print { body.com-painel #app > :not(#pn-raiz), body.com-painel #ocorrencias-box, .pn-barra, .pn-tv-rodape { display:none !important; } .pn-so-print { display:block; } .pn-hero { box-shadow:none; padding:16px 20px; } .pn-h1 { font-size:22px; } .pn-frase { font-size:15px; } .pn-cards { grid-template-columns:repeat(7,minmax(0,1fr)); gap:8px; } .pn-card .v { font-size:26px; } .pn-card.destaque .v { font-size:36px; } .pn-card svg.spark { display:none; } .pn-card:hover { transform:none; } .pn-bloco { padding:12px 14px; } .pn-tab { font-size:10.5px; } .pn-rolagem { max-height:none; overflow:visible; border:0; } .pn-quebra { break-before:page; } body { background:#fff !important; } .pn-par { display:grid !important; grid-template-columns:1fr 1fr; gap:10px; margin:10px 0; } .pn-bloco, .pn-bloco.m7, .pn-bloco.m5, .pn-bloco.m6 { grid-column:span 1 !important; margin:0 !important; } #pn-distribuicao { grid-column:span 2 !important; } .pn-fluxo, .pn-dow, .pn-sep, .pn-leg span:last-child { display:none !important; } .pn-colunas { height:130px; } .pn-linha { padding:3px 4px; } .pn-svg { max-height:165px; } .pn-hero-meta { margin-top:8px; } .pn-sub, .pn-bloco .sub { margin-bottom:4px; } .pn-so-print .pn-tab td { padding:3px 8px; } .pn-barra .grupo-c, .pn-seg, .pn-mais summary, .pn-link { display:none !important; } .pn-card, .pn-bloco, .pn-hero { break-inside:avoid; } .pn-par { display:block; } .pn-bloco { margin-bottom:12px; } @page { size:A4 landscape; margin:10mm; } * { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
  /* ---- gráficos extras: dica rica, cascata, mapa de calor, Pareto ---- */
  .pn-tip { position:fixed; z-index:60; left:0; top:0; display:none; pointer-events:none; max-width:300px; background:#14233d; color:#fff; border-radius:12px; padding:10px 13px; font-size:12.5px; line-height:1.5; box-shadow:0 10px 28px rgba(10,20,40,.35); }
  .pn-tip .t { display:block; font-size:13.5px; font-weight:800; margin-bottom:4px; } .pn-tip .l { display:flex; justify-content:space-between; gap:18px; } .pn-tip .l span { color:#cfe0ff; } .pn-tip .l b { font-variant-numeric:tabular-nums; }
  .pn-tip .l.forte span { color:#fff; font-weight:700; } .pn-tip .l i { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:6px; vertical-align:0; }
  .pn-tip .sep { border-top:1px solid rgba(255,255,255,.22); margin:5px 0; } .pn-tip .r { display:block; margin-top:5px; color:#9fb4d6; font-size:11.5px; }
  .pn-col .pn-chip { font-size:11px; padding:1px 7px; }
  .pn-linha .num b { display:block; font-size:14px; color:var(--ink); font-weight:800; } .pn-linha .num small { display:block; font-size:11.5px; color:#5b6a84; }
  .pn-calor { width:100%; border-collapse:separate; border-spacing:3px; table-layout:fixed; } .pn-calor th { font-size:11.5px; font-weight:700; color:#5b6a84; text-align:center; padding:2px 2px 5px; vertical-align:bottom; line-height:1.2; }
  .pn-calor th.crit { border-bottom:3px solid #c63828; } .pn-calor th:first-child, .pn-calor td:first-child { width:21%; text-align:left; } .pn-calor th.fim, .pn-calor td.fim { width:13%; }
  .pn-calor td { padding:0; } .pn-calor .rot { font:inherit; font-weight:800; font-size:13.5px; background:none; border:0; padding:6px 4px; cursor:pointer; color:var(--ink); text-align:left; width:100%; border-radius:8px; } .pn-calor .rot:hover, .pn-calor .rot.sel { background:#eaf1ff; }
  .pn-calor .rot small { display:block; font-weight:500; font-size:11px; color:#6b7890; }
  .pn-cel { display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; min-height:46px; border:0; border-radius:8px; font:inherit; cursor:pointer; padding:4px 2px; font-variant-numeric:tabular-nums; }
  .pn-cel b { font-size:16px; line-height:1.1; } .pn-cel small { font-size:10.5px; opacity:.85; } .pn-cel:hover { outline:2px solid #123b7a; outline-offset:1px; } .pn-cel:focus-visible { outline:3px solid #123b7a; outline-offset:1px; }
  .pn-calor tr.todos td { border-top:1px solid var(--line); } .pn-calor tr.todos .rot { cursor:default; } .pn-calor tr.todos .rot:hover { background:none; }
  .pn-calor .fim .pn-chip { font-size:12px; } .pn-escala { display:inline-block; width:90px; height:10px; border-radius:99px; background:linear-gradient(90deg,#eef3fb,#1c5cab); vertical-align:-1px; margin:0 6px; }
  .pn-svg .barra-click { cursor:pointer; outline:none; } .pn-svg .barra-click:hover rect.corpo, .pn-svg .ponto:hover rect.corpo { filter:brightness(1.08); } .pn-svg .barra-click:focus-visible rect.foco { stroke:#123b7a; stroke-width:2; }
  .pn-svg text.forte { font-weight:800; fill:#14233d; font-size:13px; } .pn-svg text.halo { paint-order:stroke; stroke:#fff; stroke-width:3px; stroke-linejoin:round; }
  .pn-dow .marca { position:absolute; top:0; bottom:0; width:2px; background:#14233d; box-shadow:0 0 0 1px #fff; }
  body.modo-tv #pn-distribuicao { grid-column:span 7; } body.modo-tv #pn-prioridades { grid-column:span 12; }
  .pn-par > .pn-bloco.m7 { min-width:0; }
  .pn-colunas { height:214px; }
  body.modo-tv .pn-colunas { height:250px; }
  @media (max-width:640px) { .pn-calor { border-spacing:2px; } .pn-calor th { font-size:10px; } .pn-calor .rot { font-size:12px; padding:4px 2px; } .pn-calor .rot small { display:none; } .pn-cel { min-height:40px; padding:2px 0; } .pn-cel b { font-size:14px; } .pn-cel small { font-size:9.5px; } .pn-calor th:first-child, .pn-calor td:first-child { width:19%; } .pn-calor .fim .pn-chip { font-size:11px; padding:2px 5px; } .pn-dow .pn-linha { grid-template-columns:44px 1fr !important; } .pn-dow .pn-linha .num { grid-column:1 / -1; } }
  @media print { .pn-tip { display:none !important; } #pn-pareto, #pn-cascata { grid-column:span 1 !important; order:2; } #pn-calor { grid-column:span 2 !important; order:1; } #pn-cascata .pn-svg, #pn-pareto .pn-svg { max-height:160px; } #pn-cascata .pn-nota, #pn-pareto .pn-nota, #pn-calor .pn-leg { display:none; } .pn-cel { min-height:24px !important; padding:1px 0 !important; } .pn-calor .rot small { display:none; } .pn-par .pn-linha { grid-template-columns:84px minmax(40px,1fr) 118px !important; gap:8px; } .pn-linha .num b { font-size:11px; } .pn-linha .num small { font-size:9.5px; } .pn-colunas { height:150px; } .pn-cel { min-height:30px; } .pn-cel b { font-size:13px; } .pn-calor .rot { padding:3px 4px; } .pn-cel small { display:none; } }
  /* ===== Polimento visual v2 (só acrescenta; nada acima foi removido) ===== */
  /* Tela larga: aproveita o monitor sem esticar demais a leitura */
  @media (min-width:1600px) { body.com-painel:not(.modo-tv) #app { max-width:1360px; } }
  /* Hero: mais presença, veredito legível, contraste AA na faixa clara do degradê */
  .pn-hero { padding:28px 32px 24px; background:radial-gradient(760px 280px at 100% 0%,rgba(120,175,255,.30),transparent 62%),linear-gradient(135deg,#0a1f42 0%,#123b7a 58%,#1c5cab 100%); box-shadow:0 16px 36px -14px rgba(12,35,71,.55); }
  .pn-hero::after { background:rgba(255,255,255,.04); }
  .pn-kicker { color:#d3e1f7; }
  .pn-h1 { font-size:34px; letter-spacing:-.025em; }
  .pn-frase { font-weight:500; font-size:19px; line-height:1.5; color:#f1f6ff; max-width:68ch; }
  .pn-veredito-chip { font-size:15px; padding:7px 16px 7px 14px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.25); }
  .pn-veredito-chip.bom { background:#197a43; }
  .pn-hero-meta { font-size:13.5px; color:#d3e1f7; }
  /* Barra de controle: a ação principal (Apresentar) se destaca; o resto fica calmo */
  .pn-barra { padding:10px 16px; border-radius:16px; border-color:#e1e7f1; box-shadow:0 1px 2px rgba(20,35,61,.05),0 10px 24px -20px rgba(20,35,61,.35); }
  .pn-barra select, .pn-barra input { min-height:38px; border-color:#d3dbe8; background:#f7f9fd; font-weight:600; }
  .pn-barra a.btn { background:var(--accent); border-color:var(--accent); color:#fff; } .pn-barra a.btn:hover { background:#0e2f63; }
  /* Cartões: mesma altura, rodapé (sparkline) alinhado embaixo, destaque maior */
  .pn-cards { gap:16px; }
  .pn-card { padding:18px 18px 16px; border-radius:18px; border-color:#e1e7f1; box-shadow:0 1px 2px rgba(20,35,61,.05),0 10px 22px -16px rgba(20,35,61,.35); }
  .pn-card::before { height:3px; }
  .pn-card .t { font-size:13px; color:#4f5d78; letter-spacing:.005em; }
  .pn-card .v { font-size:40px; }
  .pn-card.destaque { background:linear-gradient(160deg,#fff 0%,#eef4ff 100%); border-color:#c9d8f0; }
  .pn-card.destaque .v { font-size:72px; letter-spacing:-.045em; color:#0c2347; line-height:1; margin:2px 0 4px; }
  .pn-card .s { color:#566480; font-size:12px; }
  .pn-card svg.spark { margin-top:auto; padding-top:8px; box-sizing:content-box; }
  .pn-chip { font-variant-numeric:tabular-nums; }
  .pn-mais summary { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border:1px solid #d3dbe8; border-radius:99px; background:#fff; }
  /* Blocos de gráfico: mais ar, cabeçalho com controles sempre no canto */
  .pn-bloco { padding:22px 24px; border-radius:20px; border-color:#e1e7f1; box-shadow:0 1px 2px rgba(20,35,61,.05),0 12px 26px -20px rgba(20,35,61,.35); }
  .pn-bloco h2 { font-size:19px; }
  .pn-bloco .sub { font-size:13.5px; color:#566480; line-height:1.4; margin:4px 0 12px; }
  .pn-topo > div:first-child { flex:1 1 260px; min-width:0; } .pn-topo > div:last-child { margin-left:auto; }
  .pn-link { font-weight:600; color:#2f5493; text-decoration-thickness:1px; }
  /* Gráficos: rótulos legíveis (antes ~9 px na tela), grade discreta, contorno nas barras claras (contraste de objeto >= 3:1) */
  .pn-svg { overflow:visible; }
  .pn-svg text { font-size:12.5px; fill:#566480; font-variant-numeric:tabular-nums; }
  #pn-produtividade .pn-svg text { font-size:11px; }
  .pn-svg rect[fill="#86b6ef"] { stroke:#6aa5ea; stroke-width:.8; }
  #pn-hach line { stroke:#d9e0ec; }
  .pn-leg { font-size:12.5px; color:#4f5d78; gap:6px 18px; margin-top:10px; }
  .pn-nota { color:#566480; }
  .pn-tab th { color:#4f5d78; }
  .pn-vazio { border:1px dashed #cdd6e5; border-radius:14px; background:#f7f9fd; margin:6px 0; }
  /* Linhas de barras (etapas e armazéns): número embaixo da barra, sem quebrar "5+ d" */
  .pn-linha:not([style]) { grid-template-columns:132px minmax(0,1fr); row-gap:3px; padding:10px 8px; }
  .pn-linha:not([style]) .nome { grid-row:1 / span 2; align-self:center; }
  .pn-linha:not([style]) .num { grid-column:2; text-align:left; font-size:12.5px; color:#4f5d78; }
  .pn-linha .nome small { color:#566480; }
  .pn-trilho { height:18px; }
  /* Distribuição por idade: contorno do "7 dias antes" mais leve, barras mais altas */
  .pn-col .fantasma { border:1.5px dashed rgba(20,35,61,.55); }
  .pn-col .barra { border-radius:10px 10px 0 0; }
  .pn-col .qtd { font-size:24px; font-variant-numeric:tabular-nums; }
  .pn-colunas { gap:18px; height:230px; }
  .pn-colunas .pn-col > div[style*="height:120px"] { height:160px !important; }
  .pn-prio-item small, .pn-linha .nome small { color:#566480; }
  /* Separador entre o painel e o detalhe antigo */
  .pn-sep { display:flex; align-items:center; gap:14px; margin:20px 0 -4px; color:#4f5d78; } .pn-sep::after { content:''; flex:1; height:1px; background:#d3dbe8; }
  /* Detalhe antigo: valor em R$ não vaza do cartão */
  body.com-painel .kpis { grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); } body.com-painel .kpi { min-width:0; } body.com-painel .kpi .kv { font-size:27px; font-variant-numeric:tabular-nums; }
  /* Tablet: sem cartão órfão (6 colunas: destaque inteiro, 3 + 2) */
  @media (min-width:641px) and (max-width:1100px) {
    .pn-cards:not(.cinco) { grid-template-columns:repeat(6,minmax(0,1fr)); }
    .pn-cards > .pn-card { grid-column:span 2; } .pn-cards > .pn-card.destaque { grid-column:span 6; }
    .pn-cards > .pn-card:nth-child(n+5), .pn-mais .pn-cards > .pn-card:nth-child(n+4) { grid-column:span 3; }
    .pn-mais .pn-cards > .pn-card:nth-child(-n+3) { grid-column:span 2; }
  }
  /* Celular: último cartão ímpar ocupa a linha; gráficos com rótulo maior; hero compacto */
  @media (max-width:640px) {
    .pn-cards > .pn-card:last-child { grid-column:span 2; }
    .pn-card.destaque .v { font-size:56px; }
    .pn-hero { padding:22px 20px 20px; } .pn-h1 { font-size:26px; } .pn-frase { font-size:16.5px; }
    .pn-bloco { padding:18px 16px; }
    .pn-svg:not(.pn-svg-m) text { font-size:19px; } .pn-svg-m text, #pn-produtividade .pn-svg-m text { font-size:12px; }
    .pn-linha:not([style]) { grid-template-columns:104px minmax(0,1fr); }
    .pn-colunas { gap:8px; } .pn-col .qtd { font-size:18px; } .pn-col .lab { font-size:11px; min-height:2.5em; }
  }
  /* TV (3 m): texto secundário maior, faixa de cor mais grossa, gráfico de idade preenche o cartão, barra de progresso do rodízio */
  body.modo-tv .pn-card .t { font-size:14.5px; color:#3f4c66; } body.modo-tv .pn-card .v { font-size:42px; } body.modo-tv .pn-card .v.brl { font-size:32px; } body.modo-tv .pn-card.destaque .v { font-size:68px; }
  body.modo-tv .pn-card .d, body.modo-tv .pn-chip, body.modo-tv .pn-tom, body.modo-tv .pn-card .s { font-size:14px; }
  body.modo-tv .pn-card::before { height:5px; }
  body.modo-tv .pn-bloco .sub { font-size:15px; }
  body.modo-tv .pn-svg text { font-size:15px; fill:#3f4c66; } body.modo-tv #pn-produtividade .pn-svg text { font-size:12px; }
  body.modo-tv .pn-leg { font-size:15px; color:#3f4c66; }
  body.modo-tv .pn-linha:not([style]) .num { font-size:15.5px; color:#3f4c66; } body.modo-tv .pn-linha:not([style]) { padding:16px 8px; grid-template-columns:150px minmax(0,1fr); }
  body.modo-tv .pn-col .qtd { font-size:30px; } body.modo-tv .pn-col .lab { font-size:15px; }
  body.modo-tv .pn-colunas .pn-col > div[style*="height:120px"] { height:300px !important; } body.modo-tv .pn-col .lab { min-height:2.5em; } body.modo-tv .pn-colunas { height:auto; }
  body.modo-tv .pn-prio-item { font-size:16px; } body.modo-tv .pn-prio-item small { font-size:14px; }
  body.modo-tv .pn-hero { padding:18px 28px 16px; } body.modo-tv .pn-frase { max-width:none; font-size:18px; margin-top:8px; } body.modo-tv .pn-hero-meta { margin-top:10px; } body.modo-tv .pn-h1 { font-size:30px; }
  body.modo-tv .pn-pontos i { position:relative; overflow:hidden; }
  body.modo-tv .pn-pontos i.ativo { background:rgba(255,255,255,.25); }
  body.modo-tv .pn-pontos i.ativo::after { content:''; position:absolute; inset:0; background:#fff; border-radius:99px; transform-origin:left; }
  @media (prefers-reduced-motion:no-preference) { body.modo-tv .pn-pontos i.ativo::after { animation:pn-prog 20s linear forwards; } }
  @keyframes pn-prog { from { transform:scaleX(0); } to { transform:scaleX(1); } }
  @media (min-width:1700px) and (max-height:1000px) { body.modo-tv .pn { zoom:1.25; } }
  @media (max-height:800px) { body.modo-tv .pn { gap:12px; } body.modo-tv .pn-hero { padding:14px 22px; } body.modo-tv .pn-frase { font-size:16px; margin-top:8px; } body.modo-tv .pn-hero-meta { margin-top:8px; } body.modo-tv .pn-card svg.spark { display:none; } body.modo-tv #app { padding:12px 18px 12px; } }
  /* Impressão: nada cortado, legenda do Armazéns completa, tabela alinhada, rótulos legíveis no papel */
  @media print {
    .pn-hero { box-shadow:none; padding:16px 20px; background:linear-gradient(135deg,#0a1f42,#123b7a 60%,#1c5cab); }
    .pn-h1 { font-size:22px; } .pn-frase { font-size:15px; max-width:none; margin-top:8px; } .pn-veredito-chip { font-size:13px; padding:4px 12px; } .pn-hero-meta { font-size:12px; margin-top:8px; }
    .pn-cards:not(.cinco) { grid-template-columns:repeat(7,minmax(0,1fr)); } .pn-cards > .pn-card, .pn-cards > .pn-card:nth-child(n+5) { grid-column:span 1; } .pn-cards > .pn-card.destaque { grid-column:span 2; }
    .pn-chip { font-size:10.5px; padding:2px 6px; } .pn-card .d, .pn-tom { font-size:10.5px; }
    .pn-cards { gap:8px; } .pn-card { padding:10px 10px 8px; border-radius:12px; } .pn-card .t { font-size:11.5px; } .pn-card .v { font-size:26px; } .pn-card .v.brl { font-size:20px; } .pn-card.destaque .v { font-size:38px; margin:0; }
    .pn-bloco { padding:12px 14px; border-radius:14px; } .pn-bloco h2 { font-size:16px; } .pn-bloco .sub { font-size:12px; margin:2px 0 6px; }
    .pn-card, .pn-bloco { box-shadow:none; border-color:#cfd7e4; }
    .pn-linha:not([style]) { padding:3px 4px; row-gap:1px; } .pn-trilho { height:14px; } .pn-leg { font-size:11px; margin-top:6px; }
    .pn-col .qtd { font-size:18px; }
    .pn-svg text { font-size:15px; }
    .pn-linha:not([style]) { grid-template-columns:112px minmax(0,1fr); } #pn-produtividade .pn-svg text { font-size:12px; }
    .pn-linha:not([style]) .num { white-space:normal; font-size:10.5px; }
    #pn-armazens .pn-leg span:last-child { display:inline !important; }
    .pn-so-print .pn-tab th, .pn-so-print .pn-tab td { text-align:left; }
    .pn-so-print .pn-tab th:nth-child(5), .pn-so-print .pn-tab td:nth-child(5), .pn-so-print .pn-tab th:nth-child(6), .pn-so-print .pn-tab td:nth-child(6) { text-align:right; }
    .pn-so-print .pn-tab td:last-child { white-space:normal; font-size:9.5px; }
    .pn-colunas .pn-col > div[style*="height:120px"] { height:100px !important; } .pn-colunas { height:auto; }
  }
  `;
  function garantirEstilo() { if (!document.getElementById('pn-estilo')) document.head.appendChild(h('style', { id: 'pn-estilo', text: CSS })); }

  // ---------- peças pequenas ----------
  function selo(fr) {
    const txt = fr.estado === 'vazio' ? 'Sem posição gravada' : fr.estado === 'em-dia' ? 'Posição em dia' : fr.estado === 'atencao' ? 'Atenção: última posição de ' + ddmm(fr.dia) : 'Desatualizado: última posição de ' + ddmm(fr.dia);
    const hora = fr.atualizadoEm ? new Date(fr.atualizadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
    return h('span', { class: 'pn-selo ' + fr.estado, role: 'status', title: 'A posição do dia só é gravada quando o Histórico de Atraso é exportado no SC9.' }, (fr.estado === 'em-dia' ? '● ' : '⚠ ') + txt + (hora ? ' · ' + hora : ''));
  }

  function sparkline(valores, tomCor) {
    const pts = valores.map((v, i) => [i, v]).filter((x) => x[1] != null);
    if (pts.length < 2) return null;
    const w = 110, hh = 28, max = Math.max(...pts.map((x) => x[1])), min = Math.min(...pts.map((x) => x[1])), span = max - min || 1, n = valores.length - 1 || 1;
    const xy = pts.map(([i, v]) => [(i / n * (w - 6) + 3).toFixed(1), (hh - 4 - (v - min) / span * (hh - 8)).toFixed(1)]);
    const ult = xy[xy.length - 1];
    const media = pts.reduce((t, x) => t + x[1], 0) / pts.length, ym = (hh - 4 - (media - min) / span * (hh - 8)).toFixed(1);
    return s('svg', { class: 'spark', width: w, height: hh, viewBox: '0 0 ' + w + ' ' + hh, 'aria-hidden': 'true' },
      s('title', { text: pts.length + ' dias com posição · média ' + fmtN(media) + ' · mínimo ' + fmtN(min) + ' · máximo ' + fmtN(max) }),
      s('line', { x1: 3, x2: w - 3, y1: ym, y2: ym, stroke: '#cfd7e4', 'stroke-width': 1, 'stroke-dasharray': '2 3' }),
      s('polyline', { points: xy.map((c) => c.join(',')).join(' '), fill: 'none', stroke: '#8a94a8', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
      s('circle', { cx: ult[0], cy: ult[1], r: 3, fill: tomCor }));
  }
  const corDoTom = { bom: '#1f8a4c', ruim: '#c63828', atencao: '#e8a200', neutro: '#6b7890' };

  function chipDelta(c) {
    if (c.delta == null) return h('span', { class: 'pn-chip', text: c.id === 'ocorrencias' ? 'agora' : 'sem comparação' });
    const seta = c.delta > 0 ? '▲ +' : c.delta < 0 ? '▼ ' : '';
    const val = c.formato === 'brl' ? brlCurto(Math.abs(c.delta)) : fmtN(c.delta);
    const pct = c.pct != null && c.delta ? ' (' + (c.pct > 0 ? '+' : '') + c.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%)' : '';
    return [h('span', { class: 'pn-chip ' + c.tom, title: 'Comparado com ' + (c.refDia ? ddmmaaaa(c.refDia) : 'o dia anterior') }, c.delta ? seta + (c.formato === 'brl' ? (c.delta < 0 ? '−' : '') + val : val) + pct : '= igual'), h('span', { class: 'pn-tom ' + c.tom, text: TOM_ICONE[c.tom] + ' ' + TOM_TXT[c.tom] })];
  }

  function cartao(c, serieDias) {
    const ext = { atraso: (d) => d.foto && d.foto.tot, cinco: (d) => d.foto && d.foto.cinco, pecas: (d) => d.foto && d.foto.pecas, estoque: (d) => d.foto && d.foto.e, faturamento: (d) => d.foto && d.foto.f, valor: (d) => d.foto && d.foto.valor, despachados: (d) => d.exp && d.exp.pedidos, 'pecas-despachadas': (d) => d.exp && d.exp.pecas, faturados: (d) => d.fat && d.fat.pedidos }[c.id];
    const spark = ext ? sparkline(serieDias.map((d) => { const v = ext(d); return v == null || v === false ? null : v; }), corDoTom[c.tom]) : null;
    const valor = c.valor == null ? '—' : c.formato === 'brl' ? brlCurto(c.valor) : fmtI(c.valor);
    const comp = c.refDia ? ' vs ' + ddmm(c.refDia) : '';
    const rotulo = c.titulo + ': ' + valor + (c.delta != null ? ', ' + (c.delta === 0 ? 'igual' : (c.delta > 0 ? 'subiu ' : 'caiu ') + fmtN(Math.abs(c.delta))) + comp + ', ' + TOM_TXT[c.tom] : '');
    const aoClicar = () => {
      if (c.alvo) { const el = document.getElementById('pn-' + c.alvo); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      T().irParaLista(Object.assign({}, c.filtro, S.arm ? { arm: S.arm } : {}, S.transp ? { transp: S.transp } : {}));
    };
    return h('button', { type: 'button', class: 'pn-card ' + (c.tom || '') + (c.destaque ? ' destaque' : ''), 'aria-label': rotulo + (c.alvo ? '. Abre o gráfico.' : '. Abre os pedidos.'), title: (c.nota ? c.nota + '. ' : '') + (c.semFiltroArmazem ? 'Despachados e faturados são sempre do total da empresa (o dado não tem armazém). ' : '') + (c.alvo ? 'Clique para ver o gráfico.' : 'Clique para ver os pedidos.'), onclick: aoClicar },
      h('span', { class: 't', text: c.titulo }),
      h('span', { class: 'v' + (c.formato === 'brl' ? ' brl' : ''), text: valor, title: c.formato === 'brl' && c.valor != null ? brl(c.valor) : '' }),
      h('span', { class: 'd' }, chipDelta(c), c.refDia ? h('span', { class: 's', text: 'vs ' + ddmm(c.refDia) }) : null),
      c.destaque && c.estoque != null ? h('span', { class: 's', text: 'Estoque ' + fmtI(c.estoque) + ' · Faturamento ' + fmtI(c.faturamento) + (c.base ? ' · ' + (c.valor / c.base * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '% da base' : '') }) : null,
      c.destaque && c.estoque != null && c.valor ? h('span', { class: 'pn-split', 'aria-hidden': 'true' }, h('span', { style: 'width:' + (c.estoque / c.valor * 100).toFixed(1) + '%;background:' + COR.estoque }), h('span', { style: 'width:' + (c.faturamento / c.valor * 100).toFixed(1) + '%;background:' + COR.faturamento })) : null,
      c.semFiltroArmazem ? h('span', { class: 'pn-chip', text: 'Total geral' }) : null,
      spark);
  }

  // ---------- gráficos ----------
  function escalaY(max) {
    const alvo = Math.max(1, max), passo = Math.pow(10, Math.floor(Math.log10(alvo / 4)));
    let p = passo; for (const m of [1, 2, 2.5, 5, 10]) { const cand = m * passo; if (alvo / cand <= 4.0001 && Math.abs(cand - Math.round(cand)) < 1e-9) { p = cand; break; } } // contagens: marcas sempre inteiras
    const topo = Math.ceil(alvo / p) * p, ticks = []; for (let v = 0; v <= topo + 1e-9; v += p) ticks.push(v);
    return { topo, ticks };
  }
  const rotuloEixoDias = (n) => Math.max(1, Math.ceil(n / (MOB ? 6 : 12)));

  function graficoBase(dias, max, desenharDia, rotulo, opts) {
    const W = MOB ? 380 : (opts && opts.W) || 760, Ht = (opts && opts.Ht) || 290, M = { l: 46, r: 10, t: 12, b: 34 }, iw = W - M.l - M.r, ih = Ht - M.t - M.b;
    const esc = escalaY(max), slot = iw / Math.max(1, dias.length), y = (v) => M.t + ih - (v / esc.topo) * ih;
    const svg = s('svg', { class: 'pn-svg' + (MOB ? ' pn-svg-m' : ''), viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': rotulo });
    svg.appendChild(s('defs', null, s('pattern', { id: 'pn-hach', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#cfd7e4', 'stroke-width': 1.5 }))));
    for (const t of esc.ticks) {
      svg.appendChild(s('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), stroke: COR.grade, 'stroke-width': 1 }));
      svg.appendChild(s('text', { x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end', text: opts && opts.fmtY ? opts.fmtY(t) : fmtI(t) }));
    }
    const cada = rotuloEixoDias(dias.length);
    dias.forEach((d, i) => {
      const x0 = M.l + i * slot;
      const g = desenharDia(d, i, { x0, slot, y, base: y(0), M, ih });
      if (g) svg.appendChild(g);
      if (i % cada === 0 || i === dias.length - 1) svg.appendChild(s('text', { x: x0 + slot / 2, y: Ht - 14, 'text-anchor': 'middle', text: ddmm(d.dia) }));
    });
    return { svg, y, M, slot, W, Ht };
  }

  // ---------- dica (tooltip) rica em HTML: todos os números do ponto, sem depender do <title> do navegador ----------
  // d = () => ({ titulo, linhas: [{ rot, val, cor, forte } | '-'], rodape }). Funciona com mouse, toque e teclado (foco).
  let dicaEl = null;
  function dicaBox() { if (!dicaEl || !dicaEl.isConnected) { dicaEl = h('div', { class: 'pn-tip', role: 'tooltip', 'aria-hidden': 'true' }); document.body.appendChild(dicaEl); } return dicaEl; }
  function dicaEsconder() { if (dicaEl) dicaEl.style.display = 'none'; }
  function dicaMostrar(d, x, y) {
    const box = dicaBox(), c = d();
    box.replaceChildren(h('span', { class: 't', text: c.titulo }), ...c.linhas.map((l) => (l === '-' ? h('div', { class: 'sep' }) : h('div', { class: 'l' + (l.forte ? ' forte' : '') }, h('span', null, l.cor ? h('i', { style: 'background:' + l.cor }) : null, l.rot), h('b', { text: l.val })))), c.rodape ? h('span', { class: 'r', text: c.rodape }) : null);
    box.style.display = 'block';
    const w = box.offsetWidth, hh = box.offsetHeight, W = window.innerWidth, Hh = window.innerHeight;
    let px = x + 16, py = y + 16;
    if (px + w > W - 8) px = Math.max(8, x - w - 16);
    if (py + hh > Hh - 8) py = Math.max(8, y - hh - 16);
    box.style.left = px + 'px'; box.style.top = py + 'px';
  }
  function comDica(el, d) {
    el.addEventListener('mouseenter', (ev) => dicaMostrar(d, ev.clientX, ev.clientY));
    el.addEventListener('mousemove', (ev) => dicaMostrar(d, ev.clientX, ev.clientY));
    el.addEventListener('mouseleave', dicaEsconder);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); dicaMostrar(d, r.left + r.width / 2, r.top + Math.min(r.height / 2, 60)); });
    el.addEventListener('blur', dicaEsconder);
    return el;
  }
  const seta = (v) => (v > 0 ? '▲ +' + fmtI(v) : v < 0 ? '▼ −' + fmtI(-v) : '= igual');

  function campoFoco(d, i, c, rotulo, onClick, ativo, dica) {
    const g = s('g', { class: 'ponto', tabindex: 0, role: 'button', 'aria-label': rotulo, onclick: onClick, onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick(); } } },
      dica ? null : s('title', { text: rotulo }),
      s('rect', { class: 'fundo', x: c.x0, y: c.M.t, width: c.slot, height: c.ih, fill: ativo ? '#123b7a' : 'transparent', 'fill-opacity': ativo ? 0.1 : 0 }),
      s('rect', { class: 'foco', x: c.x0 + 0.5, y: c.M.t, width: c.slot - 1, height: c.ih, fill: 'none' }));
    return dica ? comDica(g, dica) : g;
  }

  function tabelaDe(colunas, linhas) {
    return h('div', { class: 'pn-rolagem' }, h('table', { class: 'pn-tab' }, h('thead', null, h('tr', null, colunas.map((c, i) => h('th', { class: i ? 'num' : '', text: c })))), h('tbody', null, linhas.map((l) => h('tr', null, l.map((v, i) => h('td', { class: i ? 'num' : '', text: v == null ? '—' : v })))))));
  }

  function blocoGrafico(id, titulo, sub, controles, corpoGrafico, corpoTabela, extra, classe) {
    const emTabela = Boolean(S.ver[id]);
    return h('section', { class: 'pn-bloco ' + (classe || ''), id: 'pn-' + id, 'aria-label': titulo },
      h('div', { class: 'pn-topo' }, h('div', null, h('h2', { text: titulo }), sub ? h('p', { class: 'sub', text: sub }) : null),
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' }, controles || null, h('button', { type: 'button', class: 'pn-link', 'aria-pressed': emTabela, onclick: () => { S.ver[id] = !S.ver[id]; T().desenhar(); }, text: emTabela ? 'Ver gráfico' : 'Ver como tabela' }))),
      emTabela ? corpoTabela() : corpoGrafico(), extra || null);
  }

  function evolucao(serieDias, fx, dia, mmPre) {
    const comFoto = serieDias.filter((d) => d.foto);
    const mm = mmPre && mmPre.length === serieDias.length ? mmPre : P().mediaMovel(serieDias.map((d) => (d.foto ? d.foto.tot : null)), 5);
    const pico = comFoto.length ? comFoto.reduce((m, d) => (d.foto.tot > m.foto.tot ? d : m), comFoto[0]) : null;
    const hoje = serieDias.find((d) => d.dia === dia);
    const max = Math.max(1, ...comFoto.map((d) => d.foto.tot));
    const fxPor = new Map(fx.map((x) => [x.dia, x])), fotoAnt = {};
    let ultFoto = null; serieDias.forEach((d) => { if (d.foto) { fotoAnt[d.dia] = ultFoto; ultFoto = d; } });
    const dicaDia = (d, i) => () => {
      const f = fxPor.get(d.dia), a = fotoAnt[d.dia], m = mm[i];
      return { titulo: semanaLonga(d.dia) + ', ' + ddmmaaaa(d.dia), linhas: [{ rot: 'Em atraso', val: fmtI(d.foto.tot), forte: true }, { rot: 'Estoque', val: fmtI(d.foto.e), cor: COR.estoque }, { rot: 'Faturamento', val: fmtI(d.foto.f), cor: COR.faturamento }, { rot: '5 dias ou mais', val: fmtI(d.foto.cinco) }, { rot: 'Peças', val: fmtI(d.foto.pecas) }, '-',
        a ? { rot: 'Vs ' + ddmm(a.dia), val: seta(d.foto.tot - a.foto.tot) } : null, f ? { rot: 'Entraram no atraso', val: '+' + fmtI(f.entraram) } : null, f ? { rot: 'Saíram do atraso', val: '−' + fmtI(f.sairam) } : null, m != null ? { rot: 'Média de 5 dias', val: fmtN(m) } : null].filter(Boolean), rodape: 'Clique para abrir o dia' };
    };
    const sub = !comFoto.length ? 'Nenhuma posição gravada neste período.' : 'Pico de ' + fmtI(pico.foto.tot) + ' em ' + ddmm(pico.dia) + (hoje && hoje.foto && pico.foto.tot && hoje.foto.tot !== pico.foto.tot ? ' · hoje ' + (Math.abs((hoje.foto.tot - pico.foto.tot) / pico.foto.tot) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '% ' + (hoje.foto.tot < pico.foto.tot ? 'abaixo' : 'acima') + ' do pico' : '');
    const corpo = () => {
      if (!comFoto.length) return h('p', { class: 'pn-vazio', text: 'Sem dados neste período. A posição do dia é gravada quando o Histórico de Atraso é exportado no SC9.' });
      const g = graficoBase(serieDias, max, (d, i, c) => {
        const grupo = s('g', null);
        if (!d.foto) { grupo.appendChild(s('rect', { x: c.x0 + 1, y: c.M.t, width: Math.max(1, c.slot - 2), height: c.ih, fill: 'url(#pn-hach)', opacity: d.fimDeSemana ? 0.45 : 0.9 })); grupo.appendChild(s('title', { text: ddmmaaaa(d.dia) + ': sem posição gravada' })); return grupo; }
        const bw = Math.max(2, c.slot * 0.7), x = c.x0 + (c.slot - bw) / 2, ye = c.y(d.foto.e), yt = c.y(d.foto.tot);
        grupo.appendChild(s('rect', { x, y: ye, width: bw, height: Math.max(0, c.base - ye), fill: COR.estoque }));
        if (d.foto.f) grupo.appendChild(s('rect', { x, y: yt, width: bw, height: Math.max(0, ye - yt - 1), fill: COR.faturamento }));
        if (d.dia === dia) grupo.appendChild(s('rect', { x: x - 2, y: yt - 2, width: bw + 4, height: c.base - yt + 2, fill: 'none', stroke: '#14233d', 'stroke-width': 2, rx: 2 }));
        if (serieDias.length <= 16) grupo.appendChild(s('text', { x: x + bw / 2, y: yt - 4, 'text-anchor': 'middle', text: fmtI(d.foto.tot), style: 'font-weight:700;fill:#14233d' }));
        grupo.appendChild(campoFoco(d, i, c, ddmmaaaa(d.dia) + ': ' + fmtI(d.foto.tot) + ' em atraso (estoque ' + fmtI(d.foto.e) + ', faturamento ' + fmtI(d.foto.f) + '). Clique para abrir o dia.', () => T().escolherDia(d.dia, false), d.dia === dia, dicaDia(d, i)));
        return grupo;
      }, 'Pedidos em atraso por dia, em estoque e faturamento, com a média móvel de 5 dias. ' + sub, { Ht: TV ? 440 : 290 });
      const pts = []; serieDias.forEach((d, i) => { if (mm[i] != null) pts.push((g.M.l + i * g.slot + g.slot / 2).toFixed(1) + ',' + g.y(mm[i]).toFixed(1)); });
      if (pts.length > 1) g.svg.appendChild(s('polyline', { points: pts.join(' '), fill: 'none', stroke: COR.linha, 'stroke-width': 2, 'stroke-dasharray': '5 4', 'stroke-linejoin': 'round' }));
      // anotações diretas (sem depender da legenda): pico do período e valor atual da média de 5 dias
      const nx = (i) => g.M.l + i * g.slot + g.slot / 2;
      if (pico && comFoto.length > 2) {
        const ip = serieDias.indexOf(pico), px = nx(ip), py = g.y(pico.foto.tot), alto = serieDias.length <= 16 ? 20 : 8, ancora = px < g.M.l + 34 ? 'start' : px > g.W - 40 ? 'end' : 'middle';
        if (py - alto > 8) g.svg.appendChild(s('text', { x: px, y: py - alto, 'text-anchor': ancora, class: 'forte halo', text: 'pico ' + fmtI(pico.foto.tot) }));
      }
      const il = mm.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
      if (il != null && pts.length > 1) {
        const mx = nx(il), my = g.y(mm[il]);
        g.svg.appendChild(s('circle', { cx: mx, cy: my, r: 4.5, fill: COR.linha, stroke: '#fff', 'stroke-width': 2 }));
        g.svg.appendChild(s('text', { x: mx - 9, y: my - 9, 'text-anchor': 'end', class: 'halo', style: 'font-weight:700;fill:#14233d', text: 'média ' + fmtN(mm[il]) }));
      }
      return h('div', null, g.svg, h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'background:' + COR.estoque }), 'Estoque'), h('span', null, h('i', { style: 'background:' + COR.faturamento }), 'Faturamento'), h('span', null, h('i', { class: 'linha', style: 'background:' + COR.linha }), 'Média dos últimos 5 dias com posição'), h('span', null, h('i', { style: 'background:repeating-linear-gradient(45deg,#cfd7e4,#cfd7e4 2px,#fff 2px,#fff 4px)' }), 'Dia sem posição gravada (não é zero)')));
    };
    const tabela = () => tabelaDe(['Dia', 'Em atraso', 'Estoque', 'Faturamento', 'Peças', '5+ dias', 'Entraram', 'Saíram'], serieDias.filter((d) => d.foto).map((d) => { const f = fx.find((x) => x.dia === d.dia); return [ddmmaaaa(d.dia) + ' ' + d.semana, fmtI(d.foto.tot), fmtI(d.foto.e), fmtI(d.foto.f), fmtI(d.foto.pecas), fmtI(d.foto.cinco), f ? fmtI(f.entraram) : '—', f ? fmtI(f.sairam) : '—']; }));
    return blocoGrafico('evolucao', 'Evolução dos atrasos', sub, null, corpo, tabela, fluxoGrafico(fx, dia), 'm7');
  }

  // Fluxo: entraram (acima, vermelho) e saíram (abaixo, verde); a posição acima/abaixo do zero é o segundo sinal além da cor.
  // A linha escura é a variação líquida do dia (entraram - saíram): acima de zero = o atraso cresceu; abaixo = diminuiu.
  function fluxoGrafico(fx, dia) {
    if (!fx.length) return null;
    const max = Math.max(1, ...fx.map((d) => Math.max(d.entraram, d.sairam)));
    const W = MOB ? 380 : 760, Ht = 150, M = { l: 46, r: 10, t: 8, b: 22 }, ih = Ht - M.t - M.b, meio = M.t + ih / 2, slot = (W - M.l - M.r) / fx.length, esc = (v) => (v / max) * (ih / 2 - 4);
    const svg = s('svg', { class: 'pn-svg' + (MOB ? ' pn-svg-m' : ''), viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': 'Pedidos que entraram no atraso (acima da linha) e que saíram do atraso (abaixo), por dia gravado, com a variação líquida.' });
    svg.appendChild(s('line', { x1: M.l, x2: W - M.r, y1: meio, y2: meio, stroke: '#9aa6b8' }));
    svg.appendChild(s('text', { x: M.l - 6, y: M.t + 10, 'text-anchor': 'end', text: '▲ ' + fmtI(max) })); svg.appendChild(s('text', { x: M.l - 6, y: Ht - M.b, 'text-anchor': 'end', text: '▼ ' + fmtI(max) })); svg.appendChild(s('text', { x: M.l - 6, y: meio + 4, 'text-anchor': 'end', text: '0' }));
    const pts = [];
    fx.forEach((d, i) => {
      const bw = Math.max(2, slot * 0.6), x = M.l + i * slot + (slot - bw) / 2, liq = d.entraram - d.sairam;
      svg.appendChild(s('rect', { x, y: meio - esc(d.entraram), width: bw, height: esc(d.entraram), fill: '#c63828', opacity: d.dia === dia ? 1 : 0.8 }));
      svg.appendChild(s('rect', { x, y: meio, width: bw, height: esc(d.sairam), fill: '#1f8a4c', opacity: d.dia === dia ? 1 : 0.8 }));
      pts.push([x + bw / 2, meio - esc(liq)]);
      if (i % rotuloEixoDias(fx.length) === 0) svg.appendChild(s('text', { x: x + bw / 2, y: Ht - 6, 'text-anchor': 'middle', text: ddmm(d.dia) }));
    });
    if (pts.length > 1) svg.appendChild(s('polyline', { points: pts.map((c) => c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' '), fill: 'none', stroke: '#14233d', 'stroke-width': 1.5, 'stroke-linejoin': 'round', opacity: 0.85 }));
    pts.forEach((c) => svg.appendChild(s('circle', { cx: c[0], cy: c[1], r: 3.2, fill: '#14233d', stroke: '#fff', 'stroke-width': 1.5 })));
    fx.forEach((d, i) => {
      const liq = d.entraram - d.sairam, rotulo = ddmmaaaa(d.dia) + ': entraram ' + d.entraram + ', saíram ' + d.sairam + ' (saldo ' + (d.saldo > 0 ? '+' : '') + d.saldo + ')';
      const g = s('g', { class: 'ponto', tabindex: 0, role: 'button', 'aria-label': rotulo + '. Clique para abrir o dia.', onclick: () => { if (T().temDia(d.dia)) T().escolherDia(d.dia, false); }, onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (T().temDia(d.dia)) T().escolherDia(d.dia, false); } } },
        s('rect', { class: 'fundo', x: M.l + i * slot, y: M.t, width: slot, height: ih, fill: 'transparent' }), s('rect', { class: 'foco', x: M.l + i * slot + 0.5, y: M.t, width: slot - 1, height: ih, fill: 'none' }));
      svg.appendChild(comDica(g, () => ({ titulo: semanaLonga(d.dia) + ', ' + ddmmaaaa(d.dia), linhas: [{ rot: 'Entraram no atraso', val: '+' + fmtI(d.entraram), cor: '#c63828' }, { rot: 'Saíram do atraso', val: '−' + fmtI(d.sairam), cor: '#1f8a4c' }, '-', { rot: 'Variação líquida', val: seta(liq), forte: true }, { rot: 'Comparado com', val: ddmm(d.ref) }], rodape: (liq > 0 ? 'O atraso cresceu neste dia.' : liq < 0 ? 'O atraso diminuiu neste dia.' : 'O atraso ficou igual.') + ' Clique para abrir o dia.' })));
    });
    const totE = fx.reduce((t, d) => t + d.entraram, 0), totS = fx.reduce((t, d) => t + d.sairam, 0), liqT = totE - totS;
    const resumo = 'No período: entraram ' + fmtI(totE) + ' · saíram ' + fmtI(totS) + ' · ' + (liqT > 0 ? 'o atraso cresceu em ' + fmtI(liqT) : liqT < 0 ? 'o atraso diminuiu em ' + fmtI(-liqT) : 'o atraso ficou igual') + '.';
    return h('div', { class: 'pn-fluxo', style: 'margin-top:14px' }, h('h3', { text: 'Fluxo do atraso: quem entrou e quem saiu', style: 'font-size:14px;margin-bottom:2px' }), h('p', { class: 'pn-nota', style: 'margin:0 0 4px', text: resumo }), svg,
      h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'background:#c63828' }), '▲ Entraram no atraso (acima)'), h('span', null, h('i', { style: 'background:#1f8a4c' }), '▼ Saíram do atraso (abaixo)'), h('span', null, h('i', { class: 'linha', style: 'background:#14233d' }), 'Variação líquida (acima de 0 = o atraso cresceu)')));
  }

  // Taxa de atraso no geral: pedidos que entraram em atraso ÷ pedidos despachados, por dia, semana ou mês (soma, não média de porcentagens).
  function taxaBloco(tx, g, ate) {
    const modo = S.taxa;
    const ctl = h('div', { class: 'pn-seg', role: 'group', 'aria-label': 'Agrupar por' }, [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': modo === k, onclick: () => mudar(() => { S.taxa = k; }), text: t })));
    const pct = (v) => (v == null ? '—' : fmtN(v) + '%');
    const lista0 = modo === 'dia' ? tx.dias.map((d) => ({ chave: d.dia, rotulo: ddmm(d.dia) + ' ' + d.semana, dias: d.valido ? 1 : 0, volume: d.valido ? d.volume : 0, pecas: d.pecas, entraram: d.valido ? d.entraram : 0, pct: d.pct, mediaEmAtraso: d.emAtraso, emAndamento: d.dia === ate })) : modo === 'mes' ? tx.meses : tx.semanas;
    const lista = lista0.filter((x) => modo === 'dia' ? x.dias > 0 : x.dias > 0).slice(modo === 'dia' ? -30 : modo === 'semana' ? -12 : -24);
    const andamento = (x) => (modo === 'semana' ? ate >= x.chave && ate <= P().somaDias(x.chave, 6) : modo === 'mes' ? ate.slice(0, 7) === x.chave : x.emAndamento);
    const sub = 'Pedidos que entraram em atraso ÷ pedidos despachados no mesmo período. Dias sem despacho ou sem posição anterior ficam fora da conta.';
    const vazio = g && g.transp ? 'Com filtro de transportadora não há volume despachado por transportadora; tire o filtro para ver a taxa.' : 'Ainda não há dias com despacho e posição de atraso gravados para calcular a taxa.';
    const corpo = () => {
      if (!lista.length) return h('p', { class: 'pn-vazio', text: vazio });
      const max = Math.max(0.0001, ...lista.map((x) => x.pct || 0));
      const ult = lista[lista.length - 1], ant = lista.length > 1 ? lista[lista.length - 2] : null;
      const comp = ult && ant && ult.pct != null && ant.pct != null ? (Math.abs(ult.pct - ant.pct) < 0.05 ? 'igual ao período anterior' : (ult.pct < ant.pct ? 'abaixo' : 'acima') + ' do período anterior (' + pct(ant.pct) + ')') : '';
      const geral = tx.geral;
      const kpis = h('div', { class: 'pn-kpis' },
        h('div', { class: 'pn-kpi principal' }, h('b', { text: pct(geral.pct) }), h('span', { text: 'dos pedidos despachados entraram em atraso (tudo o que está gravado)' })),
        h('div', { class: 'pn-kpi' }, h('b', { text: fmtI(geral.entraram) + ' de ' + fmtI(geral.volume) }), h('span', { text: 'pedidos que entraram em atraso ÷ despachados em ' + fmtI(geral.dias) + ' dias' })),
        geral.mediaVolume != null ? h('div', { class: 'pn-kpi' }, h('b', { text: fmtI(geral.mediaVolume) }), h('span', { text: 'pedidos despachados por dia, em média' })) : null,
        ult && ult.pct != null ? h('div', { class: 'pn-kpi' }, h('b', { text: pct(ult.pct) }), h('span', { text: ult.rotulo + (andamento(ult) ? ' (em andamento)' : '') + (comp ? ' · ' + comp : '') })) : null);
      return h('div', null, kpis, lista.map((x) => h('div', { class: 'pn-linha', style: 'cursor:default;grid-template-columns:130px 1fr 230px', title: x.rotulo + ': ' + fmtI(x.entraram) + ' entraram em atraso de ' + fmtI(x.volume) + ' despachados (' + pct(x.pct) + ')' },
        h('span', { class: 'nome' }, x.rotulo + (andamento(x) ? ' *' : '')),
        h('div', { class: 'pn-trilho' }, h('span', { style: 'width:' + Math.max(1, (x.pct || 0) / max * 100).toFixed(1) + '%;background:' + (x.pct >= 5 ? '#c63828' : COR.estoque) })),
        h('span', { class: 'num' }, h('b', { text: pct(x.pct) }), h('small', { text: fmtI(x.entraram) + ' de ' + fmtI(x.volume) + ' pedidos' + (x.pecas ? ' · ' + fmtI(x.pecas) + ' peças' : '') })))),
        h('p', { class: 'pn-nota', text: '* período em andamento. Esta tela guarda pedidos e peças; hora-homem e quantidade de separadores ainda não ficam no histórico.' }));
    };
    const tabela = () => tabelaDe(['Período', 'Despachados', 'Peças', 'Entraram em atraso', 'Taxa', 'Em atraso (média)'], lista.map((x) => [x.rotulo + (andamento(x) ? ' *' : ''), fmtI(x.volume), x.pecas ? fmtI(x.pecas) : null, fmtI(x.entraram), pct(x.pct), x.mediaEmAtraso != null ? fmtI(x.mediaEmAtraso) : null]));
    return blocoGrafico('taxa', 'Atraso no geral: taxa sobre o volume', sub, ctl, corpo, tabela, null, 'm12');
  }

  // se o cálculo ou o desenho da taxa falhar, o resto do painel continua aparecendo
  function taxaSegura(p, g, ate) { try { return taxaBloco(P().taxaAtraso(p, ate, g), g, ate); } catch (e) { if (root.console) console.error('Taxa de atraso:', e); return null; } }

  function produtividade(serieDias, dia) {
    const pr = P().produtividade(serieDias), medida = S.prod;
    const campo = medida === 'pecas' ? 'pecas' : 'pedidos';
    const vals = serieDias.map((d) => (d.exp ? d.exp[campo] : null));
    const max = Math.max(1, ...vals.filter((v) => v != null), ...serieDias.map((d) => (d.fat && medida !== 'pecas' ? d.fat.pedidos : 0)), ...serieDias.map((d) => (d.fat && medida === 'pecas' ? d.fat.pecas : 0)));
    const mediaP = medida === 'pecas' ? pr.despachados.mediaPecas : pr.despachados.mediaPedidos;
    const unidade = medida === 'pecas' ? 'peças' : 'pedidos';
    const ctl = h('div', { class: 'pn-seg', role: 'group', 'aria-label': 'Medida' }, [['pedidos', 'Pedidos'], ['pecas', 'Peças']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': S.prod === k, onclick: () => mudar(() => { S.prod = k; }), text: t })));
    const mel = pr.despachados.pedidos.melhor, pio = pr.despachados.pedidos.pior;
    const sub = pr.despachados.dias ? 'Média de ' + fmtI(mediaP) + ' ' + unidade + ' por dia' + (mel && medida === 'pedidos' ? ' · melhor dia ' + ddmm(mel.dia) + ' (' + fmtI(mel.v) + ') · pior ' + ddmm(pio.dia) + ' (' + fmtI(pio.v) + ')' : '') : 'Sem despachos registrados neste período.';
    // rótulos sempre visíveis (sem passar o mouse): em todos os dias quando cabem; em período longo, só o maior, o menor e o último
    const comValor = vals.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
    const cabe = ((MOB ? 380 : 560) - 56) / Math.max(1, serieDias.length) >= 7 * String(fmtI(max)).length + 3; // cada rótulo cabe na sua coluna?
    const destacados = new Set(comValor.length ? [comValor.reduce((m, i) => (vals[i] > vals[m] ? i : m), comValor[0]), comValor.reduce((m, i) => (vals[i] < vals[m] ? i : m), comValor[0]), comValor[comValor.length - 1]] : []);
    const rotular = (i) => cabe || destacados.has(i);
    const refDia = (serieDias.find((d) => d.dia === dia && d.exp) || serieDias.filter((d) => d.exp).pop() || null);
    const rotulosBarras = [];
    const kpis = refDia ? h('div', { class: 'pn-kpis' },
      h('div', { class: 'pn-kpi principal' }, h('b', { text: fmtI(refDia.exp[campo]) }), h('span', { text: unidade + ' despachados em ' + ddmm(refDia.dia) })),
      refDia.fat ? h('div', { class: 'pn-kpi' }, h('b', { text: fmtI(refDia.fat[campo]) }), h('span', { text: unidade + ' faturados em ' + ddmm(refDia.dia) })) : null,
      mediaP != null ? h('div', { class: 'pn-kpi' }, h('b', { text: fmtI(mediaP) }), h('span', { text: 'média de ' + unidade + ' despachados por dia' })) : null) : null;
    const corpo = () => {
      rotulosBarras.length = 0;
      if (!pr.despachados.dias && !pr.faturados.dias) return h('p', { class: 'pn-vazio', text: 'Sem despachos ou faturamento registrados neste período.' });
      const g = graficoBase(serieDias, max, (d, i, c) => {
        const grupo = s('g', null), v = d.exp ? d.exp[campo] : null;
        if (v != null) {
          const bw = Math.max(2, c.slot * 0.62), x = c.x0 + (c.slot - bw) / 2;
          grupo.appendChild(s('rect', { x, y: c.y(v), width: bw, height: Math.max(0, c.base - c.y(v)), fill: COR.estoque, stroke: d.dia === dia ? '#14233d' : 'none', 'stroke-width': 2 }));
          if (rotular(i)) rotulosBarras.push(s('text', { x: x + bw / 2, y: c.y(v) - 5, 'text-anchor': 'middle', class: 'halo', style: 'font-weight:800;fill:#14233d;font-size:11px', text: fmtI(v) })); // desenhado por último, por cima da linha
          grupo.appendChild(campoFoco(d, i, c, ddmmaaaa(d.dia) + ': ' + fmtI(v) + ' ' + unidade + ' despachados' + (d.fat ? ', ' + fmtI(d.fat[campo]) + ' faturados' : '') + '.', () => { if (T().temDia(d.dia)) T().escolherDia(d.dia, false); }, d.dia === dia, () => {
            const dif = mediaP ? (v - mediaP) / mediaP * 100 : null;
            return { titulo: semanaLonga(d.dia) + ', ' + ddmmaaaa(d.dia), linhas: [{ rot: 'Pedidos despachados', val: fmtI(d.exp.pedidos), cor: COR.estoque, forte: medida === 'pedidos' }, { rot: 'Peças despachadas', val: fmtI(d.exp.pecas), forte: medida === 'pecas' }, d.fat ? { rot: 'Pedidos faturados', val: fmtI(d.fat.pedidos), cor: '#5f6c84' } : null, d.fat ? { rot: 'Peças faturadas', val: fmtI(d.fat.pecas) } : null, '-', dif != null ? { rot: 'Vs média do período (' + fmtI(mediaP) + ')', val: (dif > 0 ? '▲ +' : dif < 0 ? '▼ −' : '') + fmtN(Math.abs(dif)) + '%' } : null].filter(Boolean), rodape: 'Clique para abrir o dia' };
          }));
        } else if (d.foto || d.fat) grupo.appendChild(s('title', { text: ddmmaaaa(d.dia) + ': sem registro de despacho' }));
        return grupo;
      }, 'Pedidos despachados por dia e faturados. ' + sub, { W: 560, Ht: TV ? 380 : 250, fmtY: (v) => (v >= 1000 ? fmtN(v / 1000) + ' mil' : fmtI(v)) });
      const pts = []; serieDias.forEach((d, i) => { if (d.fat) pts.push([(g.M.l + i * g.slot + g.slot / 2).toFixed(1), g.y(d.fat[campo]).toFixed(1)]); });
      if (pts.length) { if (pts.length > 1) g.svg.appendChild(s('polyline', { points: pts.map((x) => x.join(',')).join(' '), fill: 'none', stroke: '#5f6c84', 'stroke-width': 2 })); pts.forEach(([x, yy]) => g.svg.appendChild(s('circle', { cx: x, cy: yy, r: 3.5, fill: '#fff', stroke: '#5f6c84', 'stroke-width': 2 })));
        // valor do faturado ao lado do ponto (acima; abaixo se esbarrar no rótulo da barra)
        serieDias.forEach((d, i) => { if (!d.fat || !cabe) return; const yf = g.y(d.fat[campo]), yb = vals[i] != null ? g.y(vals[i]) - 5 : null, perto = yb != null && Math.abs(yf - 9 - yb) < 13; g.svg.appendChild(s('text', { x: g.M.l + i * g.slot + g.slot / 2, y: perto ? yf + 16 : yf - 9, 'text-anchor': 'middle', class: 'halo', style: 'font-weight:700;fill:#5f6c84', text: fmtI(d.fat[campo]) })); }); }
      if (mediaP != null) { const ym = g.y(mediaP); g.svg.appendChild(s('line', { x1: g.M.l, x2: g.W - g.M.r, y1: ym, y2: ym, stroke: COR.ref, 'stroke-dasharray': '4 4' })); }
      rotulosBarras.forEach((t) => g.svg.appendChild(t));
      return h('div', null, kpis, g.svg, h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'background:' + COR.estoque }), (medida === 'pecas' ? 'Peças' : 'Pedidos') + ' despachados'), h('span', null, h('i', { class: 'linha', style: 'background:#5f6c84' }), (medida === 'pecas' ? 'Peças' : 'Pedidos') + ' faturados'), h('span', null, h('i', { class: 'linha', style: 'background:' + COR.ref }), 'Média de despachados'), h('span', { text: 'Dia sem barra = sem registro.' })));
    };
    const tabela = () => tabelaDe(['Dia', 'Pedidos despachados', 'Peças despachadas', 'Pedidos faturados', 'Peças faturadas'], serieDias.filter((d) => d.exp || d.fat).map((d) => [ddmmaaaa(d.dia) + ' ' + d.semana, d.exp ? fmtI(d.exp.pedidos) : null, d.exp ? fmtI(d.exp.pecas) : null, d.fat ? fmtI(d.fat.pedidos) : null, d.fat ? fmtI(d.fat.pecas) : null]));
    const semana = pr.semana.filter((x) => x.n);
    const mx = Math.max(1, ...semana.map((x) => (medida === 'pecas' ? x.pecasDespachadas : x.despachados) || 0));
    const dow = semana.length ? h('div', { class: 'pn-dow', style: 'margin-top:14px' }, h('h3', { text: 'Média por dia da semana (despachados)', style: 'font-size:14px;margin-bottom:6px' }),
      semana.map((x) => {
        const v = (medida === 'pecas' ? x.pecasDespachadas : x.despachados) || 0, dif = mediaP ? (v - mediaP) / mediaP * 100 : null;
        return h('div', { class: 'pn-linha', style: 'cursor:default;grid-template-columns:50px 1fr 160px', title: x.semana + ': média de ' + fmtI(v) + ' ' + unidade + ' em ' + x.n + (x.n === 1 ? ' dia' : ' dias') + (dif != null ? ' (' + (dif >= 0 ? '+' : '−') + fmtN(Math.abs(dif)) + '% vs a média geral de ' + fmtI(mediaP) + ')' : '') },
          h('span', { class: 'nome', text: x.semana }),
          h('div', { class: 'pn-trilho', style: 'position:relative' }, h('span', { style: 'width:' + (v / mx * 100).toFixed(1) + '%;background:' + (mediaP != null && v < mediaP ? '#86b6ef' : COR.estoque) }), mediaP != null ? h('i', { class: 'marca', style: 'left:' + Math.min(99, mediaP / mx * 100).toFixed(1) + '%' }) : null),
          h('span', { class: 'num', text: fmtI(v) + ' · ' + x.n + (x.n === 1 ? ' dia' : ' dias') + (dif != null && Math.abs(dif) >= 0.5 ? ' · ' + (dif > 0 ? '▲ +' : '▼ −') + fmtN(Math.abs(dif)) + '%' : '') }));
      }),
      mediaP != null ? h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'width:3px;height:12px;border-radius:0;background:#14233d;vertical-align:-2px' }), 'Média geral (' + fmtI(mediaP) + ')'), h('span', null, h('i', { style: 'background:' + COR.estoque }), 'Acima da média'), h('span', null, h('i', { style: 'background:#86b6ef' }), 'Abaixo da média')) : null) : null;
    return blocoGrafico('produtividade', 'Produtividade da expedição', sub, ctl, corpo, tabela, dow, 'm5');
  }

  function gargalosBloco(gar) {
    const corpo = () => {
      if (!gar) return h('p', { class: 'pn-vazio', text: 'Sem posição gravada neste dia.' });
      if (!gar.temEtapa) return h('p', { class: 'pn-vazio', text: 'As etapas só existem nas posições gravadas com os dados completos do pedido. Esta posição não tem esse detalhe.' });
      const max = Math.max(1, ...gar.etapas.map((e) => e.qtd));
      return h('div', null, gar.etapas.map((e) => h('button', { type: 'button', class: 'pn-linha', onclick: () => T().irParaLista(Object.assign({ etapa: e.etapa }, S.arm ? { arm: S.arm } : {}, S.transp ? { transp: S.transp } : {})), 'aria-label': e.rotulo + ': ' + e.qtd + ' pedidos, ' + e.cinco + ' com 5 dias ou mais. Abre os pedidos.' },
        h('span', { class: 'nome' }, e.rotulo.replace(/ \(.*\)/, ''), h('small', { text: e.paradoMedio != null ? 'parado em média ' + fmtN(e.paradoMedio) + ' d' : 'sem hora registrada' })),
        h('div', { class: 'pn-trilho' }, h('span', { style: 'width:' + ((e.qtd - e.cinco) / max * 100).toFixed(1) + '%;background:#86b6ef' }), h('span', { style: 'width:' + (e.cinco / max * 100).toFixed(1) + '%;background:#c63828' })),
        h('span', { class: 'num' }, h('b', { text: (e.etapa === gar.maior ? '⚑ ' : '') + fmtI(e.qtd) + (e.qtd === 1 ? ' pedido' : ' pedidos') }), h('small', { text: fmtN(e.pct) + '% · ' + fmtI(e.pecas) + ' peças' }), e.cinco ? h('small', { text: e.cinco + ' c/ 5+ d (' + fmtN(e.cinco / e.qtd * 100) + '%)' }) : null))),
        h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'background:#86b6ef' }), 'até 4 dias'), h('span', null, h('i', { style: 'background:#c63828' }), '5 dias ou mais'), h('span', { text: '⚑ maior gargalo (mais pedidos com 5+ dias)' })), gar.semEtapa ? h('p', { class: 'pn-nota', text: gar.semEtapa + ' pedidos sem etapa registrada nesta posição.' }) : null);
    };
    const tabela = () => (gar ? tabelaDe(['Etapa', 'Pedidos', '%', 'Peças', '5+ dias', 'Parado em média (dias)'], gar.etapas.map((e) => [e.rotulo, fmtI(e.qtd), fmtN(e.pct) + '%', fmtI(e.pecas), fmtI(e.cinco), e.paradoMedio != null ? fmtN(e.paradoMedio) : null])) : h('p', { class: 'pn-vazio', text: 'Sem posição neste dia.' }));
    return blocoGrafico('gargalos', 'Onde os pedidos estão parados', 'Na ordem do processo. Clique para ver os pedidos.', null, corpo, tabela, null, 'm6');
  }

  function armazensBloco(arm) {
    const corpo = () => {
      if (!arm || !arm.lista.length) return h('p', { class: 'pn-vazio', text: 'Sem pedidos em atraso neste dia.' });
      const max = Math.max(1, ...arm.lista.map((a) => a.tot));
      return h('div', null, arm.lista.map((a) => h('button', { type: 'button', class: 'pn-linha' + (S.arm === a.nome ? ' sel' : ''), onclick: () => mudar(() => { S.arm = S.arm === a.nome ? '' : a.nome; }), 'aria-pressed': S.arm === a.nome, 'aria-label': a.nome + ': ' + a.tot + ' pedidos em atraso, ' + a.cinco + ' com 5 dias ou mais. Clique para filtrar por este armazém.' },
        h('span', { class: 'nome' }, a.nome, h('small', { text: 'idade média ' + fmtN(a.idadeMedia) + ' d' })),
        h('div', { class: 'pn-trilho' }, h('span', { style: 'width:' + (a.e / max * 100).toFixed(1) + '%;background:' + COR.estoque }), h('span', { style: 'width:' + (a.f / max * 100).toFixed(1) + '%;background:' + COR.faturamento })),
        h('span', { class: 'num' }, h('b', { text: fmtI(a.tot) + (a.tot === 1 ? ' pedido' : ' pedidos') + (a.pctBase != null ? ' (' + fmtN(a.pctBase) + '% da base)' : '') }), h('small', { text: fmtI(a.pecas) + ' peças' }), h('small', { text: a.cinco + ' c/ 5+ d' + (a.tot ? ' (' + fmtN(a.cinco / a.tot * 100) + '%)' : '') })))),
        h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'background:' + COR.estoque }), 'Estoque'), h('span', null, h('i', { style: 'background:' + COR.faturamento }), 'Faturamento'), null),
        h('p', { class: 'pn-nota', text: arm.temBase ? 'Percentual sobre os pedidos da base de cada armazém no dia.' : 'Comparação em números absolutos: a base de cada armazém só é gravada nas exportações novas.' }));
    };
    const tabela = () => (arm ? tabelaDe(['Armazém', 'Em atraso', 'Estoque', 'Faturamento', 'Peças', '5+ dias', 'Idade média (dias)'], arm.lista.map((a) => [a.nome, fmtI(a.tot), fmtI(a.e), fmtI(a.f), fmtI(a.pecas), fmtI(a.cinco), fmtN(a.idadeMedia)])) : h('p', { class: 'pn-vazio', text: 'Sem posição neste dia.' }));
    return blocoGrafico('armazens', 'Armazéns', 'Clique para filtrar o painel.', null, corpo, tabela, null, 'm6');
  }

  function distribuicaoBloco(dist) {
    const corpo = () => {
      if (!dist) return h('p', { class: 'pn-vazio', text: 'Sem posição gravada neste dia.' });
      const max = Math.max(1, ...dist.atual.lista.map((f) => f.qtd), ...(dist.antes ? dist.antes.lista.map((f) => f.qtd) : [0]));
      const cor = { neutro: '#9aa6b8', atencao: '#e8a200', ruim: '#c63828', critico: '#8f1d1d' };
      const marca = { neutro: '', atencao: '⚠ ', ruim: '● ', critico: '● ' };
      return h('div', null, h('div', { class: 'pn-colunas', role: 'list' }, dist.atual.lista.map((f, i) => {
        const altura = (f.qtd / max * 100).toFixed(1), antes = dist.antes ? dist.antes.lista[i].qtd : null;
        return comDica(h('div', { class: 'pn-col', role: 'listitem', 'aria-label': f.rotulo + ': ' + f.qtd + ' pedidos (' + fmtN(f.pct) + '%)' + (antes != null ? ', ' + (f.qtd - antes === 0 ? 'igual a' : (f.qtd - antes > 0 ? 'subiu ' : 'caiu ') + Math.abs(f.qtd - antes) + ' em relação a') + ' 7 dias antes' : '') },
          h('span', { class: 'qtd', text: fmtI(f.qtd) }), h('span', { style: 'font-size:11.5px;color:#43506a', text: fmtN(f.pct) + '%' }),
          antes != null ? h('span', { class: 'pn-chip ' + (f.nivel === 'neutro' ? '' : P().tom(false, f.qtd - antes, antes)), text: f.qtd - antes > 0 ? '▲ +' + (f.qtd - antes) : f.qtd - antes < 0 ? '▼ −' + (antes - f.qtd) : '= igual', title: 'Há 7 dias (' + ddmm(dist.refDia) + ') eram ' + fmtI(antes) }) : null,
          h('div', { style: 'width:100%;height:120px;display:flex;align-items:flex-end;position:relative' }, h('div', { class: 'barra', style: 'height:' + altura + '%;background:' + cor[f.nivel] }), antes ? h('div', { class: 'fantasma', style: 'height:' + (antes / max * 100).toFixed(1) + '%' }) : null),
          h('span', { class: 'lab', text: marca[f.nivel] + f.rotulo })), () => ({ titulo: f.rotulo, linhas: [{ rot: 'Pedidos', val: fmtI(f.qtd), forte: true }, { rot: 'Participação', val: fmtN(f.pct) + '%' }, { rot: 'Peças', val: fmtI(f.pecas) }].concat(antes != null ? ['-', { rot: 'Há 7 dias (' + ddmm(dist.refDia) + ')', val: fmtI(antes) }, { rot: 'Variação', val: seta(f.qtd - antes) }] : []), rodape: f.nivel === 'neutro' ? '' : f.nivel === 'atencao' ? 'Faixa de atenção.' : 'Faixa crítica: 5 dias ou mais.' }));
      })),
        h('div', { class: 'pn-leg' }, dist.antes ? h('span', null, 'Contorno tracejado: ', h('b', { text: ddmm(dist.refDia) }), ' (' + P().diasEntre(dist.refDia, dist.atualDia || P().somaDias(dist.refDia, 7)) + ' dias antes)') : h('span', { text: 'Ainda não há posição de 7 dias antes para comparar.' })),
        h('p', { class: 'pn-nota', text: fmtI(dist.cincoAtual) + ' pedidos (' + fmtN(dist.atual.total ? dist.cincoAtual / dist.atual.total * 100 : 0) + '%) com 5 dias ou mais' + (dist.cincoAntes != null ? ' · há 7 dias eram ' + fmtI(dist.cincoAntes) : '') + '.' }));
    };
    const tabela = () => (dist ? tabelaDe(['Faixa', 'Pedidos', '%', 'Peças', dist.antes ? 'Pedidos há 7 dias' : ''].filter(Boolean), dist.atual.lista.map((f, i) => [f.rotulo, fmtI(f.qtd), fmtN(f.pct) + '%', fmtI(f.pecas)].concat(dist.antes ? [fmtI(dist.antes.lista[i].qtd)] : []))) : h('p', { class: 'pn-vazio', text: 'Sem posição neste dia.' }));
    return blocoGrafico('distribuicao', 'Há quanto tempo estão atrasados', 'Quanto mais à direita, mais antigo. Chip = variação em 7 dias.', null, corpo, tabela, null, 'm7');
  }

  // ---------- cascata do dia: de quanto era, quem saiu, quem entrou, quanto é ----------
  function abrirAba(id, filtros) {
    T().irParaLista(filtros || {});
    const b = document.getElementById('aba-' + id);
    if (b) { b.click(); const alvo = document.getElementById('f-busca'); if (alvo && alvo.scrollIntoView) alvo.scrollIntoView({ block: 'center' }); }
  }
  function cascataBloco(c, dia) {
    const sub = !c ? 'Precisa de uma posição anterior para comparar.' : ddmm(c.refDia) + ' → ' + ddmm(dia) + ': ' + fmtI(c.inicio) + ' → ' + fmtI(c.fim) + (c.saldo === 0 ? ' (igual)' : c.saldo > 0 ? ' (+' + fmtI(c.saldo) + ', piorou)' : ' (−' + fmtI(-c.saldo) + ', melhorou)') + '.';
    const filtros = () => Object.assign({}, S.arm ? { arm: S.arm } : {}, S.transp ? { transp: S.transp } : {});
    const corpo = () => {
      if (!c) return h('p', { class: 'pn-vazio', text: 'Sem posição anterior para comparar com este dia.' });
      const W = 520, Ht = TV ? 330 : 290, M = { l: 40, r: 8, t: 26, b: 46 }, iw = W - M.l - M.r, ih = Ht - M.t - M.b;
      const apos = c.inicio - c.saiu, topo = Math.max(c.inicio, c.fim, apos + c.entrou), esc = escalaY(topo), y = (v) => M.t + ih - (v / esc.topo) * ih;
      const slot = iw / 4, bw = Math.min(74, slot * 0.62);
      const barras = [
        { k: 'ini', rot: ddmm(c.refDia), sub: 'posição anterior', de: 0, ate: c.inicio, cor: '#8a94a8', val: fmtI(c.inicio), nivel: c.inicio, aba: null, tip: { titulo: 'Posição de ' + ddmmaaaa(c.refDia), linhas: [{ rot: 'Em atraso', val: fmtI(c.inicio), forte: true }, { rot: '5 dias ou mais', val: fmtI(c.cinco.inicio) }, { rot: 'Peças', val: fmtI(c.pecas.inicio) }], rodape: 'Ponto de partida da comparação.' } },
        { k: 'sai', rot: 'Saíram', sub: 'do atraso', de: apos, ate: c.inicio, cor: '#1f8a4c', val: '−' + fmtI(c.saiu), nivel: c.inicio, aba: 'saiu', tip: { titulo: 'Saíram do atraso', linhas: [{ rot: 'Pedidos', val: '−' + fmtI(c.saiu), cor: '#1f8a4c', forte: true }, { rot: 'Estavam com 5 dias ou mais', val: fmtI(c.cinco.saiu) }, { rot: 'Peças', val: fmtI(c.pecas.saiu) }], rodape: 'Clique para ver quem saiu.' } },
        { k: 'ent', rot: 'Entraram', sub: 'no atraso', de: apos, ate: apos + c.entrou, cor: '#c63828', val: '+' + fmtI(c.entrou), nivel: apos + c.entrou, aba: 'novos', tip: { titulo: 'Entraram no atraso', linhas: [{ rot: 'Pedidos', val: '+' + fmtI(c.entrou), cor: '#c63828', forte: true }, { rot: 'Já com 5 dias ou mais', val: fmtI(c.cinco.entrou) }, { rot: 'Peças', val: fmtI(c.pecas.entrou) }], rodape: 'Clique para ver quem entrou.' } },
        { k: 'fim', rot: ddmm(dia), sub: 'hoje', de: 0, ate: c.fim, cor: COR.estoque, val: fmtI(c.fim), nivel: c.fim, aba: 'atraso', tip: { titulo: 'Posição de ' + ddmmaaaa(dia), linhas: [{ rot: 'Em atraso', val: fmtI(c.fim), forte: true }, { rot: 'Continuam desde ' + ddmm(c.refDia), val: fmtI(c.continuam) }, { rot: '5 dias ou mais', val: fmtI(c.cinco.fim) }, { rot: 'Peças', val: fmtI(c.pecas.fim) }], rodape: 'Clique para ver os pedidos em atraso.' } }
      ];
      const svg = s('svg', { class: 'pn-svg', viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': 'Cascata do dia: ' + fmtI(c.inicio) + ' pedidos em atraso em ' + ddmm(c.refDia) + ', menos ' + fmtI(c.saiu) + ' que saíram, mais ' + fmtI(c.entrou) + ' que entraram, igual a ' + fmtI(c.fim) + ' em ' + ddmm(dia) + '.' });
      for (const t of esc.ticks) { svg.appendChild(s('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), stroke: COR.grade })); svg.appendChild(s('text', { x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end', text: fmtI(t) })); }
      barras.forEach((b, i) => {
        const x = M.l + i * slot + (slot - bw) / 2, yt = y(b.ate), yb = y(b.de), altura = Math.max(2, yb - yt);
        const g = s('g', { class: 'barra-click', tabindex: 0, role: 'button', 'aria-label': b.rot + ' ' + b.sub + ': ' + b.val + ' pedidos.' + (b.aba ? ' Abre os pedidos.' : ''), onclick: () => { if (b.aba === 'atraso') T().irParaLista(filtros()); else if (b.aba) abrirAba(b.aba, filtros()); }, onkeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && b.aba) { ev.preventDefault(); ev.currentTarget.dispatchEvent(new Event('click')); } } },
          s('rect', { class: 'corpo', x, y: yt, width: bw, height: altura, fill: b.cor, rx: 4 }),
          s('rect', { class: 'foco', x: x - 3, y: yt - 3, width: bw + 6, height: altura + 6, fill: 'none', rx: 6 }),
          s('text', { x: x + bw / 2, y: yt - 7, 'text-anchor': 'middle', class: 'forte', text: b.val }));
        comDica(g, () => b.tip);
        svg.appendChild(g);
        svg.appendChild(s('text', { x: x + bw / 2, y: Ht - 24, 'text-anchor': 'middle', style: 'font-weight:700;fill:#14233d;font-size:12.5px', text: b.rot }));
        svg.appendChild(s('text', { x: x + bw / 2, y: Ht - 9, 'text-anchor': 'middle', text: b.sub }));
      });
      [c.inicio, apos, apos + c.entrou].forEach((nv, i) => { const x1 = M.l + i * slot + (slot + bw) / 2, x2 = M.l + (i + 1) * slot + (slot - bw) / 2; svg.appendChild(s('line', { x1, x2, y1: y(nv), y2: y(nv), stroke: '#9aa6b8', 'stroke-width': 1.2, 'stroke-dasharray': '3 3' })); });
      return h('div', null, svg, h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'background:#8a94a8' }), 'Posição anterior'), h('span', null, h('i', { style: 'background:#1f8a4c' }), '▼ Saíram'), h('span', null, h('i', { style: 'background:#c63828' }), '▲ Entraram'), h('span', null, h('i', { style: 'background:' + COR.estoque }), 'Hoje')),
        h('p', { class: 'pn-nota', text: fmtI(c.continuam) + ' continuam em atraso desde ' + ddmm(c.refDia) + ' · com 5 dias ou mais: ' + fmtI(c.cinco.inicio) + ' → ' + fmtI(c.cinco.fim) + (c.bate ? '' : ' · atenção: a conta não fecha (dados incompletos)') + '.' }));
    };
    const tabela = () => (c ? tabelaDe(['Etapa da cascata', 'Pedidos', 'Peças', '5 dias ou mais'], [['Em atraso em ' + ddmm(c.refDia), fmtI(c.inicio), fmtI(c.pecas.inicio), fmtI(c.cinco.inicio)], ['Saíram do atraso', '−' + fmtI(c.saiu), fmtI(c.pecas.saiu), fmtI(c.cinco.saiu)], ['Entraram no atraso', '+' + fmtI(c.entrou), fmtI(c.pecas.entrou), fmtI(c.cinco.entrou)], ['Em atraso em ' + ddmm(dia), fmtI(c.fim), fmtI(c.pecas.fim), fmtI(c.cinco.fim)]]) : h('p', { class: 'pn-vazio', text: 'Sem posição anterior neste dia.' }));
    return blocoGrafico('cascata', 'O que mudou desde a posição anterior', sub, null, corpo, tabela, null, 'm5');
  }

  // ---------- mapa de calor: armazém x tempo de atraso (ou etapa) ----------
  function calorBloco(m, modo) {
    const ctl = h('div', { class: 'pn-seg', role: 'group', 'aria-label': 'Colunas do mapa' }, [['faixa', 'Dias de atraso'], ['etapa', 'Etapa']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': modo === k, onclick: () => mudar(() => { S.calor = k; }), text: t })));
    const corpo = () => {
      if (!m || !m.linhas.length) return h('p', { class: 'pn-vazio', text: 'Sem pedidos em atraso neste dia.' });
      const maxCol = m.colunas.map((_, j) => Math.max(1, ...m.linhas.map((l) => l.celulas[j].pct)));
      const mix = (t) => { const a = [238, 243, 251], b = [28, 92, 171]; return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')'; };
      const marca = { f3: '⚠ ', f5: '● ', f8: '● ', f15: '● ' };
      const filtroDe = (l, col) => Object.assign({}, S.transp ? { transp: S.transp } : {}, l ? { arm: l.nome } : (S.arm ? { arm: S.arm } : {}), m.modo === 'etapa' ? { etapa: col.etapa } : (col.de ? { diasMin: col.de } : {}));
      const celula = (l, col, j) => {
        const x = l.celulas[j], t = Math.min(1, x.pct / maxCol[j]), escuro = t > 0.5, rot = l.nome + ' · ' + col.rotulo + ': ' + x.qtd + ' pedidos (' + fmtN(x.pct) + '% do armazém)';
        const filtraAte = m.modo === 'faixa' && col.de && col.ate !== Infinity;
        const b = h('button', { type: 'button', class: 'pn-cel', style: 'background:' + mix(t) + ';color:' + (escuro ? '#fff' : '#14233d'), 'aria-label': rot + '. Abre os pedidos' + (filtraAte ? ' deste armazém com ' + col.de + ' ou mais dias.' : '.'), onclick: () => T().irParaLista(filtroDe(l.nome === 'Todos' ? null : l, col)) }, h('b', { text: fmtI(x.qtd) }), h('small', { text: fmtN(x.pct) + '%' }));
        return comDica(b, () => ({ titulo: l.nome + ' · ' + col.rotulo, linhas: [{ rot: 'Pedidos', val: fmtI(x.qtd), forte: true }, { rot: 'Participação no armazém', val: fmtN(x.pct) + '%' }, { rot: 'Total do armazém', val: fmtI(l.tot) }], rodape: 'Clique para abrir os pedidos' + (filtraAte ? ' (inclui os mais antigos que esta faixa).' : '.') }));
      };
      const linha = (l, todos) => h('tr', { class: todos ? 'todos' : '' },
        h('td', null, todos ? h('span', { class: 'rot' }, 'Todos', h('small', { text: fmtI(l.tot) + ' pedidos' })) : h('button', { type: 'button', class: 'rot' + (S.arm === l.nome ? ' sel' : ''), 'aria-pressed': S.arm === l.nome, title: 'Clique para filtrar o painel por este armazém', onclick: () => mudar(() => { S.arm = S.arm === l.nome ? '' : l.nome; }) }, l.nome, h('small', { text: fmtI(l.tot) + ' pedidos' }))),
        m.colunas.map((col, j) => h('td', null, celula(l, col, j))),
        h('td', { class: 'fim', style: 'text-align:center' }, h('span', { class: 'pn-chip ' + (todos ? '' : l.pctCinco - m.total.pctCinco > 5 ? 'ruim' : l.pctCinco - m.total.pctCinco < -5 ? 'bom' : ''), title: l.cinco + ' pedidos com 5 dias ou mais' + (todos ? '' : ' (média geral ' + fmtN(m.total.pctCinco) + '%)'), text: (todos ? '' : l.pctCinco - m.total.pctCinco > 5 ? '▲ ' : l.pctCinco - m.total.pctCinco < -5 ? '▼ ' : '') + fmtN(l.pctCinco) + '%' })));
      return h('div', null,
        h('table', { class: 'pn-calor' }, h('thead', null, h('tr', null, h('th', { text: 'Armazém' }), m.colunas.map((col) => h('th', { class: col.de >= 5 ? 'crit' : '', text: (marca[col.id] || '') + col.rotulo })), h('th', { class: 'fim', text: 'c/ 5+ dias' }))), h('tbody', null, m.linhas.map((l) => linha(l, false)), m.linhas.length > 1 ? linha(m.total, true) : null)),
        h('div', { class: 'pn-leg' }, h('span', null, 'Cor: menos', h('i', { class: 'pn-escala' }), 'mais (em cada coluna, o armazém com maior proporção fica mais escuro)'), h('span', { text: '▲ / ▼ c/ 5+ dias: mais de 5 pontos acima / abaixo da média geral (' + fmtN(m.total.pctCinco) + '%)' })),
        m.semClasse ? h('p', { class: 'pn-nota', text: m.semClasse + ' pedidos sem etapa registrada nesta posição ficaram de fora.' }) : null);
    };
    const tabela = () => (m ? tabelaDe(['Armazém'].concat(m.colunas.map((c) => c.rotulo), ['Total', '% c/ 5+ dias']), m.linhas.concat(m.linhas.length > 1 ? [m.total] : []).map((l) => [l.nome].concat(l.celulas.map((x) => fmtI(x.qtd) + ' (' + fmtN(x.pct) + '%)'), [fmtI(l.tot), fmtN(l.pctCinco) + '%']))) : h('p', { class: 'pn-vazio', text: 'Sem posição neste dia.' }));
    return blocoGrafico('calor', 'Onde está o atraso mais velho', 'Armazéns do mais crítico (maior parte com 5+ dias) ao menos crítico. Clique numa célula para abrir os pedidos.', ctl, corpo, tabela, null, 'm7');
  }

  // ---------- Pareto de transportadoras ----------
  function paretoBloco(t) {
    const sub = !t || !t.lista.length ? 'Sem pedidos em atraso neste dia.' : t.qtd > 3 ? 'As 3 maiores concentram ' + fmtN(t.lista[Math.min(2, t.lista.length - 1)].acum) + '% dos ' + fmtI(t.total) + ' pedidos em atraso.' : fmtI(t.total) + ' pedidos em atraso, por transportadora cadastrada no pedido.';
    const corpo = () => {
      if (!t || !t.lista.length) return h('p', { class: 'pn-vazio', text: 'Sem pedidos em atraso neste dia.' });
      const W = 520, Ht = TV ? 360 : 300, M = { l: 40, r: 40, t: 22, b: 52 }, iw = W - M.l - M.r, ih = Ht - M.t - M.b;
      const y = (v) => M.t + ih - (v / t.total) * ih, yp = (pct) => y(pct / 100 * t.total), slot = iw / t.lista.length, bw = Math.min(46, slot * 0.62);
      const esc = escalaY(t.total), svg = s('svg', { class: 'pn-svg', viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': 'Pareto das transportadoras: pedidos em atraso por transportadora e percentual acumulado.' });
      for (const v of esc.ticks.filter((x) => x <= t.total)) { svg.appendChild(s('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: COR.grade })); svg.appendChild(s('text', { x: M.l - 6, y: y(v) + 4, 'text-anchor': 'end', text: fmtI(v) })); }
      for (const pc of [0, 20, 40, 60, 80, 100]) svg.appendChild(s('text', { x: W - M.r + 6, y: yp(pc) + 4, text: pc + '%' }));
      svg.appendChild(s('line', { x1: M.l, x2: W - M.r, y1: yp(80), y2: yp(80), stroke: '#5f6c84', 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }));
      const pts = [];
      t.lista.forEach((x, i) => {
        const cx = M.l + i * slot + slot / 2, bx = cx - bw / 2, yTop = y(x.tot), yCinco = y(x.cinco), yDot = yp(x.acum);
        pts.push([cx, yDot]);
        const click = () => { if (x.filtravel) mudar(() => { S.transp = S.transp === x.nome ? '' : x.nome; }); };
        const g = s('g', { class: x.filtravel ? 'barra-click' : '', tabindex: x.filtravel ? 0 : null, role: x.filtravel ? 'button' : null, 'aria-label': x.nome + ': ' + x.tot + ' pedidos em atraso (' + fmtN(x.pct) + '%), ' + x.cinco + ' com 5 dias ou mais, acumulado ' + fmtN(x.acum) + '%.' + (x.filtravel ? ' Clique para filtrar por esta transportadora.' : ''), onclick: click, onkeydown: (ev) => { if (x.filtravel && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); click(); } } },
          s('rect', { class: 'corpo', x: bx, y: yTop, width: bw, height: Math.max(1, y(0) - yTop), fill: '#86b6ef', rx: 3 }),
          x.cinco ? s('rect', { class: 'corpo', x: bx, y: yTop, width: bw, height: Math.max(1, y(0) - yCinco), fill: '#c63828', rx: 3 }) : null,
          s('rect', { class: 'foco', x: bx - 3, y: yTop - 3, width: bw + 6, height: y(0) - yTop + 6, fill: 'none', rx: 5 }),
          s('rect', { x: M.l + i * slot, y: M.t, width: slot, height: ih, fill: 'transparent' }));
        svg.appendChild(g);
        comDica(g, () => ({ titulo: x.nome, linhas: [{ rot: 'Pedidos em atraso', val: fmtI(x.tot), forte: true }, { rot: 'Participação', val: fmtN(x.pct) + '%' }, { rot: 'Acumulado', val: fmtN(x.acum) + '%' }, '-', { rot: 'Com 5 dias ou mais', val: fmtI(x.cinco) + ' (' + fmtN(x.pctCinco) + '%)', cor: '#c63828' }, { rot: 'Peças', val: fmtI(x.pecas) }, { rot: 'Idade média', val: fmtN(x.idadeMedia) + ' d' }], rodape: x.filtravel ? (S.transp === x.nome ? 'Filtro ativo. Clique para limpar.' : 'Clique para filtrar o painel.') : 'Várias transportadoras juntas.' }));
        const pedacos = String(x.nome).split(' '), l1 = [], l2 = []; let acc = '';
        pedacos.forEach((w) => { if ((acc + ' ' + w).trim().length <= 11 || !acc) { acc = (acc + ' ' + w).trim(); l1.push(w); } else l2.push(w); });
        const cort = (v) => (v.length > 12 ? v.slice(0, 11) + '…' : v);
        svg.appendChild(s('text', { x: cx, y: Ht - M.b + 16, 'text-anchor': 'middle', style: 'font-weight:700;fill:#14233d', text: cort(l1.join(' ')) }));
        if (l2.length) svg.appendChild(s('text', { x: cx, y: Ht - M.b + 29, 'text-anchor': 'middle', style: 'font-weight:700;fill:#14233d', text: cort(l2.join(' ')) }));
        svg.appendChild(s('text', { x: cx, y: Ht - 6, 'text-anchor': 'middle', text: x.cinco ? x.cinco + ' c/ 5+ d' : '' }));
        const perto = Math.abs(yDot - yTop) < 16;
        svg.appendChild(s('text', { x: cx, y: yTop - (perto ? 16 : 6), 'text-anchor': 'middle', class: 'forte', text: fmtI(x.tot) }));
      });
      svg.appendChild(s('polyline', { points: pts.map((c) => c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' '), fill: 'none', stroke: '#14233d', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
      pts.forEach((c, i) => {
        svg.appendChild(s('circle', { cx: c[0], cy: c[1], r: 4, fill: '#14233d', stroke: '#fff', 'stroke-width': 2 }));
        if (i > 0 && i < pts.length - 1 || pts.length === 1) svg.appendChild(s('text', { x: c[0] - 7, y: c[1] - 8, 'text-anchor': 'end', class: 'halo', style: 'font-weight:700;fill:#14233d', text: fmtN(t.lista[i].acum) + '%' }));
      });
      return h('div', null, svg, h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'background:#86b6ef' }), 'Pedidos em atraso'), h('span', null, h('i', { class: 'linha', style: 'background:#14233d' }), '% acumulado (eixo da direita)'), h('span', null, h('i', { class: 'linha', style: 'background:#5f6c84' }), '80% do total'), h('span', { text: 'Parte vermelha = 5+ dias · clique numa barra para filtrar.' })), S.transp ? h('p', { class: 'pn-nota', text: 'Filtro ativo: ' + S.transp + '. Clique na barra de novo para limpar.' }) : null);
    };
    const tabela = () => (t ? tabelaDe(['Transportadora', 'Em atraso', '% do total', '% acumulado', '5+ dias', 'Peças', 'Idade média (dias)'], t.lista.map((x) => [x.nome, fmtI(x.tot), fmtN(x.pct) + '%', fmtN(x.acum) + '%', fmtI(x.cinco), fmtI(x.pecas), fmtN(x.idadeMedia)])) : h('p', { class: 'pn-vazio', text: 'Sem posição neste dia.' }));
    return blocoGrafico('pareto', 'Transportadoras com mais pedidos em atraso', sub, null, corpo, tabela, null, 'm5');
  }

  function urlModoTv() { const u = new URL(location.href); u.searchParams.set('painel', '1'); u.searchParams.set('modo', 'tv'); return u.pathname + u.search + u.hash; }
  function urlSairTv() { const u = new URL(location.href); u.searchParams.delete('modo'); return u.pathname + u.search + u.hash; }

  // Prioridades (só leitura, em JS puro: não depende do painel React de ocorrências): o que fazer agora e as ocorrências abertas mais antigas.
  function prioridadesBloco(p, a, g, agora) {
    if (!a) return null;
    const Hh = root.SC9HistoricoAtraso, itens = P().selecionar(a.reg.itens, g);
    const pr = Hh.prioridades(p, itens, a.reg.dia, agora);
    const abertas = [];
    for (const it of itens) { const v = Hh.avaliarPedido(p, it, a.reg.dia, agora); if (v.ocor && !v.ocor.av.resolvida) abertas.push({ it, o: v.ocor }); }
    abertas.sort((x, y) => y.o.av.dias - x.o.av.dias);
    return h('section', { class: 'pn-bloco', id: 'pn-prioridades', 'aria-label': 'Prioridades e ocorrências' },
      h('h2', { text: 'Prioridades e ocorrências' }), h('p', { class: 'sub', text: 'O que fazer agora e as ocorrências abertas há mais tempo.' }),
      h('div', { class: 'pn-prio-grid' },
        h('div', null, pr.grupos.length ? pr.grupos.map((gr) => h('div', { class: 'pn-prio-item' + (gr.cod === 'ocorrencia' || gr.cod === 'fechar' ? ' crit' : '') }, h('b', { text: fmtI(gr.qtd) }), h('span', null, gr.titulo, h('small', { text: fmtI(gr.pecas) + ' peças' + (gr.antigos ? ' · ' + gr.antigos + ' com 5+ dias' : '') })))) : h('p', { class: 'pn-vazio', text: 'Nada pendente nesta posição.' }),
          pr.semOcorrencia.qtd ? h('div', { class: 'pn-prio-item crit' }, h('b', { text: fmtI(pr.semOcorrencia.qtd) }), h('span', null, 'atrasados há 5+ dias sem motivo registrado', h('small', { text: 'a expedição precisa informar na aba Ocorrências' }))) : null),
        h('div', null, h('h3', { text: abertas.length + (abertas.length === 1 ? ' ocorrência aberta' : ' ocorrências abertas'), style: 'font-size:15px;margin-bottom:4px' }), abertas.slice(0, 6).map((x) => h('div', { class: 'pn-prio-item' + (x.o.av.dias >= 3 ? ' crit' : '') }, h('b', { text: fmtI(x.o.av.dias) + 'd' }), h('span', null, 'Pedido ' + x.it[0] + ' · ' + x.it[1], h('small', { text: (x.o.oc.detalhes || 'sem detalhes').slice(0, 90) + ' · ' + (x.o.oc.responsavel || 'sem responsável') })))), !abertas.length ? h('p', { class: 'pn-vazio', text: 'Nenhuma ocorrência aberta.' }) : null)));
  }

  // Só aparece na impressão: os pedidos mais críticos (a lista completa continua no CSV da página).
  function tabelaCriticos(p, a, g, agora) {
    if (!a) return null;
    const Hh = root.SC9HistoricoAtraso;
    const lista = P().selecionar(a.reg.itens, g).slice().sort((x, y) => (y[6] || 0) - (x[6] || 0)).slice(0, 20);
    if (!lista.length) return null;
    return h('section', { class: 'pn-bloco pn-so-print pn-quebra', 'aria-label': 'Pedidos mais críticos' },
      h('h2', { text: 'Os 20 pedidos mais atrasados' }), h('p', { class: 'sub', text: 'Posição de ' + ddmmaaaa(a.reg.dia) + '. A lista completa está na página (Baixar lista em CSV).' }),
      tabelaDe(['Pedido', 'Cliente', 'Armazém', 'Etapa', 'Dias', 'Peças', 'O que fazer'], lista.map((it) => { const x = Hh.extra(it), v = Hh.avaliarPedido(p, it, a.reg.dia, agora); return [it[0], (x.n || '').slice(0, 28), it[1], (Hh.ETAPA[x.e] || '').replace(/ \(.*\)/, ''), fmtI(it[6]), fmtI(it[3]), curtoNaPalavra(v.acao.texto, 80)]; })),
      h('p', { class: 'pn-nota', text: 'Gerado em ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' · SC9 Control' }));
  }

  // ---------- barra de controle ----------
  function barra(p, fr) {
    const ops = P().opcoesGlobais(p);
    const sel = (rotulo, valor, lista, onChange, vazio) => h('label', null, rotulo, h('select', { onchange: (ev) => mudar(() => onChange(ev.target.value)), 'aria-label': rotulo }, h('option', { value: '', text: vazio }), lista.map((v) => h('option', { value: v, selected: v === valor, text: v }))));
    const periodos = [['7', '7 dias'], ['15', '15 dias'], ['30', '30 dias'], ['mes', 'Mês atual'], ['custom', 'Personalizado']];
    return h('div', { class: 'pn-barra', role: 'toolbar', 'aria-label': 'Período e filtros' },
      h('div', { class: 'grupo-c' },
        h('label', null, 'Período', h('select', { 'aria-label': 'Período', onchange: (ev) => mudar(() => { S.per = ev.target.value; if (S.per === 'custom' && !S.de) { const d = T().estado.dia; S.ate = d; S.de = P().somaDias(d, -29); } }) }, periodos.map(([v, t]) => h('option', { value: v, selected: v === S.per, text: t })))),
        S.per === 'custom' ? [h('label', null, 'De', h('input', { type: 'date', value: S.de, max: S.ate || undefined, onchange: (ev) => mudar(() => { S.de = ev.target.value; }) })), h('label', null, 'Até', h('input', { type: 'date', value: S.ate, min: S.de || undefined, onchange: (ev) => mudar(() => { S.ate = ev.target.value; }) }))] : null,
        sel('Armazém', S.arm, ops.armazens, (v) => { S.arm = v; }, 'Todos'),
        sel('Transportadora', S.transp, ops.transportadoras, (v) => { S.transp = v; }, 'Todas'),
        S.arm || S.transp ? h('button', { type: 'button', class: 'btn', onclick: () => mudar(() => { S.arm = ''; S.transp = ''; }), text: 'Limpar filtros ✕' }) : null),
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, h('a', { class: 'btn', href: urlModoTv(), text: 'Apresentar (TV)' }), h('button', { type: 'button', class: 'btn', onclick: () => root.print(), text: 'Imprimir' })));
  }

  // ---------- montagem ----------
  // corta o texto numa palavra inteira (antes cortava no meio: "Atras…")
  const curtoNaPalavra = (t, n) => { const x = String(t || ''); if (x.length <= n) return x; const c = x.slice(0, n), i = c.lastIndexOf(' '); return (i > n * 0.5 ? c.slice(0, i) : c).replace(/[ ,.;:]+$/, '') + '…'; };
  const ehUtil = (dia) => { const w = P().diaDaSemana(dia); return w > 0 && w < 6; };
  function montar() {
    garantirEstilo(); dicaEsconder();
    const tela = T(), est = tela.estado, p = est.p, dia = est.dia;
    // o filtro global vale para a lista de pedidos e o da lista volta para o painel (antes a lista não conseguia voltar a "Todos")
    const ops0 = P().opcoesGlobais(p);
    if (S.arm && ops0.armazens && !ops0.armazens.includes(S.arm)) S.arm = ''; // valor da URL que não existe nos dados
    if (S.transp && ops0.transportadoras && !ops0.transportadoras.includes(S.transp)) S.transp = '';
    if ((est.filtro.arm || '') !== S.arm) { if (S.arm !== sincArm) est.filtro.arm = S.arm; else S.arm = est.filtro.arm || ''; }
    if ((est.filtro.transp || '') !== S.transp) { if (S.transp !== sincTr) est.filtro.transp = S.transp; else S.transp = est.filtro.transp || ''; }
    sincArm = S.arm; sincTr = S.transp; guardarNaUrl();
    const agora = new Date();
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const fr = P().frescor(p, hoje);
    const g = global();
    const per = P().periodo(S.per, dia || hoje, { de: S.de, ate: S.ate });
    // o período termina no dia escolhido (ou no fim do período personalizado)
    const ate = S.per === 'custom' ? per.ate : dia;
    const de = S.per === 'custom' ? per.de : per.de;
    const dias = P().serie(p, de, ate || de, g);
    // média de 5 posições calculada com os dias anteriores ao período (senão as primeiras pontas eram médias de menos de 5 dias)
    const antesDias = P().serie(p, P().somaDias(de, -14), ate || de, g);
    const mmTodos = P().mediaMovel(antesDias.map((d) => (d.foto ? d.foto.tot : null)), 5);
    const mmPre = mmTodos.slice(mmTodos.length - dias.length);
    const fx = P().fluxo(p, de, ate || de, g);
    const cs = dia ? P().cartoes(p, dia, g, agora) : null;
    const a = dia ? p.porDia.get(dia) : null;
    const cAt = cs ? cs.cartoes.find((c) => c.id === 'atraso') : null;
    const filtroAtivo = Boolean(g.arm || g.transp);
    const filtroTxt0 = [g.arm ? 'armazém ' + g.arm : '', g.transp ? 'transportadora ' + g.transp : ''].filter(Boolean).join(' · ');
    // com filtro, a frase e o selo falam do que está filtrado (iguais ao cartão), e dizem o total da empresa à parte
    const frase = a ? (filtroAtivo && cAt && cAt.valor != null
      ? fmtI(cAt.valor) + (cAt.valor === 1 ? ' pedido em atraso' : ' pedidos em atraso') + ' (' + filtroTxt0 + ')' + (cAt.delta ? ', ' + (cAt.delta > 0 ? '+' : '−') + fmtI(Math.abs(cAt.delta)) + ' vs ' + ddmm(cAt.refDia) : (cAt.refDia ? ', igual a ' + ddmm(cAt.refDia) : '')) + '. Total da empresa neste dia: ' + fmtI(a.resumo.tot) + '.'
      : root.SC9AtrasoHistoricoXlsx.frase(a)) : (dia ? 'Sem posição de atraso neste dia (só há dados de despacho).' : 'Ainda não há posição de atraso gravada.');
    const tomVer = cAt && cAt.delta != null && cAt.ref != null ? (cAt.tom === 'bom' ? 'bom' : cAt.tom === 'ruim' ? 'ruim' : cAt.tom === 'atencao' ? (cAt.delta > 0 ? 'atencao' : 'bom') : '') : '';
    const refVer = cAt && cAt.refDia ? cAt.refDia : (a && a.cmp ? a.cmp.ant.dia : '');
    const comFoto = dias.filter((d) => d.foto).length;
    const filtroTxt = [g.arm ? 'armazém ' + g.arm : '', g.transp ? 'transportadora ' + g.transp : ''].filter(Boolean).join(' · ');
    const topo = cs ? cs.cartoes.filter((c) => ['atraso', 'cinco', 'aguardando', 'despachados', 'faturados', 'ocorrencias'].includes(c.id)).map((c) => Object.assign(c, c.id === 'atraso' ? { destaque: true } : {})) : [];
    const mais = cs ? cs.cartoes.filter((c) => !['atraso', 'cinco', 'aguardando', 'despachados', 'faturados', 'ocorrencias'].includes(c.id)) : [];
    document.body.classList.add('com-painel');
    document.body.classList.toggle('modo-tv', TV);
    const hero = h('section', { class: 'pn-hero', 'aria-label': 'Resumo do dia' },
        h('div', { class: 'pn-hero-topo' },
          h('div', null, h('p', { class: 'pn-kicker', text: 'SC9 Control · Histórico de atraso' }), h('div', { class: 'pn-h1', role: 'heading', 'aria-level': '2', text: dia ? semanaLonga(dia) + ', ' + ddmmaaaa(dia) : 'Sem dados' })),
          selo(fr)),
        h('p', { class: 'pn-frase', text: frase }),
        h('div', { class: 'pn-hero-meta' },
          cAt && cAt.ref != null && refVer ? h('span', { class: 'pn-veredito-chip ' + tomVer }, tomVer === 'bom' ? '▼ Melhorou' : tomVer === 'ruim' ? '▲ Piorou' : tomVer === 'atencao' ? '▲ Subiu um pouco' : '= Estável', ' vs ' + ddmm(refVer)) : null,
          h('span', { text: 'Período: ' + ddmm(de) + ' a ' + ddmm(ate || de) + (filtroTxt ? ' · ' + filtroTxt : '') + ' · ' + dias.filter((d) => d.foto && ehUtil(d.dia)).length + ' de ' + dias.filter((d) => ehUtil(d.dia)).length + ' dias úteis com posição gravada' + (p.analises.length < 3 ? ' (o histórico está começando)' : '') })));
    const aviso = fr.estado === 'desatualizado' || fr.estado === 'atencao' ? h('p', { class: 'pn-aviso', role: 'status', text: 'A última posição gravada é de ' + ddmmaaaa(fr.dia) + ' (' + fr.diasUteis + (fr.diasUteis === 1 ? ' dia útil' : ' dias úteis') + ' atrás). Os números são dessa posição; exporte o Histórico de Atraso no SC9 para atualizar.' }) : null;
    const cartoesEl = cs ? h('div', { class: 'pn-cards' }, topo.map((c) => cartao(c, dias))) : null;
    const maisEl = cs ? h('details', { class: 'pn-mais', open: S.mais, ontoggle: (ev) => { S.mais = ev.target.open; } }, h('summary', { text: 'Mais indicadores' }), h('div', { class: 'pn-cards' }, mais.map((c) => cartao(c, dias)))) : null;
    if (TV) {
      iniciarTv();
      const N = TV_SLIDES;
      const pontos = h('div', { class: 'pn-pontos', 'aria-hidden': 'true' }, Array.from({ length: N }, (_, i) => h('i', { class: i === S.slide ? 'ativo' : '' })));
      const mini = h('div', { class: 'pn-mini' }, h('b', { text: dia ? semanaLonga(dia) + ', ' + ddmmaaaa(dia) : 'Sem dados' }), h('span', { text: frase }), selo(fr));
      const slide = (i, ...filhos) => h('div', { class: 'pn-slide' + (S.slide === i ? ' ativo' : '') }, filhos);
      return h('div', { class: 'pn', id: 'pn-raiz' }, S.slide === 0 ? hero : mini, aviso,
        slide(0, cartoesEl, cs ? h('div', { class: 'pn-cards cinco' }, mais.map((c) => cartao(c, dias))) : null),
        slide(1, h('div', { class: 'pn-par' }, evolucao(dias, fx, dia, mmPre), produtividade(dias, dia))),
        slide(2, h('div', { class: 'pn-par' }, gargalosBloco(P().gargalos(p, dia, g)), armazensBloco(P().armazens(p, dia, g)))),
        slide(3, h('div', { class: 'pn-par' }, distribuicaoBloco(P().distribuicao(p, dia, g)), cascataBloco(P().cascata(p, dia, g), dia))),
        slide(4, h('div', { class: 'pn-par' }, calorBloco(P().mapaCalor(p, dia, g, S.calor), S.calor), paretoBloco(P().transportadoras(p, dia, g, 8)))),
        slide(5, h('div', { class: 'pn-par' }, prioridadesBloco(p, a, g, agora))),
        h('div', { class: 'pn-tv-rodape' }, pontos, h('span', null, 'Troca sozinha a cada 20 s · setas ← → mudam a tela · ', h('a', { href: urlSairTv(), style: 'color:#cfe0ff', text: 'Sair (Esc)' }))));
    }
    return h('div', { class: 'pn', id: 'pn-raiz' },
      hero, barra(p, fr), aviso, cartoesEl, maisEl,
      h('div', { class: 'pn-par' }, evolucao(dias, fx, dia, mmPre), produtividade(dias, dia), taxaSegura(p, g, ate || dia || hoje), gargalosBloco(P().gargalos(p, dia, g)), armazensBloco(P().armazens(p, dia, g)), distribuicaoBloco(P().distribuicao(p, dia, g)), cascataBloco(P().cascata(p, dia, g), dia), calorBloco(P().mapaCalor(p, dia, g, S.calor), S.calor), paretoBloco(P().transportadoras(p, dia, g, 8))),
      tabelaCriticos(p, a, g, agora),
      h('p', { class: 'pn-sep', text: 'Detalhe do dia e pedidos' }));
  }

  // Modo TV: 2 telas em rodízio (25 s), setas do teclado trocam, Esc sai. Para quando a aba está escondida.
  let tvIniciado = false;
  function iniciarTv() {
    if (tvIniciado) return; tvIniciado = true;
    const ir = (n) => { S.slide = ((S.slide + n) % TV_SLIDES + TV_SLIDES) % TV_SLIDES; T().desenhar(); };
    S.timer = setInterval(() => { if (!document.hidden) ir(1); }, 20000);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowRight') ir(1); else if (ev.key === 'ArrowLeft') ir(-1); else if (ev.key === 'Escape') location.href = urlSairTv(); });
  }

  root.SC9AtrasoPainelUI = { montar, estado: S };
})(typeof window === 'object' ? window : globalThis);
