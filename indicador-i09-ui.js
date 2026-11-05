/* Indicador BSC I 09 — OM e OS, ordens atendidas no almoxarifado (tela). Módulo aditivo: monta sozinho um botão
 * "Indicador I 09", um painel por cima do app e um campo "SC2" na tela inicial de upload; não altera nenhuma
 * tela existente. Também acrescenta as abas do indicador ao "Relatório Geral" (Excel) quando a base está carregada.
 * Depende de: indicador-i09.js (modelo), React/ReactDOM (CDN) e SheetJS (window.XLSX). */
(function (root) {
  'use strict';
  if (!root.document || !root.React || !root.ReactDOM || !root.SC9IndicadorI09) return;
  const M = root.SC9IndicadorI09, R = root.React, h = R.createElement, { useState, useEffect, useMemo, useCallback, useRef } = R;
  const fmtN = (n) => n == null || n === '' ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const fmtP = (x, d) => x == null ? '—' : (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }) + '%';
  const fmtD = (iso) => iso ? iso.split('-').reverse().join('/') : '—';
  const fmtDH = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch (e) { return iso || ''; } };
  const hoje = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const NAVY = '#1F3864', AMBER = '#E9A23B', BLUE = '#4F63D2', GREY = '#8A92B2', GREEN = '#0A8571', WARN = '#B26A00', RED = '#C62828';
  const COR = { om: NAVY, os: AMBER };
  const FERIADOS_2026 = ['2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-20', '2026-12-25'];

  const CSS = `
#sc9-i09-root{font-family:inherit;color:var(--sc9-ink,#1B2138)}
.sc9-i09-fab{position:fixed;right:20px;bottom:76px;z-index:55;border:0;border-radius:999px;padding:12px 18px;background:${NAVY};color:#fff;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;box-shadow:0 6px 18px rgba(30,40,90,.28)}
.sc9-i09-fab:hover{filter:brightness(1.15)}
.sc9-i09-overlay{position:fixed;inset:0;z-index:72;background:var(--sc9-bg,#F3F5FA);overflow:auto;font-size:13px}
.sc9-i09-top{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:14px;padding:12px 24px;background:var(--sc9-panel,#fff);border-bottom:1px solid var(--sc9-border-soft,#E5E9F3);flex-wrap:wrap}
.sc9-i09-top h1{font-size:17px;font-weight:650;margin:0;flex:1;min-width:240px}
.sc9-i09-top h1 small{display:block;font-size:11px;font-weight:400;color:var(--sc9-dim,#6B7496);margin-top:3px}
.sc9-i09-tabs{display:flex;gap:4px;background:var(--sc9-panel2,#F1F3F9);padding:4px;border-radius:10px}
.sc9-i09-tab{border:0;background:transparent;padding:7px 13px;border-radius:7px;font-family:inherit;font-weight:500;font-size:13px;color:var(--sc9-muted,#4F587A);cursor:pointer}
.sc9-i09-tab[aria-selected=true]{background:var(--sc9-panel,#fff);color:${BLUE};font-weight:650;box-shadow:0 1px 3px rgba(40,50,110,.15)}
.sc9-i09-body{max-width:1240px;margin:0 auto;padding:18px 24px 50px}
.sc9-i09-btn{border:1px solid var(--sc9-border,#D3DAEA);background:var(--sc9-panel,#fff);color:var(--sc9-ink,#1B2138);border-radius:8px;padding:8px 14px;font-family:inherit;font-weight:500;font-size:13px;cursor:pointer}
.sc9-i09-btn:hover{background:var(--sc9-highlight,#E4EAFB)}
.sc9-i09-btn.pri{background:${BLUE};border-color:${BLUE};color:#fff}
.sc9-i09-btn.sm{padding:4px 9px;font-size:12px}
.sc9-i09-btn:disabled{opacity:.5;cursor:not-allowed}
.sc9-i09-sel,.sc9-i09-inp{border:1px solid var(--sc9-border,#D3DAEA);border-radius:8px;padding:7px 10px;font-family:inherit;font-size:13px;background:#fff;color:inherit}
.sc9-i09-card{background:var(--sc9-panel,#fff);border:1px solid var(--sc9-border-soft,#E5E9F3);border-radius:14px;padding:16px;min-width:0}
.sc9-i09-card h2{font-size:14px;font-weight:650;margin:0 0 4px}
.sc9-i09-sub{font-size:11.5px;color:var(--sc9-dim,#6B7496);line-height:1.6;margin:0 0 10px}
.sc9-i09-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:14px;margin-bottom:14px}
.sc9-i09-two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
@media(max-width:860px){.sc9-i09-two{grid-template-columns:1fr}}
.sc9-i09-ind{border-top:4px solid var(--c,${NAVY})}
.sc9-i09-ind header{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:2px}
.sc9-i09-ind header b{font-size:20px;color:var(--c,${NAVY})}
.sc9-i09-ind header span{font-size:11px;color:var(--sc9-dim,#6B7496);text-align:right}
.sc9-i09-kp{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 8px}
.sc9-i09-kp div{background:var(--sc9-panel2,#F1F3F9);border-radius:10px;padding:8px 10px;min-width:0}
.sc9-i09-kp span{display:block;font-size:10.5px;color:var(--sc9-muted,#4F587A)}
.sc9-i09-kp strong{display:block;font-size:19px;letter-spacing:-.4px;font-variant-numeric:tabular-nums;margin-top:2px}
.sc9-i09-kp em{display:block;font-style:normal;font-size:10.5px;color:var(--sc9-dim,#6B7496);line-height:1.3}
.sc9-i09-kp .ok strong{color:${GREEN}}.sc9-i09-kp .warn strong{color:${WARN}}.sc9-i09-kp .bad strong{color:${RED}}
@media(max-width:560px){.sc9-i09-kp{grid-template-columns:repeat(2,1fr)}}
.sc9-i09-prog{height:8px;background:var(--sc9-panel2,#F1F3F9);border-radius:5px;position:relative;margin:4px 0 6px}
.sc9-i09-prog i{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:var(--c,${NAVY})}
.sc9-i09-prog u{position:absolute;top:-3px;bottom:-3px;width:2px;background:#1B2138;opacity:.55}
.sc9-i09-line{font-size:11.5px;color:var(--sc9-muted,#4F587A)}
.sc9-i09-table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
.sc9-i09-table th{text-align:left;font-weight:600;color:var(--sc9-muted,#4F587A);padding:5px 8px;border-bottom:1px solid var(--sc9-border,#D3DAEA);white-space:nowrap}
.sc9-i09-table td{padding:5px 8px;border-bottom:1px solid var(--sc9-border-soft,#E5E9F3)}
.sc9-i09-table .r{text-align:right}.sc9-i09-table .dim td{color:#A6ADC6}
.sc9-i09-table tfoot td{font-weight:650;border-top:1px solid var(--sc9-border,#D3DAEA)}
.sc9-i09-table .om{color:${NAVY};font-weight:600}.sc9-i09-table .os{color:#B67410;font-weight:600}
.sc9-i09-note{border-radius:10px;padding:9px 14px;font-size:12.5px;line-height:1.55;margin-bottom:12px;background:#FFF6E0;border:1px solid #E8D39B;color:#6B4E00}
.sc9-i09-err{border-radius:10px;padding:10px 14px;font-size:12.5px;margin:10px 0;background:#FDECEA;border:1px solid #E7B4AE;color:#8A241B}
.sc9-i09-ok{border-radius:10px;padding:10px 14px;font-size:12.5px;margin:10px 0;background:#E6F6F2;border:1px solid #9FD6C8;color:#0A5E50}
.sc9-i09-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sc9-i09-leg{display:flex;gap:14px;font-size:11.5px;color:var(--sc9-muted,#4F587A);margin:0 0 4px}
.sc9-i09-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.sc9-i09-det{background:var(--sc9-panel,#fff);border:1px solid var(--sc9-border-soft,#E5E9F3);border-radius:14px;padding:12px 16px;margin-bottom:14px}
.sc9-i09-det summary{cursor:pointer;font-weight:650;font-size:14px}
.sc9-i09-det[open] summary{margin-bottom:10px}
.sc9-i09-tb{display:inline-block;height:8px;border-radius:4px;vertical-align:middle;margin-right:6px}
#sc9-i09-start{margin:0}
.sc9-i09-drop{cursor:pointer;border-radius:12px;padding:16px;background:#fff;border:1px solid #D3DAEA;transition:background .15s}
.sc9-i09-drop.over{background:#E4EAFB}
.sc9-i09-drop .t{font-size:14px;font-weight:500;color:#1B2138;display:flex;gap:6px;align-items:center}
.sc9-i09-drop .s{font-size:12px;color:#6B7496;margin-top:2px}
`;
  const style = root.document.createElement('style'); style.id = 'sc9-i09-style'; style.textContent = CSS; root.document.head.appendChild(style);

  /* ------------------------------ API ------------------------------ */
  async function api(url, body) {
    const opt = { credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.headers['X-Sc9-App'] = '1';
      const data = JSON.stringify(body);
      if (data.length > 60000 && typeof root.CompressionStream === 'function') {
        const gz = new Blob([data]).stream().pipeThrough(new root.CompressionStream('gzip'));
        opt.body = await new Response(gz).blob(); opt.headers['Content-Encoding'] = 'gzip';
      } else opt.body = data;
    }
    const r = await fetch(url, opt); let j = null; try { j = await r.json(); } catch (e) { /* sem corpo */ }
    if (!r.ok) { const e = new Error((j && j.error) || ('Erro ' + r.status)); e.status = r.status; throw e; }
    return j;
  }

  /* ----------- base em memória (usada também pelo Relatório Geral) ----------- */
  const cache = { base: null, config: null };
  async function carregarBase() {
    const d = await api('/api/indicador-i09');
    cache.base = d.base; cache.config = d.config; return d;
  }
  function instalarGancho() { // acrescenta as abas do indicador ao Relatório Geral, sem mexer no código dele
    const X = root.XLSX; if (!X || !X.writeFile || X.__i09) return;
    const original = X.writeFile;
    X.writeFile = function (wb, nome) {
      const args = arguments, nomesI09 = [], estilosI09 = {};
      try {
        if (/^SC9_Relatorio_Geral_/.test(String(nome)) && cache.base) {
          for (const a of M.abasRelatorio(cache.base, cache.config)) {
            if (!a.rows.length) continue;
            nomesI09.push(a.name.slice(0, 31)); if (a.estilo) estilosI09[a.name.slice(0, 31)] = a.estilo;
            const ws = X.utils.json_to_sheet(a.rows);
            // formata cada célula (porcentagem, valor com milhar, texto) e ajusta a largura das colunas
            const cab = Object.keys(a.rows[0] || {});
            a.rows.forEach((r, i) => cab.forEach((h, j) => { const c = ws[X.utils.encode_cell({ r: i + 1, c: j })]; const z = a.z && c && typeof c.v === 'number' ? a.z(r, h) : null; if (z) c.z = z; }));
            if (a.cols) ws['!cols'] = a.cols.map((w) => ({ wch: w }));
            X.utils.book_append_sheet(wb, ws, a.name.slice(0, 31));
          }
        }
      } catch (e) { if (root.console) root.console.warn('Indicador I 09: abas não acrescentadas ao relatório', e); }
      // abas do I 09 em paisagem (horizontal) e ajustadas à largura da página; se algo falhar, baixa o arquivo normal
      if (nomesI09.length && /\.xlsx$/i.test(String(nome)) && typeof M.paisagemXlsx === 'function' && typeof root.CompressionStream === 'function' && typeof root.DecompressionStream === 'function' && root.document) {
        try {
          const bytes = X.write(wb, Object.assign({}, args[2] || {}, { type: 'array', bookType: 'xlsx' }));
          const self = this;
          M.paisagemXlsx(new Uint8Array(bytes), nomesI09, { estilos: estilosI09 }).then((out) => {
            const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
            const a = root.document.createElement('a'); a.href = url; a.download = String(nome); root.document.body.appendChild(a); a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
          }, () => original.apply(self, args));
          return;
        } catch (e) { /* segue para o download normal abaixo */ }
      }
      return original.apply(this, arguments);
    };
    X.__i09 = true;
  }
  instalarGancho();

  /* ------------------------------ gráficos (SVG) ------------------------------ */
  const escala = (max) => { if (!(max > 0)) return { max: 1, t: [0, 1] }; const p = Math.pow(10, Math.floor(Math.log10(max))), n = max / p; const m = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; return { max: m, t: [0, m / 4, m / 2, m * 3 / 4, m] }; };
  const W = 560, H = 210, L = 50, Rr = 12, T = 10, B = 24;
  const eixoX = (diario, X) => diario.map((x, i) => (i % 5 === 0 || i === diario.length - 1) && h('text', { key: 'x' + i, x: X(i), y: H - 7, fontSize: 10, textAnchor: 'middle', fill: GREY }, +x.data.slice(8)));
  function PecasPorDia({ c }) {
    const d = c.om.diario, ate = c.ate;
    const mx = escala(Math.max(...d.map((x, i) => Math.max(x.q, c.os.diario[i].q)), c.om.metaDia, c.os.metaDia, 1));
    const bw = (W - L - Rr) / Math.max(d.length, 1), Y = (v) => T + (H - T - B) * (1 - v / mx.max), X = (i) => L + i * bw + bw / 2;
    const barras = (k, off, cor) => c[k].diario.map((x, i) => x.data <= ate && x.q > 0 && h('rect', { key: k + x.data, x: L + i * bw + off, y: Y(x.q), width: Math.max(bw / 2 - 1.5, 1), height: Math.max(Y(0) - Y(x.q), 0), fill: cor, rx: 1.5 }, h('title', null, M.NOMES[k] + ' ' + fmtD(x.data) + ': ' + fmtN(x.q) + ' peças, ' + x.n + ' OPs')));
    return h('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Peças apontadas por dia, OM e OS' },
      mx.t.map((t) => h('g', { key: t }, h('line', { x1: L, x2: W - Rr, y1: Y(t), y2: Y(t), stroke: '#E5E9F3' }), h('text', { x: L - 6, y: Y(t) + 4, fontSize: 10, textAnchor: 'end', fill: GREY }, fmtN(t)))),
      d.map((x, i) => !x.util && h('rect', { key: 'w' + i, x: L + i * bw, y: T, width: bw, height: H - T - B, fill: '#F1F3F9' })),
      eixoX(d, X), barras('om', 1, NAVY), barras('os', bw / 2 + 0.5, AMBER),
      c.om.metaDia > 0 && h('line', { x1: L, x2: W - Rr, y1: Y(c.om.metaDia), y2: Y(c.om.metaDia), stroke: NAVY, strokeDasharray: '4 4', strokeWidth: 1, opacity: 0.6 }),
      c.os.metaDia > 0 && h('line', { x1: L, x2: W - Rr, y1: Y(c.os.metaDia), y2: Y(c.os.metaDia), stroke: '#B67410', strokeDasharray: '4 4', strokeWidth: 1, opacity: 0.7 }));
  }
  function PctAcumulado({ c }) {
    const d = c.om.diario;
    const vals = [...c.om.diario, ...c.os.diario].map((x) => x.pctAcc || 0);
    const top = Math.max(1.2, Math.min(Math.max(...vals) * 1.05, 2.5)), Y = (v) => T + (H - T - B) * (1 - Math.min(v, top) / top);
    const X = (i) => L + (W - L - Rr) * i / Math.max(d.length - 1, 1);
    const path = (k) => { let s = '', pen = false; c[k].diario.forEach((x, i) => { if (x.pctAcc == null) { pen = false; return; } s += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(x.pctAcc).toFixed(1); pen = true; }); return s; };
    const ticks = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5].filter((t) => t <= top);
    const ultimo = (k) => { const a = c[k].diario.filter((x) => x.pctAcc != null); return a.length ? a[a.length - 1] : null; };
    return h('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Percentual da meta acumulada, OM e OS' },
      ticks.map((t) => h('g', { key: t }, h('line', { x1: L, x2: W - Rr, y1: Y(t), y2: Y(t), stroke: t === 1 ? '#1B2138' : '#E5E9F3', strokeDasharray: t === 1 ? '4 3' : undefined, opacity: t === 1 ? 0.5 : 1 }), h('text', { x: L - 6, y: Y(t) + 4, fontSize: 10, textAnchor: 'end', fill: GREY }, Math.round(t * 100) + '%'))),
      h('line', { x1: L, x2: W - Rr, y1: Y(M.BSC), y2: Y(M.BSC), stroke: GREY, strokeDasharray: '2 3', strokeWidth: 1 }),
      eixoX(d, X),
      h('path', { d: path('om'), fill: 'none', stroke: NAVY, strokeWidth: 2.4, strokeLinejoin: 'round' }),
      h('path', { d: path('os'), fill: 'none', stroke: AMBER, strokeWidth: 2.4, strokeLinejoin: 'round' }),
      ['om', 'os'].map((k) => { const u = ultimo(k); if (!u) return null; const i = c[k].diario.indexOf(u); const o = ultimo(k === 'om' ? 'os' : 'om'); const baixo = k === 'om' && o && Math.abs(Y(o.pctAcc) - Y(u.pctAcc)) < 13 && Y(u.pctAcc) >= Y(o.pctAcc); return h('text', { key: k, x: Math.min(X(i) + 4, W - 24), y: Y(u.pctAcc) + (baixo ? 13 : -5), fontSize: 10.5, fontWeight: 650, fill: k === 'om' ? NAVY : '#B67410', textAnchor: i > d.length - 4 ? 'end' : 'start' }, M.NOMES[k] + ' ' + Math.round(u.pctAcc * 100) + '%'); }));
  }
  const Leg = () => h('div', { className: 'sc9-i09-leg' }, h('span', null, h('i', { style: { background: NAVY } }), 'OM (separa)'), h('span', null, h('i', { style: { background: AMBER } }), 'OS (estoca)'));

  /* ------------------------------ resultado ------------------------------ */
  function Indicador({ x, c }) {
    const k = x.k, tone = x.pct == null ? '' : x.pct >= 1 ? 'ok' : x.pct >= M.BSC ? 'warn' : 'bad';
    const pos = x.meta ? Math.min(c.uteisDecorridos / c.diasUteis, 1) * 100 : 0;
    return h('div', { className: 'sc9-i09-card sc9-i09-ind', style: { '--c': COR[k] } },
      h('header', null, h('b', null, M.NOMES[k]), h('span', null, M.DESCR[k])),
      h('div', { className: 'sc9-i09-kp' },
        h('div', { className: tone }, h('span', null, '% da meta'), h('strong', null, fmtP(x.pct)), h('em', null, x.situacao)),
        h('div', null, h('span', null, 'Real (peças)'), h('strong', null, fmtN(x.real)), h('em', null, 'meta ' + (x.meta ? fmtN(x.meta) : '—'))),
        h('div', { className: x.saldo == null ? '' : x.saldo >= 0 ? 'ok' : 'bad' }, h('span', null, 'Saldo'), h('strong', null, x.saldo == null ? '—' : (x.saldo > 0 ? '+' : '') + fmtN(x.saldo)), h('em', null, 'por dia útil ' + fmtN(x.metaDia))),
        h('div', { className: x.perdaPct > 0.1 ? 'warn' : '' }, h('span', null, 'Perda'), h('strong', null, fmtP(x.perdaPct)), h('em', null, fmtN(x.perda) + ' de ' + fmtN(x.enviado) + ' enviadas'))),
      x.meta > 0 && h('div', { className: 'sc9-i09-prog', title: 'Realizado contra a meta; a marca preta é onde o mês está no calendário de dias úteis' }, h('i', { style: { width: Math.min(x.pct * 100, 100) + '%' } }), c.parcial && h('u', { style: { left: pos + '%' } })),
      h('div', { className: 'sc9-i09-line' }, fmtN(x.ops) + ' OPs · ' + fmtN(x.pecasPorOp) + ' peças por OP · média ' + fmtN(x.mediaPorDiaUtil) + ' por dia com apontamento · maior dia ' + fmtN(x.maiorDia) + (x.pctRitmo != null ? ' · ' + fmtP(x.pctRitmo, 0) + ' da meta acumulada até hoje' : '')),
      h('div', { className: 'sc9-i09-line', style: { marginTop: 3, color: '#8A92B2' } }, M.REGRA[k]));
  }
  function Resultado({ calc, chaves, mes, setMes, aoAtualizar }) {
    const c = calc[mes];
    if (!c) return h('div', { className: 'sc9-i09-card' }, h('p', { className: 'sc9-i09-sub' }, 'Ainda não há meses na base. Em "Atualizar base", envie a SC2 (ou importe a carga inicial).'), aoAtualizar && h('button', { className: 'sc9-i09-btn pri', onClick: aoAtualizar }, 'Ir para Atualizar base'));
    const maxT = Math.max(1, ...c.porTipo.map((t) => Math.max(t.om.q, t.os.q)));
    const pc = (e, p) => (e ? p / e : 0);
    const linhas = [
      ['Meta do mês (peças)', c.om.meta || null, c.os.meta || null, c.total.meta || null, fmtN],
      ['Real (peças)', c.om.real, c.os.real, c.total.real, fmtN],
      ['% da meta', c.om.pct, c.os.pct, c.total.pct, (v) => fmtP(v)],
      ['Saldo contra a meta', c.om.saldo, c.os.saldo, c.om.saldo != null && c.os.saldo != null ? c.om.saldo + c.os.saldo : null, (v) => v == null ? '—' : (v > 0 ? '+' : '') + fmtN(v)],
      ['OPs apontadas', c.om.ops, c.os.ops, c.total.ops, fmtN],
      ['Peças por OP', c.om.pecasPorOp, c.os.pecasPorOp, c.total.ops ? c.total.real / c.total.ops : 0, fmtN],
      ['Enviado (quantidade das OPs)', c.om.enviado, c.os.enviado, c.total.enviado, fmtN],
      ['Perda (peças)', c.om.perda, c.os.perda, c.total.perda, fmtN],
      ['% de perda', c.om.perdaPct, c.os.perdaPct, c.total.perdaPct, (v) => fmtP(v, 2)],
    ];
    const dias = c.om.diario.filter((d) => d.data <= c.ate);
    return h(R.Fragment, null,
      h('div', { className: 'sc9-i09-row', style: { marginBottom: 12 } },
        h('label', null, 'Mês: ', h('select', { className: 'sc9-i09-sel', value: mes, onChange: (e) => setMes(e.target.value) }, chaves.map((m) => h('option', { key: m, value: m }, calc[m].nome + (calc[m].parcial ? ' (parcial)' : ''))))),
        h('span', { className: 'sc9-i09-sub', style: { margin: 0 } }, 'Tudo pelo dia do Real Fim, em peças (Qtd.Produzid). BSC: ' + fmtP(M.BSC, 0) + ' da meta. Extração de ' + fmtD(c.extracao || c.ate) + '.')),
      c.parcial && h('div', { className: 'sc9-i09-note' }, h('b', null, 'Mês parcial. '), c.uteisDecorridos + ' de ' + c.diasUteis + ' dias úteis até ' + fmtD(c.ate) + '. O % da meta do mês só vale quando o mês fechar; o apontamento sai em lotes, então não projete o fim do mês pela média diária.'),
      (!c.om.meta || !c.os.meta) && h('div', { className: 'sc9-i09-note' }, 'Sem meta lançada para ' + [!c.om.meta && 'OM', !c.os.meta && 'OS'].filter(Boolean).join(' e ') + ' em ' + c.nome + '. Lance em "Configuração" para ver % da meta e saldo.'),
      h('div', { className: 'sc9-i09-two' }, h(Indicador, { x: c.om, c }), h(Indicador, { x: c.os, c })),
      h('div', { className: 'sc9-i09-two' },
        h('div', { className: 'sc9-i09-card' }, h('h2', null, 'Peças apontadas por dia'), h(Leg), h(PecasPorDia, { c }), h('p', { className: 'sc9-i09-sub', style: { margin: '2px 0 0' } }, 'Tracejado = meta por dia útil. Fundo cinza = fim de semana ou feriado.')),
        h('div', { className: 'sc9-i09-card' }, h('h2', null, '% da meta acumulada'), h(Leg), h(PctAcumulado, { c }), h('p', { className: 'sc9-i09-sub', style: { margin: '2px 0 0' } }, 'Linha escura = 100%; pontilhada = ' + fmtP(M.BSC, 0) + ' (BSC). Acima = adiantado.'))),
      h('div', { className: 'sc9-i09-two' },
        h('div', { className: 'sc9-i09-card' }, h('h2', null, 'Comparativo OM x OS'),
          h('table', { className: 'sc9-i09-table' }, h('thead', null, h('tr', null, ['', 'OM', 'OS', 'OM + OS'].map((t, i) => h('th', { key: i, className: i ? 'r' : '' }, t)))),
            h('tbody', null, linhas.map(([rot, a, b, t, f]) => h('tr', { key: rot }, h('td', null, rot), h('td', { className: 'r' }, a == null ? '—' : f(a)), h('td', { className: 'r' }, b == null ? '—' : f(b)), h('td', { className: 'r' }, t == null ? '—' : f(t))))))),
        h('div', { className: 'sc9-i09-card' }, h('h2', null, 'Por tipo (Type Korea)'),
          h('table', { className: 'sc9-i09-table' }, h('thead', null, h('tr', null, ['Tipo', 'OM', '% perda', 'OS', '% perda'].map((t, i) => h('th', { key: t + i, className: i ? 'r' : '' }, t)))),
            h('tbody', null, c.porTipo.map((t) => h('tr', { key: t.tipo }, h('td', null, t.tipo),
              h('td', { className: 'r' }, h('span', { className: 'sc9-i09-tb', style: { width: Math.round(t.om.q / maxT * 50), background: NAVY } }), fmtN(t.om.q)), h('td', { className: 'r' }, t.om.env ? fmtP(pc(t.om.env, t.om.perda), 1) : '—'),
              h('td', { className: 'r' }, h('span', { className: 'sc9-i09-tb', style: { width: Math.round(t.os.q / maxT * 50), background: AMBER } }), fmtN(t.os.q)), h('td', { className: 'r' }, t.os.env ? fmtP(pc(t.os.env, t.os.perda), 1) : '—')))),
            h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', { className: 'r' }, fmtN(c.om.real)), h('td', { className: 'r' }, fmtP(c.om.perdaPct, 1)), h('td', { className: 'r' }, fmtN(c.os.real)), h('td', { className: 'r' }, fmtP(c.os.perdaPct, 1))))),
          h('p', { className: 'sc9-i09-sub', style: { margin: '8px 0 0' } }, '% de perda = perda ÷ quantidade enviada nas OPs. "(sem tipo)" = produto que não está na lista de tipos (Configuração).'))),
      h('details', { className: 'sc9-i09-det', open: true }, h('summary', null, 'Dia a dia'),
        h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'sc9-i09-table' },
          h('thead', null, h('tr', null, ['Data', 'OM peças', 'OM acum.', 'OM % meta', 'OM perda', 'OS peças', 'OS acum.', 'OS % meta', 'OS perda'].map((t, i) => h('th', { key: t, className: i ? 'r' : '' }, t)))),
          h('tbody', null, dias.map((d, i) => { const e = c.os.diario[i]; return h('tr', { key: d.data, className: d.util ? '' : 'dim' }, h('td', null, fmtD(d.data).slice(0, 5) + ' ' + ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(d.data + 'T12:00:00Z').getUTCDay()]),
            h('td', { className: 'r om' }, d.q ? fmtN(d.q) : '—'), h('td', { className: 'r' }, fmtN(d.acc)), h('td', { className: 'r' }, fmtP(d.pctAcc, 0)), h('td', { className: 'r' }, d.perda ? fmtN(d.perda) : '—'),
            h('td', { className: 'r os' }, e.q ? fmtN(e.q) : '—'), h('td', { className: 'r' }, fmtN(e.acc)), h('td', { className: 'r' }, fmtP(e.pctAcc, 0)), h('td', { className: 'r' }, e.perda ? fmtN(e.perda) : '—')); })),
          h('tfoot', null, h('tr', null, h('td', null, 'Mês'), h('td', { className: 'r' }, fmtN(c.om.real)), h('td', null), h('td', { className: 'r' }, fmtP(c.om.pct, 0)), h('td', { className: 'r' }, fmtN(c.om.perda)), h('td', { className: 'r' }, fmtN(c.os.real)), h('td', null), h('td', { className: 'r' }, fmtP(c.os.pct, 0)), h('td', { className: 'r' }, fmtN(c.os.perda))))))),
      chaves.length > 1 && h('details', { className: 'sc9-i09-det' }, h('summary', null, 'Mês a mês'),
        h('table', { className: 'sc9-i09-table' }, h('thead', null, h('tr', null, ['Mês', 'OM real', 'OM % meta', 'OM % perda', 'OS real', 'OS % meta', 'OS % perda'].map((t, i) => h('th', { key: t, className: i ? 'r' : '' }, t)))),
          h('tbody', null, chaves.map((m) => { const x = calc[m]; return h('tr', { key: m }, h('td', null, x.nome + (x.parcial ? ' (até ' + fmtD(x.ate).slice(0, 5) + ')' : '')),
            h('td', { className: 'r' }, fmtN(x.om.real)), h('td', { className: 'r' }, x.parcial ? '—' : fmtP(x.om.pct)), h('td', { className: 'r' }, fmtP(x.om.perdaPct)),
            h('td', { className: 'r' }, fmtN(x.os.real)), h('td', { className: 'r' }, x.parcial ? '—' : fmtP(x.os.pct)), h('td', { className: 'r' }, fmtP(x.os.perdaPct))); })))));
  }

  /* ------------------------------ upload da SC2 (usado na tela inicial e na aba Atualizar) ------------------------------ */
  function lerArquivo(file) {
    return new Promise((ok, no) => {
      const fr = new FileReader();
      fr.onerror = () => no(new Error('não consegui ler o arquivo'));
      fr.onload = () => { try { ok(root.XLSX.read(fr.result, { type: 'array' })); } catch (e) { no(new Error('arquivo inválido: ' + e.message)); } };
      fr.readAsArrayBuffer(file);
    });
  }
  const matriz = (wb, nome) => root.XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' });
  function baixar(nome, conteudo, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo })); const a = root.document.createElement('a'); a.href = url; a.download = nome; root.document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function UploadSC2({ base, config, onSalvo, onAbrir, inicio }) {
    const [st, setSt] = useState({ fase: 'vazio' }); const [ate, setAte] = useState(hoje()); const [sel, setSel] = useState({}); const [msg, setMsg] = useState(null); const [ocupado, setOcupado] = useState(false); const [sobre, setSobre] = useState(false);
    const inp = useRef(null);
    const ler = async (f) => {
      if (!f) return; setMsg(null); setSt({ fase: 'lendo', arquivo: f.name });
      try {
        const wb = await lerArquivo(f); let r = null;
        const ordem = [...wb.SheetNames.filter((n) => n.toUpperCase() === 'SC2'), ...wb.SheetNames.filter((n) => n.toUpperCase() !== 'SC2')];
        for (const n of ordem.slice(0, 6)) { const x = M.lerSC2(matriz(wb, n)); if (!x.erro) { r = x; break; } if (!r) r = x; }
        if (!r || r.erro) throw new Error((r && r.erro) || 'SC2 não encontrada');
        if (!r.rows.length) throw new Error('A SC2 não tem nenhuma OP de OM ou OS com DT Real Fim. Confira se a extração é a da data fim do mês.');
        const meses = M.porMes(r.rows), sug = {};
        for (const m of Object.keys(meses)) { const salvo = base.meses[m]; sug[m] = !salvo || meses[m].length >= salvo.rows.length; }
        setSel(sug); setSt({ fase: 'pronto', arquivo: f.name, resumo: r.resumo, meses });
        // se nenhum mês ficaria com menos linhas do que já está guardado, grava na hora (sem precisar clicar em "Gravar")
        if (Object.keys(meses).length && Object.keys(meses).every((m) => sug[m])) await gravar(meses, sug, f.name);
      } catch (e) { setSt({ fase: 'erro', erro: e.message }); }
    };
    const gravar = async (mesesArg, selArg, arquivoArg) => {
      const dados = mesesArg && typeof mesesArg === 'object' && !mesesArg.nativeEvent && !mesesArg.target ? mesesArg : st.meses, marcados = selArg || sel, nomeArq = arquivoArg || st.arquivo;
      const escolhidos = Object.keys(dados).filter((m) => marcados[m]); if (!escolhidos.length) return;
      setOcupado(true); setMsg(null);
      try {
        for (const m of escolhidos.sort()) await api('/api/indicador-i09', { acao: 'mes', mes: m, rows: dados[m], arquivo: nomeArq, ate });
        const d = await onSalvo();
        const res = M.calcularBase(d.base, d.config);
        setMsg({ ok: true, t: 'Gravado. ' + escolhidos.map((m) => { const c = res[m]; return M.nomeMes(m) + ': OM ' + fmtN(c.om.real) + ' (' + fmtP(c.om.pct) + ') · OS ' + fmtN(c.os.real) + ' (' + fmtP(c.os.pct) + ')'; }).join(' | ') + '. Os outros meses ficaram como estavam.' });
        setSt({ fase: 'vazio' });
      } catch (e) { setMsg({ ok: false, t: e.message }); }
      setOcupado(false);
    };
    const nm = (m) => M.nomeMes(m), q = (rows) => rows.reduce((s, o) => s + o[8], 0);
    const corpo = h(R.Fragment, null,
      st.fase === 'lendo' && h('p', { className: 'sc9-i09-sub' }, 'Lendo ' + st.arquivo + '…'),
      st.fase === 'erro' && h('div', { className: 'sc9-i09-err' }, st.erro),
      st.fase === 'pronto' && h('div', { onClick: (e) => e.stopPropagation() },
        h('p', { className: 'sc9-i09-sub', style: { marginTop: 10 } }, st.arquivo + ': ' + fmtN(st.resumo.linhas) + ' linhas na SC2, ' + fmtN(st.resumo.apontadas) + ' de OM/OS com Real Fim' + (st.resumo.semRealFim ? ' (' + st.resumo.semRealFim + ' ainda sem Real Fim, ignoradas)' : '') + '. Mod. OP lidas: ' + Object.keys(st.resumo.modos).map((k) => k + ' ' + st.resumo.modos[k]).join(' · ') + '.'),
        h('table', { className: 'sc9-i09-table' }, h('thead', null, h('tr', null, ['Gravar', 'Mês', 'No arquivo', 'Na base'].map((t) => h('th', { key: t }, t)))),
          h('tbody', null, Object.keys(st.meses).sort().map((m) => { const novo = st.meses[m], salvo = base.meses[m], menor = salvo && novo.length < salvo.rows.length;
            return h('tr', { key: m }, h('td', null, h('input', { type: 'checkbox', checked: !!sel[m], onChange: (e) => setSel(Object.assign({}, sel, { [m]: e.target.checked })) })), h('td', null, nm(m)),
              h('td', null, fmtN(novo.length) + ' linhas · ' + fmtN(q(novo)) + ' peças'), h('td', null, salvo ? fmtN(salvo.rows.length) + ' linhas · ' + fmtN(q(salvo.rows)) + ' peças (' + fmtDH(salvo.savedAt) + ')' : 'ainda não existe', menor && h('div', { style: { color: WARN, fontSize: 11.5 } }, 'O arquivo tem menos linhas que a base. Só marque se for isso mesmo.'))); }))),
        h('div', { className: 'sc9-i09-row', style: { marginTop: 10 } },
          h('label', null, 'Data da extração: ', h('input', { type: 'date', className: 'sc9-i09-inp', value: ate, onChange: (e) => setAte(e.target.value) })),
          h('button', { className: 'sc9-i09-btn pri', disabled: ocupado || !Object.keys(st.meses).some((m) => sel[m]), onClick: () => gravar() }, ocupado ? 'Gravando…' : 'Gravar meses marcados'),
          h('button', { className: 'sc9-i09-btn', disabled: ocupado, onClick: () => setSt({ fase: 'vazio' }) }, 'Cancelar'))),
      msg && h('div', { className: msg.ok ? 'sc9-i09-ok' : 'sc9-i09-err', onClick: (e) => e.stopPropagation() }, msg.t, msg.ok && onAbrir && h('div', { style: { marginTop: 6 } }, h('button', { className: 'sc9-i09-btn sm', onClick: onAbrir }, 'Abrir o dashboard'))));
    return h('div', null,
      h('input', { ref: inp, type: 'file', accept: '.xlsx,.xlsm,.xls', style: { display: 'none' }, disabled: ocupado, onChange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; ler(f); } }),
      h('div', { className: 'sc9-i09-drop' + (sobre ? ' over' : ''), onClick: () => inp.current && inp.current.click(),
        onDragOver: (e) => { e.preventDefault(); setSobre(true); }, onDragLeave: () => setSobre(false), onDrop: (e) => { e.preventDefault(); setSobre(false); ler(e.dataTransfer.files && e.dataTransfer.files[0]); } },
        h('div', { className: 't' }, 'SC2 do mês (Indicador I 09: OM e OS)'),
        h('div', { className: 's' }, inicio ? 'Extração da SC2 do Protheus, só as OPs com DT Real Fim no mês, até a data fim. Clique ou arraste. Os outros meses guardados não mudam.' : 'Extração da SC2 do Protheus (cabeçalho na linha 3). A leitura é feita aqui no navegador; só as linhas de OM e OS com Real Fim são guardadas. Clique ou arraste o arquivo.'),
        corpo));
  }

  /* ------------------------------ atualizar base ------------------------------ */
  function Atualizar({ base, config, onSalvo }) {
    const [msg, setMsg] = useState(null); const [ocupado, setOcupado] = useState(false);
    const exportar = () => baixar('indicador-i09-base-' + hoje() + '.json', JSON.stringify({ base, config }), 'application/json');
    const importar = async (ev) => {
      const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (!f) return;
      if (!root.confirm('Importar este arquivo SUBSTITUI todos os meses e a configuração guardados. Continuar?')) return;
      setOcupado(true); setMsg(null);
      try { const j = JSON.parse(await f.text()); await api('/api/indicador-i09', { acao: 'importar', base: j.base, config: j.config }); await onSalvo(); setMsg({ ok: true, t: 'Base importada.' }); } catch (e) { setMsg({ ok: false, t: e.message }); }
      setOcupado(false);
    };
    const apagar = async (m) => {
      if (!root.confirm('Apagar ' + M.nomeMes(m) + ' da base? Dá para subir a SC2 de novo depois.')) return;
      setOcupado(true); setMsg(null);
      try { await api('/api/indicador-i09', { acao: 'apagar', mes: m }); await onSalvo(); setMsg({ ok: true, t: M.nomeMes(m) + ' apagado.' }); } catch (e) { setMsg({ ok: false, t: e.message }); }
      setOcupado(false);
    };
    const vazio = !Object.keys(base.meses).length;
    return h('div', { className: 'sc9-i09-grid' },
      h('div', { className: 'sc9-i09-card' }, h('h2', null, 'Subir a SC2'), h(UploadSC2, { base, config, onSalvo }),
        h('p', { className: 'sc9-i09-sub', style: { marginTop: 10 } }, 'A SC2 também pode ser enviada na tela inicial, junto com as outras bases. Todo dia: suba a SC2 do mês até a data fim e grave. Os outros meses não mudam.')),
      h('div', { className: 'sc9-i09-card' },
        h('h2', null, 'O que está guardado'),
        vazio ? h('div', { className: 'sc9-i09-note' }, 'Nada guardado ainda. Para a primeira vez, importe a carga inicial (arquivo .json com Setembro, Outubro, Novembro, metas, tipos e a lista Não considera) no botão abaixo.')
          : h('table', { className: 'sc9-i09-table' }, h('thead', null, h('tr', null, ['Mês', 'Linhas', 'Extração', 'Gravado em', 'Arquivo', ''].map((t) => h('th', { key: t }, t)))),
            h('tbody', null, Object.keys(base.meses).sort().map((m) => { const b = base.meses[m]; return h('tr', { key: m }, h('td', null, M.nomeMes(m)), h('td', null, fmtN(b.rows.length)), h('td', null, b.ate ? fmtD(b.ate) : '—'), h('td', null, fmtDH(b.savedAt)), h('td', null, b.arquivo || '—'), h('td', null, h('button', { className: 'sc9-i09-btn sm', disabled: ocupado, onClick: () => apagar(m) }, 'Apagar'))); }))),
        h('h2', { style: { marginTop: 16 } }, 'Cópia de segurança e carga inicial'),
        h('p', { className: 'sc9-i09-sub' }, 'Baixe a base inteira (meses e configuração) ou restaure uma cópia. Importar substitui tudo.'),
        h('div', { className: 'sc9-i09-row' }, h('button', { className: 'sc9-i09-btn', onClick: exportar, disabled: vazio }, 'Baixar base (.json)'),
          h('label', { className: 'sc9-i09-btn' }, 'Importar base (.json) ', h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onChange: importar, disabled: ocupado }))),
        msg && h('div', { className: msg.ok ? 'sc9-i09-ok' : 'sc9-i09-err' }, msg.t)));
  }

  /* ------------------------------ configuração ------------------------------ */
  function Configuracao({ base, config, onSalvo }) {
    const meses = useMemo(() => { const s = new Set([...Object.keys(base.meses), ...Object.keys((config.metas || {}).om || {}), ...Object.keys((config.metas || {}).os || {})]); return [...s].sort(); }, [base, config]);
    const [metas, setMetas] = useState({ om: {}, os: {} }); const [novoMes, setNovoMes] = useState(''); const [fer, setFer] = useState((config.feriados && config.feriados.length ? config.feriados : FERIADOS_2026).map(fmtD).join('\n'));
    const [nao, setNao] = useState((config.naoConsidera || []).join('\n'));
    const [msg, setMsg] = useState(null); const [ocupado, setOcupado] = useState(false);
    useEffect(() => { const m = { om: {}, os: {} }; meses.forEach((k) => { for (const t of ['om', 'os']) m[t][k] = ((config.metas || {})[t] || {})[k] != null ? String(config.metas[t][k]) : ''; }); setMetas(m); }, [config, meses]);
    useEffect(() => { setNao((config.naoConsidera || []).join('\n')); }, [config]);
    const salvar = async (cfg, texto, extra) => { setOcupado(true); setMsg(null); try { await api('/api/indicador-i09', Object.assign({ acao: 'config', config: cfg }, extra || {})); await onSalvo(); setMsg({ ok: true, t: texto }); } catch (e) { setMsg({ ok: false, t: e.message }); } setOcupado(false); };
    const salvarMetas = () => { const o = { om: {}, os: {} }; for (const t of ['om', 'os']) Object.keys(metas[t] || {}).forEach((k) => { o[t][k] = Number(String(metas[t][k]).replace(/\./g, '').replace(',', '.')) || 0; }); salvar({ metas: o }, 'Metas gravadas.'); };
    const salvarFeriados = () => {
      const lista = fer.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map(M.toISO);
      if (lista.some((d) => !d)) { setMsg({ ok: false, t: 'Há uma data inválida. Use dd/mm/aaaa, uma por linha.' }); return; }
      salvar({ feriados: lista }, 'Feriados gravados (' + lista.length + ').');
    };
    const salvarNao = () => { const l = [...new Set(nao.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean))]; salvar({ naoConsidera: l }, 'Lista Não considera gravada (' + l.length + ' produtos).'); };
    const subirListas = async (ev) => {
      const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (!f) return; setOcupado(true); setMsg(null);
      try {
        const wb = await lerArquivo(f); const out = {}; const partes = [];
        const nTipo = wb.SheetNames.find((n) => /type\s*korea/i.test(n)), nNao = wb.SheetNames.find((n) => /n[aã]o\s*considera/i.test(n));
        if (!nTipo && !nNao) throw new Error('não achei as abas "Type Korea" nem "Não considera" neste arquivo');
        if (nTipo) { const r = M.lerTipos(matriz(wb, nTipo)); if (r.erro) throw new Error(r.erro); out.tipos = r.tipos; partes.push(r.total + ' produtos com tipo'); }
        if (nNao) { const r = M.lerNaoConsidera(matriz(wb, nNao)); if (r.erro) throw new Error(r.erro); out.naoConsidera = r.codigos; partes.push(r.total + ' produtos em Não considera'); }
        await api('/api/indicador-i09', { acao: 'config', config: out, substituirTipos: true }); await onSalvo(); setMsg({ ok: true, t: 'Gravado: ' + partes.join(', ') + '.' });
      } catch (e) { setMsg({ ok: false, t: e.message }); }
      setOcupado(false);
    };
    const setMeta = (t, m, v) => setMetas(Object.assign({}, metas, { [t]: Object.assign({}, metas[t], { [m]: v }) }));
    return h('div', { className: 'sc9-i09-grid' },
      h('div', { className: 'sc9-i09-card' }, h('h2', null, 'Meta de peças por mês'), h('p', { className: 'sc9-i09-sub' }, 'Meta do BSC em peças, uma para o OM e outra para a OS. Sem meta, o mês aparece sem % da meta.'),
        h('table', { className: 'sc9-i09-table' }, h('thead', null, h('tr', null, ['Mês', 'OM', 'OS'].map((t, i) => h('th', { key: t, className: i ? 'r' : '' }, t)))),
          h('tbody', null, meses.map((m) => h('tr', { key: m }, h('td', null, M.nomeMes(m)), ['om', 'os'].map((t) => h('td', { key: t, className: 'r' }, h('input', { className: 'sc9-i09-inp', style: { width: 110, textAlign: 'right' }, value: (metas[t] || {})[m] == null ? '' : metas[t][m], onChange: (e) => setMeta(t, m, e.target.value) }))))))),
        h('div', { className: 'sc9-i09-row', style: { marginTop: 10 } }, h('input', { type: 'month', className: 'sc9-i09-inp', value: novoMes, onChange: (e) => setNovoMes(e.target.value) }),
          h('button', { className: 'sc9-i09-btn', disabled: !novoMes || meses.includes(novoMes), onClick: () => { setMetas({ om: Object.assign({}, metas.om, { [novoMes]: '' }), os: Object.assign({}, metas.os, { [novoMes]: '' }) }); setNovoMes(''); } }, 'Adicionar mês'), h('button', { className: 'sc9-i09-btn pri', onClick: salvarMetas, disabled: ocupado }, 'Gravar metas'))),
      h('div', { className: 'sc9-i09-card' }, h('h2', null, 'Feriados (fora dos dias úteis)'), h('p', { className: 'sc9-i09-sub' }, 'Uma data por linha, dd/mm/aaaa. Usados na meta por dia útil e na meta acumulada.'),
        h('textarea', { className: 'sc9-i09-inp', rows: 9, style: { width: '100%' }, value: fer, onChange: (e) => setFer(e.target.value) }),
        h('div', { className: 'sc9-i09-row', style: { marginTop: 10 } }, h('button', { className: 'sc9-i09-btn pri', onClick: salvarFeriados, disabled: ocupado }, 'Gravar feriados'))),
      h('div', { className: 'sc9-i09-card' }, h('h2', null, 'Tipo dos produtos e "Não considera"'), h('p', { className: 'sc9-i09-sub' }, 'Hoje: ' + Object.keys(config.tipos || {}).length + ' produtos com tipo (Type Korea) e ' + (config.naoConsidera || []).length + ' em Não considera. Só precisa refazer quando entrar produto novo: envie a planilha de controle (abas "Type Korea" e "Não considera") ou edite a lista ao lado.'),
        h('input', { type: 'file', accept: '.xlsx,.xlsm,.xls', onChange: subirListas, disabled: ocupado })),
      h('div', { className: 'sc9-i09-card' }, h('h2', null, 'Não considera (produtos que a OS ignora)'), h('p', { className: 'sc9-i09-sub' }, 'Um código por linha. A OS só conta produtos usinados, ou seja, fora desta lista.'),
        h('textarea', { className: 'sc9-i09-inp', rows: 8, style: { width: '100%', fontFamily: 'monospace' }, value: nao, onChange: (e) => setNao(e.target.value) }),
        h('div', { className: 'sc9-i09-row', style: { marginTop: 10 } }, h('button', { className: 'sc9-i09-btn pri', onClick: salvarNao, disabled: ocupado }, 'Gravar lista'))),
      msg && h('div', { className: msg.ok ? 'sc9-i09-ok' : 'sc9-i09-err', style: { gridColumn: '1 / -1' } }, msg.t));
  }

  /* ------------------------------ painel, campo da tela inicial e lançador ------------------------------ */
  function Painel({ sessao, onFechar, abaInicial }) {
    const admin = sessao.role === 'admin';
    const [dados, setDados] = useState(null); const [erro, setErro] = useState(''); const [aba, setAba] = useState(abaInicial || 'resultado'); const [mes, setMes] = useState('');
    const carregar = useCallback(async () => { try { const d = await carregarBase(); setDados({ base: d.base, config: d.config }); setErro(''); return d; } catch (e) { setErro(e.message); } }, []);
    useEffect(() => { carregar(); }, [carregar]);
    const calc = useMemo(() => dados ? M.calcularBase(dados.base, dados.config) : {}, [dados]);
    const chaves = Object.keys(calc);
    useEffect(() => { if (chaves.length && !calc[mes]) setMes(chaves[chaves.length - 1]); }, [chaves.join('|')]);
    const ult = dados && Object.values(dados.base.meses).map((m) => m.savedAt).sort().pop();
    return h('div', { className: 'sc9-i09-overlay', role: 'dialog', 'aria-label': 'Indicador I 09' },
      h('div', { className: 'sc9-i09-top' },
        h('h1', null, 'Indicador I 09 · OM e OS no almoxarifado', h('small', null, ult ? 'Base atualizada em ' + fmtDH(ult) + '. Atualiza quando alguém sobe a SC2; não é tempo real.' : 'Sem dados ainda')),
        h('div', { className: 'sc9-i09-tabs', role: 'tablist' }, [['resultado', 'Resultado'], ...(admin ? [['atualizar', 'Atualizar base'], ['config', 'Configuração']] : [])].map(([k, t]) => h('button', { key: k, role: 'tab', 'aria-selected': aba === k, className: 'sc9-i09-tab', onClick: () => setAba(k) }, t))),
        h('button', { className: 'sc9-i09-btn', onClick: onFechar }, 'Fechar')),
      h('div', { className: 'sc9-i09-body' },
        erro && h('div', { className: 'sc9-i09-err' }, erro),
        !dados && !erro && h('p', { className: 'sc9-i09-sub' }, 'Carregando…'),
        dados && aba === 'resultado' && h(Resultado, { calc, chaves, mes, setMes, aoAtualizar: admin ? () => setAba('atualizar') : null }),
        dados && admin && aba === 'atualizar' && h(Atualizar, { base: dados.base, config: dados.config, onSalvo: carregar }),
        dados && admin && aba === 'config' && h(Configuracao, { base: dados.base, config: dados.config, onSalvo: carregar })));
  }
  /* Campo "SC2" na tela inicial de upload, ao lado das outras bases (só administrador). Entra por fora do app:
   * acrescenta um bloco no fim da lista de uploads e o recoloca se a tela for redesenhada. */
  function CampoInicio({ onAbrir }) {
    const [dados, setDados] = useState(cache.base ? { base: cache.base, config: cache.config } : null);
    const carregar = useCallback(async () => { const d = await carregarBase(); setDados({ base: d.base, config: d.config }); return d; }, []);
    useEffect(() => { carregar().catch(() => { /* sem base: o campo só aparece quando carregar */ }); }, [carregar]);
    if (!dados) return null;
    return h(UploadSC2, { base: dados.base, config: dados.config, onSalvo: carregar, onAbrir, inicio: true });
  }
  function instalarCampoInicio(onAbrir) {
    const doc = root.document; let raiz = null, no = null;
    const achar = () => {
      const h1 = [...doc.querySelectorAll('main h1')].find((e) => /suba as bases/i.test(e.textContent || '')); if (!h1) return null;
      const grade = h1.parentElement.querySelector('.grid'); return grade && grade.querySelector('input[type=file]') ? grade : null;
    };
    const garantir = () => {
      const grade = achar();
      if (!grade) { if (no && !no.isConnected) { try { raiz.unmount(); } catch (e) { /* já saiu */ } raiz = null; no = null; } return; }
      if (no && no.isConnected && no.parentElement === grade) return;
      if (raiz) { try { raiz.unmount(); } catch (e) { /* já saiu */ } }
      no = doc.createElement('div'); no.id = 'sc9-i09-start'; grade.appendChild(no);
      raiz = root.ReactDOM.createRoot(no); raiz.render(h(CampoInicio, { onAbrir }));
    };
    let t = null; const agenda = () => { clearTimeout(t); t = setTimeout(garantir, 120); };
    new root.MutationObserver(agenda).observe(doc.body, { childList: true, subtree: true });
    garantir();
    return () => { clearTimeout(t); };
  }
  function App() {
    const [sessao, setSessao] = useState(null); const [aberto, setAberto] = useState(false);
    useEffect(() => {
      let vivo = true, t;
      const checar = async () => {
        try {
          const s = await fetch('/api/session', { credentials: 'same-origin' }).then((r) => r.json()); if (!vivo) return;
          const ok = Boolean(s && s.authed && (s.role === 'admin' || (s.perfis || []).includes('geral')));
          setSessao(ok ? s : null);
          if (ok && !cache.base) carregarBase().catch(() => { /* o botão do relatório só acrescenta as abas se a base chegou */ });
        } catch (e) { /* offline: tenta de novo */ }
        if (vivo) t = setTimeout(checar, 20000);
      };
      checar(); return () => { vivo = false; clearTimeout(t); };
    }, []);
    const admin = Boolean(sessao && sessao.role === 'admin');
    useEffect(() => { if (!admin) return undefined; return instalarCampoInicio(() => setAberto(true)); }, [admin]);
    if (!sessao) return null;
    return h(R.Fragment, null,
      !aberto && h('button', { className: 'sc9-i09-fab', onClick: () => setAberto(true), title: 'Ordens atendidas no almoxarifado (BSC I 09: OM e OS)' }, 'Indicador I 09'),
      aberto && h(Painel, { sessao, onFechar: () => setAberto(false) }));
  }
  function montar() {
    if (root.document.getElementById('sc9-i09-root')) return;
    const el = root.document.createElement('div'); el.id = 'sc9-i09-root'; root.document.body.appendChild(el);
    root.ReactDOM.createRoot(el).render(h(App));
  }
  root.SC9IndicadorI09UI = { montar };
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', montar); else montar();
})(typeof window === 'object' ? window : globalThis);
