/* Central de Pedidos · Painel da Expedição. Mostra num lugar só o que DESCEU do estoque, o que a expedição RECEBEU e o que SAIU
 * (planilha de Entrega), pedido a pedido e por transportadora. Entra com o usuário do SC9 (administrador ou quem tem o acesso
 * "Recebimento" ou "Despacho"). Tudo que vem do servidor entra como texto (nunca como HTML). JavaScript puro, sem nada de fora.
 * Modo TV: /expedicao.html?modo=tv (sem tabela, números grandes, atualiza sozinho). */
(function (root) {
  'use strict';
  const C = root.Central, h = C.h;
  const doc = root.document;
  const $raiz = doc.getElementById('raiz');
  const CAB = { 'Content-Type': 'application/json', 'X-SC9-App': '1' };
  const params = new root.URLSearchParams(root.location.search);
  const EMBED = params.get('embed') === '1'; // dentro do SC9 (iframe da mesma origem): sem faixa da marca, sem botões de navegação
  const TV = !EMBED && params.get('modo') === 'tv';
  const REDUZ = Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const LIMITE = 25;
  if (TV) doc.body.classList.add('tv');
  if (EMBED) doc.body.classList.add('embed');

  /* ---------- ícones extras (mesmo traço dos da Central) ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  const EXTRA = {
    descer: [['p', 'M12 3v12'], ['p', 'm7 10 5 5 5-5'], ['p', 'M5 21h14']],
    planilha: [['r', 3, 3, 18, 18, 2], ['p', 'M3 9h18'], ['p', 'M3 15h18'], ['p', 'M9 3v18']],
    tv: [['r', 2, 4, 20, 13, 2], ['p', 'M8 21h8'], ['p', 'M12 17v4']],
    chevron: [['p', 'm6 9 6 6 6-6']],
    externo: [['p', 'M15 3h6v6'], ['p', 'M10 14 21 3'], ['p', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6']],
    pino: [['p', 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z'], ['c', 12, 10, 2.5]],
    lapis: [['p', 'M12 20h9'], ['p', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']],
    grafico: [['p', 'M3 3v18h18'], ['p', 'M7 14v4'], ['p', 'M12 9v9'], ['p', 'M17 5v13']],
    tabela: [['r', 3, 4, 18, 16, 2], ['p', 'M3 10h18'], ['p', 'M9 4v16']],
    bipe: [['p', 'M4 8V5a1 1 0 0 1 1-1h3'], ['p', 'M16 4h3a1 1 0 0 1 1 1v3'], ['p', 'M20 16v3a1 1 0 0 1-1 1h-3'], ['p', 'M8 20H5a1 1 0 0 1-1-1v-3'], ['p', 'M8 9v6'], ['p', 'M12 9v6'], ['p', 'M16 9v6']],
    seta: [['p', 'M5 12h14'], ['p', 'm12 5 7 7-7 7']],
    esq: [['p', 'm15 18-6-6 6-6']],
    dir: [['p', 'm9 18 6-6-6-6']],
    estrela: [['p', 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z']],
    sol: [['c', 12, 12, 4], ['p', 'M12 2v2'], ['p', 'M12 20v2'], ['p', 'm4.9 4.9 1.4 1.4'], ['p', 'm17.7 17.7 1.4 1.4'], ['p', 'M2 12h2'], ['p', 'M20 12h2']]
  };
  function ic(nome, extra) {
    const def = EXTRA[nome];
    if (!def) return C.icone(nome, extra);
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ic' + (extra ? ' ' + extra : '')); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    for (const it of def) {
      const el = doc.createElementNS(NS, it[0] === 'p' ? 'path' : it[0] === 'c' ? 'circle' : 'rect');
      if (it[0] === 'p') el.setAttribute('d', it[1]);
      else if (it[0] === 'c') { el.setAttribute('cx', it[1]); el.setAttribute('cy', it[2]); el.setAttribute('r', it[3]); }
      else { el.setAttribute('x', it[1]); el.setAttribute('y', it[2]); el.setAttribute('width', it[3]); el.setAttribute('height', it[4]); el.setAttribute('rx', it[5]); }
      svg.appendChild(el);
    }
    return svg;
  }

  /* ---------- datas e números ---------- */
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DIA3 = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const DIA_LONGO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const ehDia = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const hoje = () => (estado.painel && estado.painel.hoje) || C.diaSP(new Date().toISOString());
  const somar = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dif = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
  const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
  const dm = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const dmy = (d) => dm(d) + '/' + d.slice(0, 4);
  const fimMes = (d) => { const x = new Date(d.slice(0, 7) + '-01T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10); };
  const nomeMes = (d) => MESES[Number(d.slice(5, 7)) - 1];
  const num = (n) => Number(n || 0).toLocaleString('pt-BR');
  const plural = (n, um, varios) => num(n) + ' ' + (Number(n) === 1 ? um : varios);
  const pct = (a, b) => { if (!b) return 0; const v = (a / b) * 100; return a >= b ? 100 : Math.min(99, Math.max(a > 0 ? 1 : 0, Math.floor(v + 0.5))); };
  function periodoTexto(de, ate) {
    if (!ehDia(de) || !ehDia(ate)) return '';
    if (de === ate) return DIA_LONGO[dow(de)] + ', ' + dmy(de);
    if (de.slice(0, 7) === ate.slice(0, 7)) return Number(de.slice(8)) + ' a ' + Number(ate.slice(8)) + ' de ' + nomeMes(de) + ' de ' + de.slice(0, 4);
    return dmy(de) + ' a ' + dmy(ate);
  }
  const dataCurta = (v) => (!v ? '' : ehDia(String(v).slice(0, 10)) && String(v).length === 10 ? dm(v) : C.curta(v));
  const dataHora = (iso) => (iso ? C.curta(iso) + ' ' + C.horaBR(iso) : '');
  function parado(horas) {
    if (horas < 1) return 'menos de 1 h';
    if (horas < 48) return horas + ' h';
    const d = Math.floor(horas / 24), r = horas % 24;
    return d + (d === 1 ? ' dia' : ' dias') + (r ? ' e ' + r + ' h' : '');
  }
  function fmtMin(m) {
    m = Math.max(0, Math.round(Number(m) || 0));
    if (m < 1) return 'menos de 1 min';
    if (m < 60) return m + ' min';
    const hh = Math.floor(m / 60), r = m % 60;
    if (hh >= 48) { const d = Math.floor(hh / 24), rh = hh % 24; return d + ' dias' + (rh ? ' e ' + rh + ' h' : ''); }
    return hh + ' h' + (r ? ' ' + r + ' min' : '');
  }
  const fmtHoras = (hs) => fmtMin(Number(hs) * 60);
  // tempo do estoque até o recebimento: verde até 30 min, amarelo até 2 h, vermelho acima
  const tomTempo = (min) => (min < 30 ? 'verde' : min <= 120 ? 'ambar' : 'vermelho');
  const tomPermanencia = (hs) => (hs < 12 ? 'verde' : hs <= 36 ? 'ambar' : 'vermelho');
  const tomParado = (horas) => (horas >= 48 ? 'vermelho' : horas >= 24 ? 'laranja' : horas >= 8 ? 'ambar' : 'azul');
  const primeiroNome = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[1][0] + '.' : p[0] || ''; };

  /* ---------- estado ---------- */
  const estado = {
    sessao: null, login: { usuario: '', senha: '', erro: '', entrando: false },
    periodo: { tipo: 'mes', de: '', ate: '' },
    painel: null, pedidos: null, erro: '', erroPedidos: '', carregando: true, carregandoPedidos: true, ultima: 0, falhouAtualizar: false,
    filtro: { q: '', situacao: '', transportadora: '', dia: '', pagina: 1 },
    aba: '', abaEscolhida: false, pendMostrar: 8, expandido: new Set(), abrirPedido: '',
    graficoTabela: false, series: { desceram: true, recebidos: true, saiu: true },
    imp: { aberto: false, fase: 'ocioso', sim: null, res: null, erro: '', passo: 0 },
    exp: { aberta: false, transportadora: '', soPendentes: false, ocupado: '' },
    bipe: { pode: false, totalHoje: 0, ocupado: false, res: null, recebidosAgora: new Set(), volSalvo: '' },
    animado: false
  };
  const ui = {};       // pedaços da tela (criados uma vez)
  const cache = {};    // chave do que está desenhado, para não redesenhar à toa (nada de piscar)
  let seqPainel = 0, seqPedidos = 0, timerBusca = 0;

  function iniciarPeriodo() {
    const hj = C.diaSP(new Date().toISOString());
    const de = params.get('de'), ate = params.get('ate'), tipo = params.get('periodo');
    if (ehDia(de) && ehDia(ate)) estado.periodo = { tipo: 'datas', de, ate: ate < de ? de : ate };
    else if (tipo === 'hoje') estado.periodo = { tipo: 'hoje', de: hj, ate: hj };
    else if (tipo === '7') estado.periodo = { tipo: '7', de: somar(hj, -6), ate: hj };
    else estado.periodo = { tipo: 'mes', de: hj.slice(0, 7) + '-01', ate: hj };
  }
  function definirPeriodo(tipo, deEscolhido, ateEscolhido) {
    const hj = hoje();
    let de, ate;
    if (tipo === 'hoje') { de = ate = hj; } else if (tipo === '7') { de = somar(hj, -6); ate = hj; } else if (tipo === 'mes') { de = hj.slice(0, 7) + '-01'; ate = hj; } else {
      de = ehDia(deEscolhido) ? deEscolhido : estado.periodo.de; ate = ehDia(ateEscolhido) ? ateEscolhido : estado.periodo.ate;
      if (ate < de) ate = de;
      if (dif(de, ate) > 61) { ate = somar(de, 61); C.toast('O painel mostra até 62 dias de uma vez. Ajustei a data final.'); }
    }
    estado.periodo = { tipo, de, ate }; estado.filtro.dia = ''; estado.filtro.pagina = 1;
    estado.carregando = !estado.painel; estado.carregandoPedidos = true;
    recarregar(false);
    renderCabecalho();
  }

  /* ---------- rede ---------- */
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  async function api(caminho, opc) {
    const o = opc || {};
    const r = await root.fetch(caminho, { method: o.method || 'GET', cache: 'no-store', credentials: 'same-origin', headers: CAB, body: o.corpo ? JSON.stringify(o.corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { const e = new Error(j.error || 'Entre para continuar.'); e.auth = true; throw e; }
    if (!r.ok) { const e = new Error(j.error || 'Não consegui falar com o servidor. Tente de novo.'); e.status = r.status; e.dados = j; throw e; }
    return j;
  }
  function seSessaoCaiu(e) { if (e && e.auth) { estado.sessao = { authed: false, pode: false }; estado.painel = null; estado.pedidos = null; ui.montada = false; desenhar(); return true; } return false; }

  async function carregarSessao() {
    try {
      const j = await (await root.fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' })).json();
      const perfis = j.perfis || [];
      estado.sessao = { authed: Boolean(j.authed), nome: j.nome || j.usuario || '', admin: j.role === 'admin', pode: Boolean(j.authed && (j.role === 'admin' || perfis.includes('recebimento') || perfis.includes('despacho'))) };
    } catch (e) { estado.sessao = { authed: false, pode: false }; }
  }
  async function carregarPainel() {
    const meu = ++seqPainel;
    try {
      const j = await api('/api/expedicao/painel?' + qs({ de: estado.periodo.de, ate: estado.periodo.ate }));
      if (meu !== seqPainel) return;
      estado.painel = j; estado.erro = ''; estado.falhouAtualizar = false; estado.ultima = Date.now();
      if (!estado.abaEscolhida) estado.aba = abaPadrao(j);
    } catch (e) {
      if (meu !== seqPainel || seSessaoCaiu(e)) return;
      if (estado.painel) estado.falhouAtualizar = true; else estado.erro = e.message;
    }
    estado.carregando = false;
  }
  async function carregarPedidos() {
    const meu = ++seqPedidos, f = estado.filtro, p = estado.periodo;
    try {
      const j = await api('/api/expedicao/pedidos?' + qs({ de: f.dia || p.de, ate: f.dia || p.ate, transportadora: f.transportadora, situacao: f.situacao, q: f.q.trim(), pagina: f.pagina, limite: LIMITE }));
      if (meu !== seqPedidos) return;
      estado.pedidos = j; estado.erroPedidos = '';
      if (estado.abrirPedido) { const l = (j.linhas || []).find((x) => x.pedido === estado.abrirPedido); if (l) estado.expandido.add(chaveLinha(l)); estado.abrirPedido = ''; }
    } catch (e) {
      if (meu !== seqPedidos || seSessaoCaiu(e)) return;
      if (!estado.pedidos) estado.erroPedidos = e.message;
    }
    estado.carregandoPedidos = false;
  }
  async function recarregar(silencioso) {
    if (!estado.sessao || !estado.sessao.pode) return;
    if (!silencioso) { renderTudo(); }
    await Promise.all([carregarPainel(), TV ? null : carregarPedidos()]);
    renderTudo();
  }
  // "Faltam sair" = recebidos que ainda não estão na Entrega (inclui os que a expedição marcou como "não sai hoje"): bate com o funil e com a lista de pendências.
  const faltam = (t) => Math.max(0, (t.recebidos || 0) - (t.saiuEntrega || 0));
  const abaPadrao = (p) => { const t = p.pendenciasTotal || {}, l = p.pendencias || {}; const n = (k) => (t[k] != null ? t[k] : (l[k] || []).length); return n('recebidoNaoSaiu') ? 'recebidoNaoSaiu' : n('desceuNaoRecebido') ? 'desceuNaoRecebido' : n('saiuSemRecebimento') ? 'saiuSemRecebimento' : 'recebidoNaoSaiu'; };

  /* ---------- entrar ---------- */
  async function entrar() {
    const l = estado.login; l.entrando = true; l.erro = ''; desenhar();
    try {
      const r = await root.fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: CAB, body: JSON.stringify({ usuario: l.usuario, password: l.senha }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'Não consegui entrar.');
      l.senha = ''; await carregarSessao(); if (estado.sessao.pode) await carregarPodeReceber(); ui.montada = false; estado.carregando = true; desenhar(); await recarregar(true);
    } catch (e) { l.erro = e.message; }
    l.entrando = false; if (!estado.sessao.pode) desenhar();
  }
  async function sair() {
    try { await root.fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: CAB }); } catch (e) { /* segue */ }
    estado.painel = null; estado.pedidos = null; ui.montada = false; await carregarSessao(); desenhar();
  }

  /* ---------- pecinhas ---------- */
  // Só redesenha o pedaço se o que ele mostra mudou: a tela não pisca na atualização automática.
  function peca(nome, alvo, chave, construir) {
    const k = typeof chave === 'string' ? chave : JSON.stringify(chave);
    if (cache[nome] === k) return false;
    cache[nome] = k; alvo.replaceChildren(...[].concat(construir()).flat(Infinity).filter(Boolean)); return true;
  }
  const botao = (texto, opc, filhos) => h('button', Object.assign({ type: 'button', class: 'btn' }, opc || {}), filhos || null, texto);
  function numero(valor, classe) {
    const s = h('span', { class: classe || '', 'data-final': String(valor), text: num(valor) });
    if (!estado.animado && !REDUZ && valor > 0) animar(s, valor);
    return s;
  }
  function animar(el, alvo) {
    const ini = root.performance.now(), dur = 750;
    el.textContent = '0';
    const passo = (t) => { const k = Math.min(1, (t - ini) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = num(Math.round(alvo * e)); if (k < 1) root.requestAnimationFrame(passo); };
    root.requestAnimationFrame(passo);
  }
  const SIT = {
    saiu: { t: 'Saiu', tom: 'verde', i: 'okCirculo' },
    recebido: { t: 'Recebido', tom: 'azul', i: 'pacote' },
    nao_sai_hoje: { t: 'Não sai hoje', tom: 'ambar', i: 'relogio' },
    desceu_nao_recebido: { t: 'Desceu, não recebido', tom: 'laranja', i: 'descer' },
    saiu_sem_recebimento: { t: 'Saiu sem recebimento', tom: 'roxo', i: 'alerta' }
  };
  const seloSit = (s) => { const d = SIT[s] || { t: s || '—', tom: 'azul', i: 'info' }; return h('span', { class: 'sit ' + d.tom }, ic(d.i), d.t); };
  const chaveLinha = (l) => (l.id || '') + '|' + l.dia + '|' + l.pedido;

  /* ---------- cabeçalho e período ---------- */
  // Dentro do SC9: só uma barrinha fina com a hora da última atualização e o link para abrir a página em tela cheia.
  function barraEmbed(comHora) {
    return h('div', { class: 'emb-barra' },
      comHora ? (ui.atualizado = h('span', { class: 'atualizado', role: 'status' }, h('i', { class: 'ponto' }), h('span', { class: 'rotulo-hora', text: 'Carregando…' }))) : h('span', null),
      h('a', { class: 'emb-link', href: '/expedicao.html', target: '_blank', rel: 'noopener' }, 'Abrir em tela cheia', ic('externo')));
  }
  const cabeca = () => (EMBED ? barraEmbed(false) : h('header', { class: 'topo' }, h('div', { class: 'topo-in' }, C.marca('Painel da Expedição'))));
  function montarTopo() {
    if (EMBED) return barraEmbed(true);
    const nome = estado.sessao && estado.sessao.nome;
    return h('header', { class: 'topo' }, h('div', { class: 'topo-in' }, C.marca('Painel da Expedição'),
      h('div', { class: 'topo-lado' },
        TV ? null : h('a', { class: 'btn peq', href: '/fechamento-dia.html' }, ic('caminhao'), h('span', { class: 'so-largo', text: 'Fechamento do dia' })),
        TV ? null : h('a', { class: 'btn peq', href: '/prioridades.html' }, ic('painel'), h('span', { class: 'so-largo', text: 'Painel da logística' })),
        h('a', { class: 'btn peq', href: TV ? '/expedicao.html' : '/expedicao.html?modo=tv', 'aria-label': TV ? 'Sair do modo TV' : 'Abrir em modo TV (tela grande)' }, ic('tv'), h('span', { class: 'so-largo', text: TV ? 'Sair do modo TV' : 'Modo TV' })),
        ui.atualizado = h('span', { class: 'atualizado', role: 'status' }, h('i', { class: 'ponto' }), h('span', { class: 'rotulo-hora', text: 'Carregando…' })),
        !TV && nome ? h('button', { class: 'btn peq', type: 'button', onclick: sair }, ic('sair'), h('span', { class: 'so-largo', text: 'Sair' })) : null)));
  }
  function atualizarSelo() {
    if (!ui.atualizado) return;
    const velho = estado.falhouAtualizar;
    ui.atualizado.className = 'atualizado' + (velho ? ' velha' : '');
    ui.atualizado.lastChild.textContent = !estado.ultima && estado.erro ? 'Sem conexão' : estado.ultima ? (velho ? 'Sem conexão · dados das ' : 'Atualizado às ') + C.horaBR(new Date(estado.ultima).toISOString()) : 'Carregando…';
  }
  function renderCabecalho() {
    const p = estado.periodo, pn = estado.painel;
    const ent = pn && pn.baseEntregaEm;
    let cargaTxt = pn ? 'Planilha de Entrega ainda não carregada' : '', cargaTom = 'laranja';
    if (ent) {
      const dias = dif(C.diaSP(ent), hoje());
      cargaTxt = dias <= 0 ? 'Entrega carregada hoje às ' + C.horaBR(ent) : dias === 1 ? 'Entrega carregada ontem às ' + C.horaBR(ent) : 'Entrega carregada há ' + dias + ' dias (' + C.dataHora(ent) + ')'; cargaTom = dias <= 1 ? 'verde' : 'laranja';
    }
    const abas = [['hoje', 'Hoje'], ['7', '7 dias'], ['mes', 'Mês'], ['datas', 'Datas']];
    peca('cab', ui.cab, { p, cargaTxt, cargaTom, tv: TV, podeIm: pn && pn.podeImportar, exp: estado.exp.ocupado }, () => [
      h('div', { class: 'cab-linha' },
        C.cabecalho('caminhao', 'Painel da Expedição', TV || EMBED ? null : 'O que desceu do estoque, o que a expedição recebeu e o que já saiu para as transportadoras.'),
        TV ? h('div', { class: 'tv-relogio', 'aria-hidden': 'true' }, h('b', { class: 'tv-hora', text: C.horaBR(new Date().toISOString()) }), h('span', { text: periodoTexto(p.de, p.ate) })) : null),
      h('div', { class: 'barra-periodo' },
        TV ? null : h('div', { class: 'abas-pequenas', role: 'group', 'aria-label': 'Período' }, abas.map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(p.tipo === k), onclick: () => (k === 'datas' ? definirPeriodo('datas', p.de, p.ate) : definirPeriodo(k)) }, t))),
        TV ? null : h('div', { class: 'datas' + (p.tipo === 'datas' ? ' aberto' : '') },
          h('label', { class: 'sr', for: 'de', text: 'De' }), h('input', { id: 'de', class: 'entrada', type: 'date', value: p.de, max: hoje(), 'aria-label': 'Data inicial', onchange: (ev) => definirPeriodo('datas', ev.target.value, estado.periodo.ate) }),
          h('span', { class: 'mudo', text: 'até' }),
          h('label', { class: 'sr', for: 'ate', text: 'Até' }), h('input', { id: 'ate', class: 'entrada', type: 'date', value: p.ate, max: hoje(), 'aria-label': 'Data final', onchange: (ev) => definirPeriodo('datas', estado.periodo.de, ev.target.value) })),
        h('span', { class: 'periodo-txt', text: periodoTexto(p.de, p.ate) }),
        cargaTxt ? h('span', { class: 'carga ' + cargaTom }, ic('planilha'), cargaTxt) : null),
      TV ? null : h('div', { class: 'acoes-pg' },
        botao('Manifesto da transportadora', { class: 'btn primario', onclick: abrirExportar, 'aria-haspopup': 'dialog' }, ic('baixar')),
        botao('Copiar resumo do dia', { class: 'btn', onclick: copiarResumo }, ic('copiar')),
        pn && pn.podeImportar ? botao('Trazer da planilha de Entrega', { class: 'btn', onclick: () => { estado.imp.aberto = true; if (estado.imp.fase === 'pronto') estado.imp.fase = 'ocioso'; renderImport(); ui.import.scrollIntoView({ block: 'center', behavior: REDUZ ? 'auto' : 'smooth' }); } }, ic('planilha')) : null)
    ]);
    atualizarSelo();
  }

  /* ---------- funil ---------- */
  function renderFunil() {
    const pn = estado.painel;
    if (!pn) { peca('funil', ui.funil, 'esq' + String(estado.erro), () => (estado.erro ? [] : [h('div', { class: 'esqueleto funil-esq' })])); return; }
    const t = pn.totais, p = estado.periodo;
    const chegaram = Math.max(0, t.desceram - t.desceuNaoRecebido), p1 = pct(chegaram, t.desceram), p2 = pct(t.saiuEntrega, t.recebidos), fal = faltam(t);
    const chave = { t, p };
    peca('funil', ui.funil, chave, () => {
      const etapa = (k, icone, valor, nome, sub, extra) => h('li', { class: 'etapa e-' + k },
        h('span', { class: 'orbe-et' }, ic(icone)),
        h('div', { class: 'et-corpo' }, numero(valor, 'et-num'), h('b', { class: 'et-nome', text: nome }), h('span', { class: 'et-sub', text: sub }), extra || null));
      const elo = (porc, texto, resto, rotulo) => h('li', { class: 'elo', 'aria-label': rotulo },
        h('span', { class: 'elo-fio', 'aria-hidden': 'true' }),
        h('span', { class: 'elo-pilula' }, h('b', { text: porc + '%' }), h('span', { text: texto })),
        h('span', { class: 'elo-resto', text: resto }));
      return h('section', { class: 'card funil' + (estado.animado ? '' : ' anima'), 'aria-labelledby': 'funil-t' },
        h('div', { class: 'funil-cab' }, h('h2', { id: 'funil-t', text: 'O caminho dos pedidos' }), h('p', { text: 'Do estoque até a transportadora · ' + periodoTexto(p.de, p.ate) })),
        h('ol', { class: 'trilho' },
          etapa('1', 'descer', t.desceram, 'Desceram do estoque', 'pedidos que o estoque mandou para a expedição'),
          elo(p1, t.desceram ? 'foram recebidos' : '', t.desceuNaoRecebido ? plural(t.desceuNaoRecebido, 'ainda não chegou', 'ainda não chegaram') : t.desceram ? 'todos já chegaram' : 'sem pedidos neste período', 'Dos que desceram, ' + p1 + ' por cento foram recebidos'),
          etapa('2', 'pacote', t.recebidos, 'Recebidos na expedição', 'pedidos que a expedição já tem em mãos', h('span', { class: 'et-origem' }, h('span', { title: 'Pedidos que a expedição bipou' }, ic('conferencia'), plural(t.bipados, 'bipado', 'bipados')), h('span', { title: 'Pedidos que entraram pela planilha de Entrega, sem bipe' }, ic('planilha'), num(t.daPlanilha) + ' da planilha'))),
          elo(p2, t.recebidos ? 'já saíram' : '', fal ? plural(fal, 'falta sair', 'faltam sair') : t.recebidos ? 'tudo já saiu' : 'sem pedidos neste período', 'Dos recebidos, ' + p2 + ' por cento já saíram'),
          etapa('3', 'caminhao', t.saiuEntrega, 'Saíram para a transportadora', 'pedidos que já estão na planilha de Entrega')));
    });
    estado.animado = true;
  }

  /* ---------- destaques ---------- */
  function renderKpis() {
    const pn = estado.painel;
    if (!pn) { peca('kpis', ui.kpis, 'esq', () => Array.from({ length: 5 }, () => h('div', { class: 'esqueleto kpi-esq' }))); return; }
    const t = pn.totais;
    peca('kpis', ui.kpis, t, () => {
      const kpi = (cls, icone, valor, nome, sub, dica, acao) => {
        const zero = !valor && cls !== 'neutro';
        const corpo = [h('span', { class: 'kpi-ic' }, ic(zero ? 'okCirculo' : icone)), numero(valor, 'kpi-num'), h('b', { class: 'kpi-nome', text: nome }), h('span', { class: 'kpi-sub', text: zero ? 'Tudo certo por aqui' : sub })];
        return acao && !zero ? h('button', { type: 'button', class: 'kpi2 ' + cls, title: dica, onclick: acao }, corpo, h('span', { class: 'kpi-ver' }, 'Ver lista', ic('seta'))) : h('div', { class: 'kpi2 ' + (zero ? 'ok' : cls), title: dica }, corpo);
      };
      return [
        kpi('laranja', 'relogio', faltam(t), 'Faltam sair', t.naoSaiHoje ? 'recebidos que não estão na Entrega (' + num(t.naoSaiHoje) + ' não saem hoje)' : 'recebidos que ainda não estão na Entrega', 'Pedidos que a expedição recebeu e que ainda não apareceram na planilha de Entrega', () => irParaPend('recebidoNaoSaiu')),
        kpi('vermelho', 'descer', t.desceuNaoRecebido, 'Desceram e não foram recebidos', 'o estoque mandou, a expedição não bipou', 'Pedidos que o estoque mandou descer e que a expedição ainda não recebeu', () => irParaPend('desceuNaoRecebido')),
        kpi('roxo', 'alerta', t.saiuSemRecebimento, 'Saíram sem recebimento', 'estão na Entrega, mas ninguém recebeu', 'Pedidos que aparecem na planilha de Entrega mas nunca foram recebidos pela expedição', () => irParaPend('saiuSemRecebimento')),
        kpi('ambar', 'relogio', t.naoSaiHoje, 'Não saem hoje', 'ficaram para outro dia, com motivo', 'Pedidos que a expedição marcou como "não sai hoje"', () => filtrarTabela({ situacao: 'nao_sai_hoje' })),
        kpi('neutro', 'caixaEntrada', t.volumes, 'Volumes recebidos', t.comRastreio ? num(t.comRastreio) + ' com rastreio guardado' : 'nenhum rastreio guardado ainda', 'Soma dos volumes informados nos pedidos recebidos', null)
      ];
    });
  }
  function irParaPend(aba) { estado.aba = aba; estado.abaEscolhida = true; estado.pendMostrar = 8; renderPend(); ui.pendSecao.scrollIntoView({ block: 'start', behavior: REDUZ ? 'auto' : 'smooth' }); }

  /* ---------- gráfico por dia ---------- */
  const SERIES = [['desceram', 'Desceram', 'serie-1'], ['recebidos', 'Recebidos', 'serie-2'], ['saiu', 'Saíram', 'serie-3']];
  function diasCompletos(pn) {
    const m = new Map((pn.dias || []).map((d) => [d.dia, d]));
    const out = []; for (let d = pn.de, n = 0; d <= pn.ate && n < 70; d = somar(d, 1), n++) out.push(m.get(d) || { dia: d, desceram: 0, recebidos: 0, saiu: 0, pendentes: 0, naoSaiHoje: 0, volumes: 0 });
    return out;
  }
  function topoEscala(max) {
    const m = Math.max(4, max), pot = Math.pow(10, Math.floor(Math.log10(m)));
    for (const k of [1, 2, 4, 5, 8, 10]) if (k * pot >= m) return k * pot;
    return 10 * pot;
  }
  function renderGrafico() {
    const pn = estado.painel;
    if (!pn) { peca('graf', ui.graf, 'esq', () => h('div', { class: 'esqueleto', style: 'height:320px' })); return; }
    const dias = diasCompletos(pn), ativas = SERIES.filter((s) => estado.series[s[0]]);
    peca('graf', ui.graf, { dias, s: estado.series, tab: estado.graficoTabela, sel: estado.filtro.dia, t: pn.totais, hoje: pn.hoje }, () => {
      const max = Math.max(0, ...dias.map((d) => Math.max(...ativas.map((s) => d[s[0]] || 0))));
      const topo = topoEscala(max);
      const temDados = dias.some((d) => d.desceram || d.recebidos || d.saiu);
      const legenda = h('div', { class: 'legenda', role: 'group', 'aria-label': 'Séries do gráfico' }, SERIES.map(([k, nome, cls]) => h('button', { type: 'button', class: 'leg ' + cls, 'aria-pressed': String(estado.series[k]), title: 'Mostrar ou esconder: ' + nome, onclick: () => { estado.series[k] = !estado.series[k]; if (!SERIES.some((s) => estado.series[s[0]])) estado.series[k] = true; renderGrafico(); } }, h('i', { class: 'leg-cor' }), nome, h('b', { text: num(k === 'desceram' ? pn.totais.desceram : k === 'recebidos' ? pn.totais.recebidos : pn.totais.saiuEntrega) }))));
      const cab = h('div', { class: 'card-titulo' }, h('div', null, h('h2', { text: 'Dia a dia' }), h('p', { class: 'mudo peq', text: 'Toque num dia para ver os pedidos dele na tabela.' })),
        h('button', { type: 'button', class: 'btn peq fantasma', 'aria-pressed': String(estado.graficoTabela), onclick: () => { estado.graficoTabela = !estado.graficoTabela; renderGrafico(); } }, ic(estado.graficoTabela ? 'grafico' : 'tabela'), estado.graficoTabela ? 'Ver gráfico' : 'Ver como tabela'));
      if (!temDados) return [cab, C.vazio('caixaEntrada', 'Nenhum movimento neste período', 'Quando o estoque descer pedidos ou a expedição receber, os dias aparecem aqui.')];
      if (estado.graficoTabela) return [cab, legenda, tabelaDias(dias)];
      const rolagem = h('div', { class: 'graf-rolagem', tabindex: '0', role: 'group', 'aria-label': 'Gráfico de barras por dia. Use as setas para andar pelos dias.' });
      const rotulos = dias.length <= 10;
      const trilha = h('div', { class: 'graf-trilha' + (rotulos ? ' rotulos' : '') + (cache.grafAnimou ? '' : ' anima'), style: '--n:' + dias.length }); cache.grafAnimou = true;
      const tip = h('div', { class: 'graf-tip', role: 'presentation', hidden: true });
      const colunas = dias.map((d) => {
        const dw = dow(d.dia), sel = estado.filtro.dia === d.dia, ehHoje = d.dia === pn.hoje;
        const barras = ativas.map(([k, , cls]) => { const v = d[k] || 0; return h('i', { class: 'barra ' + cls + (v ? '' : ' zero'), style: 'height:' + (v ? Math.max(2.5, (v / topo) * 100) : 0) + '%' }, rotulos && v ? h('em', { text: String(v) }) : null); });
        const col = h('button', { type: 'button', class: 'dia-col' + (sel ? ' sel' : '') + (ehHoje ? ' hoje' : '') + (dw === 0 ? ' dom' : ''), 'aria-pressed': String(sel), 'aria-label': DIA_LONGO[dw] + ', ' + dm(d.dia) + ': ' + d.desceram + ' desceram, ' + d.recebidos + ' recebidos, ' + d.saiu + ' saíram',
          onclick: () => { const novo = estado.filtro.dia === d.dia ? '' : d.dia; filtrarTabela({ dia: novo }, false); }, onmouseenter: (ev) => mostrarTip(tip, ev.currentTarget, d), onfocus: (ev) => mostrarTip(tip, ev.currentTarget, d), onmouseleave: () => { tip.hidden = true; }, onblur: () => { tip.hidden = true; } },
          h('span', { class: 'barras' }, barras), h('span', { class: 'dia-num', text: d.dia.slice(8) }), h('span', { class: 'dia-sem', text: ehHoje ? 'hoje' : DIA3[dw].slice(0, 3) }));
        return col;
      });
      const grade = h('div', { class: 'graf-grade', 'aria-hidden': 'true' }, [0, 1, 2].map(() => h('span', { class: 'graf-linha' })));
      const eixo = h('div', { class: 'graf-eixo', 'aria-hidden': 'true' }, [topo, topo / 2, 0].map((v) => h('span', { text: num(v) })));
      trilha.append(grade, ...colunas, tip);
      rolagem.appendChild(trilha);
      root.setTimeout(() => { if (rolagem.scrollWidth > rolagem.clientWidth) rolagem.scrollLeft = rolagem.scrollWidth; }, 0);
      const nota = estado.filtro.dia ? h('p', { class: 'graf-nota' }, ic('filtro'), 'A tabela está mostrando só ' + DIA_LONGO[dow(estado.filtro.dia)] + ', ' + dm(estado.filtro.dia) + '. ', h('button', { type: 'button', class: 'link-botao', onclick: () => filtrarTabela({ dia: '' }, false), text: 'Mostrar todos os dias' })) : null;
      return [cab, legenda, h('div', { class: 'graf-caixa' }, eixo, rolagem), nota];
    });
  }
  function mostrarTip(tip, alvo, d) {
    const linhas = SERIES.map(([k, nome, cls]) => h('li', null, h('i', { class: 'leg-cor ' + cls }), nome, h('b', { text: num(d[k]) })));
    tip.replaceChildren(h('b', { class: 'tip-tit', text: DIA_LONGO[dow(d.dia)] + ', ' + dm(d.dia) }), h('ul', null, linhas), h('span', { class: 'tip-pe', text: d.pendentes ? plural(d.pendentes, 'falta sair', 'faltam sair') + ' · ' + plural(d.volumes, 'volume', 'volumes') : plural(d.volumes, 'volume', 'volumes') }));
    tip.hidden = false;
    const trilha = tip.parentNode, centro = alvo.offsetLeft + alvo.offsetWidth / 2, largura = tip.offsetWidth;
    let esq = centro - largura / 2; esq = Math.max(4, Math.min(trilha.clientWidth - largura - 4, esq));
    tip.style.left = esq + 'px';
  }
  function tabelaDias(dias) {
    return h('div', { class: 'tabela-rolagem pequena' }, h('table', { class: 'tabela mini-tab' }, h('caption', { class: 'sr', text: 'Pedidos por dia' }),
      h('thead', null, h('tr', null, ['Dia', 'Desceram', 'Recebidos', 'Saíram', 'Faltam sair', 'Volumes'].map((x, i) => h('th', { scope: 'col', class: i ? 'dir' : '', text: x })))),
      h('tbody', null, dias.filter((d) => d.desceram || d.recebidos || d.saiu).reverse().map((d) => h('tr', null, h('th', { scope: 'row', text: DIA3[dow(d.dia)] + ' ' + dm(d.dia) }), [d.desceram, d.recebidos, d.saiu, d.pendentes, d.volumes].map((v) => h('td', { class: 'dir num', text: num(v) })))))));
  }

  /* ---------- transportadoras ---------- */
  function renderTransp() {
    const pn = estado.painel;
    if (!pn) { peca('transp', ui.transp, 'esq', () => h('div', { class: 'esqueleto', style: 'height:320px' })); return; }
    peca('transp', ui.transp, { l: pn.transportadoras, sel: estado.filtro.transportadora }, () => {
      const lista = pn.transportadoras || [];
      const cab = h('div', { class: 'card-titulo' }, h('div', null, h('h2', { text: 'Por transportadora' }), h('p', { class: 'mudo peq', text: lista.length ? 'Toque numa transportadora para ver os pedidos dela.' : '' })),
        estado.filtro.transportadora ? h('button', { type: 'button', class: 'btn peq fantasma', onclick: () => filtrarTabela({ transportadora: '' }, false) }, ic('fechar'), 'Ver todas') : null);
      if (!lista.length) return [cab, C.vazio('caminhao', 'Nenhuma transportadora ainda', 'Quando houver pedidos recebidos neste período, cada transportadora aparece aqui.')];
      const maior = Math.max(...lista.map((g) => g.recebidos), 1);
      return [cab, h('ul', { class: 'tr-lista' }, lista.map((g) => {
        const sel = estado.filtro.transportadora === g.nome, porc = pct(g.saiu, g.recebidos), pend = Math.max(0, g.recebidos - g.saiu);
        return h('li', null, h('button', { type: 'button', class: 'tr-linha' + (sel ? ' sel' : ''), 'aria-pressed': String(sel), title: g.nome + ': ' + g.recebidos + ' recebidos, ' + g.saiu + ' saíram, ' + pend + ' faltam sair, ' + g.volumes + ' volumes', onclick: () => filtrarTabela({ transportadora: sel ? '' : g.nome }, true) },
          h('span', { class: 'tr-topo' }, h('b', { class: 'tr-nome', text: g.nome }), h('span', { class: 'tr-pct' + (pend ? '' : ' ok') }, pend ? porc + '% saíram' : h('span', null, ic('okCirculo'), 'tudo saiu'))),
          h('span', { class: 'tr-barra', style: 'width:' + Math.max(8, (g.recebidos / maior) * 100) + '%', 'aria-hidden': 'true' }, h('i', { class: 'saiu', style: 'flex:' + g.saiu }), h('i', { class: 'falta', style: 'flex:' + pend })),
          h('span', { class: 'tr-nums' }, h('span', null, h('b', { text: num(g.recebidos) }), ' recebidos'), h('span', null, h('b', { text: num(g.saiu) }), ' saíram'), h('span', { class: pend ? 'falta' : '' }, h('b', { text: num(pend) }), pend === 1 ? ' falta sair' : ' faltam sair'), h('span', null, h('b', { text: num(g.volumes) }), g.volumes === 1 ? ' volume' : ' volumes'), g.permanenciaMediaHoras != null ? h('span', { class: 'tr-rast', title: 'Tempo médio entre o recebimento e a saída' }, ic('relogio'), fmtHoras(g.permanenciaMediaHoras) + ' até sair') : null, g.comRastreio ? h('span', { class: 'tr-rast' }, ic('pino'), num(g.comRastreio) + ' com rastreio') : null)));
      }))];
    });
  }

  /* ---------- pendências ---------- */
  const PEND = [
    { k: 'desceuNaoRecebido', t: 'Desceu e não foi recebido', curto: 'Desceu, não recebido', i: 'descer', vazio: 'Todo pedido que desceu do estoque já foi recebido.' },
    { k: 'recebidoNaoSaiu', t: 'Recebido e não saiu', curto: 'Recebido, não saiu', i: 'relogio', vazio: 'Todo pedido recebido já saiu para a transportadora.' },
    { k: 'saiuSemRecebimento', t: 'Saiu sem recebimento', curto: 'Saiu sem recebimento', i: 'alerta', vazio: 'Todo pedido da planilha de Entrega passou pelo recebimento.' }
  ];
  const totalPend = (pn, k) => (pn.pendenciasTotal && pn.pendenciasTotal[k] != null ? pn.pendenciasTotal[k] : ((pn.pendencias || {})[k] || []).length);
  function itemPend(k, x) {
    const quando = k === 'saiuSemRecebimento' ? null : Number(x.horasParado) || 0;
    const tom = k === 'saiuSemRecebimento' ? 'roxo' : tomParado(quando);
    const linha2 = k === 'desceuNaoRecebido' ? 'desceu ' + dataHora(x.desceuEm) + (x.desceuPor ? ' · ' + primeiroNome(x.desceuPor) : '') : k === 'recebidoNaoSaiu' ? 'recebido ' + dataHora(x.recebidoEm) : 'saiu em ' + dataCurta(x.dataEntrega);
    return h('li', null, h('button', { type: 'button', class: 'pend-item tom-' + tom, onclick: () => verPedido(x.pedido), title: 'Ver este pedido na tabela' },
      h('span', { class: 'pend-ped' }, h('b', { text: x.pedido }), x.motivo ? h('small', { class: 'motivo', text: x.motivo }) : null),
      h('span', { class: 'pend-cli' }, h('b', { text: x.cliente || 'Cliente não informado' }), h('small', { text: (x.transportadora || 'Sem transportadora') + ' · ' + linha2 })),
      h('span', { class: 'pend-tempo' }, ic(tom === 'vermelho' ? 'alerta' : k === 'saiuSemRecebimento' ? 'planilha' : 'relogio'), quando == null ? 'Sem recebimento' : parado(quando))));
  }
  function renderPend() {
    const pn = estado.painel;
    if (!pn) { peca('pend', ui.pend, 'esq', () => h('div', { class: 'esqueleto', style: 'height:260px' })); return; }
    peca('pend', ui.pend, { p: pn.pendencias, t: pn.pendenciasTotal, a: estado.aba, m: estado.pendMostrar }, () => {
      const tabs = h('div', { class: 'pend-abas', role: 'tablist', 'aria-label': 'Tipos de pendência' }, PEND.map((d) => {
        const n = totalPend(pn, d.k), ativa = estado.aba === d.k;
        return h('button', { type: 'button', role: 'tab', id: 'aba-' + d.k, 'aria-selected': String(ativa), 'aria-controls': 'pend-painel', class: 'pend-aba aba-' + d.k + (n ? ' tem' : ''), onclick: () => { estado.aba = d.k; estado.abaEscolhida = true; estado.pendMostrar = 8; renderPend(); } }, h('span', { class: 'pa-ic' }, ic(n ? d.i : 'okCirculo')), h('span', { class: 'pa-n', text: num(n) }), h('span', { class: 'pa-t', text: d.t }));
      }));
      const d = PEND.find((x) => x.k === estado.aba) || PEND[1], lista = (pn.pendencias || {})[d.k] || [], total = totalPend(pn, d.k);
      const mostrar = TV ? 7 : estado.pendMostrar;
      const corpo = total === 0 ? h('div', { class: 'pend-ok' }, h('span', { class: 'pend-ok-ic' }, ic('ok')), h('div', null, h('b', { text: 'Nada pendente aqui' }), h('p', { text: d.vazio })))
        : [h('ul', { class: 'pend-lista' }, lista.slice(0, mostrar).map((x) => itemPend(d.k, x))),
          lista.length > mostrar ? h('button', { type: 'button', class: 'btn fantasma mais', onclick: () => { estado.pendMostrar += 20; renderPend(); } }, 'Mostrar mais ' + Math.min(20, lista.length - mostrar), ic('chevron')) : null,
          total > lista.length ? h('p', { class: 'mudo peq nota-limite', text: 'Mostrando os ' + num(lista.length) + ' mais antigos de ' + num(total) + '. Use a tabela abaixo para ver os outros.' }) : null];
      return [tabs, h('div', { class: 'pend-painel', id: 'pend-painel', role: 'tabpanel', 'aria-labelledby': 'aba-' + d.k }, corpo, d.k === 'recebidoNaoSaiu' && total ? h('p', { class: 'legenda-tempo' }, 'Cores pelo tempo parado: ', h('span', { class: 'ponto-leg azul' }), 'menos de 8 h ', h('span', { class: 'ponto-leg ambar' }), 'de 8 a 24 h ', h('span', { class: 'ponto-leg laranja' }), 'de 1 a 2 dias ', h('span', { class: 'ponto-leg vermelho' }), '2 dias ou mais') : null)];
    });
  }
  function pendTv() {
    const pn = estado.painel; if (!pn) return;
    peca('pend', ui.pend, { p: pn.pendencias, t: pn.pendenciasTotal }, () => h('div', { class: 'pend-tv' }, PEND.map((d) => {
      const lista = (pn.pendencias || {})[d.k] || [], total = totalPend(pn, d.k);
      return h('section', { class: 'pend-col' }, h('h3', null, ic(total ? d.i : 'okCirculo'), d.t, h('span', { class: 'pend-cont', text: num(total) })),
        total ? [h('ul', { class: 'pend-lista' }, lista.slice(0, 6).map((x) => itemPend(d.k, x))), total > 6 ? h('p', { class: 'mudo peq nota-limite', text: 'e mais ' + num(total - 6) }) : null] : h('p', { class: 'pend-ok-tv' }, ic('ok'), 'Nada pendente'));
    })));
  }
  function verPedido(pedido) {
    estado.filtro = { q: pedido, situacao: '', transportadora: '', dia: '', pagina: 1 }; estado.abrirPedido = pedido;
    if (ui.busca) ui.busca.value = pedido; if (ui.selSit) ui.selSit.value = '';
    estado.carregandoPedidos = true; carregarPedidos().then(renderTabela); renderTabela(); renderGrafico(); renderTransp();
    ui.tabSecao.scrollIntoView({ block: 'start', behavior: REDUZ ? 'auto' : 'smooth' });
  }

  /* ---------- tabela de pedidos ---------- */
  function filtrarTabela(mud, rolar) {
    Object.assign(estado.filtro, mud, { pagina: 1 });
    if (ui.busca) ui.busca.value = estado.filtro.q; if (ui.selSit) ui.selSit.value = estado.filtro.situacao; if (ui.selTr) ui.selTr.value = estado.filtro.transportadora;
    estado.carregandoPedidos = true; renderTabela(); renderTransp(); renderGrafico();
    carregarPedidos().then(renderTabela);
    if (rolar !== false) ui.tabSecao.scrollIntoView({ block: 'start', behavior: REDUZ ? 'auto' : 'smooth' });
  }
  function montarFiltros() {
    ui.busca = h('input', { id: 'busca', class: 'entrada', type: 'search', placeholder: 'Pedido, nota ou cliente', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Buscar por pedido, nota ou cliente', oninput: (ev) => { root.clearTimeout(timerBusca); const v = ev.target.value; timerBusca = root.setTimeout(() => filtrarTabela({ q: v }, false), 350); } });
    ui.selSit = h('select', { id: 'f-sit', class: 'entrada', 'aria-label': 'Situação', onchange: (ev) => filtrarTabela({ situacao: ev.target.value }, false) }, [['', 'Todas as situações'], ['recebido', 'Recebido, não saiu'], ['saiu', 'Saiu'], ['nao_sai_hoje', 'Não sai hoje'], ['desceu_nao_recebido', 'Desceu, não recebido'], ['saiu_sem_recebimento', 'Saiu sem recebimento']].map(([v, t]) => h('option', { value: v, text: t })));
    ui.selTr = h('select', { id: 'f-tr', class: 'entrada', 'aria-label': 'Transportadora', onchange: (ev) => filtrarTabela({ transportadora: ev.target.value }, false) }, h('option', { value: '', text: 'Todas as transportadoras' }));
    ui.resumoFiltro = h('p', { class: 'mudo peq resumo-filtro', role: 'status' });
    return h('div', { class: 'filtros-ped' },
      h('div', { class: 'campo-busca' }, ic('busca'), ui.busca),
      ui.selSit, ui.selTr);
  }
  function atualizarSelectTransp() {
    const pn = estado.painel; if (!pn || !ui.selTr) return;
    const nomes = (pn.transportadoras || []).map((g) => g.nome), k = nomes.join('|');
    if (estado.filtro.transportadora && !nomes.includes(estado.filtro.transportadora)) nomes.push(estado.filtro.transportadora);
    if (cache.selTr === k + estado.filtro.transportadora) return; cache.selTr = k + estado.filtro.transportadora;
    ui.selTr.replaceChildren(h('option', { value: '', text: 'Todas as transportadoras' }), ...nomes.map((n) => h('option', { value: n, text: n })));
    ui.selTr.value = estado.filtro.transportadora;
  }
  const celula = (rot, ...f) => h('td', { 'data-label': rot }, ...f);
  function celNota(l) {
    return l.nf ? h('b', { class: 'nf num', text: l.nf }) : h('span', { class: 'aguarda', title: 'A nota só aparece depois que o SC9 é carregado de novo.' }, ic('relogio'), 'Aguardando nota');
  }
  function celDesceu(l) {
    if (!l.desceuEm) return h('span', { class: 'mudo peq', text: l.situacao === 'saiu_sem_recebimento' || l.origem === 'entrega' ? 'Sem registro do estoque' : '—' });
    return [h('b', { text: primeiroNome(l.desceuPor) || 'Estoque' }), h('span', { class: 'sub num', text: dataHora(l.desceuEm) })];
  }
  function celRecebido(l) {
    if (!l.recebidoEm) return h('span', { class: 'mudo peq', text: l.situacao === 'desceu_nao_recebido' ? 'Ainda não recebido' : '—' });
    const planilha = l.origem === 'entrega';
    return [h('b', { text: planilha ? 'Planilha de Entrega' : primeiroNome(l.recebidoPor) }), h('span', { class: 'sub num', text: l.horaEstimada ? dataCurta(l.recebidoEm) : dataHora(l.recebidoEm) }), planilha ? h('span', { class: 'selo-planilha', title: 'Este pedido entrou pela planilha de Entrega, sem bipe da expedição' }, ic('planilha'), 'Veio da planilha') : null];
  }
  function celTempo(l) {
    if (l.horaEstimada || l.origem === 'entrega') return h('span', { class: 'mudo', title: 'Veio da planilha de Entrega: não tem a hora real do recebimento' }, '—');
    const f = [];
    if (l.dataEntrega && l.diasAteSair != null) f.push(h('b', { class: 'tempo-t verde', text: Number(l.diasAteSair) === 0 ? 'Saiu no mesmo dia' : '+' + l.diasAteSair + (Number(l.diasAteSair) === 1 ? ' dia' : ' dias') }));
    else if (!l.dataEntrega && l.horasNaExpedicao != null) f.push(h('b', { class: 'tempo-t ' + tomPermanencia(Number(l.horasNaExpedicao)), text: 'Há ' + fmtHoras(l.horasNaExpedicao) }), h('span', { class: 'sub', text: 'na expedição' }));
    else if (l.situacao === 'desceu_nao_recebido' && l.desceuEm) { const hs = Math.max(0, Math.round((Date.now() - new Date(l.desceuEm).getTime()) / 3600000)); f.push(h('b', { class: 'tempo-t ' + (hs >= 48 ? 'vermelho' : hs >= 24 ? 'laranja' : 'ambar'), text: 'Há ' + parado(hs) }), h('span', { class: 'sub', text: 'desde que desceu' })); }
    if (l.minutosDesceuAteReceber != null) f.push(h('span', { class: 'sub', title: 'Do estoque até o recebimento' }, ic('descer'), fmtMin(l.minutosDesceuAteReceber)));
    return f.length ? f : h('span', { class: 'mudo', text: '—' });
  }
  function celRastreio(l) {
    const r = l.rastreio;
    if (!l.id) return h('span', { class: 'mudo peq', text: 'Só depois do recebimento' });
    if (r && (r.codigo || r.link)) return h('span', { class: 'rast-ok' }, h('span', { class: 'rast-cod', text: r.codigo || 'Link guardado' }),
      r.link ? h('a', { class: 'rast-abrir', href: r.link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Abrir rastreio do pedido ' + l.pedido + ' (abre em outra aba)', title: 'Abrir o link da transportadora' }, ic('externo')) : null,
      h('button', { type: 'button', class: 'rast-edit', 'aria-label': 'Editar rastreio do pedido ' + l.pedido, title: 'Editar', onclick: () => alternarLinha(l, true) }, ic('lapis')));
    return h('button', { type: 'button', class: 'rast-add', onclick: () => alternarLinha(l, true) }, ic('pino'), 'Colar rastreio');
  }
  function alternarLinha(l, focarRastreio) {
    const k = chaveLinha(l);
    if (focarRastreio) estado.expandido.add(k); else if (estado.expandido.has(k)) estado.expandido.delete(k); else estado.expandido.add(k);
    cache.tabela = ''; renderTabela();
    if (focarRastreio) { const alvo = doc.getElementById('rast-' + CSSsafe(k)); if (alvo) alvo.focus(); }
  }
  const CSSsafe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
  function detalhe(l) {
    const k = CSSsafe(chaveLinha(l)), r = l.rastreio || {};
    const passo = (feito, i, t, q, extra) => h('li', { class: feito ? 'feita' : '' }, h('span', { class: 'orbe-mini' }, ic(feito ? 'ok' : i)), h('div', null, h('b', { text: t }), h('span', { class: 'sub', text: q }), extra || null));
    const f = { cod: h('input', { id: 'rast-' + k, class: 'entrada', value: r.codigo || '', maxlength: '80', placeholder: 'Ex.: JD0123456789', autocomplete: 'off' }), link: h('input', { id: 'rastl-' + k, class: 'entrada', value: r.link || '', maxlength: '300', placeholder: 'https://…', inputmode: 'url', autocomplete: 'off' }) };
    const msg = h('p', { class: 'rast-msg', role: 'status' });
    const salvarBtn = h('button', { type: 'button', class: 'btn primario peq', onclick: () => salvarRastreio(l, f.cod.value, f.link.value, msg, salvarBtn) }, ic('ok'), 'Salvar rastreio');
    const colar = (ev) => { const t = (ev.clipboardData || root.clipboardData).getData('text') || ''; const m = t.match(/https?:\/\/\S+/i); if (m && ev.target === f.cod) { ev.preventDefault(); const resto = t.replace(m[0], '').trim(); if (resto) f.cod.value = resto.slice(0, 80); f.link.value = m[0].slice(0, 300); } };
    f.cod.addEventListener('paste', colar);
    return h('tr', { class: 'detalhe' }, h('td', { colspan: '10' }, h('div', { class: 'det-grade' },
      h('ol', { class: 'det-passos' },
        passo(Boolean(l.desceuEm), 'descer', 'Desceu do estoque', l.desceuEm ? (l.desceuPor || 'Estoque') + ' · ' + dataHora(l.desceuEm) : 'Sem registro de descida'),
        passo(Boolean(l.recebidoEm), 'pacote', 'Recebido na expedição', l.recebidoEm ? (l.origem === 'entrega' ? 'Planilha de Entrega · ' + (l.horaEstimada ? dataCurta(l.recebidoEm) + ' (hora não registrada)' : dataHora(l.recebidoEm)) : (l.recebidoPor || '') + ' · ' + dataHora(l.recebidoEm)) : 'Ainda não recebido'),
        passo(Boolean(l.dataEntrega), 'caminhao', 'Saiu para a transportadora', l.dataEntrega ? 'Entrega de ' + dataCurta(l.dataEntrega) + ' · ' + (l.transportadora || '') : 'Ainda não aparece na planilha de Entrega')),
      h('div', { class: 'det-info' },
        l.motivo ? h('p', { class: 'det-aviso' }, ic('relogio'), h('span', null, h('b', { text: 'Motivo de não sair hoje: ' }), l.motivo)) : null,
        l.transportadoraDiferente ? h('p', { class: 'det-aviso' }, ic('alerta'), h('span', null, 'A transportadora do SC9 é diferente da que consta na Entrega' + (l.transportadoraEntrega ? ' (' + l.transportadoraEntrega + ')' : '') + '.')) : null,
        h('p', { class: 'mudo peq', text: [l.armazem ? 'Armazém: ' + l.armazem : '', l.volumes != null ? plural(l.volumes, 'volume', 'volumes') : 'Volumes não informados'].filter(Boolean).join(' · ') })),
      l.id ? h('form', { class: 'det-rast', onsubmit: (ev) => { ev.preventDefault(); salvarRastreio(l, f.cod.value, f.link.value, msg, salvarBtn); } },
        h('h4', null, ic('pino'), 'Rastreio da transportadora'),
        h('p', { class: 'mudo peq', text: 'Cole aqui o código ou o link que a transportadora passou. Se colar o link no campo do código, a gente separa para você.' }),
        h('div', { class: 'det-campos' }, h('div', null, h('label', { class: 'rotulo', for: 'rast-' + k, text: 'Código' }), f.cod), h('div', null, h('label', { class: 'rotulo', for: 'rastl-' + k, text: 'Link' }), f.link)),
        h('div', { class: 'det-botoes' }, salvarBtn, r.link ? h('a', { class: 'btn peq', href: r.link, target: '_blank', rel: 'noopener noreferrer' }, ic('externo'), 'Abrir link') : null, msg)) : h('p', { class: 'mudo peq', text: 'O rastreio fica disponível depois que a expedição recebe o pedido.' }))));
  }
  async function salvarRastreio(l, codigo, link, msg, btn) {
    let cod = String(codigo || '').trim(), lk = String(link || '').trim();
    const m = cod.match(/https?:\/\/\S+/i); if (m && !lk) { lk = m[0]; cod = cod.replace(m[0], '').trim(); }
    const erro = (t) => { msg.className = 'rast-msg erro-t'; msg.textContent = t; };
    if (lk && !/^https:\/\//i.test(lk)) return erro('O link precisa começar com https://');
    if (cod.length > 80 || lk.length > 300) return erro('Texto grande demais. Confira o que colou.');
    btn.disabled = true; msg.className = 'rast-msg'; msg.textContent = 'Salvando…';
    try {
      const j = await api('/api/expedicao/rastreio', { method: 'POST', corpo: { id: l.id, dia: l.dia, codigo: cod, link: lk } });
      const novo = j && j.rastreio !== undefined ? j.rastreio : (cod || lk ? { codigo: cod, link: lk } : null);
      l.rastreio = novo && (novo.codigo || novo.link) ? { codigo: novo.codigo || '', link: novo.link || '' } : null;
      C.toast(l.rastreio ? 'Rastreio guardado.' : 'Rastreio removido.');
      if (estado.painel) { const t = estado.painel.totais; cache.kpis = ''; cache.transp = ''; t.comRastreio = Math.max(0, (t.comRastreio || 0)); }
      cache.tabela = ''; renderTabela(); carregarPainel().then(() => { renderKpis(); renderTransp(); });
    } catch (e) { if (!seSessaoCaiu(e)) { btn.disabled = false; erro(e.message); } }
  }
  function linhaPedido(l) {
    const k = chaveLinha(l), aberto = estado.expandido.has(k), sit = SIT[l.situacao] || { tom: 'azul' };
    const tr = h('tr', { class: 'linha tom-' + sit.tom + (aberto ? ' aberta' : '') },
      h('th', { scope: 'row', class: 'c-ped', 'data-label': 'Pedido' }, h('button', { type: 'button', class: 'abre-linha', 'aria-expanded': String(aberto), 'aria-label': (aberto ? 'Fechar' : 'Abrir') + ' detalhes do pedido ' + l.pedido, onclick: () => alternarLinha(l, false) }, ic('chevron'), h('b', { class: 'num', text: l.pedido })), h('span', { class: 'sub num', text: dm(l.dia) })),
      celula('Nota', celNota(l)),
      celula('Cliente', h('span', { class: 'cli', text: l.cliente || 'Cliente não informado' }), l.armazem ? h('span', { class: 'sub', text: l.armazem }) : null),
      celula('Transportadora', h('span', { text: l.transportadora || '—' }), h('span', { class: 'sub' }, l.volumes == null ? 'volumes não informados' : plural(l.volumes, 'volume', 'volumes')), l.transportadoraDiferente ? h('span', { class: 'sub alerta-t', title: 'A transportadora do SC9 é diferente da que consta na Entrega' }, 'diferente da Entrega') : null),
      celula('Desceu', celDesceu(l)),
      celula('Recebido', celRecebido(l)),
      celula('Saída', l.dataEntrega ? h('b', { class: 'num', text: dataCurta(l.dataEntrega) }) : h('span', { class: 'mudo peq', text: '—' })),
      celula('Tempo', celTempo(l)),
      celula('Situação', seloSit(l.situacao), l.motivo && l.situacao === 'nao_sai_hoje' ? h('span', { class: 'sub', text: l.motivo }) : null),
      celula('Rastreio', celRastreio(l)));
    return aberto ? [tr, detalhe(l)] : [tr];
  }
  function renderTabela() {
    const pd = estado.pedidos, f = estado.filtro;
    if (!ui.tabCorpo) return;
    atualizarSelectTransp();
    const filtrando = Boolean(f.q.trim() || f.situacao || f.transportadora || f.dia);
    const chaves = { pd, f, ex: Array.from(estado.expandido), c: estado.carregandoPedidos, e: estado.erroPedidos, k: cache.tabela };
    if (cache.tabela === '') { cache.tabelaK = ''; }
    const ativo = doc.activeElement;
    if (ativo && ui.tabCorpo.contains(ativo) && /^(INPUT|TEXTAREA)$/.test(ativo.tagName) && cache.tabelaK !== 'forca') { if (cache.tabelaChave && JSON.stringify({ pd }) === cache.tabelaPd) return; }
    cache.tabelaPd = JSON.stringify({ pd });
    cache.tabela = 'x';
    const chave = JSON.stringify(chaves);
    if (cache.tabelaChave === chave) return; cache.tabelaChave = chave;
    // resumo do filtro (chips)
    const chips = [];
    if (f.dia) chips.push(['Dia ' + dm(f.dia), () => filtrarTabela({ dia: '' }, false)]);
    if (f.transportadora) chips.push([f.transportadora, () => filtrarTabela({ transportadora: '' }, false)]);
    if (f.situacao) chips.push([(SIT[f.situacao] || {}).t || f.situacao, () => filtrarTabela({ situacao: '' }, false)]);
    if (f.q.trim()) chips.push(['"' + f.q.trim() + '"', () => filtrarTabela({ q: '' }, false)]);
    ui.chips.replaceChildren(...chips.map(([t, fn]) => h('button', { type: 'button', class: 'chip-f', onclick: fn, 'aria-label': 'Tirar o filtro ' + t }, t, ic('fechar'))));
    let corpo;
    if (estado.erroPedidos && !pd) corpo = h('div', { class: 'erro erro-bloco', role: 'alert' }, h('div', { class: 'linha-erro' }, ic('alerta'), estado.erroPedidos), botao('Tentar de novo', { class: 'btn peq', onclick: () => { estado.carregandoPedidos = true; estado.erroPedidos = ''; renderTabela(); carregarPedidos().then(renderTabela); } }, ic('atualizar')));
    else if (!pd) corpo = h('div', { class: 'esq-tab', role: 'status', 'aria-label': 'Carregando pedidos' }, Array.from({ length: 6 }, () => h('div', { class: 'esqueleto', style: 'height:56px;border-radius:14px' })));
    else if (!pd.linhas.length) corpo = C.vazio(filtrando ? 'busca' : 'caixaEntrada', filtrando ? 'Nenhum pedido com esses filtros' : 'Nenhum pedido neste período', filtrando ? 'Confira a escrita ou tire algum filtro. A busca olha o número do pedido, a nota e o nome do cliente.' : 'Os pedidos aparecem aqui quando o estoque desce ou a expedição recebe.');
    else {
      const total = pd.total, pg = pd.pagina || f.pagina, paginas = Math.max(1, Math.ceil(total / LIMITE)), ini = (pg - 1) * LIMITE + 1, fim = Math.min(total, ini + pd.linhas.length - 1);
      corpo = [h('div', { class: 'tabela-rolagem tab-ped' + (estado.carregandoPedidos ? ' atualizando' : '') }, h('table', { class: 'tabela tab-pedidos' }, h('caption', { class: 'sr', text: 'Pedidos do período, do mais recente para o mais antigo' }),
        h('colgroup', null, [9.5, 9.5, 14, 10.5, 9, 11, 5.5, 10, 10.5, 10.5].map((w) => h('col', { style: 'width:' + w + '%' }))),
        h('thead', null, h('tr', null, ['Pedido', 'Nota', 'Cliente', 'Transportadora', 'Desceu', 'Recebido', 'Saída', 'Tempo', 'Situação', 'Rastreio'].map((x) => h('th', { scope: 'col', text: x })))),
        h('tbody', null, pd.linhas.map(linhaPedido)))),
      h('nav', { class: 'paginacao', 'aria-label': 'Páginas da tabela' }, h('span', { class: 'mudo peq', text: 'Mostrando ' + num(ini) + ' a ' + num(fim) + ' de ' + num(total) }),
        h('div', { class: 'pag-bot' }, botao('Anterior', { class: 'btn peq', disabled: pg <= 1, onclick: () => irPagina(pg - 1) }, ic('esq')), h('span', { class: 'pag-n num', text: pg + ' de ' + paginas }), botao('Próxima', { class: 'btn peq', disabled: pg >= paginas, onclick: () => irPagina(pg + 1) }, ic('dir'))))];
    }
    ui.tabCorpo.replaceChildren(...[].concat(corpo));
    ui.resumoFiltro.textContent = pd ? num(pd.total) + (pd.total === 1 ? ' pedido' : ' pedidos') + (filtrando ? ' com os filtros' : ' no período') : '';
  }
  function irPagina(n) { estado.filtro.pagina = n; estado.carregandoPedidos = true; renderTabela(); carregarPedidos().then(() => { renderTabela(); ui.tabCabeca.scrollIntoView({ block: 'start', behavior: REDUZ ? 'auto' : 'smooth' }); }); }

  /* ---------- erro e vazios gerais ---------- */
  function renderErro() {
    const mostra = estado.erro && !estado.painel;
    peca('erro', ui.erro, { m: estado.erro, f: estado.falhouAtualizar, c: estado.painel && estado.painel.entregaPossivelmenteCortada }, () => {
      if (mostra) return h('div', { class: 'card erro-tela', role: 'alert' }, C.vazio('atualizar', 'Não consegui carregar o painel', estado.erro), botao('Tentar de novo', { class: 'btn primario', onclick: () => { estado.erro = ''; estado.carregando = true; recarregar(false); } }, ic('atualizar')));
      if (estado.painel && estado.painel.entregaPossivelmenteCortada) return h('div', { class: 'aviso', role: 'status' }, ic('alerta'), 'A planilha de Entrega carregada por último tem bem menos pedidos' + (estado.painel.pedidosNaEntregaAnterior ? ' (' + num(estado.painel.pedidosNaEntrega) + ' contra ' + num(estado.painel.pedidosNaEntregaAnterior) + ' da anterior)' : '') + '. Pode ter vindo cortada: confira antes de trazer o mês.');
      if (estado.falhouAtualizar) return h('div', { class: 'aviso', role: 'status' }, ic('alerta'), 'Não consegui atualizar agora. Você está vendo os dados da última vez que deu certo. ', h('button', { type: 'button', class: 'link-botao', onclick: () => recarregar(true), text: 'Tentar de novo' }));
      return null;
    });
  }

  /* ---------- trazer da planilha de Entrega ---------- */
  function faixaImport() { const pn = estado.painel, base = (pn && pn.mes && pn.mes.base) || hoje().slice(0, 7), de = base + '-01', fim = fimMes(de), ate = fim < hoje() ? fim : hoje(); return { de, ate, base }; }
  const faltaImportar = (pn) => Boolean(pn && pn.podeImportar && (pn.totais.recebidos === 0 || pn.totais.saiuSemRecebimento > 0));
  async function simular() {
    const im = estado.imp, f = faixaImport(); im.fase = 'simulando'; im.erro = ''; renderImport();
    try { im.sim = await api('/api/expedicao/importar-entrega', { method: 'POST', corpo: { de: f.de, ate: f.ate, simular: true } }); im.fase = 'simulado'; } catch (e) { if (seSessaoCaiu(e)) return; im.erro = e.message; im.fase = 'erro'; }
    renderImport();
  }
  async function confirmarImport() {
    const im = estado.imp, f = faixaImport(); im.fase = 'gravando'; im.erro = ''; im.passo = 0; renderImport();
    const rolo = root.setInterval(() => { im.passo = Math.min(3, im.passo + 1); const p = doc.getElementById('imp-passo'); if (p) p.textContent = PASSOS[im.passo]; }, 900);
    try { im.res = await api('/api/expedicao/importar-entrega', { method: 'POST', corpo: { de: f.de, ate: f.ate, simular: false } }); im.fase = 'pronto'; estado.animado = true; await Promise.all([carregarPainel(), carregarPedidos()]); } catch (e) { if (seSessaoCaiu(e)) { root.clearInterval(rolo); return; } im.erro = e.message; im.fase = 'erro'; }
    root.clearInterval(rolo); renderImport(); renderTudo();
  }
  const PASSOS = ['Lendo a planilha de Entrega…', 'Casando cada pedido com o SC9…', 'Gravando no recebimento…', 'Conferindo o resultado…'];
  function minibarras(lista, rot, max) {
    const topo = Math.max(1, ...lista.map((x) => x.novos));
    return h('ul', { class: 'imp-barras' }, lista.slice(0, max).map((x) => h('li', null, h('span', { class: 'ib-nome', text: rot(x) }), h('span', { class: 'ib-trilho' }, h('i', { style: 'width:' + Math.max(4, (x.novos / topo) * 100) + '%' })), h('b', { class: 'num', text: num(x.novos) }))));
  }
  function renderImport() {
    const pn = estado.painel, im = estado.imp, f = faixaImport();
    const visivel = !TV && pn && pn.podeImportar && (im.aberto || faltaImportar(pn) || im.fase === 'pronto') && !(im.fechado && im.fase === 'ocioso' && !im.aberto);
    peca('imp', ui.import, { v: visivel, fase: im.fase, sim: im.sim, res: im.res, erro: im.erro, f, falta: pn && pn.totais && pn.totais.saiuSemRecebimento, rec: pn && pn.totais && pn.totais.recebidos }, () => {
      if (!visivel) return null;
      const mes = nomeMes(f.de), destaque = faltaImportar(pn) && im.fase === 'ocioso';
      const cab = (titulo, sub, icone) => h('div', { class: 'imp-cab' }, h('span', { class: 'imp-orbe' }, ic(icone || 'planilha')), h('div', null, h('h2', { text: titulo }), sub ? h('p', { text: sub }) : null));
      let corpo;
      if (im.fase === 'ocioso') corpo = [cab('Trazer ' + mes + ' da planilha de Entrega', pn.totais.saiuSemRecebimento ? plural(pn.totais.saiuSemRecebimento, 'pedido está', 'pedidos estão') + ' na planilha de Entrega sem recebimento. Dá para trazer tudo de uma vez: cada pedido entra como recebido e já saído.' : pn.totais.recebidos === 0 ? 'Este mês ainda não tem recebimentos. Dá para preencher tudo a partir da planilha de Entrega que já está no SC9.' : 'Confira se algum pedido da planilha de Entrega ainda não entrou no painel.'),
        h('p', { class: 'imp-seguro' }, ic('cadeado'), 'Primeiro mostramos o que vai entrar. Só gravamos depois que você confirmar, e nada é apagado nem duplicado.'),
        h('div', { class: 'imp-acoes' }, botao('Ver o que vai entrar', { class: 'btn primario', onclick: simular }, ic('busca')), !destaque || im.aberto ? botao('Fechar', { class: 'btn fantasma', onclick: () => { im.aberto = false; im.fechado = true; renderImport(); } }) : null)];
      else if (im.fase === 'simulando') corpo = [cab('Conferindo a planilha…', 'Estamos só contando, ainda não gravamos nada.'), h('div', { class: 'imp-progresso', role: 'status' }, h('i', null))];
      else if (im.fase === 'simulado') {
        const s = im.sim || {}, vazio = !s.novos;
        corpo = [cab(vazio ? 'Nada novo para trazer' : 'Pronto para trazer', vazio ? 'Tudo o que está na planilha de Entrega deste período já está no painel.' : null, vazio ? 'okCirculo' : 'planilha'),
          vazio ? null : h('p', { class: 'imp-frase' }, 'Vão entrar ', h('b', { text: plural(s.novos, 'pedido', 'pedidos') }), ' de ', h('b', { text: plural((s.porDia || []).length, 'dia', 'dias') }), ', de ', h('b', { text: plural((s.porTransportadora || []).length, 'transportadora', 'transportadoras') }), '. ', h('b', { text: num(s.jaExistiam) }), s.jaExistiam === 1 ? ' já existia e não será repetido.' : ' já existiam e não serão repetidos.'),
          h('div', { class: 'imp-numeros' }, [['Vão entrar', s.novos, 'destaque'], ['Já existiam', s.jaExistiam, ''], ['Confirmados na Entrega', s.confirmados, ''], ['Sem dados no SC9', s.semInfoSC9, s.semInfoSC9 ? 'aviso-n' : '']].map(([t, v, c]) => h('div', { class: 'imp-n ' + c }, h('b', { class: 'num', text: num(v) }), h('span', { text: t })))),
          s.semInfoSC9 ? h('p', { class: 'mudo peq' }, plural(s.semInfoSC9, 'pedido entra', 'pedidos entram') + ' mesmo sem cliente ou nota, porque o SC9 não tem esses dados. Eles se completam sozinhos quando o SC9 for carregado de novo.') : null,
          vazio ? null : h('div', { class: 'imp-graf' }, h('div', null, h('h3', { text: 'Por transportadora' }), minibarras(s.porTransportadora || [], (x) => x.nome, 5)), h('div', null, h('h3', { text: 'Por dia' }), minibarras((s.porDia || []).slice().sort((a, b) => b.novos - a.novos), (x) => dm(x.dia), 5))),
          s.anteriores ? h('p', { class: 'mudo peq', text: plural(s.anteriores, 'pedido já constava com saída antes de ser recebido', 'pedidos já constavam com saída antes de serem recebidos') + '. É só um aviso, nada muda neles.' }) : null,
          s.baseEntregaEm ? h('p', { class: 'mudo peq', text: 'Planilha de Entrega carregada em ' + C.dataHora(s.baseEntregaEm) + '.' }) : null,
          h('div', { class: 'imp-acoes' }, vazio ? botao('Fechar', { class: 'btn primario', onclick: () => { im.aberto = false; im.fase = 'ocioso'; im.fechado = true; renderImport(); } }) : [botao('Trazer ' + plural(s.novos, 'pedido', 'pedidos'), { class: 'btn verde', onclick: confirmarImport }, ic('ok')), botao('Cancelar', { class: 'btn fantasma', onclick: () => { im.fase = 'ocioso'; im.sim = null; renderImport(); } })])];
      } else if (im.fase === 'gravando') corpo = [cab('Trazendo os pedidos…', 'Não feche esta tela. Leva alguns segundos.'), h('div', { class: 'imp-progresso real', role: 'progressbar', 'aria-label': 'Gravando os pedidos' }, h('i', null)), h('p', { class: 'imp-passo', id: 'imp-passo', role: 'status', text: PASSOS[estado.imp.passo || 0] })];
      else if (im.fase === 'pronto') {
        const r = im.res || {}, g = r.gravados, n = typeof g === 'number' ? g : g && typeof g === 'object' && g.novos != null ? g.novos : r.novos || 0;
        corpo = [h('div', { class: 'imp-pronto' }, h('span', { class: 'selo-ok' }, ic('ok')), h('h2', { text: n ? 'Pronto! ' + plural(n, 'pedido entrou', 'pedidos entraram') + ' no painel' : 'Tudo certo, nada novo para trazer' }), h('p', { class: 'mudo', text: 'O painel já foi atualizado. Se rodar de novo, nenhum pedido se repete.' }),
          h('div', { class: 'imp-acoes centro' }, botao('Ver o painel', { class: 'btn primario', onclick: () => { im.aberto = false; im.fase = 'ocioso'; im.sim = null; im.res = null; im.fechado = true; renderImport(); } })))];
      } else corpo = [cab('Não deu para trazer agora', null, 'alerta'), h('div', { class: 'erro', role: 'alert' }, ic('alerta'), im.erro || 'Algo deu errado.'), h('div', { class: 'imp-acoes' }, botao('Tentar de novo', { class: 'btn primario', onclick: simular }, ic('atualizar')), botao('Fechar', { class: 'btn fantasma', onclick: () => { im.fase = 'ocioso'; im.aberto = false; renderImport(); } }))];
      return h('section', { class: 'card imp-card' + (destaque ? ' destaque' : '') + ' fase-' + im.fase, 'aria-live': 'polite' }, corpo);
    });
  }

  /* ---------- exportar: manifesto da transportadora ---------- */
  function abrirExportar() {
    estado.exp.aberta = true; const antes = doc.activeElement;
    const x = estado.exp, pn = estado.painel, nomes = ((pn && pn.transportadoras) || []).map((g) => g.nome);
    const fundo = h('div', { class: 'gaveta-fundo abre', onclick: () => fechar() });
    const sel = h('select', { id: 'x-tr', class: 'entrada', onchange: (ev) => { x.transportadora = ev.target.value; } }, h('option', { value: '', text: 'Todas (uma aba para cada)' }), ...nomes.map((n) => h('option', { value: n, text: n, selected: n === x.transportadora })));
    const chk = h('input', { id: 'x-pend', type: 'checkbox', checked: x.soPendentes || null, onchange: (ev) => { x.soPendentes = ev.target.checked; } });
    const msg = h('p', { class: 'rast-msg', role: 'status' });
    const bExcel = h('button', { type: 'button', class: 'btn primario', onclick: () => gerarManifesto('xlsx', msg, [bExcel, bCsv]) }, ic('planilha'), 'Baixar Excel');
    const bCsv = h('button', { type: 'button', class: 'btn', onclick: () => gerarManifesto('csv', msg, [bExcel, bCsv]) }, ic('baixar'), 'Baixar CSV');
    const p = estado.periodo;
    const painel = h('aside', { class: 'gaveta abre exp-gaveta', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'x-t' },
      h('div', { class: 'gaveta-cab' }, h('div', null, h('h3', { id: 'x-t', text: 'Manifesto da transportadora' }), h('p', { class: 'mudo peq', text: 'Planilha com os pedidos de cada transportadora, dia a dia, para passar para ela conferir.' })), h('button', { type: 'button', class: 'btn peq fantasma', 'aria-label': 'Fechar', onclick: () => fechar() }, ic('fechar'))),
      h('div', { class: 'gaveta-corpo' },
        h('div', null, h('label', { class: 'rotulo', for: 'x-tr', text: 'Transportadora' }), sel),
        h('div', { class: 'x-periodo' }, ic('calendario'), h('span', null, h('b', { text: periodoTexto(p.de, p.ate) }), h('small', { text: ' Muda no período lá em cima.' }))),
        h('label', { class: 'troca', for: 'x-pend' }, chk, h('span', { class: 'troca-trilho' }, h('i')), h('span', null, h('b', { text: 'Só o que ainda falta sair' }), h('small', { text: 'Tira da lista o que já saiu na planilha de Entrega.' }))),
        h('div', { class: 'x-botoes' }, bExcel, bCsv), msg));
    const fechar = () => { fundo.remove(); painel.remove(); doc.removeEventListener('keydown', tecla); x.aberta = false; if (antes && antes.focus) antes.focus(); };
    const tecla = (ev) => {
      if (ev.key === 'Escape') fechar();
      if (ev.key === 'Tab') { const f = Array.from(painel.querySelectorAll('button, select, input, a[href]')).filter((e) => !e.disabled); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (ev.shiftKey && doc.activeElement === a) { ev.preventDefault(); z.focus(); } else if (!ev.shiftKey && doc.activeElement === z) { ev.preventDefault(); a.focus(); } }
    };
    doc.addEventListener('keydown', tecla); doc.body.append(fundo, painel); sel.focus();
  }
  async function gerarManifesto(tipo, msg, botoes) {
    const x = estado.exp, p = estado.periodo;
    botoes.forEach((b) => { b.disabled = true; }); msg.className = 'rast-msg'; msg.textContent = tipo === 'xlsx' ? 'Montando o Excel…' : 'Montando o CSV…';
    try {
      const dados = await api('/api/expedicao/exportar?' + qs({ de: p.de, ate: p.ate, transportadora: x.transportadora, somentePendentes: x.soPendentes ? '1' : '0' }));
      if (!dados.linhas || !dados.linhas.length) { msg.className = 'rast-msg'; msg.textContent = x.soPendentes ? 'Não há pedidos pendentes neste filtro. Tudo já saiu.' : 'Não há pedidos neste filtro.'; return; }
      const nome = 'manifesto-' + (x.transportadora ? x.transportadora.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'todas') + '-' + p.de + (p.de === p.ate ? '' : '_a_' + p.ate);
      if (tipo === 'xlsx') await root.SC9ExpedicaoXlsx.baixarExcel(dados, { periodoTexto: periodoTexto(p.de, p.ate), soPendentes: x.soPendentes }, nome + '.xlsx');
      else root.SC9ExpedicaoXlsx.baixarCsv(dados, nome + '.csv');
      msg.className = 'rast-msg ok-t'; msg.textContent = 'Pronto: ' + plural(dados.linhas.length, 'pedido', 'pedidos') + ' no arquivo.'; C.toast('Arquivo ' + nome + (tipo === 'xlsx' ? '.xlsx' : '.csv') + ' baixado.');
    } catch (e) { if (!seSessaoCaiu(e)) { msg.className = 'rast-msg erro-t'; msg.textContent = e.message; } } finally { botoes.forEach((b) => { b.disabled = false; }); }
  }

  /* ---------- copiar resumo do dia ---------- */
  async function copiarResumo() {
    try {
      const hj = hoje(), j = await api('/api/expedicao/painel?' + qs({ de: hj, ate: hj })), t = j.totais;
      const linhas = ['Expedição · ' + DIA_LONGO[dow(hj)] + ', ' + dmy(hj),
        'Desceram do estoque: ' + t.desceram + ' | Recebidos: ' + t.recebidos + ' | Saíram: ' + t.saiuEntrega + ' | Faltam sair: ' + faltam(t),
        'Volumes recebidos: ' + num(t.volumes)];
      if ((j.transportadoras || []).length) { linhas.push('', 'Por transportadora:'); for (const g of j.transportadoras) linhas.push('- ' + g.nome + ': ' + g.recebidos + ' recebidos, ' + g.saiu + ' saíram' + (g.pendentes ? ', ' + g.pendentes + ' faltam sair' : '') + ', ' + num(g.volumes) + ' volumes'); }
      const aten = []; if (t.desceuNaoRecebido) aten.push(plural(t.desceuNaoRecebido, 'pedido desceu e ainda não foi recebido', 'pedidos desceram e ainda não foram recebidos')); if (t.naoSaiHoje) aten.push(plural(t.naoSaiHoje, 'pedido não sai hoje', 'pedidos não saem hoje')); if (t.saiuSemRecebimento) aten.push(plural(t.saiuSemRecebimento, 'pedido saiu sem passar pelo recebimento', 'pedidos saíram sem passar pelo recebimento'));
      if (aten.length) linhas.push('', 'Atenção:', ...aten.map((a) => '- ' + a));
      if (!t.desceram && !t.recebidos && !t.saiuEntrega) linhas.push('', 'Ainda não há movimento registrado hoje.');
      await C.copiar(linhas.join('\n'), 'Resumo do dia copiado. É só colar no WhatsApp ou no e-mail.');
    } catch (e) { if (!seSessaoCaiu(e)) C.toast('Não consegui montar o resumo agora. ' + e.message, 'erro'); }
  }

  /* ---------- bipar pedido recebido (quem tem acesso "Recebimento") ---------- */
  async function carregarPodeReceber() {
    try { const j = await api('/api/recebimento'); estado.bipe.pode = Boolean(j.podeReceber); estado.bipe.totalHoje = (j.entries || []).length; } catch (e) { estado.bipe.pode = false; }
  }
  const celularPequeno = () => Boolean(root.matchMedia && root.matchMedia('(pointer: coarse) and (max-width: 700px)').matches);
  function focarBipe() { if (ui.bipeCampo && !celularPequeno()) ui.bipeCampo.focus({ preventScroll: true }); }
  function montarBipe() {
    ui.bipeCampo = h('input', { id: 'bipe', class: 'bipe-campo', type: 'text', inputmode: 'numeric', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'send', placeholder: 'Leia o código ou digite o pedido', 'aria-label': 'Número do pedido para receber' });
    ui.bipeBotao = h('button', { type: 'submit', class: 'btn verde bipe-ok' }, ic('ok'), 'Receber');
    ui.bipeAviso = h('p', { class: 'bipe-aviso', role: 'status', 'aria-live': 'polite' });
    ui.bipeRes = h('div', { class: 'bipe-res' });
    ui.bipeContador = h('div', { class: 'bipe-contador', title: 'Pedidos recebidos hoje pela expedição' });
    ui.bipeLista = h('section', { class: 'card bipe-lista', 'aria-labelledby': 'bl-t' });
    const form = h('form', { class: 'bipe-form', autocomplete: 'off', onsubmit: (ev) => { ev.preventDefault(); const v = ui.bipeCampo.value; ui.bipeCampo.value = ''; bipar(v); } }, h('span', { class: 'bipe-ic' }, ic('bipe')), ui.bipeCampo, ui.bipeBotao);
    ui.bipeCard = h('section', { class: 'card bipe-hero', 'aria-labelledby': 'bipe-t' },
      h('div', { class: 'bipe-cab' }, h('div', null, h('h2', { id: 'bipe-t', text: 'Bipar pedido recebido' }), h('p', { text: 'Passe o leitor no código de barras ou digite o número e aperte Enter. A tela fica pronta para o próximo.' })), ui.bipeContador),
      form, ui.bipeAviso, ui.bipeRes);
    renderBipeContador();
    return h('div', { class: 'bipe-grade' }, ui.bipeCard, ui.bipeLista);
  }
  function renderBipeContador() {
    if (!ui.bipeContador) return;
    ui.bipeContador.replaceChildren(h('b', { class: 'num', text: num(estado.bipe.totalHoje) }), h('span', { text: estado.bipe.totalHoje === 1 ? 'recebido hoje' : 'recebidos hoje' }));
  }
  function avisoBipe(texto, tom) { ui.bipeAviso.className = 'bipe-aviso ' + (tom || ''); ui.bipeAviso.textContent = texto || ''; }
  async function bipar(valor) {
    const b = estado.bipe; if (b.ocupado) return;
    const ped = String(valor || '').replace(/\D/g, '').replace(/^0+/, '');
    if (ped.length < 4 || ped.length > 10) { avisoBipe(ped ? 'Esse número não parece um pedido. Leia o código de novo ou digite de 4 a 10 números.' : 'Leia o código de barras ou digite o número do pedido.', 'laranja'); focarBipe(); return; }
    b.ocupado = true; ui.bipeBotao.disabled = true; ui.bipeCard.classList.add('ocupado'); avisoBipe('Recebendo o pedido ' + ped + '…', '');
    try {
      const j = await api('/api/recebimento/bipar', { method: 'POST', corpo: { pedido: ped } });
      b.totalHoje = j.totalHoje != null ? j.totalHoje : b.totalHoje + 1; b.recebidosAgora.add(ped);
      b.res = { tipo: 'ok', ped, entry: j.entry || {}, info: (j.entry && j.entry.info) || j.info || null, desceu: j.desceu || (j.entry && j.entry.desceu) || null, tempos: j.tempos || null, volumes: j.entry ? j.entry.volumes : null, chave: Date.now() };
      avisoBipe('Pedido ' + ped + ' recebido.', 'verde');
      carregarPainel().then(() => { renderTudo(); }); carregarPedidos().then(renderTabela);
    } catch (e) {
      if (seSessaoCaiu(e)) { b.ocupado = false; return; }
      if (e.status === 409 && e.dados && e.dados.error === 'duplicado') { b.res = { tipo: 'dup', ped, entry: e.dados.duplicado || {}, info: e.dados.info || (e.dados.duplicado && e.dados.duplicado.info) || null, chave: Date.now() }; avisoBipe('', ''); }
      else { b.res = { tipo: 'erro', ped, msg: e.message, chave: Date.now() }; avisoBipe('', ''); }
    }
    b.ocupado = false; ui.bipeBotao.disabled = false; ui.bipeCard.classList.remove('ocupado');
    renderBipeContador(); renderBipeRes(); renderBipeLista(); focarBipe();
  }
  const dataDoDia = (iso) => (iso && C.diaSP(iso) === hoje() ? 'hoje' : iso ? 'em ' + C.curta(iso) : '');
  function blocoTempo(r) {
    const d = r.desceu, min = r.tempos && r.tempos.minutosDesceuAteReceber != null ? r.tempos.minutosDesceuAteReceber : (d && d.status === 'ok' && d.saidaEm && r.entry.recebidoEm ? Math.max(0, Math.round((new Date(r.entry.recebidoEm) - new Date(d.saidaEm)) / 60000)) : null);
    const desceuEm = (r.tempos && r.tempos.desceuEm) || (d && d.saidaEm);
    if (!desceuEm || (d && d.status === 'sem_saida') || min == null) return h('div', { class: 'tempo-faixa suave' }, ic('info'), h('div', null, h('b', { text: 'Ainda não desceu pelo estoque' }), h('span', { text: 'Foi recebido mesmo assim. Quando o estoque registrar a saída, o tempo aparece no painel.' })));
    const tom = tomTempo(min), hh = C.horaBR(desceuEm), quem = d && d.saidaPor ? ' por ' + primeiroNome(d.saidaPor) : '';
    return h('div', { class: 'tempo-faixa ' + tom, role: 'status' }, ic(tom === 'verde' ? 'okCirculo' : tom === 'ambar' ? 'relogio' : 'alerta'), h('div', null,
      h('b', { text: min < 1 ? 'Recebido na hora' : 'Ficou ' + fmtMin(min) + ' lá embaixo' }), h('span', { text: 'Desceu ' + (C.diaSP(desceuEm) === hoje() ? '' : 'em ' + C.curta(desceuEm) + ' ') + 'às ' + hh + quem + ' · foi recebido ' + (min < 1 ? 'em seguida' : fmtMin(min) + ' depois') })));
  }
  async function guardarVolumes(r, valor, msg, botoes) {
    const v = String(valor == null ? '' : valor).trim();
    if (v && (!/^\d{1,3}$/.test(v) || Number(v) < 1)) { msg.className = 'rast-msg erro-t'; msg.textContent = 'Volumes: digite um número de 1 a 999.'; return; }
    if (!r.entry.id) return;
    botoes.forEach((x) => { x.disabled = true; }); msg.className = 'rast-msg'; msg.textContent = 'Guardando…';
    try {
      await api('/api/recebimento/atualizar', { method: 'POST', corpo: { id: r.entry.id, volumes: v ? Number(v) : null } });
      r.volumes = v ? Number(v) : null; renderBipeRes(); focarBipe(); carregarPainel().then(() => { renderKpis(); renderTransp(); });
      const t = ui.bipeRes.querySelector('.vol-salvo'); if (t) t.classList.add('pop');
    } catch (e) { if (!seSessaoCaiu(e)) { botoes.forEach((x) => { x.disabled = false; }); msg.className = 'rast-msg erro-t'; msg.textContent = e.message; } }
  }
  function blocoVolumes(r) {
    if (r.volumes) return h('div', { class: 'vol-salvo' }, ic('caixaEntrada'), h('span', null, h('b', { text: plural(r.volumes, 'volume', 'volumes') }), ' guardados'), h('button', { type: 'button', class: 'link-botao', onclick: () => { r.volumes = null; renderBipeRes(); const c = doc.getElementById('vol'); if (c) c.focus(); }, text: 'Mudar' }));
    const msg = h('p', { class: 'rast-msg', role: 'status' });
    const campo = h('input', { id: 'vol', class: 'entrada vol-campo', type: 'text', inputmode: 'numeric', maxlength: '3', placeholder: 'Quantos?', autocomplete: 'off', 'aria-label': 'Quantidade de volumes (opcional)' });
    const botoes = [];
    const chips = [1, 2, 3, 4, 5].map((n) => { const b = h('button', { type: 'button', class: 'chip-vol', 'aria-label': n + (n === 1 ? ' volume' : ' volumes'), onclick: () => guardarVolumes(r, n, msg, botoes) }, String(n)); botoes.push(b); return b; });
    const ok = h('button', { type: 'button', class: 'btn peq', onclick: () => guardarVolumes(r, campo.value, msg, botoes) }, 'Guardar'); botoes.push(ok);
    campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); if (campo.value.trim()) guardarVolumes(r, campo.value, msg, botoes); else focarBipe(); } });
    return h('div', { class: 'vol-bloco' }, h('label', { class: 'rotulo', for: 'vol', text: 'Volumes (se quiser anotar agora)' }), h('div', { class: 'vol-linha' }, h('div', { class: 'chips-vol' }, chips), campo, ok), msg);
  }
  function renderBipeRes() {
    const r = estado.bipe.res; if (!ui.bipeRes) return;
    if (!r) { ui.bipeRes.replaceChildren(h('div', { class: 'bipe-espera' }, ic('bipe'), h('span', { text: 'Aguardando o próximo pedido…' }))); return; }
    let el;
    if (r.tipo === 'ok') {
      const i = r.info || {}, nf = i.nf || (r.entry.info && r.entry.info.nf);
      const fato = (icone, rot, valor, extra) => h('div', { class: 'fato' }, ic(icone), h('div', null, h('span', { text: rot }), valor, extra || null));
      el = h('div', { class: 'res-bipe r-ok', key: r.chave },
        h('div', { class: 'res-topo' }, h('span', { class: 'selo-ok mini' }, ic('ok')), h('div', null, h('b', { class: 'res-t', text: 'Pedido recebido' }), h('span', { class: 'res-h', text: 'às ' + C.horaBR(r.entry.recebidoEm || new Date().toISOString()) + ' · ' + plural(estado.bipe.totalHoje, 'recebido hoje', 'recebidos hoje') })), h('b', { class: 'res-ped num', text: r.ped })),
        blocoTempo(r),
        h('div', { class: 'fatos' },
          fato('predio', 'Cliente', h('b', { text: i.cliente || 'Ainda sem cliente' })),
          fato('caminhao', 'Transportadora', h('b', { text: i.transportadora || 'Ainda sem transportadora' })),
          fato('lista', 'Linhas e peças', h('b', { text: i.linhas != null ? plural(i.linhas, 'linha', 'linhas') + ' · ' + plural(i.pecas || 0, 'peça', 'peças') : '—' })),
          fato('nota', 'Nota fiscal', nf ? h('b', { class: 'num', text: nf }) : h('b', { class: 'aguarda', title: 'A nota só aparece depois que o SC9 é carregado de novo.' }, 'Aguardando nota'))),
        !r.info ? h('p', { class: 'res-sem', role: 'note' }, ic('info'), 'O SC9 ainda não tem os dados deste pedido. Cliente, transportadora e nota aparecem sozinhos quando o SC9 for carregado de novo.') : (!nf ? h('p', { class: 'res-sem', role: 'note' }, ic('info'), 'A nota fiscal só existe depois que o SC9 é carregado de novo. Não precisa fazer nada: ela aparece sozinha.') : null),
        blocoVolumes(r));
    } else if (r.tipo === 'dup') {
      const e = r.entry || {}, i = r.info || e.info || {};
      el = h('div', { class: 'res-bipe r-dup', key: r.chave }, h('div', { class: 'res-topo' }, h('span', { class: 'selo-ok mini info' }, ic('info')), h('div', null, h('b', { class: 'res-t', text: 'Este pedido já tinha sido recebido' }), h('span', { class: 'res-h', text: (e.recebidoEm ? 'Recebido ' + (C.diaSP(e.recebidoEm) === hoje() ? 'às ' + C.horaBR(e.recebidoEm) : 'em ' + C.dataHora(e.recebidoEm)) : '') + (e.recebidoPorNome ? ' por ' + primeiroNome(e.recebidoPorNome) : '') + '. Não foi contado de novo.' })), h('b', { class: 'res-ped num', text: r.ped })),
        i.cliente || i.transportadora ? h('p', { class: 'res-sub', text: [i.cliente, i.transportadora].filter(Boolean).join(' · ') }) : null);
    } else el = h('div', { class: 'res-bipe r-erro', key: r.chave, role: 'alert' }, h('div', { class: 'res-topo' }, h('span', { class: 'selo-ok mini erro' }, ic('alerta')), h('div', null, h('b', { class: 'res-t', text: 'Não consegui receber o pedido ' + r.ped }), h('span', { class: 'res-h', text: r.msg + ' Leia o código de novo.' }))));
    ui.bipeRes.replaceChildren(el);
  }
  function renderBipeLista() {
    if (!ui.bipeLista) return;
    const pn = estado.painel, b = estado.bipe;
    if (!pn) { peca('bipeLista', ui.bipeLista, 'esq', () => h('div', { class: 'esqueleto', style: 'height:100%;min-height:200px' })); return; }
    const todos = ((pn.pendencias || {}).desceuNaoRecebido || []).filter((x) => !b.recebidosAgora.has(x.pedido)), total = Math.max(0, totalPend(pn, 'desceuNaoRecebido') - ((pn.pendencias || {}).desceuNaoRecebido || []).filter((x) => b.recebidosAgora.has(x.pedido)).length);
    peca('bipeLista', ui.bipeLista, { t: todos.slice(0, 6), total, o: b.ocupado }, () => [
      h('div', { class: 'card-titulo' }, h('div', null, h('h2', { id: 'bl-t', text: 'Desceu e ainda não foi recebido' }), h('p', { class: 'mudo peq', text: total ? 'Toque em "Bipar" quando o pedido chegar na expedição.' : '' })), total ? h('span', { class: 'pend-cont', text: num(total) }) : null),
      total ? [h('ul', { class: 'bl-lista' }, todos.slice(0, 6).map((x) => { const tom = tomParado(Number(x.horasParado) || 0); return h('li', { class: 'tom-' + tom }, h('div', { class: 'bl-info' }, h('b', { class: 'num', text: x.pedido }), h('span', { text: x.cliente || 'Cliente não informado' }), h('small', { text: (x.transportadora || 'Sem transportadora') + ' · desceu há ' + parado(Number(x.horasParado) || 0) })), h('button', { type: 'button', class: 'btn peq', 'aria-label': 'Bipar o pedido ' + x.pedido, onclick: () => bipar(x.pedido) }, ic('bipe'), 'Bipar')); })),
        total > 6 ? h('button', { type: 'button', class: 'link-botao bl-mais', onclick: () => irParaPend('desceuNaoRecebido') }, 'Ver os outros ' + num(total - 6)) : null]
        : h('div', { class: 'pend-ok' }, h('span', { class: 'pend-ok-ic' }, ic('ok')), h('div', null, h('b', { text: 'Tudo o que desceu já foi recebido' }), h('p', { text: 'Quando o estoque descer um pedido novo, ele aparece aqui.' })))
    ]);
  }

  /* ---------- tempos (médias do período) ---------- */
  function renderTempos() {
    const pn = estado.painel; if (!ui.tempos) return;
    const t = pn && pn.totais;
    if (!t || (t.desceuAteReceberMediaMin === undefined && t.permanenciaMediaHoras === undefined)) { peca('tempos', ui.tempos, 'nada', () => null); return; }
    peca('tempos', ui.tempos, { a: t.desceuAteReceberMediaMin, b: t.desceuAteReceberP90Min, c: t.permanenciaMediaHoras, d: t.permanenciaP90Horas }, () => {
      const cartao = (icone, titulo, valor, tom, sub, dica) => h('div', { class: 'tempo-card ' + (valor == null ? 'neutro' : tom), title: dica }, h('span', { class: 'kpi-ic' }, ic(icone)), h('div', null, h('b', { class: 'tempo-nome', text: titulo }), h('span', { class: 'tempo-val num', text: valor == null ? '—' : valor }), h('span', { class: 'kpi-sub', text: sub }), valor == null ? null : h('span', { class: 'tempo-selo' }, ic(tom === 'verde' ? 'okCirculo' : tom === 'ambar' ? 'relogio' : 'alerta'), tom === 'verde' ? 'Rápido' : tom === 'ambar' ? 'Dentro do normal' : 'Demora, vale olhar')));
      const m1 = t.desceuAteReceberMediaMin, m2 = t.permanenciaMediaHoras;
      return [
        cartao('descer', 'Do estoque até o recebimento', m1 == null ? null : fmtMin(m1), m1 == null ? '' : tomTempo(m1), m1 == null ? 'ainda sem pedidos com hora de descida e de recebimento' : 'tempo médio · 9 em cada 10 chegam em até ' + fmtMin(Math.max(1, t.desceuAteReceberP90Min || 0)), 'Do momento em que o estoque desceu o pedido até a expedição bipar. Pedidos que vieram da planilha de Entrega não entram na conta.'),
        cartao('caminhao', 'Na expedição até sair', m2 == null ? null : fmtHoras(m2), m2 == null ? '' : tomPermanencia(m2), m2 == null ? 'ainda sem pedidos que saíram neste período' : 'tempo médio · 9 em cada 10 saem em até ' + fmtMin(Math.max(1, Math.round(Number(t.permanenciaP90Horas || 0) * 60))), 'Do recebimento até o pedido aparecer na planilha de Entrega. Pedidos que vieram da planilha não entram na conta.')
      ];
    });
  }

  /* ---------- montar a página ---------- */
  function renderTudo() {
    if (!ui.montada) return;
    atualizarSelo(); renderCabecalho(); renderErro(); renderImport(); renderBipeLista(); renderFunil(); renderKpis(); renderTempos(); renderGrafico(); renderTransp(); if (TV) pendTv(); else { renderPend(); renderTabela(); }
  }
  function telaLogin() {
    const l = estado.login, semAcesso = estado.sessao && estado.sessao.authed;
    return h('main', { class: 'pagina estreita' }, h('section', { class: 'card login-caixa' },
      h('div', { class: 'login-topo' }, C.vazio('caixa', '', null)), h('h2', { text: semAcesso ? 'Falta liberar o seu acesso' : EMBED ? 'Sua sessão expirou' : 'Entrar no Painel da Expedição' }),
      h('p', { class: 'mudo peq', style: 'margin:4px 0 14px', text: semAcesso ? 'Seu usuário não tem o acesso "Recebimento" nem "Despacho". Peça ao administrador para liberar, ou entre com outro usuário.' : EMBED ? 'Entre de novo no SC9 e volte para esta aba, ou entre aqui mesmo com o usuário e a senha do SC9 (o administrador deixa o usuário vazio).' : 'Use o usuário e a senha do SC9. O administrador deixa o usuário vazio.' }),
      h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); entrar(); } },
        h('div', null, h('label', { class: 'rotulo', for: 'u', text: 'Usuário' }), h('input', { id: 'u', class: 'entrada', value: l.usuario, autocomplete: 'username', oninput: (ev) => { l.usuario = ev.target.value; } })),
        h('div', null, h('label', { class: 'rotulo', for: 's', text: 'Senha' }), h('input', { id: 's', class: 'entrada', type: 'password', value: l.senha, autocomplete: 'current-password', oninput: (ev) => { l.senha = ev.target.value; } })),
        h('button', { class: 'btn primario', type: 'submit', disabled: l.entrando, text: l.entrando ? 'Entrando…' : 'Entrar' }),
        l.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), l.erro) : null)));
  }
  function desenhar() {
    const logado = estado.sessao && estado.sessao.pode;
    if (!estado.sessao) { $raiz.replaceChildren(cabeca(), h('main', { class: 'pagina' }, C.esqueleto(3))); return; }
    if (!logado) { ui.montada = false; for (const k of Object.keys(cache)) delete cache[k]; $raiz.replaceChildren(cabeca(), telaLogin()); return; }
    if (ui.montada) return;
    for (const k of Object.keys(cache)) delete cache[k];
    ui.cab = h('div', { class: 'cab-pagina' });
    ui.erro = h('div', { class: 'bloco-erro' });
    ui.import = h('div', { class: 'bloco-import' });
    ui.funil = h('div', { class: 'bloco-funil' });
    ui.kpis = h('div', { class: 'kpis2' });
    ui.tempos = h('div', { class: 'tempos' });
    ui.bipeLista = null; ui.bipeCampo = null;
    const bipe = !TV && estado.bipe.pode ? montarBipe() : null;
    ui.graf = h('section', { class: 'card graf', 'aria-label': 'Pedidos por dia' });
    ui.transp = h('section', { class: 'card transp', 'aria-label': 'Por transportadora' });
    ui.pend = h('div', { class: 'pend-corpo' });
    ui.pendSecao = h('section', { class: 'card pend-card', 'aria-labelledby': 'pend-t' }, h('div', { class: 'card-titulo' }, h('div', null, h('h2', { id: 'pend-t', text: TV ? 'O que precisa de atenção' : 'Pendências' }), TV ? null : h('p', { class: 'mudo peq', text: 'Pedidos parados em alguma etapa. Toque num pedido para ver todos os detalhes dele.' }))), ui.pend);
    ui.chips = h('div', { class: 'chips-f' });
    ui.tabCorpo = h('div', { class: 'tab-corpo', 'aria-live': 'polite' });
    ui.tabCabeca = h('div', { class: 'card-titulo' }, h('div', null, h('h2', { id: 'tab-t', text: 'Pedido a pedido' }), ui.resumoFiltro = h('p', { class: 'mudo peq resumo-filtro', role: 'status' })));
    ui.tabSecao = h('section', { class: 'card tab-card', 'aria-labelledby': 'tab-t' }, ui.tabCabeca, montarFiltros(), ui.chips, ui.tabCorpo);
    const meio = h('div', { class: 'duas' }, h('div', { class: 'col-esq' }, ui.graf, ui.tempos), ui.transp);
    const pagina = h('main', { class: 'pagina exp-pg' }, ui.cab, ui.erro, bipe, ui.import, ui.funil, ui.kpis, meio, ui.pendSecao, TV ? null : ui.tabSecao,
      !TV && !estado.bipe.pode ? h('div', { class: 'processo compacta so-leitura', role: 'note' }, ic('info'), h('p', { text: 'Você está vendo o painel só para consulta. Para bipar pedidos recebidos, peça ao administrador o acesso "Recebimento".' })) : null,
      h('p', { class: 'rodape-nota' }, ic('info'), 'A tela se atualiza sozinha a cada minuto enquanto estiver aberta. "Sair" = o pedido aparecer na planilha de Entrega.'));
    $raiz.replaceChildren(montarTopo(), pagina);
    ui.montada = true; renderTudo(); if (ui.bipeRes) { renderBipeRes(); focarBipe(); }
  }

  /* ---------- atualização automática ---------- */
  function atualizarSeCabe() {
    if (doc.hidden || !ui.montada || !estado.sessao || !estado.sessao.pode) return;
    if (estado.imp.fase === 'gravando' || estado.exp.aberta) return;
    recarregar(true);
  }
  root.setInterval(atualizarSeCabe, 60000);
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden && estado.ultima && Date.now() - estado.ultima > 60000) atualizarSeCabe(); });
  if (TV) root.setInterval(() => { if (!doc.hidden) { const r = doc.querySelector('.tv-hora'); if (r) r.textContent = C.horaBR(new Date().toISOString()); } }, 15000);

  (async () => {
    iniciarPeriodo();
    await carregarSessao();
    if (estado.sessao.pode) await carregarPodeReceber();
    desenhar();
    if (estado.sessao.pode) await recarregar(true);
  })();
})(window);
