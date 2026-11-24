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
  const brlCurto = (v) => (v >= 1e6 ? 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : v >= 1e3 ? 'R$ ' + Math.round(v / 1e3).toLocaleString('pt-BR') + ' mil' : 'R$ ' + Math.round(v).toLocaleString('pt-BR'));
  const semanaLonga = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' }).replace(/^./, (c) => c.toUpperCase());
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const TOM_TXT = { bom: 'melhor', ruim: 'pior', atencao: 'atenção', neutro: 'estável' };
  const TOM_ICONE = { bom: '✔', ruim: '✖', atencao: '⚠', neutro: '●' };
  const COR = { estoque: '#1c5cab', faturamento: '#86b6ef', linha: '#14233d', ref: '#8a94a8', grade: '#e3e9f2', texto: '#5b6a84' };

  const h = (tag, props, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
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
  const S = { slide: 0, timer: 0, per: ['7', '15', '30', 'mes', 'custom'].includes(q.get('p')) ? q.get('p') : '30', arm: q.get('arm') || '', transp: q.get('tr') || '', de: q.get('de') || '', ate: q.get('ate') || '', ver: {}, prod: 'pedidos', mais: false };
  function guardarNaUrl() {
    try {
      const u = new URL(location.href);
      const set = (k, v, padrao) => { if (v && v !== padrao) u.searchParams.set(k, v); else u.searchParams.delete(k); };
      set('p', S.per, '30'); set('arm', S.arm, ''); set('tr', S.transp, '');
      if (S.per === 'custom') { set('de', S.de, ''); set('ate', S.ate, ''); } else { u.searchParams.delete('de'); u.searchParams.delete('ate'); }
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* sem histórico de navegação */ }
  }
  const mudar = (fn) => { fn(); guardarNaUrl(); const f = T().estado.filtro; f.arm = S.arm; f.transp = S.transp; T().desenhar(); };
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
  .pn-bloco.m7 { grid-column:span 7; } .pn-bloco.m5 { grid-column:span 5; } .pn-bloco.m4 { grid-column:span 4; } .pn-bloco.m6 { grid-column:span 6; }
  .pn-bloco h2 { font-size:18px; margin:0; letter-spacing:-.01em; } .pn-bloco .sub { font-size:13px; color:#5b6a84; margin:3px 0 10px; font-weight:500; }
  .pn-topo { display:flex; flex-wrap:wrap; gap:8px; justify-content:space-between; align-items:flex-start; }
  .pn-seg { display:inline-flex; background:#eef1f6; border-radius:10px; padding:3px; gap:2px; } .pn-seg button { font:inherit; font-size:12.5px; font-weight:700; padding:5px 12px; border:0; border-radius:8px; background:transparent; color:#43506a; cursor:pointer; }
  .pn-seg button[aria-pressed=true] { background:#fff; color:var(--accent); box-shadow:0 1px 3px rgba(20,35,61,.15); }
  .pn-link { font:inherit; font-size:12.5px; font-weight:700; color:var(--accent); background:none; border:0; padding:6px 4px; cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
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
  `;
  function garantirEstilo() { if (!document.getElementById('pn-estilo')) document.head.appendChild(h('style', { id: 'pn-estilo', text: CSS })); }

  // ---------- peças pequenas ----------
  function selo(fr) {
    const txt = fr.estado === 'vazio' ? 'Sem posição gravada' : fr.estado === 'em-dia' ? 'Dados em dia' : fr.estado === 'atencao' ? 'Atenção: última posição de ' + ddmm(fr.dia) : 'Desatualizado: última posição de ' + ddmm(fr.dia);
    const hora = fr.atualizadoEm ? new Date(fr.atualizadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
    return h('span', { class: 'pn-selo ' + fr.estado, role: 'status', title: 'A posição do dia só é gravada quando o Histórico de Atraso é exportado no SC9.' }, (fr.estado === 'em-dia' ? '● ' : '⚠ ') + txt + (hora ? ' · ' + hora : ''));
  }

  function sparkline(valores, tomCor) {
    const pts = valores.map((v, i) => [i, v]).filter((x) => x[1] != null);
    if (pts.length < 2) return null;
    const w = 110, hh = 28, max = Math.max(...pts.map((x) => x[1])), min = Math.min(...pts.map((x) => x[1])), span = max - min || 1, n = valores.length - 1 || 1;
    const xy = pts.map(([i, v]) => [(i / n * (w - 6) + 3).toFixed(1), (hh - 4 - (v - min) / span * (hh - 8)).toFixed(1)]);
    const ult = xy[xy.length - 1];
    return s('svg', { class: 'spark', width: w, height: hh, viewBox: '0 0 ' + w + ' ' + hh, 'aria-hidden': 'true' },
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
    let p = passo; for (const m of [1, 2, 2.5, 5, 10]) { if (alvo / (m * passo) <= 4.0001) { p = m * passo; break; } }
    const topo = Math.ceil(alvo / p) * p, ticks = []; for (let v = 0; v <= topo + 1e-9; v += p) ticks.push(v);
    return { topo, ticks };
  }
  const rotuloEixoDias = (n) => Math.max(1, Math.ceil(n / 12));

  function graficoBase(dias, max, desenharDia, rotulo, opts) {
    const W = (opts && opts.W) || 760, Ht = (opts && opts.Ht) || 290, M = { l: 46, r: 10, t: 12, b: 34 }, iw = W - M.l - M.r, ih = Ht - M.t - M.b;
    const esc = escalaY(max), slot = iw / Math.max(1, dias.length), y = (v) => M.t + ih - (v / esc.topo) * ih;
    const svg = s('svg', { class: 'pn-svg', viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': rotulo });
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

  function campoFoco(d, i, c, rotulo, onClick, ativo) {
    return s('g', { class: 'ponto', tabindex: 0, role: 'button', 'aria-label': rotulo, onclick: onClick, onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick(); } } },
      s('title', { text: rotulo }),
      s('rect', { class: 'fundo', x: c.x0, y: c.M.t, width: c.slot, height: c.ih, fill: ativo ? '#123b7a' : 'transparent', 'fill-opacity': ativo ? 0.1 : 0 }),
      s('rect', { class: 'foco', x: c.x0 + 0.5, y: c.M.t, width: c.slot - 1, height: c.ih, fill: 'none' }));
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

  function evolucao(serieDias, fx, dia) {
    const comFoto = serieDias.filter((d) => d.foto);
    const mm = P().mediaMovel(serieDias.map((d) => (d.foto ? d.foto.tot : null)), 5);
    const pico = comFoto.length ? comFoto.reduce((m, d) => (d.foto.tot > m.foto.tot ? d : m), comFoto[0]) : null;
    const hoje = serieDias.find((d) => d.dia === dia);
    const max = Math.max(1, ...comFoto.map((d) => d.foto.tot));
    const sub = !comFoto.length ? 'Nenhuma posição gravada neste período.' : 'Pico de ' + fmtI(pico.foto.tot) + ' em ' + ddmm(pico.dia) + (hoje && hoje.foto && pico.foto.tot && hoje.foto.tot !== pico.foto.tot ? ' · hoje ' + (((hoje.foto.tot - pico.foto.tot) / pico.foto.tot) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '% ' + (hoje.foto.tot < pico.foto.tot ? 'abaixo' : 'acima') + ' do pico' : '');
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
        grupo.appendChild(campoFoco(d, i, c, ddmmaaaa(d.dia) + ': ' + fmtI(d.foto.tot) + ' em atraso (estoque ' + fmtI(d.foto.e) + ', faturamento ' + fmtI(d.foto.f) + '). Clique para abrir o dia.', () => T().escolherDia(d.dia, false), d.dia === dia));
        return grupo;
      }, 'Pedidos em atraso por dia, em estoque e faturamento, com a média móvel de 5 dias. ' + sub, { Ht: TV ? 440 : 290 });
      const pts = []; serieDias.forEach((d, i) => { if (mm[i] != null) pts.push((g.M.l + i * g.slot + g.slot / 2).toFixed(1) + ',' + g.y(mm[i]).toFixed(1)); });
      if (pts.length > 1) g.svg.appendChild(s('polyline', { points: pts.join(' '), fill: 'none', stroke: COR.linha, 'stroke-width': 2, 'stroke-dasharray': '5 4', 'stroke-linejoin': 'round' }));
      return h('div', null, g.svg, h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'background:' + COR.estoque }), 'Estoque'), h('span', null, h('i', { style: 'background:' + COR.faturamento }), 'Faturamento'), h('span', null, h('i', { class: 'linha', style: 'background:' + COR.linha }), 'Média dos últimos 5 dias com posição'), h('span', null, h('i', { style: 'background:repeating-linear-gradient(45deg,#cfd7e4,#cfd7e4 2px,#fff 2px,#fff 4px)' }), 'Dia sem posição gravada (não é zero)')));
    };
    const tabela = () => tabelaDe(['Dia', 'Em atraso', 'Estoque', 'Faturamento', 'Peças', '5+ dias', 'Entraram', 'Saíram'], serieDias.filter((d) => d.foto).map((d) => { const f = fx.find((x) => x.dia === d.dia); return [ddmmaaaa(d.dia) + ' ' + d.semana, fmtI(d.foto.tot), fmtI(d.foto.e), fmtI(d.foto.f), fmtI(d.foto.pecas), fmtI(d.foto.cinco), f ? fmtI(f.entraram) : '—', f ? fmtI(f.sairam) : '—']; }));
    return blocoGrafico('evolucao', 'Evolução dos atrasos', sub, null, corpo, tabela, fluxoGrafico(fx, dia), 'm7');
  }

  // Fluxo: entraram (acima, vermelho) e saíram (abaixo, verde); a posição acima/abaixo do zero é o segundo sinal além da cor.
  function fluxoGrafico(fx, dia) {
    if (!fx.length) return null;
    const max = Math.max(1, ...fx.map((d) => Math.max(d.entraram, d.sairam)));
    const W = 760, Ht = 150, M = { l: 46, r: 10, t: 8, b: 22 }, ih = Ht - M.t - M.b, meio = M.t + ih / 2, slot = (W - M.l - M.r) / fx.length, esc = (v) => (v / max) * (ih / 2 - 4);
    const svg = s('svg', { class: 'pn-svg', viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': 'Pedidos que entraram no atraso (acima da linha) e que saíram do atraso (abaixo), por dia gravado.' });
    svg.appendChild(s('line', { x1: M.l, x2: W - M.r, y1: meio, y2: meio, stroke: '#9aa6b8' }));
    svg.appendChild(s('text', { x: M.l - 6, y: M.t + 10, 'text-anchor': 'end', text: '▲ ' + fmtI(max) })); svg.appendChild(s('text', { x: M.l - 6, y: Ht - M.b, 'text-anchor': 'end', text: '▼ ' + fmtI(max) }));
    fx.forEach((d, i) => {
      const bw = Math.max(2, slot * 0.6), x = M.l + i * slot + (slot - bw) / 2;
      svg.appendChild(s('rect', { x, y: meio - esc(d.entraram), width: bw, height: esc(d.entraram), fill: '#c63828', opacity: d.dia === dia ? 1 : 0.8 }));
      svg.appendChild(s('rect', { x, y: meio, width: bw, height: esc(d.sairam), fill: '#1f8a4c', opacity: d.dia === dia ? 1 : 0.8 }));
      svg.appendChild(s('title', { text: ddmmaaaa(d.dia) + ': entraram ' + d.entraram + ', saíram ' + d.sairam + ' (saldo ' + (d.saldo > 0 ? '+' : '') + d.saldo + ')' }));
      if (i % rotuloEixoDias(fx.length) === 0) svg.appendChild(s('text', { x: x + bw / 2, y: Ht - 6, 'text-anchor': 'middle', text: ddmm(d.dia) }));
    });
    return h('div', { class: 'pn-fluxo', style: 'margin-top:14px' }, h('h3', { text: 'Fluxo do atraso: quem entrou e quem saiu', style: 'font-size:14px;margin-bottom:4px' }), svg,
      h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'background:#c63828' }), '▲ Entraram no atraso (acima)'), h('span', null, h('i', { style: 'background:#1f8a4c' }), '▼ Saíram do atraso (abaixo)'), null));
  }

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
    const corpo = () => {
      if (!pr.despachados.dias && !pr.faturados.dias) return h('p', { class: 'pn-vazio', text: 'Sem despachos ou faturamento registrados neste período.' });
      const g = graficoBase(serieDias, max, (d, i, c) => {
        const grupo = s('g', null), v = d.exp ? d.exp[campo] : null;
        if (v != null) {
          const bw = Math.max(2, c.slot * 0.62), x = c.x0 + (c.slot - bw) / 2;
          grupo.appendChild(s('rect', { x, y: c.y(v), width: bw, height: Math.max(0, c.base - c.y(v)), fill: COR.estoque, stroke: d.dia === dia ? '#14233d' : 'none', 'stroke-width': 2 }));
          grupo.appendChild(campoFoco(d, i, c, ddmmaaaa(d.dia) + ': ' + fmtI(v) + ' ' + unidade + ' despachados' + (d.fat ? ', ' + fmtI(d.fat[campo]) + ' faturados' : '') + '.', () => { if (T().temDia(d.dia)) T().escolherDia(d.dia, false); }, d.dia === dia));
        } else if (d.foto || d.fat) grupo.appendChild(s('title', { text: ddmmaaaa(d.dia) + ': sem registro de despacho' }));
        return grupo;
      }, 'Pedidos despachados por dia e faturados. ' + sub, { W: 560, Ht: TV ? 380 : 250, fmtY: (v) => (v >= 1000 ? fmtN(v / 1000) + ' mil' : fmtI(v)) });
      const pts = []; serieDias.forEach((d, i) => { if (d.fat) pts.push([(g.M.l + i * g.slot + g.slot / 2).toFixed(1), g.y(d.fat[campo]).toFixed(1)]); });
      if (pts.length) { if (pts.length > 1) g.svg.appendChild(s('polyline', { points: pts.map((x) => x.join(',')).join(' '), fill: 'none', stroke: '#5f6c84', 'stroke-width': 2 })); pts.forEach(([x, yy]) => g.svg.appendChild(s('circle', { cx: x, cy: yy, r: 3.5, fill: '#fff', stroke: '#5f6c84', 'stroke-width': 2 }))); }
      if (mediaP != null) { const ym = g.y(mediaP); g.svg.appendChild(s('line', { x1: g.M.l, x2: g.W - g.M.r, y1: ym, y2: ym, stroke: COR.ref, 'stroke-dasharray': '4 4' })); }
      return h('div', null, g.svg, h('div', { class: 'pn-leg' }, h('span', null, h('i', { style: 'background:' + COR.estoque }), (medida === 'pecas' ? 'Peças' : 'Pedidos') + ' despachados'), h('span', null, h('i', { class: 'linha', style: 'background:#5f6c84' }), (medida === 'pecas' ? 'Peças' : 'Pedidos') + ' faturados'), h('span', null, h('i', { class: 'linha', style: 'background:' + COR.ref }), 'Média de despachados'), h('span', { text: 'Dia sem barra = sem registro.' })));
    };
    const tabela = () => tabelaDe(['Dia', 'Pedidos despachados', 'Peças despachadas', 'Pedidos faturados', 'Peças faturadas'], serieDias.filter((d) => d.exp || d.fat).map((d) => [ddmmaaaa(d.dia) + ' ' + d.semana, d.exp ? fmtI(d.exp.pedidos) : null, d.exp ? fmtI(d.exp.pecas) : null, d.fat ? fmtI(d.fat.pedidos) : null, d.fat ? fmtI(d.fat.pecas) : null]));
    const semana = pr.semana.filter((x) => x.n);
    const mx = Math.max(1, ...semana.map((x) => (medida === 'pecas' ? x.pecasDespachadas : x.despachados) || 0));
    const dow = semana.length ? h('div', { class: 'pn-dow', style: 'margin-top:14px' }, h('h3', { text: 'Média por dia da semana (despachados)', style: 'font-size:14px;margin-bottom:6px' }),
      semana.map((x) => { const v = (medida === 'pecas' ? x.pecasDespachadas : x.despachados) || 0; return h('div', { class: 'pn-linha', style: 'cursor:default;grid-template-columns:50px 1fr 90px' }, h('span', { class: 'nome', text: x.semana }), h('div', { class: 'pn-trilho' }, h('span', { style: 'width:' + (v / mx * 100).toFixed(1) + '%;background:' + COR.estoque })), h('span', { class: 'num', text: fmtI(v) + ' · ' + x.n + (x.n === 1 ? ' dia' : ' dias') })); })) : null;
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
        h('span', { class: 'num' }, e.etapa === gar.maior ? '⚑ ' : '', fmtI(e.qtd) + ' · ' + fmtN(e.pct) + '% · ' + fmtI(e.pecas) + ' peças' + (e.cinco ? ' · ' + e.cinco + ' c/ 5+ d' : '')))),
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
        h('span', { class: 'num' }, fmtI(a.tot) + (a.pctBase != null ? ' (' + fmtN(a.pctBase) + '% da base)' : '') + ' · ' + fmtI(a.pecas) + ' peças · ' + a.cinco + ' c/ 5+ d'))),
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
        return h('div', { class: 'pn-col', role: 'listitem', 'aria-label': f.rotulo + ': ' + f.qtd + ' pedidos (' + fmtN(f.pct) + '%)' },
          h('span', { class: 'qtd', text: fmtI(f.qtd) }), h('span', { style: 'font-size:11.5px;color:#43506a', text: fmtN(f.pct) + '%' }),
          h('div', { style: 'width:100%;height:120px;display:flex;align-items:flex-end;position:relative' }, h('div', { class: 'barra', style: 'height:' + altura + '%;background:' + cor[f.nivel] }), antes ? h('div', { class: 'fantasma', style: 'height:' + (antes / max * 100).toFixed(1) + '%' }) : null),
          h('span', { class: 'lab', text: marca[f.nivel] + f.rotulo }));
      })),
        h('div', { class: 'pn-leg' }, dist.antes ? h('span', null, 'Contorno tracejado: ', h('b', { text: ddmm(dist.refDia) }), ' (7 dias antes)') : h('span', { text: 'Ainda não há posição de 7 dias antes para comparar.' })),
        h('p', { class: 'pn-nota', text: fmtI(dist.cincoAtual) + ' pedidos (' + fmtN(dist.atual.total ? dist.cincoAtual / dist.atual.total * 100 : 0) + '%) com 5 dias ou mais' + (dist.cincoAntes != null ? ' · há 7 dias eram ' + fmtI(dist.cincoAntes) : '') + '.' }));
    };
    const tabela = () => (dist ? tabelaDe(['Faixa', 'Pedidos', '%', 'Peças', dist.antes ? 'Pedidos há 7 dias' : ''].filter(Boolean), dist.atual.lista.map((f, i) => [f.rotulo, fmtI(f.qtd), fmtN(f.pct) + '%', fmtI(f.pecas)].concat(dist.antes ? [fmtI(dist.antes.lista[i].qtd)] : []))) : h('p', { class: 'pn-vazio', text: 'Sem posição neste dia.' }));
    return blocoGrafico('distribuicao', 'Há quanto tempo estão atrasados', 'Quanto mais à direita, mais antigo.', null, corpo, tabela, null, 'm12');
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
      tabelaDe(['Pedido', 'Cliente', 'Armazém', 'Etapa', 'Dias', 'Peças', 'O que fazer'], lista.map((it) => { const x = Hh.extra(it), v = Hh.avaliarPedido(p, it, a.reg.dia, agora); return [it[0], (x.n || '').slice(0, 28), it[1], (Hh.ETAPA[x.e] || '').replace(/ \(.*\)/, ''), fmtI(it[6]), fmtI(it[3]), v.acao.texto.slice(0, 70)]; })),
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
  function montar() {
    garantirEstilo();
    const tela = T(), est = tela.estado, p = est.p, dia = est.dia;
    if (S.arm && !est.filtro.arm) est.filtro.arm = S.arm; // o filtro global também vale para a lista de pedidos
    if (S.transp && !est.filtro.transp) est.filtro.transp = S.transp;
    const agora = new Date();
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const fr = P().frescor(p, hoje);
    const g = global();
    const per = P().periodo(S.per, dia || hoje, { de: S.de, ate: S.ate });
    // o período termina no dia escolhido (ou no fim do período personalizado)
    const ate = S.per === 'custom' ? per.ate : dia;
    const de = S.per === 'custom' ? per.de : per.de;
    const dias = P().serie(p, de, ate || de, g);
    const fx = P().fluxo(p, de, ate || de, g);
    const cs = dia ? P().cartoes(p, dia, g, agora) : null;
    const a = dia ? p.porDia.get(dia) : null;
    const frase = a ? root.SC9AtrasoHistoricoXlsx.frase(a) : (dia ? 'Sem posição de atraso neste dia (só há dados de despacho).' : 'Ainda não há posição de atraso gravada.');
    const tomVer = a && a.cmp ? (a.resumo.tot < a.cmp.resumoAnt.tot ? 'bom' : a.resumo.tot > a.cmp.resumoAnt.tot ? 'ruim' : '') : '';
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
          a && a.cmp ? h('span', { class: 'pn-veredito-chip ' + tomVer }, tomVer === 'bom' ? '▼ Melhorou' : tomVer === 'ruim' ? '▲ Piorou' : '= Igual', ' vs ' + ddmm(a.cmp.ant.dia)) : null,
          h('span', { text: 'Período: ' + ddmm(de) + ' a ' + ddmm(ate || de) + (filtroTxt ? ' · ' + filtroTxt : '') + ' · ' + comFoto + ' de ' + dias.length + ' dias com posição gravada' + (comFoto < 3 ? ' (o histórico está começando)' : '') })));
    const aviso = fr.estado === 'desatualizado' || fr.estado === 'atencao' ? h('p', { class: 'pn-aviso', role: 'status', text: 'A última posição gravada é de ' + ddmmaaaa(fr.dia) + ' (' + fr.diasUteis + (fr.diasUteis === 1 ? ' dia útil' : ' dias úteis') + ' atrás). Os números são dessa posição; exporte o Histórico de Atraso no SC9 para atualizar.' }) : null;
    const cartoesEl = cs ? h('div', { class: 'pn-cards' }, topo.map((c) => cartao(c, dias))) : null;
    const maisEl = cs ? h('details', { class: 'pn-mais', open: S.mais, ontoggle: (ev) => { S.mais = ev.target.open; } }, h('summary', { text: 'Mais indicadores' }), h('div', { class: 'pn-cards' }, mais.map((c) => cartao(c, dias)))) : null;
    if (TV) {
      iniciarTv();
      const N = 4;
      const pontos = h('div', { class: 'pn-pontos', 'aria-hidden': 'true' }, Array.from({ length: N }, (_, i) => h('i', { class: i === S.slide ? 'ativo' : '' })));
      const mini = h('div', { class: 'pn-mini' }, h('b', { text: dia ? semanaLonga(dia) + ', ' + ddmmaaaa(dia) : 'Sem dados' }), h('span', { text: frase }), selo(fr));
      const slide = (i, ...filhos) => h('div', { class: 'pn-slide' + (S.slide === i ? ' ativo' : '') }, filhos);
      return h('div', { class: 'pn', id: 'pn-raiz' }, S.slide === 0 ? hero : mini, aviso,
        slide(0, cartoesEl, cs ? h('div', { class: 'pn-cards cinco' }, mais.map((c) => cartao(c, dias))) : null),
        slide(1, h('div', { class: 'pn-par' }, evolucao(dias, fx, dia), produtividade(dias, dia))),
        slide(2, h('div', { class: 'pn-par' }, gargalosBloco(P().gargalos(p, dia, g)), armazensBloco(P().armazens(p, dia, g)))),
        slide(3, h('div', { class: 'pn-par' }, distribuicaoBloco(P().distribuicao(p, dia, g)), prioridadesBloco(p, a, g, agora))),
        h('div', { class: 'pn-tv-rodape' }, pontos, h('span', null, 'Troca sozinha a cada 20 s · setas ← → mudam a tela · ', h('a', { href: urlSairTv(), style: 'color:#cfe0ff', text: 'Sair (Esc)' }))));
    }
    return h('div', { class: 'pn', id: 'pn-raiz' },
      hero, barra(p, fr), aviso, cartoesEl, maisEl,
      h('div', { class: 'pn-par' }, evolucao(dias, fx, dia), produtividade(dias, dia), gargalosBloco(P().gargalos(p, dia, g)), armazensBloco(P().armazens(p, dia, g)), distribuicaoBloco(P().distribuicao(p, dia, g))),
      tabelaCriticos(p, a, g, agora),
      h('p', { class: 'pn-sep', text: 'Detalhe do dia e pedidos' }));
  }

  // Modo TV: 2 telas em rodízio (25 s), setas do teclado trocam, Esc sai. Para quando a aba está escondida.
  let tvIniciado = false;
  function iniciarTv() {
    if (tvIniciado) return; tvIniciado = true;
    const ir = (n) => { S.slide = ((S.slide + n) % 4 + 4) % 4; T().desenhar(); };
    S.timer = setInterval(() => { if (!document.hidden) ir(1); }, 20000);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowRight') ir(1); else if (ev.key === 'ArrowLeft') ir(-1); else if (ev.key === 'Escape') location.href = urlSairTv(); });
  }

  root.SC9AtrasoPainelUI = { montar, estado: S };
})(typeof window === 'object' ? window : globalThis);
