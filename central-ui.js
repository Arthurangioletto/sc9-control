/* Central de Pedidos: peças visuais reutilizáveis (ícones, marca, selos, formatação, avisos). JavaScript puro, sem nada de fora.
 * Usado por vendedoras.js (área das vendedoras) e prioridades.js (painel da logística). Tudo que vem do servidor entra como textContent. */
(function (root) {
  'use strict';

  const FUSO = 'America/Sao_Paulo';
  const NOME = 'Central de Pedidos';

  /* ---------- elementos ---------- */
  const h = (tag, props, ...filhos) => {
    const e = root.document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const f of filhos.flat(Infinity)) { if (f == null || f === false) continue; e.appendChild(typeof f === 'string' || typeof f === 'number' ? root.document.createTextNode(String(f)) : f); }
    return e;
  };

  /* ---------- ícones (traço simples, 24x24) ---------- */
  const ICONES = {
    busca: [['c', 11, 11, 8], ['p', 'm21 21-4.3-4.3']],
    pacote: [['p', 'M21 8l-9-5-9 5v8l9 5 9-5V8z'], ['p', 'M3 8l9 5 9-5'], ['p', 'M12 13v8']],
    ok: [['p', 'M20 6 9 17l-5-5']],
    okCirculo: [['c', 12, 12, 10], ['p', 'm9 12 2 2 4-4']],
    relogio: [['c', 12, 12, 10], ['p', 'M12 6v6l4 2']],
    caminhao: [['p', 'M1 3h15v13H1z'], ['p', 'M16 8h4l3 3v5h-7z'], ['c', 5.5, 18.5, 2.5], ['c', 18.5, 18.5, 2.5]],
    conferencia: [['p', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'], ['p', 'M9 2h6v4H9z'], ['p', 'm9 14 2 2 4-4']],
    nota: [['p', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'], ['p', 'M14 2v6h6'], ['p', 'M8 13h8'], ['p', 'M8 17h8']],
    raio: [['p', 'M13 2 3 14h9l-1 8 10-12h-9l1-8z']],
    alerta: [['p', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'], ['p', 'M12 9v4'], ['p', 'M12 17h.01']],
    pessoa: [['p', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'], ['c', 12, 7, 4]],
    predio: [['p', 'M3 21h18'], ['p', 'M5 21V7l8-4v18'], ['p', 'M19 21V11l-6-4'], ['p', 'M9 9v.01'], ['p', 'M9 13v.01'], ['p', 'M9 17v.01']],
    calendario: [['r', 3, 4, 18, 18, 2], ['p', 'M16 2v4'], ['p', 'M8 2v4'], ['p', 'M3 10h18']],
    fechar: [['p', 'M18 6 6 18'], ['p', 'M6 6l12 12']],
    seta: [['p', 'M5 12h14'], ['p', 'm12 5 7 7-7 7']],
    copiar: [['r', 9, 9, 13, 13, 2], ['p', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1']],
    atualizar: [['p', 'M21 12a9 9 0 1 1-3-6.7L21 8'], ['p', 'M21 3v5h-5']],
    enviar: [['p', 'm22 2-7 20-4-9-9-4z'], ['p', 'M22 2 11 13']],
    lista: [['p', 'M8 6h13'], ['p', 'M8 12h13'], ['p', 'M8 18h13'], ['p', 'M3 6h.01'], ['p', 'M3 12h.01'], ['p', 'M3 18h.01']],
    caixaEntrada: [['p', 'M22 12h-6l-2 3h-4l-2-3H2'], ['p', 'M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z']],
    comentario: [['p', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z']],
    liberado: [['r', 3, 11, 18, 11, 2], ['p', 'M7 11V7a5 5 0 0 1 9.9-1']],
    link: [['p', 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7'], ['p', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7']],
    sair: [['p', 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'], ['p', 'm16 17 5-5-5-5'], ['p', 'M21 12H9']],
    painel: [['r', 3, 3, 7, 9, 1], ['r', 14, 3, 7, 5, 1], ['r', 14, 12, 7, 9, 1], ['r', 3, 16, 7, 5, 1]],
    usuarioCheck: [['p', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'], ['c', 9, 7, 4], ['p', 'm16 11 2 2 4-4']],
    baixar: [['p', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'], ['p', 'm7 10 5 5 5-5'], ['p', 'M12 15V3']],
    usuario: [['p', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'], ['c', 12, 7, 4]],
    cadeado: [['r', 3, 11, 18, 11, 2], ['p', 'M7 11V7a5 5 0 0 1 10 0v4']],
    info: [['c', 12, 12, 10], ['p', 'M12 16v-4'], ['p', 'M12 8h.01']],
    sino: [['p', 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9'], ['p', 'M13.7 21a2 2 0 0 1-3.4 0']]
  };
  const NS = 'http://www.w3.org/2000/svg';
  function icone(nome, extra) {
    const svg = root.document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ic' + (extra ? ' ' + extra : '')); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    for (const it of ICONES[nome] || []) {
      const el = root.document.createElementNS(NS, it[0] === 'p' ? 'path' : it[0] === 'c' ? 'circle' : 'rect');
      if (it[0] === 'p') el.setAttribute('d', it[1]);
      else if (it[0] === 'c') { el.setAttribute('cx', it[1]); el.setAttribute('cy', it[2]); el.setAttribute('r', it[3]); }
      else { el.setAttribute('x', it[1]); el.setAttribute('y', it[2]); el.setAttribute('width', it[3]); el.setAttribute('height', it[4]); el.setAttribute('rx', it[5]); }
      svg.appendChild(el);
    }
    return svg;
  }

  // Marca: um percurso com início, passagem e destino (a ideia é "acompanhar o caminho do pedido").
  function marca(sub) {
    const s = root.document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    for (const d of ['M5 18c0-6 14-2 14-9', 'M5 18h.01', 'M19 6h.01']) { const p = root.document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); }
    const c = root.document.createElementNS(NS, 'circle'); c.setAttribute('cx', 12); c.setAttribute('cy', 12.5); c.setAttribute('r', 1.6); c.setAttribute('fill', 'currentColor'); c.setAttribute('stroke', 'none'); s.appendChild(c);
    return h('div', { class: 'marca' }, h('span', { class: 'marca-sinal' }, s), h('div', null, NOME, sub ? h('small', { text: sub }) : null));
  }

  /* ---------- textos do negócio ---------- */
  const NIVEL = { normal: 'Normal', media: 'Média', alta: 'Alta', urgente: 'Urgente' };
  const NIVEL_DICA = { normal: 'Sem pressa', media: 'Neste dia', alta: 'Hoje', urgente: 'Agora' };
  const STATUS = { recebida: 'Recebida', em_analise: 'Em análise', aprovada: 'Aprovada', em_atendimento: 'Em atendimento', concluida: 'Concluída', nao_aprovada: 'Não aprovada' };
  const MOTIVO = { cliente_aguardando: 'Cliente esperando o pedido', prazo_combinado: 'Prazo combinado com o cliente', cliente_importante: 'Cliente estratégico', erro_nosso: 'Atraso por erro nosso', retirada: 'Cliente vai retirar', outro: 'Outro (explique na observação)' };
  const TIPO_AVISO = { endereco: 'Cliente mudou o endereço de entrega', retirada: 'Cliente vai retirar / mudou a retirada', transportadora: 'Trocar a transportadora', cancelar: 'Cliente pediu para cancelar ou segurar o pedido', produto: 'Problema ou dúvida com os itens do pedido', outro: 'Outra informação' };
  const STATUS_AVISO = { recebido: 'Recebido', em_andamento: 'Em andamento', resolvido: 'Resolvido' };
  const ICONE_ETAPA = { liberado: 'liberado', sep: 'pacote', conf: 'conferencia', fat: 'nota', saida: 'caixaEntrada', desp: 'caminhao' };

  /* ---------- datas ---------- */
  const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO }) : '');
  const curta = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' }) : '');
  const horaBR = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }) : '');
  const dataHora = (iso) => (iso ? curta(iso) + ' às ' + horaBR(iso) : '');
  const diaSP = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: FUSO }) : '');
  const duracao = (deIso, ateMs) => {
    const min = Math.max(0, Math.round(((ateMs || Date.now()) - new Date(deIso).getTime()) / 60000));
    const d = Math.floor(min / 1440), hh = Math.floor((min % 1440) / 60), m = min % 60;
    if (d >= 1) return d + (d === 1 ? ' dia' : ' dias') + (hh ? ' e ' + hh + ' h' : '');
    if (hh >= 1) return hh + ' h' + (m ? ' ' + m + ' min' : '');
    return Math.max(1, m) + ' min';
  };

  /* ---------- pequenas peças ---------- */
  const selo = (texto, classe, semPonto) => h('span', { class: 'selo ' + (classe || '') + (semPonto ? ' sem-ponto' : ''), text: texto });
  const fato = (nomeIcone, rotulo, valor) => h('div', { class: 'fato' }, icone(nomeIcone), h('div', null, h('span', { text: rotulo }), h('b', { text: valor || '—' })));
  // Ilustrações simples (SVG inline, texto fixo do próprio código) para as telas vazias: caixa aberta e lupa sobre um pacote.
  const ILUS = {
    caixa: '<svg class="ilus" viewBox="0 0 200 150" aria-hidden="true" focusable="false"><defs><linearGradient id="ilA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6e4ff"/><stop offset="1" stop-color="#a3bdfb"/></linearGradient><linearGradient id="ilB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#82a6fb"/><stop offset="1" stop-color="#3a6cf5"/></linearGradient></defs><ellipse cx="100" cy="134" rx="60" ry="8" fill="#1d4ed8" opacity=".12"/><g class="flutua"><path d="M46 72 28 58l54-20 18 12z" fill="#e3ecff" stroke="#a3bdfb" stroke-width="2" stroke-linejoin="round"/><path d="m154 72 18-14-54-20-18 12z" fill="#eef3ff" stroke="#a3bdfb" stroke-width="2" stroke-linejoin="round"/><path d="m46 72 54 22 54-22-54-22z" fill="#cfdcfb" stroke="#a3bdfb" stroke-width="2" stroke-linejoin="round"/><path d="M46 72v36l54 24V94z" fill="url(#ilA)"/><path d="M154 72v36l-54 24V94z" fill="url(#ilB)"/><path d="M62 98v9l14 6v-9z" fill="#fff" opacity=".55"/></g><path d="m168 24 3.2 7.6 7.6 3.2-7.6 3.2-3.2 7.6-3.2-7.6-7.6-3.2 7.6-3.2z" fill="#f39a35"/><circle cx="30" cy="34" r="4" fill="#7ea3fb"/><circle cx="178" cy="92" r="3" fill="#7ea3fb"/><path d="m22 96 2.2 5 5 2.2-5 2.2-2.2 5-2.2-5-5-2.2 5-2.2z" fill="#a3bdfb"/></svg>',
    lupa: '<svg class="ilus" viewBox="0 0 200 150" aria-hidden="true" focusable="false"><defs><linearGradient id="ilC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6e4ff"/><stop offset="1" stop-color="#a3bdfb"/></linearGradient></defs><ellipse cx="100" cy="134" rx="62" ry="8" fill="#1d4ed8" opacity=".12"/><g class="flutua"><path d="M30 78 58 66l28 12v32L58 122 30 110z" fill="url(#ilC)"/><path d="m30 78 28 12 28-12M58 90v32" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round" opacity=".8"/><circle cx="112" cy="62" r="34" fill="#fff" fill-opacity=".65" stroke="#2f63f0" stroke-width="8"/><path d="m137 88 28 28" stroke="#1a3fb4" stroke-width="13" stroke-linecap="round"/><path d="M101 54a11 11 0 1 1 15 10c-3 1.600-4 3.500-4 7" fill="none" stroke="#1d4ed8" stroke-width="6" stroke-linecap="round"/><circle cx="112" cy="82" r="3.800" fill="#1d4ed8"/></g><path d="m170 26 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#f39a35"/><circle cx="26" cy="36" r="4" fill="#7ea3fb"/></svg>'
  };
  const ilustracao = (tipo) => { const w = root.document.createElement('span'); w.innerHTML = ILUS[tipo] || ILUS.caixa; return w.firstChild; };
  const vazio = (nomeIcone, titulo, texto) => h('div', { class: 'vazio' }, ilustracao(nomeIcone === 'busca' || nomeIcone === 'atualizar' ? 'lupa' : 'caixa'), h('b', { text: titulo }), texto ? h('p', { text: texto }) : null);
  // Cabeçalho de página: ícone em relevo + título + frase de apoio.
  const cabecalho = (nomeIcone, titulo, sub) => h('div', { class: 'cab-pg' }, h('div', { class: 'orbe-pg' }, icone(nomeIcone)), h('div', null, h('h1', { text: titulo }), sub ? h('p', { text: sub }) : null));
  const esqueleto = (n) => h('div', { 'aria-label': 'Carregando', role: 'status', style: 'display:flex;flex-direction:column;gap:12px' }, Array.from({ length: n || 3 }, (_, i) => h('div', { class: 'esqueleto', style: 'height:' + (i === 0 ? 120 : 64) + 'px' })));

  /* ---------- exportar (CSV que abre direto no Excel em português) ---------- */
  // ";" como separador, BOM no começo (acentos certos) e CRLF. Texto que começaria com = + - @ ganha um apóstrofo na frente
  // para o Excel não tratar como fórmula (o texto vem de gente digitando).
  const celulaCsv = (v) => {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t)) t = "'" + t;
    return /[";\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const montarCsv = (cabecalho, linhas) => [cabecalho].concat(linhas).map((l) => l.map(celulaCsv).join(';')).join('\r\n');
  const dataHoraCsv = (iso) => (iso ? dataBR(iso) + ' ' + horaBR(iso) : '');
  function baixarCsv(nomeArquivo, cabecalho, linhas) {
    const blob = new root.Blob(['\ufeff' + montarCsv(cabecalho, linhas)], { type: 'text/csv;charset=utf-8' });
    const url = root.URL.createObjectURL(blob);
    const a = h('a', { href: url, download: nomeArquivo, style: 'display:none' });
    root.document.body.appendChild(a); a.click(); a.remove();
    root.setTimeout(() => root.URL.revokeObjectURL(url), 4000);
    toast('Arquivo ' + nomeArquivo + ' baixado.');
  }
  const nomeArquivo = (base) => base + '-' + diaSP(new Date().toISOString()) + '.csv';

  let caixaToasts = null;
  function toast(texto, tipo) {
    if (!caixaToasts) { caixaToasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); root.document.body.appendChild(caixaToasts); }
    const t = h('div', { class: 'toast ' + (tipo === 'erro' ? 'erro' : '') }, icone(tipo === 'erro' ? 'alerta' : 'okCirculo'), h('span', { text: texto }));
    caixaToasts.appendChild(t);
    root.setTimeout(() => t.remove(), tipo === 'erro' ? 5000 : 3000);
  }
  async function copiar(texto, aviso) {
    try { await root.navigator.clipboard.writeText(texto); toast(aviso || 'Copiado.'); } catch (e) { toast('Não consegui copiar. Selecione o texto e copie.', 'erro'); }
  }

  root.Central = { NOME, FUSO, h, icone, marca, cabecalho, NIVEL, NIVEL_DICA, STATUS, MOTIVO, TIPO_AVISO, STATUS_AVISO, ICONE_ETAPA, dataBR, curta, horaBR, dataHora, diaSP, duracao, selo, fato, vazio, esqueleto, toast, copiar, montarCsv, baixarCsv, dataHoraCsv, nomeArquivo };
})(window);
