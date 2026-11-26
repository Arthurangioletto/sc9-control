/* Central de Pedidos · Painel da Expedição. Mostra num lugar só o que DESCEU do estoque, o que a expedição RECEBEU e o que SAIU
 * (planilha de Entrega), pedido a pedido e por transportadora. Entra com o usuário do SC9 (administrador ou quem tem o acesso
 * "Recebimento" ou "Despacho"). Tudo que vem do servidor entra como texto (nunca como HTML). JavaScript puro, sem nada de fora.
 * Modo TV: /expedicao.html?modo=tv (sem tabela, números grandes, atualiza sozinho). */
(function (root) {
  'use strict';
  const C = root.Central, h = C.h;
  const doc = root.document;
  /* Colunas da aba "Planilha de entrega", na ordem e com os nomes da planilha de Entrega que o SC9 carrega.
   * Para trocar o nome ou a ordem de uma coluna, mexa SÓ aqui (k = qual dado a coluna mostra; nome = o que aparece no cabeçalho).
   * As três últimas são mais discretas (cls "discreta"). Os mesmos nomes saem no Excel/CSV baixado. */
  const COLUNAS_PLANILHA = [
    { k: 'data', nome: 'Data', cls: 'c-data' },
    { k: 'pedido', nome: 'Pedido', cls: 'c-ped' },
    { k: 'cliente', nome: 'Cliente', cls: 'c-cli' },
    { k: 'nf', nome: 'Nota Fiscal', cls: 'c-nf' },
    { k: 'transportadora', nome: 'Transportadora', cls: 'c-tr' },
    { k: 'armazem', nome: 'Armazém', cls: 'c-arm' },
    { k: 'volumes', nome: 'Volumes', cls: 'c-vol dir' },
    { k: 'obs', nome: 'Observação', cls: 'c-obs' },
    { k: 'bipadoEm', nome: 'Bipado às', cls: 'c-hora discreta' },
    { k: 'bipadoPor', nome: 'Bipado por', cls: 'c-por discreta' },
    { k: 'situacao', nome: 'Situação', cls: 'c-sit discreta' }
  ];
  const $raiz = doc.getElementById('raiz');
  const CAB = { 'Content-Type': 'application/json', 'X-SC9-App': '1' };
  const params = new root.URLSearchParams(root.location.search);
  const EMBED = params.get('embed') === '1'; // dentro do SC9 (iframe da mesma origem): sem faixa da marca, sem botões de navegação
  const TV = !EMBED && params.get('modo') === 'tv';
  const REDUZ = Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const LIMITE = 25, LIMITE_POD = 25;
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
    impressora: [['p', 'M6 9V2h12v7'], ['p', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2'], ['r', 6, 14, 12, 8, 1]],
    troca: [['p', 'm16 3 4 4-4 4'], ['p', 'M20 7H4'], ['p', 'm8 21-4-4 4-4'], ['p', 'M4 17h16']],
    som: [['p', 'M11 5 6 9H2v6h4l5 4z'], ['p', 'M15.5 8.5a5 5 0 0 1 0 7'], ['p', 'M19 5a10 10 0 0 1 0 14']],
    mudo: [['p', 'M11 5 6 9H2v6h4l5 4z'], ['p', 'm22 9-6 6'], ['p', 'm16 9 6 6']],
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
    acesso: null, tab: '', dialogos: 0,
    bipar: { fila: [], ocupado: false, res: null, hist: [], faltando: [], carregouHist: false, erroHist: '', som: true, ult: 0 },
    plan: { dia: '', dados: null, carregando: false, erro: '', sel: new Set(), transp: new Set(), q: '', ultima: 0, ultimoIdx: -1, seq: 0, ocupado: false, menuAberto: false, timer: 0 },
    pod: { de: '', ate: '', preset: '15', transportadora: '', status: '', q: '', pagina: 1, dados: null, carregando: false, erro: '', nomes: new Set(), seq: 0, ult: 0, timer: 0, ajudaAberta: false },
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
  function seSessaoCaiu(e) { if (e && e.auth) { estado.sessao = { authed: false, pode: false }; estado.acesso = null; estado.painel = null; estado.pedidos = null; ui.montada = false; desenhar(); return true; } return false; }

  // Compatibilidade: se o servidor ainda não tem /api/expedicao/acesso, deduz das permissões antigas do usuário.
  function acessoPelosPerfis(j) {
    const p = j.perfis || [], adm = j.role === 'admin';
    const bipar = adm || p.includes('exp_bipar') || p.includes('recebimento'), planilha = adm || p.includes('exp_planilha') || p.includes('recebimento') || p.includes('despacho'), pod = adm || p.includes('exp_pod');
    return { admin: adm, abas: { bipar, planilha, pod, visaoGeral: planilha }, usuario: j.usuario || '', nome: j.nome || j.usuario || '' };
  }
  async function carregarSessao() {
    try {
      const j = await (await root.fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' })).json();
      estado.sessao = { authed: Boolean(j.authed), nome: j.nome || j.usuario || '', admin: j.role === 'admin', pode: false };
      estado.acesso = null;
      if (j.authed) {
        let a = null;
        try { a = await api('/api/expedicao/acesso'); } catch (e) { /* servidor sem a rota: usa os perfis */ }
        if (!a || !a.abas) a = acessoPelosPerfis(j);
        a.abas = { bipar: Boolean(a.abas.bipar), planilha: Boolean(a.abas.planilha), pod: Boolean(a.abas.pod), visaoGeral: Boolean(a.abas.visaoGeral) };
        estado.acesso = a; estado.sessao.nome = a.nome || estado.sessao.nome; estado.sessao.admin = Boolean(a.admin);
        estado.sessao.pode = a.abas.bipar || a.abas.planilha || a.abas.pod || a.abas.visaoGeral;
      }
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
    if (!estado.sessao || !estado.sessao.pode || !abaPermitida('geral')) return;
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
      l.senha = ''; await carregarSessao(); ui.montada = false; estado.carregando = true; desenhar();
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
      h('a', { class: 'emb-link', href: '/expedicao.html', target: '_blank', rel: 'noopener', onclick: (ev) => { ev.currentTarget.href = '/expedicao.html' + (estado.tab ? '#' + estado.tab : ''); } }, 'Abrir em tela cheia', ic('externo')));
  }
  const cabeca = () => (EMBED ? barraEmbed(false) : h('header', { class: 'topo' }, h('div', { class: 'topo-in' }, C.marca('Expedição'))));
  function montarTopo() {
    if (EMBED) return barraEmbed(true);
    const nome = estado.sessao && estado.sessao.nome;
    const gerente = Boolean(estado.acesso && estado.acesso.abas.visaoGeral);
    return h('header', { class: 'topo' }, h('div', { class: 'topo-in' }, C.marca('Expedição'),
      h('div', { class: 'topo-lado' },
        TV || !gerente ? null : h('a', { class: 'btn peq', href: '/fechamento-dia.html' }, ic('caminhao'), h('span', { class: 'so-largo', text: 'Fechamento do dia' })),
        TV || !gerente ? null : h('a', { class: 'btn peq', href: '/prioridades.html' }, ic('painel'), h('span', { class: 'so-largo', text: 'Painel da logística' })),
        gerente ? h('a', { class: 'btn peq', href: TV ? '/expedicao.html' : '/expedicao.html?modo=tv', 'aria-label': TV ? 'Sair do modo TV' : 'Abrir em modo TV (tela grande)' }, ic('tv'), h('span', { class: 'so-largo', text: TV ? 'Sair do modo TV' : 'Modo TV' })) : null,
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
        C.cabecalho('painel', TV ? 'Painel da Expedição' : 'Visão geral', TV || EMBED ? null : 'O que desceu do estoque, o que a expedição recebeu e o que já saiu para as transportadoras.'),
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

  /* ---------- preferências simples (só neste aparelho) ---------- */
  const PREF = {
    ler(k, padrao) { try { const v = root.localStorage.getItem('sc9exp.' + k); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } },
    gravar(k, v) { try { root.localStorage.setItem('sc9exp.' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento: segue sem lembrar */ } }
  };
  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const diaLongoTxt = (d) => DIA_LONGO[dow(d)] + ', ' + dmy(d);
  const horaDe = (iso) => (iso ? C.horaBR(iso) : '');
  const interativo = (alvo) => Boolean(alvo && alvo.closest && alvo.closest('button, a, input, select, textarea, summary, label, [role="tab"], [role="menuitem"]'));

  /* ---------- janelas (diálogo central; gaveta lateral no computador, folha no celular) ---------- */
  let seqDialogo = 0;
  function abrirDialogo(o) {
    const antes = doc.activeElement, idT = 'dlg-t-' + (++seqDialogo);
    estado.dialogos++;
    const fundo = h('div', { class: 'gaveta-fundo abre', onclick: () => fechar() });
    const painel = h('div', { class: (o.lado ? 'gaveta exp-gaveta lado' : 'dialogo') + ' abre' + (o.larga ? ' larga' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idT },
      h('div', { class: 'gaveta-cab' }, h('div', null, h('h3', { id: idT, text: o.titulo }), o.sub ? h('p', { class: 'mudo peq', text: o.sub }) : null), h('button', { type: 'button', class: 'btn peq fantasma', 'aria-label': 'Fechar', onclick: () => fechar() }, ic('fechar'))),
      h('div', { class: 'gaveta-corpo' }, o.corpo),
      o.rodape ? h('div', { class: 'dialogo-rodape' }, o.rodape) : null);
    let fechado = false;
    function fechar() {
      if (fechado) return; fechado = true;
      fundo.remove(); painel.remove(); doc.removeEventListener('keydown', tecla); estado.dialogos = Math.max(0, estado.dialogos - 1);
      if (o.aoFechar) o.aoFechar();
      if (antes && antes.focus && doc.contains(antes)) antes.focus(); else if (estado.tab === 'bipar') focarBipe();
    }
    const tecla = (ev) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); fechar(); return; }
      if (ev.key === 'Tab') {
        const f = Array.from(painel.querySelectorAll('button, select, input, textarea, a[href]')).filter((e) => !e.disabled && e.offsetParent !== null);
        if (!f.length) return; const a = f[0], z = f[f.length - 1];
        if (ev.shiftKey && doc.activeElement === a) { ev.preventDefault(); z.focus(); } else if (!ev.shiftKey && doc.activeElement === z) { ev.preventDefault(); a.focus(); }
      }
    };
    doc.addEventListener('keydown', tecla); doc.body.append(fundo, painel);
    const foco = o.foco ? painel.querySelector(o.foco) : painel.querySelector('textarea, input:not([type="checkbox"]), select, button.primario');
    if (foco) foco.focus({ preventScroll: true });
    return { fechar, el: painel };
  }
  const msgEm = (el, texto, tipo) => { el.className = 'rast-msg' + (tipo === 'erro' ? ' erro-t' : tipo === 'ok' ? ' ok-t' : ''); el.textContent = texto || ''; };
  // contador "123/400" que acompanha um campo de texto
  function contador(campo, max, minimo) {
    const c = h('span', { class: 'contador', 'aria-hidden': 'true' });
    const atualiza = () => { const n = campo.value.trim().length; c.textContent = campo.value.length + '/' + max; c.classList.toggle('falta', Boolean(minimo) && n < minimo); };
    campo.addEventListener('input', atualiza); atualiza();
    return c;
  }
  const nomeCurto = (n) => primeiroNome(n) || '—';

  /* ====================================================================================================================
   * ABA BIPAR: uma pessoa, um campo. O leitor de código de barras digita o número e aperta Enter; o cartão mostra tudo do pedido.
   * ==================================================================================================================== */
  const bp = estado.bipar;
  const celularPequeno = () => Boolean(root.matchMedia && root.matchMedia('(pointer: coarse) and (max-width: 700px)').matches);
  function focarBipe() { if (ui.bipeCampo && estado.tab === 'bipar' && !estado.dialogos && !celularPequeno()) ui.bipeCampo.focus({ preventScroll: true }); }
  let audioCtx = null;
  function sinal(tipo) {
    if (!bp.som) return;
    try {
      if (root.navigator.vibrate) root.navigator.vibrate(tipo === 'erro' ? [120, 60, 120] : 35);
      const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return;
      audioCtx = audioCtx || new AC(); if (audioCtx.state === 'suspended') audioCtx.resume();
      const nota = (f, ini, dur) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + ini; o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur + 0.03); };
      if (tipo === 'ok') { nota(880, 0, 0.08); nota(1175, 0.09, 0.12); } else if (tipo === 'dup') { nota(620, 0, 0.1); nota(620, 0.15, 0.1); } else nota(280, 0, 0.26);
    } catch (e) { /* som e vibração são opcionais */ }
  }
  const limpaPedido = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
  function avisoBipe(texto, tom) { if (!ui.bipeAviso) return; ui.bipeAviso.className = 'bipe-aviso ' + (tom || ''); ui.bipeAviso.textContent = texto || ''; }

  // Tudo do pedido num formato só, venha do bipe, de um pedido já bipado ou do histórico do dia.
  function normalizarBipe(j, entrada) {
    const e = entrada || {}, R = (j && j.resumo) || {}, I = Object.assign({}, (j && j.info) || {}, e.info || {});
    const d = (j && j.desceu) || e.desceu || {}, t = (j && j.tempos) || R.tempos || {};
    const nf = R.nf || I.nf || '';
    const desceuEm = R.desceuEm || t.desceuEm || (d.status === 'ok' ? d.saidaEm : '') || '';
    const minutos = t.minutosDesceuAteReceber != null ? t.minutosDesceuAteReceber : (desceuEm && e.recebidoEm ? Math.max(0, Math.round((new Date(e.recebidoEm) - new Date(desceuEm)) / 60000)) : null);
    return {
      id: e.id || '', pedido: e.pedido || R.pedido || '', cliente: R.cliente || I.cliente || '', transportadora: R.transportadora || I.transportadora || '', armazem: R.armazem || I.armazem || '',
      linhas: R.linhas != null ? R.linhas : I.linhas, pecas: R.pecas != null ? R.pecas : I.pecas, conferente: R.conferente || I.conferente || '', nf,
      semDado: Boolean(R.semDadoSC9 != null ? R.semDadoSC9 : e.semDadoSC9) || (!I.cliente && !I.transportadora && !nf),
      desceuEm, desceuPor: R.desceuPor || (d.status === 'ok' ? d.saidaPor : '') || '', minutos, recebidoEm: e.recebidoEm || '', recebidoPor: e.recebidoPorNome || '', volumes: e.volumes == null ? null : e.volumes, origem: e.origem || R.origem || 'bipe'
    };
  }
  async function biparUm(ped) {
    avisoBipe('Recebendo o pedido ' + ped + '…', '');
    try {
      const j = await api('/api/recebimento/bipar', { method: 'POST', corpo: { pedido: ped } });
      const entry = j.entry || { pedido: ped, recebidoEm: new Date().toISOString() };
      const c = normalizarBipe(j, entry);
      bp.res = { tipo: 'ok', c, chave: Date.now() };
      bp.hist = [entry].concat(bp.hist.filter((x) => x.id !== entry.id && x.pedido !== entry.pedido));
      avisoBipe('', ''); sinal('ok');
      if (ui.geralMontada) { carregarPainel().then(renderTudo); }
    } catch (e) {
      if (seSessaoCaiu(e)) return;
      if (e.status === 409 && e.dados && e.dados.error === 'duplicado') {
        const dup = e.dados.duplicado || { pedido: ped };
        bp.res = { tipo: 'dup', c: normalizarBipe(e.dados, dup), msg: e.dados.mensagem || '', chave: Date.now() }; avisoBipe('', ''); sinal('dup');
      } else { bp.res = { tipo: 'erro', c: { pedido: ped }, msg: e.message, chave: Date.now() }; avisoBipe('', ''); sinal('erro'); }
    }
    renderBipeRes(); renderBipeHist(); renderBipeTopo();
  }
  async function processarFila() {
    if (bp.ocupado) return; bp.ocupado = true;
    try { while (bp.fila.length) { const ped = bp.fila.shift(); renderBipeFila(); await biparUm(ped); } } finally { bp.ocupado = false; renderBipeFila(); focarBipe(); }
  }
  function enfileirar(valor) {
    const ped = limpaPedido(valor);
    if (ped.length < 4 || ped.length > 10) { avisoBipe(ped ? 'Esse número não parece um pedido. Leia o código de novo ou digite de 4 a 10 números.' : 'Leia o código de barras ou digite o número do pedido.', 'laranja'); sinal('erro'); focarBipe(); return; }
    bp.fila.push(ped); renderBipeFila(); processarFila();
  }
  function renderBipeFila() { if (ui.bipeFila) { ui.bipeFila.textContent = bp.fila.length ? 'Na fila: ' + bp.fila.length : ''; ui.bipeFila.hidden = !bp.fila.length; } }

  function tomMinutos(min) { return min == null ? 'suave' : tomTempo(min); }
  function fatoG(icone, rotulo, conteudo, classe) { return h('div', { class: 'fato-g ' + (classe || '') }, h('span', { class: 'fg-ic' }, ic(icone)), h('div', { class: 'fg-corpo' }, h('span', { class: 'fg-rot', text: rotulo }), conteudo)); }
  const valorG = (texto, classe) => h('b', { class: 'fg-val ' + (classe || ''), text: texto });
  function chipNota(nf, grande) {
    return nf ? h('b', { class: 'fg-val num', text: nf }) : h('span', { class: 'chip-aguarda' + (grande ? ' grande' : ''), title: 'A nota só aparece depois que o SC9 é carregado de novo.' }, ic('relogio'), 'Aguardando nota');
  }
  function blocoDesceu(c, consulta) {
    if (!c.desceuEm) return fatoG('descer', 'Desceu do estoque', [valorG('Ainda não desceu pelo estoque', 'suave'), h('span', { class: 'fg-sub tom-suave', text: 'Foi recebido mesmo assim.' })], 'dois-terco suave');
    const hojeDia = C.diaSP(c.desceuEm) === hoje();
    const quando = (hojeDia ? 'às ' : 'em ' + C.curta(c.desceuEm) + ' às ') + horaDe(c.desceuEm) + (c.desceuPor ? ' · ' + primeiroNome(c.desceuPor) : '');
    const min = c.minutos != null ? c.minutos : Math.max(0, Math.round((Date.now() - new Date(c.desceuEm).getTime()) / 60000));
    const tom = c.minutos != null ? tomTempo(c.minutos) : 'suave';
    const frase = c.minutos != null ? (c.minutos < 1 ? 'Recebido na hora' : 'Ficou ' + fmtMin(c.minutos) + ' lá embaixo') : 'Desceu há ' + fmtMin(min);
    return fatoG(tom === 'verde' ? 'okCirculo' : tom === 'ambar' ? 'relogio' : tom === 'vermelho' ? 'alerta' : 'descer', 'Desceu do estoque', [valorG(quando), h('span', { class: 'fg-sub tom-' + tom, text: frase })], 'dois-terco tempo ' + tom);
  }
  function cartaoPedido(r) {
    const c = r.c, dup = r.tipo === 'dup', cons = r.tipo === 'consulta';
    const topo = h('div', { class: 'res-topo' },
      h('span', { class: 'selo-ok' + (dup || cons ? ' info' : '') }, ic(dup || cons ? 'info' : 'ok')),
      h('div', { class: 'res-tit' }, h('b', { class: 'res-t', text: dup ? 'Este pedido já tinha sido bipado' : cons ? 'Pedido bipado hoje' : 'Pedido recebido' }),
        h('span', { class: 'res-h', text: (dup ? (c.recebidoEm ? 'Bipado ' + (C.diaSP(c.recebidoEm) === hoje() ? 'às ' + horaDe(c.recebidoEm) : 'em ' + C.dataHora(c.recebidoEm)) : '') + (c.recebidoPor ? ' por ' + primeiroNome(c.recebidoPor) : '') + '. Não foi contado de novo.' : 'às ' + horaDe(c.recebidoEm || new Date().toISOString()) + (c.recebidoPor && cons ? ' por ' + primeiroNome(c.recebidoPor) : '')) })),
      h('b', { class: 'res-ped num', text: c.pedido }));
    const semDado = c.semDado ? h('div', { class: 'faixa-aguarda', role: 'note' }, ic('info'), h('div', null, h('b', { text: 'Sem dado do SC9' }), h('span', { text: 'O SC9 ainda não conhece este pedido, mas ele foi registrado. Cliente, transportadora e nota aparecem sozinhos quando o SC9 for carregado de novo.' }))) : null;
    const notaFato = c.nf ? fatoG('nota', 'Nota fiscal', chipNota(c.nf, true), 'meia') : fatoG('relogio', 'Nota fiscal', [h('b', { class: 'fg-val' }, 'Aguardando nota'), h('span', { class: 'fg-sub tom-ambar', text: 'Normal: aparece sozinha quando o SC9 for carregado de novo.' })], 'meia nota-espera');
    const fatos = h('div', { class: 'fatos-g' },
      fatoG('predio', 'Cliente', valorG(c.cliente || 'Ainda sem cliente', c.cliente ? 'grande' : 'suave'), 'larga'),
      fatoG('caminhao', 'Transportadora', valorG(c.transportadora || 'Ainda sem transportadora', c.transportadora ? '' : 'suave'), 'meia'),
      notaFato,
      fatoG('predio', 'Armazém', valorG(c.armazem || '—'), 'meia'),
      fatoG('lista', 'Linhas e peças', valorG(c.linhas != null ? plural(c.linhas, 'linha', 'linhas') + ' · ' + plural(c.pecas || 0, 'peça', 'peças') : '—'), 'meia'),
      blocoDesceu(c, cons),
      dup || cons ? fatoG('relogio', 'Bipado', valorG((c.recebidoEm ? horaDe(c.recebidoEm) : '—') + (c.recebidoPor ? ' · ' + primeiroNome(c.recebidoPor) : '')), 'terco') : (c.conferente ? fatoG('conferencia', 'Conferido por', valorG(primeiroNome(c.conferente)), 'terco') : null));
    return h('div', { class: 'res-bipe ' + (dup || cons ? 'r-dup' : 'r-ok'), key: r.chave }, topo, semDado, fatos, dup ? null : blocoVolumes(r));
  }
  async function guardarVolumes(r, valor, msg, botoes) {
    const v = String(valor == null ? '' : valor).trim();
    if (v && (!/^\d{1,3}$/.test(v) || Number(v) < 1)) { msgEm(msg, 'Volumes: digite um número de 1 a 999.', 'erro'); return; }
    if (!r.c.id) return;
    botoes.forEach((x) => { x.disabled = true; }); msgEm(msg, 'Guardando…');
    try {
      await api('/api/recebimento/atualizar', { method: 'POST', corpo: { id: r.c.id, volumes: v ? Number(v) : null } });
      r.c.volumes = v ? Number(v) : null; bp.hist = bp.hist.map((x) => (x.id === r.c.id ? Object.assign({}, x, { volumes: r.c.volumes }) : x));
      renderBipeRes(); focarBipe(); if (ui.geralMontada) carregarPainel().then(() => { renderKpis(); renderTransp(); });
      const t = ui.bipeRes.querySelector('.vol-salvo'); if (t) t.classList.add('pop');
    } catch (e) { if (!seSessaoCaiu(e)) { botoes.forEach((x) => { x.disabled = false; }); msgEm(msg, e.message, 'erro'); } }
  }
  function blocoVolumes(r) {
    if (r.c.volumes) return h('div', { class: 'vol-salvo' }, ic('caixaEntrada'), h('span', null, h('b', { text: plural(r.c.volumes, 'volume', 'volumes') }), ' anotados'), h('button', { type: 'button', class: 'link-botao', onclick: () => { r.c.volumes = null; renderBipeRes(); const x = doc.getElementById('vol'); if (x) x.focus(); }, text: 'Mudar' }));
    const msg = h('p', { class: 'rast-msg', role: 'status' }), botoes = [];
    const campo = h('input', { id: 'vol', class: 'entrada vol-campo', type: 'text', inputmode: 'numeric', maxlength: '3', placeholder: 'Outro', autocomplete: 'off', 'aria-label': 'Quantidade de volumes (opcional)' });
    const chips = [1, 2, 3, 4, 5].map((n) => { const b = h('button', { type: 'button', class: 'chip-vol', 'aria-label': n + (n === 1 ? ' volume' : ' volumes'), onclick: () => guardarVolumes(r, n, msg, botoes) }, String(n)); botoes.push(b); return b; });
    const ok = h('button', { type: 'button', class: 'btn peq', onclick: () => guardarVolumes(r, campo.value, msg, botoes) }, 'Guardar'); botoes.push(ok);
    campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); if (campo.value.trim()) guardarVolumes(r, campo.value, msg, botoes); else focarBipe(); } });
    return h('div', { class: 'vol-bloco' }, h('span', { class: 'rotulo', id: 'vol-rot', text: 'Quantos volumes? (se quiser anotar agora)' }), h('div', { class: 'vol-linha', role: 'group', 'aria-labelledby': 'vol-rot' }, h('div', { class: 'chips-vol' }, chips), campo, ok), msg);
  }
  function renderBipeRes() {
    if (!ui.bipeRes) return; const r = bp.res;
    if (!r) { ui.bipeRes.replaceChildren(h('div', { class: 'bipe-espera' }, ic('bipe'), h('div', null, h('b', { text: 'Pronto para o próximo pedido' }), h('span', { text: 'Passe o leitor no código de barras. O resultado aparece aqui.' })))); return; }
    if (r.tipo === 'erro') { ui.bipeRes.replaceChildren(h('div', { class: 'res-bipe r-erro', key: r.chave, role: 'alert' }, h('div', { class: 'res-topo' }, h('span', { class: 'selo-ok erro' }, ic('alerta')), h('div', { class: 'res-tit' }, h('b', { class: 'res-t', text: 'Não consegui receber o pedido ' + r.c.pedido }), h('span', { class: 'res-h', text: r.msg + ' Leia o código de novo.' }))))); return; }
    ui.bipeRes.replaceChildren(cartaoPedido(r));
  }
  function renderBipeTopo() {
    if (!ui.bipeContador) return;
    const n = bp.hist.length;
    ui.bipeContador.replaceChildren(h('b', { class: 'num', text: num(n) }), h('span', { text: n === 1 ? 'bipado hoje por você' : 'bipados hoje por você' }));
  }
  function renderBipeHist() {
    if (!ui.bipeHist) return;
    const lista = bp.hist.slice(0, 15);
    peca('bipeHist', ui.bipeHist, { l: lista.map((e) => [e.id, e.nf, (e.info || {}).nf, (e.info || {}).cliente, e.volumes]), erro: bp.erroHist, c: bp.carregouHist, f: bp.faltando.map((x) => x.pedido) }, () => [
      h('div', { class: 'card-titulo' }, h('div', null, h('h2', { id: 'bh-t', text: 'Bipados hoje por mim' }), h('p', { class: 'mudo peq', text: 'Os 15 últimos. Toque em um para ver os dados dele.' })), lista.length ? h('span', { class: 'pend-cont azul', text: String(bp.hist.length) }) : null),
      bp.erroHist ? h('p', { class: 'erro', role: 'alert' }, ic('alerta'), bp.erroHist)
        : !bp.carregouHist ? h('div', { class: 'esqueleto', style: 'height:180px' })
        : lista.length ? h('ul', { class: 'hist-lista' }, lista.map((e) => { const c = normalizarBipe(null, e); return h('li', null, h('button', { type: 'button', class: 'hist-item', onclick: () => { bp.res = { tipo: 'consulta', c, chave: Date.now() }; renderBipeRes(); focarBipe(); }, 'aria-label': 'Ver o pedido ' + c.pedido + ', bipado às ' + horaDe(e.recebidoEm) },
          h('span', { class: 'hi-hora num', text: horaDe(e.recebidoEm) }), h('span', { class: 'hi-meio' }, h('b', { class: 'num', text: c.pedido }), h('span', { text: c.cliente || 'Sem dado do SC9' }), h('small', { text: c.transportadora || 'Sem transportadora' })),
          c.nf ? h('span', { class: 'hi-nf num', text: 'NF ' + c.nf }) : h('span', { class: 'chip-aguarda mini' }, ic('relogio'), 'Aguardando nota'))); }))
        : h('div', { class: 'pend-ok' }, h('span', { class: 'pend-ok-ic' }, ic('bipe')), h('div', null, h('b', { text: 'Nenhum pedido bipado ainda hoje' }), h('p', { text: 'Quando você bipar, eles aparecem aqui, do mais novo para o mais antigo.' }))),
      bp.faltando.length ? h('details', { class: 'faltam' }, h('summary', null, ic('descer'), 'Desceram do estoque e ainda não chegaram', h('span', { class: 'pend-cont', text: String(bp.faltando.length) })),
        h('ul', { class: 'bl-lista' }, bp.faltando.slice(0, 12).map((x) => h('li', null, h('div', { class: 'bl-info' }, h('b', { class: 'num', text: x.pedido }), h('span', { text: (x.info && x.info.cliente) || 'Cliente não informado' }), h('small', { text: ((x.info && x.info.transportadora) || 'Sem transportadora') + (x.saidaEm ? ' · desceu às ' + horaDe(x.saidaEm) : '') })), h('button', { type: 'button', class: 'btn peq', 'aria-label': 'Bipar o pedido ' + x.pedido, onclick: () => enfileirar(x.pedido) }, ic('bipe'), 'Bipar'))))) : null
    ]);
  }
  async function carregarHistorico(silencioso) {
    try {
      const j = await api('/api/recebimento');
      const eu = String(j.usuario || (estado.acesso && estado.acesso.usuario) || '');
      const meus = (j.entries || []).filter((e) => !eu || e.recebidoPorUsuario === eu).sort((a, b) => String(b.recebidoEm).localeCompare(String(a.recebidoEm)));
      bp.hist = meus; bp.faltando = (j.faltando || []).filter((x) => !meus.some((m) => m.pedido === x.pedido)); bp.erroHist = ''; bp.carregouHist = true; marcarAtualizado();
    } catch (e) { if (seSessaoCaiu(e)) return; if (!silencioso || !bp.carregouHist) { bp.erroHist = e.message; bp.carregouHist = true; } }
    cache.bipeHist = ''; renderBipeHist(); renderBipeTopo();
  }
  function montarBipar() {
    bp.som = PREF.ler('som', true);
    ui.bipeCampo = h('input', { id: 'bipe', class: 'bipe-campo', type: 'text', inputmode: 'numeric', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'send', placeholder: 'Leia o código ou digite o pedido', 'aria-label': 'Número do pedido para bipar' });
    ui.bipeAviso = h('p', { class: 'bipe-aviso', role: 'status', 'aria-live': 'polite' });
    ui.bipeFila = h('span', { class: 'bipe-fila', hidden: true, role: 'status' });
    ui.bipeRes = h('div', { class: 'bipe-res', 'aria-live': 'polite' });
    ui.bipeContador = h('div', { class: 'bipe-contador', role: 'status' });
    ui.bipeHist = h('section', { class: 'card bipe-hist', 'aria-labelledby': 'bh-t' });
    const botaoSom = h('button', { type: 'button', class: 'btn peq som-botao', 'aria-pressed': String(bp.som), title: 'Som e vibração ao bipar', onclick: () => { bp.som = !bp.som; PREF.gravar('som', bp.som); botaoSom.setAttribute('aria-pressed', String(bp.som)); botaoSom.replaceChildren(ic(bp.som ? 'som' : 'mudo'), bp.som ? 'Som ligado' : 'Som desligado'); if (bp.som) sinal('ok'); focarBipe(); } }, ic(bp.som ? 'som' : 'mudo'), bp.som ? 'Som ligado' : 'Som desligado');
    const form = h('form', { class: 'bipe-form', autocomplete: 'off', onsubmit: (ev) => { ev.preventDefault(); const v = ui.bipeCampo.value; ui.bipeCampo.value = ''; enfileirar(v); } },
      h('span', { class: 'bipe-ic' }, ic('bipe')), ui.bipeCampo, h('button', { type: 'submit', class: 'btn verde bipe-ok' }, ic('ok'), 'Receber'));
    ui.bipeCampo.addEventListener('blur', () => { root.setTimeout(() => { if (estado.tab === 'bipar' && !estado.dialogos && (doc.activeElement === doc.body || doc.activeElement === null)) focarBipe(); }, 60); });
    const principal = h('section', { class: 'card bipe-hero', 'aria-labelledby': 'bipe-t' },
      h('div', { class: 'bipe-cab' }, h('h2', { id: 'bipe-t', text: 'Bipar pedido recebido' }), h('div', { class: 'bipe-cab-lado' }, ui.bipeContador, botaoSom)),
      form, h('div', { class: 'bipe-linha' }, ui.bipeAviso, ui.bipeFila), ui.bipeRes);
    renderBipeRes(); renderBipeTopo(); renderBipeHist();
    return h('div', { class: 'bipe-grade' }, principal, ui.bipeHist);
  }

  /* ====================================================================================================================
   * ABA PLANILHA DE ENTREGA: parecida com a planilha de Entrega do SC9, de UM dia só. Filtra por transportadora (várias),
   * marca linhas, imprime a lista de saída, troca a transportadora (com motivo) e guarda observações.
   * ==================================================================================================================== */
  const pl = estado.plan;
  const nomeTr = (n) => n || 'Sem transportadora';
  const linhasDoDia = () => (pl.dados && pl.dados.linhas) || [];
  // o servidor agrupa as transportadoras sem olhar maiúsculas/acentos e chama a vazia de "Sem transportadora": a comparação daqui faz o mesmo
  const motivoTroca = (l) => (l.troca && l.troca.motivo) || l.trocaMotivo || '';
  const chaveTr = (n) => { const k = semAcento(n).replace(/\s+/g, ' ').trim(); return k === 'sem transportadora' ? '' : k; };
  const chavesMarcadas = () => new Set(Array.from(pl.transp).map(chaveTr));
  function passaFiltro(l, ks) {
    ks = ks || chavesMarcadas();
    if (pl.transp.size && !ks.has(chaveTr(l.transportadora))) return false;
    const q = semAcento(pl.q).trim(); if (!q) return true;
    const palheiro = semAcento([l.pedido, l.cliente, l.nf, l.observacao, l.transportadora, l.bipadoPor].join(' '));
    return q.split(/\s+/).every((p) => palheiro.includes(p));
  }
  const linhasFiltradas = () => { const ks = chavesMarcadas(); return linhasDoDia().filter((l) => passaFiltro(l, ks)); };
  const selecionadas = () => linhasDoDia().filter((l) => pl.sel.has(l.id));
  function escopoAcao() { const sel = selecionadas(); return sel.length ? { linhas: sel, selecionado: true } : { linhas: linhasFiltradas(), selecionado: false }; }
  const podeVoltarHoje = () => pl.dia && pl.dia !== hoje();
  function podarSelecao() { const ok = new Set(linhasFiltradas().map((l) => l.id)); for (const id of Array.from(pl.sel)) if (!ok.has(id)) pl.sel.delete(id); }

  async function carregarPlanilha(silencioso) {
    if (!estado.acesso || !estado.acesso.abas.planilha) return;
    const meu = ++pl.seq; if (!pl.dia) pl.dia = hoje();
    if (!silencioso) { pl.carregando = true; pl.erro = ''; renderPlanilha(); }
    try {
      const j = await api('/api/expedicao/planilha?' + qs({ dia: pl.dia }));
      if (meu !== pl.seq) return;
      pl.dados = j; pl.erro = ''; pl.ultima = Date.now(); marcarAtualizado();
      const ids = new Set((j.linhas || []).map((l) => l.id)); for (const id of Array.from(pl.sel)) if (!ids.has(id)) pl.sel.delete(id);
      for (const n of Array.from(pl.transp)) if (!(j.transportadoras || []).some((g) => g.nome === n)) pl.transp.delete(n);
    } catch (e) { if (meu !== pl.seq || seSessaoCaiu(e)) return; if (!pl.dados || !silencioso) { pl.erro = e.message; if (!silencioso) pl.dados = null; } else estado.falhouAtualizar = true; }
    pl.carregando = false; renderPlanilha();
  }
  function irParaDia(dia) {
    if (!ehDia(dia)) return; if (dia > hoje()) { C.toast('Só dá para ver até hoje.', 'erro'); dia = hoje(); }
    pl.dia = dia; pl.sel.clear(); pl.dados = null; pl.ultimoIdx = -1; carregarPlanilha(false);
  }

  /* --- cabeçalho: dia, resumo --- */
  function renderPlanCab() {
    const d = pl.dados, dia = pl.dia || hoje(), eHoje = dia === hoje();
    peca('plCab', ui.plCab, { dia, eHoje, t: d && d.totais, c: pl.carregando, ult: pl.ultima && Math.floor(pl.ultima / 60000) }, () => {
      const navDia = h('div', { class: 'dia-nav', role: 'group', 'aria-label': 'Escolher o dia' },
        h('button', { type: 'button', class: 'btn icone', 'aria-label': 'Dia anterior', title: 'Dia anterior', onclick: () => irParaDia(somar(dia, -1)) }, ic('esq')),
        h('div', { class: 'dia-atual' }, h('label', { class: 'sr', for: 'pl-dia', text: 'Escolher o dia' }),
          h('input', { id: 'pl-dia', class: 'dia-input', type: 'date', value: dia, max: hoje(), onchange: (ev) => { if (ev.target.value) irParaDia(ev.target.value); } }), h('span', { class: 'dia-ext', text: DIA_LONGO[dow(dia)] }), eHoje ? h('span', { class: 'selo-hoje', text: 'hoje' }) : null),
        h('button', { type: 'button', class: 'btn icone', 'aria-label': 'Próximo dia', title: eHoje ? 'Hoje é o último dia' : 'Próximo dia', disabled: eHoje, onclick: () => irParaDia(somar(dia, 1)) }, ic('dir')),
        h('button', { type: 'button', class: 'btn peq', disabled: eHoje, onclick: () => irParaDia(hoje()) }, 'Hoje'));
      const t = d && d.totais;
      const kpi = (cls, icone, valor, rot) => h('li', { class: 'mini-kpi ' + cls }, ic(icone), h('b', { class: 'num', text: num(valor) }), h('span', { text: rot }));
      return [h('div', { class: 'plan-cab' }, h('div', { class: 'plan-tit' }, h('h2', { text: 'Planilha de entrega' }), h('p', { class: 'mudo peq', text: 'Tudo que foi bipado em um dia. Escolha as transportadoras, marque os pedidos e imprima a lista de saída.' })), navDia),
        t ? h('ul', { class: 'mini-kpis', 'aria-label': 'Resumo do dia' }, kpi('azul', 'pacote', t.pedidos, t.pedidos === 1 ? 'pedido' : 'pedidos'), kpi('azul', 'caixaEntrada', t.volumes, t.volumes === 1 ? 'volume' : 'volumes'), kpi(t.aguardandoNota ? 'ambar' : 'verde', t.aguardandoNota ? 'relogio' : 'okCirculo', t.aguardandoNota, 'aguardando nota'), kpi('roxo', 'troca', t.trocadas, t.trocadas === 1 ? 'troca de transportadora' : 'trocas de transportadora'), kpi('verde', 'impressora', t.impressos, t.impressos === 1 ? 'já impresso' : 'já impressos')) : null];
    });
  }
  /* --- filtros: busca e chips de transportadora --- */
  function renderPlanChips() {
    const d = pl.dados; if (!ui.plChips) return;
    peca('plChips', ui.plChips, { t: d && d.transportadoras, s: Array.from(pl.transp) }, () => {
      const lista = (d && d.transportadoras) || []; if (!lista.length) return null;
      return [h('div', { class: 'chips-tr', role: 'group', 'aria-label': 'Filtrar por transportadora (pode escolher várias)' },
        h('button', { type: 'button', class: 'chip-tr todas', 'aria-pressed': String(!pl.transp.size), onclick: () => { pl.transp.clear(); aposFiltro(); } }, 'Todas', h('b', { class: 'num', text: num(lista.reduce((a, g) => a + g.total, 0)) })),
        lista.map((g) => { const on = pl.transp.has(g.nome); return h('button', { type: 'button', class: 'chip-tr' + (on ? ' on' : ''), 'aria-pressed': String(on), title: nomeTr(g.nome) + ': ' + plural(g.total, 'pedido', 'pedidos') + ', ' + plural(g.volumes, 'volume', 'volumes') + (g.impressos ? ', ' + g.impressos + ' já impressos' : ''), onclick: () => { if (on) pl.transp.delete(g.nome); else pl.transp.add(g.nome); aposFiltro(); } }, on ? ic('ok') : null, nomeTr(g.nome), h('b', { class: 'num', text: num(g.total) })); }),
        pl.transp.size ? h('button', { type: 'button', class: 'link-botao limpar-f', onclick: () => { pl.transp.clear(); aposFiltro(); } }, 'Limpar') : null)];
    });
  }
  function aposFiltro() { podarSelecao(); renderPlanChips(); renderPlanTabela(); renderPlanBarra(); }

  /* --- tabela --- */
  function celNotaPlan(l) { return l.nf ? h('b', { class: 'nf num', text: l.nf }) : h('span', { class: 'chip-aguarda', title: 'A nota só aparece depois que o SC9 é carregado de novo.' }, ic('relogio'), 'Aguardando nota'); }
  function celTranspPlan(l) {
    return [h('b', { class: 'tr-efetiva', text: nomeTr(l.transportadora) }),
      l.trocada ? h('span', { class: 'selo-troca', title: 'Era ' + (l.transportadoraOriginal || '—') + ' e saiu como ' + (l.transportadora || '—') + (motivoTroca(l) ? '. Motivo: ' + motivoTroca(l) : '. Toque no lápis da observação para ver o histórico.') }, ic('troca'), 'era ' + (l.transportadoraOriginal || '—') + ' → ' + (l.transportadora || '—')) : null,
      null];
  }
  function celObsPlan(l) {
    const n = (l.observacoes || []).length;
    return h('div', { class: 'obs-cel' }, l.observacao ? h('span', { class: 'obs-txt', title: l.observacao, text: l.observacao }) : h('span', { class: 'obs-vazia', 'aria-hidden': 'true' }),
      h('button', { type: 'button', class: 'btn icone peq obs-botao' + (n ? ' tem' : ''), 'aria-label': (n ? 'Observações do pedido ' + l.pedido + ' (' + n + ')' : 'Escrever observação do pedido ' + l.pedido), title: n ? 'Ver e acrescentar observações (' + n + ')' : 'Escrever observação', onclick: () => abrirObservacao(l) }, ic(n ? 'comentario' : 'lapis'), n > 1 ? h('span', { class: 'obs-n', text: String(n) }) : null));
  }
  function celulaPlan(c, l) {
    const base = { class: c.cls };
    switch (c.k) {
      case 'data': return h('td', base, h('span', { class: 'num', text: dm(l.data || pl.dia) }));
      case 'pedido': return h('th', Object.assign({ scope: 'row' }, base), h('b', { class: 'num', text: l.pedido }));
      case 'cliente': return h('td', base, h('span', { class: 'cli', text: l.cliente || 'Sem dado do SC9' }));
      case 'nf': return h('td', base, celNotaPlan(l));
      case 'transportadora': return h('td', base, celTranspPlan(l));
      case 'armazem': return h('td', base, h('span', { text: l.armazem || '' }));
      case 'volumes': return h('td', base, h('span', { class: 'num', text: l.volumes == null ? '' : String(l.volumes) }));
      case 'obs': return h('td', base, celObsPlan(l));
      case 'bipadoEm': return h('td', base, h('span', { class: 'num', text: horaDe(l.bipadoEm) }));
      case 'bipadoPor': return h('td', base, h('span', { text: primeiroNome(l.bipadoPor) }));
      case 'situacao': return h('td', base, h('span', { text: l.saiuEntrega ? 'Saiu' : 'Na expedição' }), l.impressoEm ? h('span', { class: 'selo-impressa', title: 'Esta linha já saiu numa lista impressa' }, ic('impressora'), 'impressa ' + horaDe(l.impressoEm)) : null);
      default: return h('td', base, '');
    }
  }
  function linhaPlan(l, i) {
    const marcada = pl.sel.has(l.id);
    const caixa = h('input', { type: 'checkbox', class: 'caixa-sel', checked: marcada || null, 'aria-label': 'Marcar o pedido ' + l.pedido, onclick: (ev) => { ev.stopPropagation(); marcarLinha(l, ev.target.checked, ev.shiftKey, i); } });
    const tr = h('tr', { class: 'linha-plan' + (marcada ? ' marcada' : '') + (l.trocada ? ' trocada' : ''), 'data-id': l.id, 'data-i': i,
      onclick: (ev) => { if (interativo(ev.target)) return; const novo = !pl.sel.has(l.id); marcarLinha(l, novo, ev.shiftKey, i); } },
      h('td', { class: 'c-sel' }, h('label', { class: 'caixa-area' }, caixa)),
      COLUNAS_PLANILHA.map((c) => celulaPlan(c, l)));
    return tr;
  }
  function marcarLinha(l, marcar, intervalo, i) {
    const vis = linhasFiltradas();
    if (intervalo && pl.ultimoIdx >= 0 && pl.ultimoIdx < vis.length) { const a = Math.min(pl.ultimoIdx, i), b = Math.max(pl.ultimoIdx, i); for (let k = a; k <= b; k++) { if (marcar) pl.sel.add(vis[k].id); else pl.sel.delete(vis[k].id); } } else if (marcar) pl.sel.add(l.id); else pl.sel.delete(l.id);
    pl.ultimoIdx = i; sincronizarSelecao();
  }
  function marcarTodos(marcar) { const vis = linhasFiltradas(); for (const l of vis) { if (marcar) pl.sel.add(l.id); else pl.sel.delete(l.id); } sincronizarSelecao(); }
  // atualiza só o que mudou na tela (sem redesenhar a tabela)
  function sincronizarSelecao() {
    if (ui.plCorpo) for (const tr of ui.plCorpo.querySelectorAll('tr.linha-plan')) { const on = pl.sel.has(tr.getAttribute('data-id')); tr.classList.toggle('marcada', on); const c = tr.querySelector('.caixa-sel'); if (c) c.checked = on; }
    const vis = linhasFiltradas(), n = vis.filter((l) => pl.sel.has(l.id)).length;
    if (ui.plTodos) { ui.plTodos.checked = vis.length > 0 && n === vis.length; ui.plTodos.indeterminate = n > 0 && n < vis.length; }
    renderPlanBarra();
  }
  function renderPlanTabela() {
    if (!ui.plTabela) return; const d = pl.dados;
    ui.plTodos = null; ui.plCorpo = null;
    if (pl.erro && !d) { ui.plTabela.replaceChildren(h('div', { class: 'erro erro-bloco', role: 'alert' }, h('div', { class: 'linha-erro' }, ic('alerta'), pl.erro), botao('Tentar de novo', { class: 'btn peq', onclick: () => carregarPlanilha(false) }, ic('atualizar')))); ui.plResumoFiltro.textContent = ''; return; }
    if (!d) { ui.plTabela.replaceChildren(h('div', { class: 'esq-tab', role: 'status', 'aria-label': 'Carregando a planilha' }, Array.from({ length: 7 }, () => h('div', { class: 'esqueleto', style: 'height:52px;border-radius:12px' })))); ui.plResumoFiltro.textContent = ''; return; }
    const vis = linhasFiltradas(), total = linhasDoDia().length, filtrando = Boolean(pl.transp.size || pl.q.trim());
    ui.plResumoFiltro.textContent = total ? (filtrando ? num(vis.length) + ' de ' + plural(total, 'pedido', 'pedidos') + ' neste dia' : plural(total, 'pedido', 'pedidos') + ' neste dia') : '';
    if (!vis.length) {
      ui.plTabela.replaceChildren(C.vazio(filtrando ? 'busca' : 'caixaEntrada', filtrando ? 'Nenhum pedido com esses filtros' : 'Nenhum pedido bipado ' + (pl.dia === hoje() ? 'hoje' : 'neste dia'), filtrando ? 'Tire alguma transportadora ou confira a busca.' : (pl.dia === hoje() ? 'Quando a expedição bipar os pedidos, eles aparecem aqui sozinhos.' : 'Escolha outro dia nas setas ou volte para hoje.')),
        h('div', { class: 'vazio-acoes' }, filtrando ? botao('Limpar filtros', { class: 'btn', onclick: () => { pl.transp.clear(); pl.q = ''; if (ui.plBusca) ui.plBusca.value = ''; aposFiltro(); } }, ic('fechar')) : null, podeVoltarHoje() ? botao('Ir para hoje', { class: 'btn primario', onclick: () => irParaDia(hoje()) }, ic('calendario')) : null));
      return;
    }
    const nSel = vis.filter((l) => pl.sel.has(l.id)).length;
    ui.plTodos = h('input', { type: 'checkbox', class: 'caixa-sel', 'aria-label': 'Marcar todos os pedidos do filtro (' + vis.length + ')', checked: (nSel === vis.length) || null, onchange: (ev) => marcarTodos(ev.target.checked) });
    ui.plTodos.indeterminate = nSel > 0 && nSel < vis.length;
    ui.plCorpo = h('tbody', null, vis.map(linhaPlan));
    ui.plTabela.replaceChildren(h('div', { class: 'tabela-rolagem tab-plan-rol', tabindex: '-1' }, h('table', { class: 'tabela tab-plan' }, h('caption', { class: 'sr', text: 'Pedidos bipados em ' + diaLongoTxt(pl.dia) }),
      h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'c-sel' }, h('label', { class: 'caixa-area', title: 'Marcar todos do filtro' }, ui.plTodos)), COLUNAS_PLANILHA.map((c) => h('th', { scope: 'col', class: c.cls, text: c.nome })))),
      ui.plCorpo)));
  }
  /* --- barra de ações --- */
  function renderPlanBarra() {
    if (!ui.plBarra) return;
    const d = pl.dados, vis = d ? linhasFiltradas() : [], sel = selecionadas();
    const k = { n: vis.length, s: sel.length, o: pl.ocupado, m: pl.menuAberto, g: new Set((sel.length ? sel : vis).map((l) => l.transportadora)).size, d: Boolean(d) };
    peca('plBarra', ui.plBarra, k, () => {
      if (!d || !vis.length) return null;
      const trs = new Set((sel.length ? sel : vis).map((l) => l.transportadora));
      const texto = sel.length ? [h('b', { class: 'num', text: num(sel.length) }), sel.length === 1 ? ' selecionado' : ' selecionados', h('span', { class: 'bar-sub', text: trs.size > 1 ? ' · ' + trs.size + ' transportadoras, uma folha para cada' : '' })] : [h('span', { class: 'bar-sem' }, 'Nenhum marcado: as ações valem para os ', h('b', { class: 'num', text: num(vis.length) }), vis.length === 1 ? ' pedido' : ' pedidos', ' do filtro')];
      const menu = h('div', { class: 'menu-exp' },
        h('button', { type: 'button', class: 'btn', 'aria-haspopup': 'menu', 'aria-expanded': String(Boolean(pl.menuAberto)), onclick: (ev) => { ev.stopPropagation(); pl.menuAberto = !pl.menuAberto; cache.plBarra = ''; renderPlanBarra(); if (pl.menuAberto) { const p = ui.plBarra.querySelector('[role="menuitem"]'); if (p) p.focus(); } } }, ic('baixar'), 'Exportar', ic('chevron')),
        pl.menuAberto ? h('div', { class: 'menu-lista', role: 'menu', onkeydown: (ev) => { if (ev.key === 'Escape') { pl.menuAberto = false; cache.plBarra = ''; renderPlanBarra(); const b = ui.plBarra.querySelector('[aria-haspopup]'); if (b) b.focus(); } } },
          h('button', { type: 'button', role: 'menuitem', class: 'menu-item', onclick: () => exportarPlanilha('xlsx') }, ic('planilha'), 'Baixar Excel'),
          h('button', { type: 'button', role: 'menuitem', class: 'menu-item', onclick: () => exportarPlanilha('csv') }, ic('baixar'), 'Baixar CSV')) : null);
      return h('div', { class: 'barra-acoes' + (sel.length ? ' com-sel' : ''), role: 'region', 'aria-label': 'Ações da planilha' },
        h('div', { class: 'bar-info', role: 'status' }, texto, sel.length ? h('button', { type: 'button', class: 'link-botao', onclick: () => { for (const l of sel) pl.sel.delete(l.id); sincronizarSelecao(); } }, 'Limpar seleção') : null),
        h('div', { class: 'bar-botoes' },
          h('button', { type: 'button', class: 'btn primario', disabled: pl.ocupado || null, onclick: abrirImprimir }, ic('impressora'), h('span', { class: 't-l', text: 'Imprimir lista de saída' }), h('span', { class: 't-c', 'aria-hidden': 'true', text: 'Imprimir' })),
          h('button', { type: 'button', class: 'btn', disabled: !sel.length || null, title: sel.length ? 'Trocar a transportadora dos marcados' : 'Marque os pedidos que vão sair por outra transportadora', onclick: abrirTroca }, ic('troca'), h('span', { class: 't-l', text: 'Trocar transportadora' }), h('span', { class: 't-c', 'aria-hidden': 'true', text: 'Trocar' })),
          sel.length === 1 ? h('button', { type: 'button', class: 'btn', onclick: () => abrirObservacao(sel[0]), title: 'Escrever ou ver as observações do pedido marcado' }, ic('comentario'), 'Observação') : null,
          menu));
    });
  }
  // fecha o menu de exportar ao clicar fora
  doc.addEventListener('click', (ev) => { if (pl.menuAberto && !(ev.target.closest && ev.target.closest('.menu-exp'))) { pl.menuAberto = false; cache.plBarra = ''; renderPlanBarra(); } });

  function renderPlanilha() { if (!ui.plCab) return; renderPlanCab(); renderPlanChips(); renderPlanTabela(); renderPlanBarra(); }

  /* --- exportar (Excel e CSV com as colunas da planilha) --- */
  function dadosExportar() {
    const esc = escopoAcao();
    return esc.linhas.map((l) => ({ data: l.data || pl.dia, pedido: l.pedido, cliente: l.cliente || '', nf: l.nf || '', transportadora: l.transportadora || '', transportadoraOriginal: l.transportadoraOriginal || '', trocada: Boolean(l.trocada), armazem: l.armazem || '', volumes: l.volumes, observacao: (l.observacoes || []).map((o) => o.texto).join(' | ') || l.observacao || '', bipadoEm: l.bipadoEm, bipadoPor: l.bipadoPor || '', impressoEm: l.impressoEm || null, saiuEntrega: l.saiuEntrega || null }));
  }
  async function exportarPlanilha(tipo) {
    pl.menuAberto = false; cache.plBarra = ''; renderPlanBarra();
    const linhas = dadosExportar(); if (!linhas.length) { C.toast('Não há pedidos para exportar.', 'erro'); return; }
    const nome = 'planilha-entrega-' + pl.dia + (pl.transp.size ? '-' + Array.from(pl.transp).map((n) => semAcento(n).replace(/[^a-z0-9]+/g, '')).join('-') : '');
    try {
      const X = root.SC9ExpedicaoXlsx; if (!X) throw new Error('O módulo de exportação não carregou.');
      if (tipo === 'xlsx') { C.toast('Montando o Excel…'); await X.baixarExcelPlanilha({ dia: pl.dia, linhas }, { diaTexto: diaLongoTxt(pl.dia) }, nome + '.xlsx'); C.toast('Arquivo ' + nome + '.xlsx baixado.'); }
      else { X.baixarCsvPlanilha({ dia: pl.dia, linhas }, nome + '.csv'); C.toast('Arquivo ' + nome + '.csv baixado.'); }
    } catch (e) { C.toast('Não consegui gerar o arquivo. ' + e.message, 'erro'); }
  }

  /* --- imprimir a lista de saída --- */
  function abrirImprimir() {
    const esc = escopoAcao(), linhas = esc.linhas; if (!linhas.length) return;
    const grupos = new Map(); for (const l of linhas) { const g = grupos.get(l.transportadora) || { nome: l.transportadora || 'Sem transportadora', n: 0, v: 0 }; g.n++; g.v += l.volumes || 0; grupos.set(l.transportadora, g); }
    const lista = Array.from(grupos.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const semNota = linhas.filter((l) => !l.nf).length, jaImpr = linhas.filter((l) => l.impressoEm).length, semVol = linhas.filter((l) => l.volumes == null).length;
    const msg = h('p', { class: 'rast-msg', role: 'status' });
    let dlg; const bOk = h('button', { type: 'button', class: 'btn primario grande', onclick: async () => {
      bOk.disabled = true; msgEm(msg, 'Montando a lista…'); pl.ocupado = true;
      try {
        const corpo = esc.selecionado || pl.q.trim() ? { dia: pl.dia, ids: linhas.map((l) => l.id) } : { dia: pl.dia, transportadoras: lista.map((g) => g.nome) };
        const j = await api('/api/expedicao/lista', { method: 'POST', corpo });
        if (!root.SC9ExpedicaoLista) throw new Error('O módulo de impressão não carregou. Recarregue a página.');
        dlg.fechar(); C.toast('Lista ' + (j.listaId || '') + ' pronta. Abrindo a impressão…');
        await root.SC9ExpedicaoLista.imprimir(j);
      } catch (e) { if (!seSessaoCaiu(e)) { bOk.disabled = false; msgEm(msg, e.message, 'erro'); } }
      pl.ocupado = false; carregarPlanilha(true);
    } }, ic('impressora'), 'Imprimir ' + plural(linhas.length, 'pedido', 'pedidos'));
    const aviso = (tom, icone, texto) => h('li', { class: 'aviso-lista ' + tom }, ic(icone), h('span', { text: texto }));
    const corpo = h('div', { class: 'imp-corpo' },
      h('p', { class: 'imp-intro', text: esc.selecionado ? 'Vai imprimir os pedidos que você marcou, uma folha por transportadora, com espaço para a assinatura.' : 'Nenhum pedido marcado: vai imprimir todos os pedidos do filtro atual, uma folha por transportadora.' }),
      h('ul', { class: 'imp-grupos' }, lista.map((g) => h('li', null, ic('nota'), h('b', { text: g.nome }), h('span', { text: plural(g.n, 'pedido', 'pedidos') + ' · ' + plural(g.v, 'volume', 'volumes') })))),
      (semNota || jaImpr || semVol) ? h('ul', { class: 'avisos-lista' },
        semNota ? aviso('ambar', 'relogio', plural(semNota, 'pedido ainda está', 'pedidos ainda estão') + ' aguardando nota. Eles saem na lista escritos "aguardando nota".') : null,
        jaImpr ? aviso('azul', 'info', plural(jaImpr, 'pedido já foi impresso', 'pedidos já foram impressos') + ' antes. Pode imprimir de novo, a gente guarda o registro.') : null,
        semVol ? aviso('suave', 'info', plural(semVol, 'pedido está', 'pedidos estão') + ' sem a quantidade de volumes anotada.') : null) : null,
      msg);
    dlg = abrirDialogo({ titulo: 'Imprimir lista de saída', sub: diaLongoTxt(pl.dia), corpo, rodape: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.fechar() }, 'Cancelar'), bOk], foco: '.primario' });
  }

  /* --- trocar a transportadora --- */
  function abrirTroca() {
    const sel = selecionadas(); if (!sel.length) return;
    const nomes = Array.from(new Set(((pl.dados && pl.dados.transportadoras) || []).map((g) => g.nome).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const atuais = new Map(); for (const l of sel) atuais.set(l.transportadora, (atuais.get(l.transportadora) || 0) + 1);
    const selTr = h('select', { id: 'troca-para', class: 'entrada', 'aria-required': 'true' }, h('option', { value: '', text: 'Escolha a transportadora…' }), ...nomes.map((n) => h('option', { value: n, text: n })), h('option', { value: '__outra', text: 'Outra (digitar o nome)…' }));
    const campoOutra = h('input', { id: 'troca-outra', class: 'entrada', maxlength: '40', placeholder: 'Nome da transportadora', autocomplete: 'off', hidden: true, 'aria-label': 'Nome da outra transportadora' });
    selTr.addEventListener('change', () => { campoOutra.hidden = selTr.value !== '__outra'; if (!campoOutra.hidden) campoOutra.focus(); });
    const motivo = h('textarea', { id: 'troca-motivo', class: 'entrada', maxlength: '200', rows: '3', placeholder: 'Por que vai sair por outra? (obrigatório)', 'aria-required': 'true' });
    const motivos = ['A transportadora não passou hoje', 'Pedido do cliente', 'Rota cheia', 'Corrigindo o cadastro'];
    const sugestoes = h('div', { class: 'sugestoes', role: 'group', 'aria-label': 'Motivos comuns' }, motivos.map((m) => h('button', { type: 'button', class: 'chip-sug', onclick: () => { motivo.value = m; motivo.dispatchEvent(new root.Event('input')); motivo.focus(); } }, m)));
    const msg = h('p', { class: 'rast-msg', role: 'status' });
    let dlg; const bOk = h('button', { type: 'button', class: 'btn primario grande', onclick: async () => {
      const para = (selTr.value === '__outra' ? campoOutra.value : selTr.value).trim(), mt = motivo.value.trim();
      if (!para) { msgEm(msg, 'Escolha para qual transportadora o pedido vai.', 'erro'); (selTr.value === '__outra' ? campoOutra : selTr).focus(); return; }
      if (mt.length < 3) { msgEm(msg, 'Escreva o motivo da troca (pelo menos 3 letras).', 'erro'); motivo.focus(); return; }
      bOk.disabled = true; msgEm(msg, 'Trocando…');
      try {
        const corpo = sel.length === 1 ? { id: sel[0].id, dia: pl.dia, para, motivo: mt } : { ids: sel.map((l) => ({ id: l.id, dia: pl.dia })), para, motivo: mt };
        await api('/api/expedicao/transportadora', { method: 'POST', corpo });
        dlg.fechar(); C.toast(plural(sel.length, 'pedido saiu', 'pedidos saíram') + ' como ' + para + '. A original ficou guardada.'); await carregarPlanilha(true);
      } catch (e) { if (!seSessaoCaiu(e)) { bOk.disabled = false; msgEm(msg, e.message, 'erro'); } }
    } }, ic('troca'), 'Trocar ' + plural(sel.length, 'pedido', 'pedidos'));
    const corpo = h('div', { class: 'troca-corpo' },
      h('p', { class: 'imp-intro' }, 'Vale para ', h('b', { text: plural(sel.length, 'pedido marcado', 'pedidos marcados') }), ' (hoje em: ', Array.from(atuais.entries()).map(([n, q]) => nomeTr(n) + ' ' + q).join(', '), ').'),
      h('div', null, h('label', { class: 'rotulo', for: 'troca-para', text: 'Vai sair por qual transportadora?' }), selTr, campoOutra),
      h('div', null, h('label', { class: 'rotulo', for: 'troca-motivo', text: 'Motivo da troca' }), motivo, h('div', { class: 'motivo-pe' }, sugestoes, contador(motivo, 200, 3))),
      h('p', { class: 'res-sem', role: 'note' }, ic('info'), 'A transportadora original do pedido continua guardada: nada se perde. Na planilha aparece "era Retira 4 → Brasil".'), msg);
    dlg = abrirDialogo({ titulo: 'Trocar a transportadora', sub: diaLongoTxt(pl.dia), corpo, rodape: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.fechar() }, 'Cancelar'), bOk], foco: '#troca-para' });
  }

  /* --- observação --- */
  function abrirObservacao(l) {
    const texto = h('textarea', { id: 'obs-texto', class: 'entrada', maxlength: '400', rows: '3', placeholder: 'Escreva o que a próxima pessoa precisa saber', 'aria-label': 'Nova observação' });
    const msg = h('p', { class: 'rast-msg', role: 'status' });
    const lista = (l.observacoes || []).slice().reverse();
    const historico = lista.length ? h('ol', { class: 'obs-hist', 'aria-label': 'Observações anteriores' }, lista.map((o) => h('li', null, h('p', { text: o.texto }), h('small', { text: (o.nome || o.por || '—') + ' · ' + (o.em ? C.curta(o.em) + ' às ' + horaDe(o.em) : '') })))) : h('p', { class: 'mudo peq', text: 'Ainda não há observações neste pedido.' });
    let dlg; const bOk = h('button', { type: 'button', class: 'btn primario grande', onclick: async () => {
      const t = texto.value.trim(); if (!t) { msgEm(msg, 'Escreva a observação antes de salvar.', 'erro'); texto.focus(); return; }
      bOk.disabled = true; msgEm(msg, 'Guardando…');
      try {
        const j = await api('/api/expedicao/observacao', { method: 'POST', corpo: { id: l.id, dia: pl.dia, texto: t } });
        l.observacoes = Array.isArray(j.observacoes) ? j.observacoes : (l.observacoes || []).concat([{ texto: t, por: estado.acesso.usuario, nome: estado.acesso.nome, em: new Date().toISOString() }]);
        l.observacao = l.observacoes.length ? l.observacoes[l.observacoes.length - 1].texto : t;
        dlg.fechar(); C.toast('Observação guardada.'); renderPlanTabela(); carregarPlanilha(true);
      } catch (e) { if (!seSessaoCaiu(e)) { bOk.disabled = false; msgEm(msg, e.message, 'erro'); } }
    } }, ic('ok'), 'Guardar observação');
    texto.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); bOk.click(); } });
    const corpo = h('div', { class: 'obs-corpo' },
      h('p', { class: 'obs-quem' }, h('b', { class: 'num', text: l.pedido }), ' · ', l.cliente || 'Sem dado do SC9', ' · ', l.transportadora || ''),
      h('div', null, h('span', { class: 'rotulo', text: 'Histórico' }), historico),
      h('div', null, h('label', { class: 'rotulo', for: 'obs-texto', text: 'Nova observação' }), texto, h('div', { class: 'motivo-pe' }, h('span', { class: 'mudo peq', text: 'Ela fica guardada e as anteriores não se perdem.' }), contador(texto, 400))), msg);
    dlg = abrirDialogo({ titulo: 'Observação do pedido', sub: 'Pedido ' + l.pedido, corpo, rodape: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.fechar() }, 'Fechar'), bOk], foco: '#obs-texto' });
  }

  function montarPlanilha() {
    ui.plCab = h('div', { class: 'plan-topo' });
    ui.plBusca = h('input', { id: 'pl-busca', class: 'entrada', type: 'search', placeholder: 'Pedido, cliente ou nota', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Buscar por pedido, cliente ou nota', value: pl.q, oninput: (ev) => { root.clearTimeout(pl.timer); const v = ev.target.value; pl.timer = root.setTimeout(() => { pl.q = v; aposFiltro(); }, 160); } });
    ui.plChips = h('div', { class: 'chips-tr-caixa' });
    ui.plResumoFiltro = h('span', { class: 'mudo peq resumo-filtro', role: 'status' });
    ui.plTabela = h('div', { class: 'tab-plan-caixa', 'aria-live': 'polite' });
    ui.plBarra = h('div', { class: 'barra-fixa' });
    const filtros = h('div', { class: 'filtros-plan' }, h('div', { class: 'campo-busca' }, ic('busca'), ui.plBusca), ui.plChips, ui.plResumoFiltro,
      h('button', { type: 'button', class: 'btn peq fantasma atualizar-plan', title: 'Atualizar agora', onclick: () => carregarPlanilha(false) }, ic('atualizar'), 'Atualizar'));
    const card = h('section', { class: 'card plan-card', 'aria-label': 'Pedidos do dia' }, filtros, ui.plTabela);
    renderPlanilha();
    return [ui.plCab, card, ui.plBarra];
  }

  /* ====================================================================================================================
   * ABA ENTREGAS (POD, prova de entrega): quem confere se o pedido chegou de verdade. O sistema guarda o link da transportadora
   * e o resultado da conferência; a foto/comprovante é conferida pela pessoa (o app não olha a foto sozinho).
   * ==================================================================================================================== */
  const pd = estado.pod;
  const POD = {
    pendente: { t: 'Pendente', curto: 'Ainda não conferi', tom: 'azul', i: 'relogio', ajuda: 'Ainda não conferi esta entrega.' },
    entregue: { t: 'Entregue', curto: 'Entregue', tom: 'verde', i: 'okCirculo', ajuda: 'A foto ou o comprovante mostra que chegou certo.' },
    divergente: { t: 'Divergente', curto: 'Divergente', tom: 'laranja', i: 'alerta', ajuda: 'Chegou, mas tem algo errado (nota diferente, foto que não bate, falta de item).' },
    nao_entregue: { t: 'Não entregue', curto: 'Não entregue', tom: 'vermelho', i: 'fechar', ajuda: 'A transportadora não entregou ou devolveu o pedido.' }
  };
  const FOTO = { sim: ['Sim, confere', 'ok'], nao: ['Não confere', 'fechar'], nao_vi: ['Não vi a foto', 'info'] };
  const statusPod = (l) => (l.pod && POD[l.pod.status] ? l.pod.status : 'pendente');
  const seloPod = (s) => { const d = POD[s] || POD.pendente; return h('span', { class: 'sit ' + d.tom }, ic(d.i), d.t); };
  const linkValido = (t) => /^https:\/\/\S+$/i.test(String(t || '').trim());
  function periodoPod() { const hj = hoje(); return { de: pd.de || somar(hj, -14), ate: pd.ate || hj }; }

  async function carregarEntregas(silencioso) {
    if (!estado.acesso || !estado.acesso.abas.pod) return;
    const meu = ++pd.seq, p = periodoPod();
    if (!silencioso) { pd.carregando = true; pd.erro = ''; renderEntregas(); }
    try {
      const j = await api('/api/expedicao/entregas?' + qs({ de: p.de, ate: p.ate, transportadora: pd.transportadora, status: pd.status, q: pd.q.trim(), pagina: pd.pagina, limite: LIMITE_POD }));
      if (meu !== pd.seq) return;
      pd.dados = j; pd.erro = ''; marcarAtualizado();
      for (const n of (Array.isArray(j.transportadoras) ? j.transportadoras.map((x) => (typeof x === 'string' ? x : x && x.nome)) : (j.linhas || []).map((l) => l.transportadora))) if (n) pd.nomes.add(n);
    } catch (e) { if (meu !== pd.seq || seSessaoCaiu(e)) return; if (!pd.dados || !silencioso) { pd.erro = e.message; if (!silencioso) pd.dados = null; } }
    pd.carregando = false; renderEntregas();
  }
  function filtrarEntregas(mud) { Object.assign(pd, mud, { pagina: 1 }); if (ui.pdBusca && 'q' in mud) ui.pdBusca.value = pd.q; carregarEntregas(false); }
  function definirPeriodoPod(dias) { const hj = hoje(); pd.preset = String(dias); pd.de = somar(hj, -(dias - 1)); pd.ate = hj; pd.pagina = 1; carregarEntregas(false); }

  function renderPodAjuda() {
    if (!ui.pdAjuda) return;
    if (PREF.ler('podAjudaFechada', Boolean(root.matchMedia && root.matchMedia('(max-width: 640px)').matches)) && !pd.ajudaAberta) { ui.pdAjuda.replaceChildren(h('button', { type: 'button', class: 'link-botao ajuda-reabrir', onclick: () => { pd.ajudaAberta = true; renderPodAjuda(); } }, ic('info'), 'Como conferir uma entrega?')); return; }
    const passo = (n, t, x) => h('li', null, h('span', { class: 'passo-n', 'aria-hidden': 'true', text: String(n) }), h('div', null, h('b', { text: t }), h('span', { text: x })));
    ui.pdAjuda.replaceChildren(h('section', { class: 'card pod-ajuda', 'aria-labelledby': 'pod-aj-t' },
      h('div', { class: 'card-titulo' }, h('div', null, h('h2', { id: 'pod-aj-t', text: 'Como conferir uma entrega' }), h('p', { class: 'mudo peq', text: 'POD quer dizer "prova de entrega": a foto ou o comprovante que a transportadora guarda quando entrega.' })),
        h('button', { type: 'button', class: 'btn peq fantasma', onclick: () => { PREF.gravar('podAjudaFechada', true); pd.ajudaAberta = false; renderPodAjuda(); } }, ic('fechar'), 'Entendi, esconder')),
      h('ol', { class: 'passos-pod' }, passo(1, 'Abra o link da transportadora', 'Toque em "Conferir" e depois em "Abrir link". A foto abre em outra aba.'), passo(2, 'Compare a foto com a nota', 'O nome, o endereço e a assinatura batem com a nota fiscal do pedido?'), passo(3, 'Marque o resultado', 'Entregue, divergente ou não entregue. Pode escrever uma observação.')),
      h('p', { class: 'res-sem', role: 'note' }, ic('info'), 'O sistema guarda o link e o resultado da sua conferência. A foto é conferida por você, o sistema não olha a foto sozinho.')));
  }
  function renderPodFiltros() {
    if (!ui.pdFiltros) return; const d = pd.dados, p = periodoPod();
    peca('pdFiltros', ui.pdFiltros, { p, preset: pd.preset, s: pd.status, t: pd.transportadora, n: Array.from(pd.nomes), r: d && d.resumo }, () => {
      const r = (d && d.resumo) || { pendente: 0, entregue: 0, divergente: 0, nao_entregue: 0 };
      const kpis = h('div', { class: 'pod-kpis', role: 'group', 'aria-label': 'Filtrar por resultado' }, ['pendente', 'entregue', 'divergente', 'nao_entregue'].map((k) => {
        const m = POD[k], on = pd.status === k;
        return h('button', { type: 'button', class: 'pod-kpi tom-' + m.tom + (on ? ' on' : ''), 'aria-pressed': String(on), title: on ? 'Mostrar todos' : 'Mostrar só: ' + m.t, onclick: () => filtrarEntregas({ status: on ? '' : k }) },
          h('span', { class: 'kpi-ic' }, ic(m.i)), h('b', { class: 'kpi-num num', text: num(r[k]) }), h('span', { class: 'kpi-nome', text: k === 'pendente' ? 'Pendentes' : k === 'entregue' ? 'Entregues' : k === 'divergente' ? 'Divergentes' : 'Não entregues' }), h('span', { class: 'kpi-sub', text: k === 'pendente' ? 'ainda sem conferência' : on ? 'filtrando, toque para tirar' : 'toque para filtrar' }));
      }));
      const presets = [[7, '7 dias'], [15, '15 dias'], [30, '30 dias'], [62, '62 dias']];
      const nomes = Array.from(pd.nomes).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      if (pd.transportadora && !nomes.includes(pd.transportadora)) nomes.push(pd.transportadora);
      return [kpis, h('div', { class: 'filtros-pod' },
        h('div', { class: 'abas-pequenas', role: 'group', 'aria-label': 'Período' }, presets.map(([n, t]) => h('button', { type: 'button', 'aria-pressed': String(pd.preset === String(n)), onclick: () => definirPeriodoPod(n) }, t))),
        h('div', { class: 'datas aberto' },
          h('label', { class: 'sr', for: 'pd-de', text: 'De' }), h('input', { id: 'pd-de', class: 'entrada', type: 'date', value: p.de, max: hoje(), 'aria-label': 'Data inicial', onchange: (ev) => { if (!ehDia(ev.target.value)) return; pd.de = ev.target.value; if (pd.ate < pd.de) pd.ate = pd.de; if (dif(pd.de, pd.ate) > 61) { pd.ate = somar(pd.de, 61); C.toast('A conferência mostra até 62 dias de uma vez. Ajustei a data final.'); } pd.preset = ''; pd.pagina = 1; carregarEntregas(false); } }),
          h('span', { class: 'mudo', text: 'até' }),
          h('label', { class: 'sr', for: 'pd-ate', text: 'Até' }), h('input', { id: 'pd-ate', class: 'entrada', type: 'date', value: p.ate, max: hoje(), 'aria-label': 'Data final', onchange: (ev) => { if (!ehDia(ev.target.value)) return; pd.ate = ev.target.value; if (!pd.de || pd.de > pd.ate) pd.de = pd.ate; if (dif(pd.de, pd.ate) > 61) { pd.de = somar(pd.ate, -61); C.toast('A conferência mostra até 62 dias de uma vez. Ajustei a data inicial.'); } pd.preset = ''; pd.pagina = 1; carregarEntregas(false); } })),
        h('select', { class: 'entrada sel-tr', 'aria-label': 'Transportadora', onchange: (ev) => filtrarEntregas({ transportadora: ev.target.value }) }, h('option', { value: '', text: 'Todas as transportadoras' }), ...nomes.map((n) => h('option', { value: n, text: n, selected: n === pd.transportadora }))))];
    });
  }
  function celLinkPod(l) {
    const link = (l.pod && l.pod.link) || (l.rastreio && l.rastreio.link) || '', cod = (l.pod && l.pod.codigo) || (l.rastreio && l.rastreio.codigo) || '';
    if (!link && !cod) return h('span', { class: 'mudo peq', text: 'Sem link ainda' });
    return h('span', { class: 'rast-ok' }, h('span', { class: 'rast-cod', text: cod || 'Link guardado' }), linkValido(link) ? h('a', { class: 'rast-abrir', href: link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Abrir o link da transportadora do pedido ' + l.pedido + ' (abre em outra aba)', title: 'Abrir o link da transportadora' }, ic('externo')) : null);
  }
  function celConferencia(l) {
    const p = l.pod; if (!p || !p.verificadoEm) return h('span', { class: 'mudo peq', text: 'Ninguém conferiu ainda' });
    const f = FOTO[p.fotoConfere];
    return [f ? h('span', { class: 'foto-tag ' + p.fotoConfere }, ic(f[1]), f[0]) : null, h('span', { class: 'sub', text: (primeiroNome(p.verificadoNome) || p.verificadoPor || '') + ' · ' + C.curta(p.verificadoEm) + ' ' + horaDe(p.verificadoEm) })];
  }
  function linhaPod(l, i) {
    const s = statusPod(l), m = POD[s];
    return h('tr', { class: 'linha-pod tom-' + m.tom, 'data-id': l.id },
      h('th', { scope: 'row', class: 'c-ped', 'data-label': 'Pedido' }, h('b', { class: 'num', text: l.pedido }), h('span', { class: 'sub num', text: l.nf ? 'NF ' + l.nf : 'aguardando nota' })),
      h('td', { class: 'c-cli', 'data-label': 'Cliente' }, h('span', { class: 'cli', text: l.cliente || 'Sem dado do SC9' }), l.observacao ? h('span', { class: 'sub', text: l.observacao }) : null),
      h('td', { class: 'c-tr', 'data-label': 'Transportadora' }, h('b', { text: l.transportadora || '—' }), h('span', { class: 'sub', text: (l.volumes == null ? 'volumes não informados' : plural(l.volumes, 'volume', 'volumes')) })),
      h('td', { class: 'c-saida', 'data-label': 'Saiu em' }, h('span', { class: 'num', text: l.dataSaida ? dataCurta(l.dataSaida) : dm(l.dia) })),
      h('td', { class: 'c-link', 'data-label': 'Link da transportadora' }, celLinkPod(l)),
      h('td', { class: 'c-res', 'data-label': 'Resultado' }, seloPod(s)),
      h('td', { class: 'c-conf', 'data-label': 'Conferência' }, celConferencia(l)),
      h('td', { class: 'c-acao' }, h('button', { type: 'button', class: 'btn peq' + (s === 'pendente' ? ' primario' : ''), 'aria-label': (s === 'pendente' ? 'Conferir' : 'Rever') + ' a entrega do pedido ' + l.pedido, onclick: () => abrirPod(l, i) }, ic(s === 'pendente' ? 'conferencia' : 'lapis'), s === 'pendente' ? 'Conferir' : 'Rever')));
  }
  function renderPodTabela() {
    if (!ui.pdTabela) return; const d = pd.dados;
    if (pd.erro && !d) { ui.pdTabela.replaceChildren(h('div', { class: 'erro erro-bloco', role: 'alert' }, h('div', { class: 'linha-erro' }, ic('alerta'), pd.erro), botao('Tentar de novo', { class: 'btn peq', onclick: () => carregarEntregas(false) }, ic('atualizar')))); ui.pdResumo.textContent = ''; return; }
    if (!d) { ui.pdTabela.replaceChildren(h('div', { class: 'esq-tab', role: 'status', 'aria-label': 'Carregando as entregas' }, Array.from({ length: 6 }, () => h('div', { class: 'esqueleto', style: 'height:56px;border-radius:12px' })))); ui.pdResumo.textContent = ''; return; }
    const filtrando = Boolean(pd.status || pd.transportadora || pd.q.trim());
    ui.pdResumo.textContent = num(d.total) + (d.total === 1 ? ' pedido' : ' pedidos') + (filtrando ? ' com os filtros' : ' que saíram no período');
    if (!d.linhas.length) { ui.pdTabela.replaceChildren(C.vazio(filtrando ? 'busca' : 'caixaEntrada', filtrando ? 'Nenhuma entrega com esses filtros' : 'Nenhum pedido saiu neste período', filtrando ? 'Tire algum filtro ou aumente o período.' : 'Quando os pedidos saírem na planilha de Entrega, eles aparecem aqui para conferir.'), filtrando ? h('div', { class: 'vazio-acoes' }, botao('Limpar filtros', { class: 'btn', onclick: () => filtrarEntregas({ status: '', transportadora: '', q: '' }) }, ic('fechar'))) : null); return; }
    const paginas = Math.max(1, Math.ceil(d.total / LIMITE_POD)), pg = d.pagina || pd.pagina, ini = (pg - 1) * LIMITE_POD + 1, fim = Math.min(d.total, ini + d.linhas.length - 1);
    ui.pdTabela.replaceChildren(h('div', { class: 'tabela-rolagem tab-pod-rol' + (pd.carregando ? ' atualizando' : '') }, h('table', { class: 'tabela tab-pod' }, h('caption', { class: 'sr', text: 'Pedidos que saíram, para conferir a entrega' }),
      h('thead', null, h('tr', null, ['Pedido', 'Cliente', 'Transportadora', 'Saiu em', 'Link da transportadora', 'Resultado', 'Conferência', ''].map((x) => h('th', { scope: 'col', text: x })))),
      h('tbody', null, d.linhas.map(linhaPod)))),
      h('nav', { class: 'paginacao', 'aria-label': 'Páginas das entregas' }, h('span', { class: 'mudo peq', text: 'Mostrando ' + num(ini) + ' a ' + num(fim) + ' de ' + num(d.total) }),
        h('div', { class: 'pag-bot' }, botao('Anterior', { class: 'btn peq', disabled: pg <= 1, onclick: () => { pd.pagina = pg - 1; carregarEntregas(false); } }, ic('esq')), h('span', { class: 'pag-n num', text: pg + ' de ' + paginas }), botao('Próxima', { class: 'btn peq', disabled: pg >= paginas, onclick: () => { pd.pagina = pg + 1; carregarEntregas(false); } }, ic('dir')))));
  }
  function renderEntregas() { if (!ui.pdFiltros) return; renderPodAjuda(); renderPodFiltros(); renderPodTabela(); }

  /* --- painel lateral de uma entrega --- */
  function abrirPod(l, i) {
    const p0 = l.pod || {}, rast = l.rastreio || {};
    const sug = !p0.link && linkValido(rast.link);
    const f = { status: p0.status && POD[p0.status] ? p0.status : '', foto: p0.fotoConfere || '', sugerido: false };
    const campoLink = h('input', { id: 'pod-link', class: 'entrada', value: p0.link || (sug ? rast.link : ''), maxlength: '300', placeholder: 'https://…', inputmode: 'url', autocomplete: 'off', 'aria-describedby': 'pod-link-ajuda' });
    const campoCod = h('input', { id: 'pod-cod', class: 'entrada', value: p0.codigo || rast.codigo || '', maxlength: '80', placeholder: 'Ex.: VX12345BR', autocomplete: 'off' });
    const obs = h('textarea', { id: 'pod-obs', class: 'entrada', rows: '3', maxlength: '400', placeholder: 'Se quiser, escreva o que viu (nome de quem assinou, problema, etc.)', value: p0.obs || '' }); obs.value = p0.obs || '';
    const msg = h('p', { class: 'rast-msg', role: 'status' });
    const abrirBtn = h('a', { class: 'btn primario abrir-link', target: '_blank', rel: 'noopener noreferrer', role: 'link' }, ic('externo'), 'Abrir link');
    const atualizaLink = () => { const t = campoLink.value.trim(); if (linkValido(t)) { abrirBtn.setAttribute('href', t); abrirBtn.removeAttribute('aria-disabled'); abrirBtn.classList.remove('desligado'); } else { abrirBtn.removeAttribute('href'); abrirBtn.setAttribute('aria-disabled', 'true'); abrirBtn.classList.add('desligado'); } };
    campoLink.addEventListener('input', atualizaLink); atualizaLink();
    abrirBtn.addEventListener('click', (ev) => { if (abrirBtn.getAttribute('aria-disabled') === 'true') { ev.preventDefault(); msgEm(msg, 'Cole primeiro o link da transportadora (começa com https://).', 'erro'); campoLink.focus(); } });
    campoLink.addEventListener('paste', (ev) => { const t = (ev.clipboardData || root.clipboardData).getData('text') || ''; const m = t.match(/https?:\/\/\S+/i); if (m && t.trim() !== m[0]) { ev.preventDefault(); campoLink.value = m[0].slice(0, 300); atualizaLink(); } });
    const grupoFoto = h('div', { class: 'opcoes', role: 'radiogroup', 'aria-labelledby': 'pod-foto-t' });
    const grupoSt = h('div', { class: 'opcoes st', role: 'radiogroup', 'aria-labelledby': 'pod-st-t' });
    const dica = h('p', { class: 'mudo peq dica-sug', role: 'status' });
    const marcaOpcao = (grupo, valor) => { for (const b of grupo.querySelectorAll('button')) { const on = b.getAttribute('data-v') === valor; b.setAttribute('aria-checked', String(on)); b.tabIndex = on || (!valor && b === grupo.querySelector('button')) ? 0 : -1; b.classList.toggle('on', on); } };
    const opcao = (grupo, valor, cls, icone, t, sub, aoEscolher) => h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-v': valor, class: 'opcao ' + cls, onclick: () => aoEscolher(valor), onkeydown: (ev) => { if (!/^Arrow(Left|Right|Up|Down)$/.test(ev.key)) return; ev.preventDefault(); const bs = Array.from(grupo.querySelectorAll('button')), k = bs.indexOf(ev.currentTarget), n = bs[(k + (/Left|Up/.test(ev.key) ? -1 : 1) + bs.length) % bs.length]; n.focus(); n.click(); } }, h('span', { class: 'op-ic' }, ic(icone)), h('span', { class: 'op-txt' }, h('b', { text: t }), sub ? h('small', { text: sub }) : null));
    const escolherFoto = (v) => {
      f.foto = v; marcaOpcao(grupoFoto, v);
      if (!f.status || f.sugerido) { const s = v === 'sim' ? 'entregue' : v === 'nao' ? 'divergente' : ''; if (s) { f.status = s; f.sugerido = true; marcaOpcao(grupoSt, s); dica.textContent = 'Sugerimos "' + POD[s].t + '". Mude se for outro caso.'; } }
    };
    const escolherStatus = (v) => { f.status = v; f.sugerido = false; dica.textContent = ''; marcaOpcao(grupoSt, v); };
    grupoFoto.append(opcao(grupoFoto, 'sim', 'ok', 'ok', 'Sim, confere', 'A foto bate com a nota', escolherFoto), opcao(grupoFoto, 'nao', 'ruim', 'fechar', 'Não confere', 'Algo está diferente', escolherFoto), opcao(grupoFoto, 'nao_vi', 'neutro', 'info', 'Não vi a foto', 'Sem foto ou não abriu', escolherFoto));
    for (const k of ['entregue', 'divergente', 'nao_entregue', 'pendente']) { const m = POD[k]; grupoSt.append(opcao(grupoSt, k, 'st-' + m.tom, m.i, m.t, m.ajuda, escolherStatus)); }
    marcaOpcao(grupoFoto, f.foto); marcaOpcao(grupoSt, f.status);
    const hist = (p0.historico || l.podHistorico || []).slice().reverse();
    const proximo = (() => { const ls = (pd.dados && pd.dados.linhas) || []; for (let k = i + 1; k < ls.length; k++) if (statusPod(ls[k]) === 'pendente') return ls[k]; return null; })();
    let dlg;
    async function salvar(irProximo, botao) {
      const link = campoLink.value.trim(), cod = campoCod.value.trim();
      if (!f.status) { msgEm(msg, 'Escolha o resultado da entrega (passo 3).', 'erro'); grupoSt.querySelector('button').focus(); return; }
      if (link && !linkValido(link)) { msgEm(msg, 'O link precisa começar com https://', 'erro'); campoLink.focus(); return; }
      if (f.status === 'entregue' && !f.foto) { msgEm(msg, 'Diga se a foto confere com a nota (passo 2): Sim, Não ou Não vi.', 'erro'); grupoFoto.querySelector('button').focus(); return; }
      const bs = dlg.el.querySelectorAll('.rodape-pod button'); bs.forEach((b) => { b.disabled = true; }); msgEm(msg, 'Guardando a conferência…');
      try {
        const j = await api('/api/expedicao/pod', { method: 'POST', corpo: { id: l.id, dia: l.dia, status: f.status, link, codigo: cod, fotoConfere: f.foto, obs: obs.value.trim() } });
        l.pod = (j && j.pod) || { status: f.status, link, codigo: cod, fotoConfere: f.foto, obs: obs.value.trim(), verificadoNome: estado.acesso.nome, verificadoPor: estado.acesso.usuario, verificadoEm: new Date().toISOString() };
        dlg.fechar(); C.toast('Conferência do pedido ' + l.pedido + ' guardada.');
        if (irProximo && proximo) abrirPod(proximo, (pd.dados.linhas || []).indexOf(proximo));
        await carregarEntregas(true);
      } catch (e) { if (!seSessaoCaiu(e)) { bs.forEach((b) => { b.disabled = false; }); msgEm(msg, e.message, 'erro'); } }
    }
    const resumoPedido = h('div', { class: 'pod-pedido' }, h('div', null, h('b', { class: 'res-ped num', text: l.pedido }), h('span', { class: 'sub', text: l.nf ? 'Nota fiscal ' + l.nf : 'Aguardando nota' })), h('div', { class: 'pod-pedido-info' }, h('b', { text: l.cliente || 'Sem dado do SC9' }), h('span', { text: [l.transportadora, l.dataSaida ? 'saiu em ' + dataCurta(l.dataSaida) : '', l.volumes != null ? plural(l.volumes, 'volume', 'volumes') : ''].filter(Boolean).join(' · ') }), l.observacao ? h('span', { class: 'sub', text: 'Obs.: ' + l.observacao }) : null), seloPod(statusPod(l)));
    const corpo = h('div', { class: 'pod-corpo' }, resumoPedido,
      h('section', { class: 'pod-passo' }, h('h4', null, h('span', { class: 'passo-n', 'aria-hidden': 'true', text: '1' }), 'Abra o link da transportadora'),
        h('div', { class: 'link-linha' }, h('div', { class: 'link-campo' }, h('label', { class: 'sr', for: 'pod-link', text: 'Link da transportadora' }), campoLink), abrirBtn),
        h('p', { class: 'mudo peq', id: 'pod-link-ajuda', text: sug ? 'Colocamos o link do rastreio que já estava guardado. Se for outro, cole aqui o link da foto.' : 'Cole aqui o link que a transportadora (Velox) mandou. Ele fica guardado no pedido.' }),
        h('div', { class: 'cod-linha' }, h('label', { class: 'rotulo', for: 'pod-cod', text: 'Código (opcional)' }), campoCod)),
      h('section', { class: 'pod-passo' }, h('h4', { id: 'pod-foto-t' }, h('span', { class: 'passo-n', 'aria-hidden': 'true', text: '2' }), 'A foto ou comprovante confere com a nota?'), grupoFoto),
      h('section', { class: 'pod-passo' }, h('h4', { id: 'pod-st-t' }, h('span', { class: 'passo-n', 'aria-hidden': 'true', text: '3' }), 'Qual é o resultado?'), grupoSt, dica),
      h('section', { class: 'pod-passo' }, h('h4', null, h('label', { for: 'pod-obs', text: 'Observação (opcional)' })), obs, h('div', { class: 'motivo-pe' }, h('span'), contador(obs, 400))),
      p0.verificadoEm ? h('p', { class: 'res-sem', role: 'note' }, ic('info'), 'Última conferência: ' + (p0.verificadoNome || p0.verificadoPor || '') + ' em ' + C.curta(p0.verificadoEm) + ' às ' + horaDe(p0.verificadoEm) + '.') : null,
      hist.length > 0 ? h('details', { class: 'pod-hist' }, h('summary', null, 'Histórico das conferências (' + hist.length + ')'), h('ol', null, hist.map((x) => h('li', null, seloPod(x.status), h('span', { class: 'sub', text: (x.nome || x.por || '') + ' · ' + (x.em ? C.curta(x.em) + ' ' + horaDe(x.em) : '') + (x.obs ? ' · ' + x.obs : '') }))))) : null,
      h('p', { class: 'mudo peq nota-pod', text: 'O sistema guarda o link e o resultado da sua conferência; a foto é conferida por você.' }), msg);
    const bSalvar = h('button', { type: 'button', class: 'btn primario grande', onclick: () => salvar(false) }, ic('ok'), 'Guardar conferência');
    const bProx = proximo ? h('button', { type: 'button', class: 'btn grande', onclick: () => salvar(true) }, 'Guardar e ir para o próximo', ic('dir')) : null;
    dlg = abrirDialogo({ lado: true, titulo: 'Conferir a entrega', sub: 'Pedido ' + l.pedido, corpo, rodape: h('div', { class: 'rodape-pod' }, bSalvar, bProx), foco: '#pod-link' });
  }
  function montarEntregas() {
    ui.pdAjuda = h('div', { class: 'pod-ajuda-caixa' });
    ui.pdFiltros = h('div', { class: 'pod-filtros-caixa' });
    ui.pdBusca = h('input', { id: 'pd-busca', class: 'entrada', type: 'search', placeholder: 'Pedido, cliente ou nota', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Buscar por pedido, cliente ou nota', value: pd.q, oninput: (ev) => { root.clearTimeout(pd.timer); const v = ev.target.value; pd.timer = root.setTimeout(() => { pd.q = v; pd.pagina = 1; carregarEntregas(false); }, 350); } });
    ui.pdResumo = h('span', { class: 'mudo peq resumo-filtro', role: 'status' });
    ui.pdTabela = h('div', { class: 'tab-pod-caixa', 'aria-live': 'polite' });
    const card = h('section', { class: 'card pod-card', 'aria-labelledby': 'pod-t' },
      h('div', { class: 'card-titulo' }, h('div', null, h('h2', { id: 'pod-t', text: 'Entregas dos pedidos que saíram' }), h('p', { class: 'mudo peq', text: 'Confira se cada pedido chegou de verdade e guarde o resultado.' })), h('button', { type: 'button', class: 'btn peq fantasma', onclick: () => carregarEntregas(false) }, ic('atualizar'), 'Atualizar')),
      ui.pdFiltros, h('div', { class: 'filtros-ped pod-busca' }, h('div', { class: 'campo-busca' }, ic('busca'), ui.pdBusca), ui.pdResumo), ui.pdTabela);
    renderEntregas();
    return [ui.pdAjuda, card];
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
    atualizarSelo();
    if (!ui.geralMontada) return;
    renderCabecalho(); renderErro(); renderImport(); renderFunil(); renderKpis(); renderTempos(); renderGrafico(); renderTransp(); if (TV) pendTv(); else { renderPend(); renderTabela(); }
  }
  function marcarAtualizado() { estado.ultima = Date.now(); estado.falhouAtualizar = false; atualizarSelo(); }
  function telaLogin() {
    const l = estado.login, semAcesso = estado.sessao && estado.sessao.authed;
    return h('main', { class: 'pagina estreita' }, h('section', { class: 'card login-caixa' },
      h('div', { class: 'login-topo' }, C.vazio('caixa', '', null)), h('h2', { text: semAcesso ? 'Falta liberar o seu acesso' : EMBED ? 'Sua sessão expirou' : 'Entrar na Expedição' }),
      h('p', { class: 'mudo peq', style: 'margin:4px 0 14px', text: semAcesso ? 'Seu usuário ainda não tem acesso à Expedição. Peça ao administrador para liberar (bipar, planilha de entrega ou conferir entregas), ou entre com outro usuário.' : EMBED ? 'Entre de novo no SC9 e volte para esta aba, ou entre aqui mesmo com o usuário e a senha do SC9 (o administrador deixa o usuário vazio).' : 'Use o usuário e a senha do SC9. O administrador deixa o usuário vazio.' }),
      h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); entrar(); } },
        h('div', null, h('label', { class: 'rotulo', for: 'u', text: 'Usuário' }), h('input', { id: 'u', class: 'entrada', value: l.usuario, autocomplete: 'username', oninput: (ev) => { l.usuario = ev.target.value; } })),
        h('div', null, h('label', { class: 'rotulo', for: 's', text: 'Senha' }), h('input', { id: 's', class: 'entrada', type: 'password', value: l.senha, autocomplete: 'current-password', oninput: (ev) => { l.senha = ev.target.value; } })),
        h('button', { class: 'btn primario', type: 'submit', disabled: l.entrando, text: l.entrando ? 'Entrando…' : 'Entrar' }),
        l.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), l.erro) : null)));
  }

  /* ---------- Visão geral (o Painel de antes) ---------- */
  function montarGeral() {
    ui.cab = h('div', { class: 'cab-pagina' });
    ui.erro = h('div', { class: 'bloco-erro' });
    ui.import = h('div', { class: 'bloco-import' });
    ui.funil = h('div', { class: 'bloco-funil' });
    ui.kpis = h('div', { class: 'kpis2' });
    ui.tempos = h('div', { class: 'tempos' });
    ui.graf = h('section', { class: 'card graf', 'aria-label': 'Pedidos por dia' });
    ui.transp = h('section', { class: 'card transp', 'aria-label': 'Por transportadora' });
    ui.pend = h('div', { class: 'pend-corpo' });
    ui.pendSecao = h('section', { class: 'card pend-card', 'aria-labelledby': 'pend-t' }, h('div', { class: 'card-titulo' }, h('div', null, h('h2', { id: 'pend-t', text: TV ? 'O que precisa de atenção' : 'Pendências' }), TV ? null : h('p', { class: 'mudo peq', text: 'Pedidos parados em alguma etapa. Toque num pedido para ver todos os detalhes dele.' }))), ui.pend);
    ui.chips = h('div', { class: 'chips-f' });
    ui.tabCorpo = h('div', { class: 'tab-corpo', 'aria-live': 'polite' });
    ui.tabCabeca = h('div', { class: 'card-titulo' }, h('div', null, h('h2', { id: 'tab-t', text: 'Pedido a pedido' }), ui.resumoFiltro = h('p', { class: 'mudo peq resumo-filtro', role: 'status' })));
    ui.tabSecao = h('section', { class: 'card tab-card', 'aria-labelledby': 'tab-t' }, ui.tabCabeca, montarFiltros(), ui.chips, ui.tabCorpo);
    const meio = h('div', { class: 'duas' }, h('div', { class: 'col-esq' }, ui.graf, ui.tempos), ui.transp);
    return [ui.cab, ui.erro, ui.import, ui.funil, ui.kpis, meio, ui.pendSecao, TV ? null : ui.tabSecao,
      h('p', { class: 'rodape-nota' }, ic('info'), 'A tela se atualiza sozinha a cada minuto enquanto estiver aberta. "Sair" = o pedido aparecer na planilha de Entrega.')];
  }

  /* ---------- abas ---------- */
  const ABAS = [
    { k: 'bipar', hash: 'bipar', longo: 'Bipar', curto: 'Bipar', i: 'bipe', dica: 'Bipar os pedidos que chegaram' },
    { k: 'planilha', hash: 'planilha', longo: 'Planilha de entrega', curto: 'Planilha', i: 'planilha', dica: 'Planilha de entrega do dia, lista de saída' },
    { k: 'entregas', hash: 'entregas', longo: 'Entregas (POD)', curto: 'Entregas', i: 'conferencia', dica: 'Conferir se os pedidos foram entregues' },
    { k: 'geral', hash: 'geral', longo: 'Visão geral', curto: 'Geral', i: 'painel', dica: 'Painel do desempenho da expedição' }
  ];
  const abaPermitida = (k) => { const a = estado.acesso && estado.acesso.abas; return Boolean(a && (k === 'geral' ? a.visaoGeral : a[k === 'entregas' ? 'pod' : k])); };
  const abasPermitidas = () => (TV ? ['geral'].filter(abaPermitida) : ABAS.map((a) => a.k).filter(abaPermitida));
  function abaInicial(lista) {
    const h0 = (root.location.hash || '').replace('#', '');
    const porHash = ABAS.find((a) => a.hash === h0); if (porHash && lista.includes(porHash.k)) return porHash.k;
    const lembrada = PREF.ler('aba', ''); if (lista.includes(lembrada)) return lembrada;
    return lista[0];
  }
  function montarBarraAbas(lista) {
    const botoes = lista.map((k) => { const a = ABAS.find((x) => x.k === k); return h('button', { type: 'button', role: 'tab', id: 'tab-' + k, class: 'aba-exp', 'aria-selected': 'false', 'aria-controls': 'painel-' + k, tabindex: '-1', title: a.dica, 'data-aba': k, onclick: () => ativarAba(k, true) }, ic(a.i), h('span', { class: 'aba-longo', text: a.longo }), h('span', { class: 'aba-curto', 'aria-hidden': 'true', text: a.curto })); });
    const lista2 = h('div', { class: 'abas-in', role: 'tablist', 'aria-label': 'Seções da Expedição', onkeydown: (ev) => {
      if (!/^(ArrowLeft|ArrowRight|Home|End)$/.test(ev.key)) return; ev.preventDefault();
      const i = botoes.indexOf(doc.activeElement); if (i < 0) return;
      const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? botoes.length - 1 : (i + (ev.key === 'ArrowLeft' ? -1 : 1) + botoes.length) % botoes.length;
      botoes[n].focus(); botoes[n].click();
    } }, botoes);
    return h('nav', { class: 'abas-exp', 'aria-label': 'Seções da Expedição' }, lista2);
  }
  function ativarAba(k, guardar) {
    if (!ui.paineis || !ui.paineis[k]) return;
    estado.tab = k;
    for (const [nome, el] of Object.entries(ui.paineis)) el.hidden = nome !== k;
    const mainEl = doc.querySelector('main.exp-pg'); if (mainEl) mainEl.classList.toggle('larga', k === 'planilha'); if (ui.abas) ui.abas.classList.toggle('larga', k === 'planilha');
    if (ui.abas) for (const b of ui.abas.querySelectorAll('[role="tab"]')) { const on = b.getAttribute('data-aba') === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    if (guardar) { PREF.gravar('aba', k); try { root.history.replaceState(null, '', root.location.pathname + root.location.search + '#' + k); } catch (e) { /* sem histórico: segue */ } }
    const primeira = !ui.abaMontada[k];
    if (primeira) {
      ui.abaMontada[k] = true;
      const el = ui.paineis[k];
      if (k === 'bipar') el.replaceChildren(...[].concat(montarBipar()));
      else if (k === 'planilha') el.replaceChildren(...[].concat(montarPlanilha()));
      else if (k === 'entregas') el.replaceChildren(...[].concat(montarEntregas()));
      else { el.replaceChildren(...[].concat(montarGeral()).filter(Boolean)); ui.geralMontada = true; }
    }
    if (k === 'bipar') { if (primeira || Date.now() - bp.ult > 20000) { bp.ult = Date.now(); carregarHistorico(!primeira); } focarBipe(); }
    else if (k === 'planilha') { if (primeira || Date.now() - pl.ultima > 20000) carregarPlanilha(!primeira && Boolean(pl.dados)); }
    else if (k === 'entregas') { if (primeira || Date.now() - pd.ult > 20000) { pd.ult = Date.now(); carregarEntregas(!primeira && Boolean(pd.dados)); } }
    else if (k === 'geral') { if (primeira) { estado.carregando = true; recarregar(false); } else if (Date.now() - estado.ultima > 20000) recarregar(true); else renderTudo(); }
  }
  function desenhar() {
    const logado = estado.sessao && estado.sessao.pode;
    if (!estado.sessao) { $raiz.replaceChildren(cabeca(), h('main', { class: 'pagina' }, C.esqueleto(3))); return; }
    if (!logado) { ui.montada = false; for (const k of Object.keys(cache)) delete cache[k]; $raiz.replaceChildren(cabeca(), telaLogin()); return; }
    if (ui.montada) return;
    for (const k of Object.keys(cache)) delete cache[k];
    const lista = abasPermitidas();
    if (!lista.length) { ui.montada = false; $raiz.replaceChildren(cabeca(), h('main', { class: 'pagina estreita' }, h('section', { class: 'card login-caixa' }, C.vazio('caixa', 'Esta tela não está liberada para você', 'O modo TV e a Visão geral precisam do acesso à planilha de entrega. Peça ao administrador.')))); return; }
    ui.abaMontada = {}; ui.geralMontada = false; ui.paineis = {};
    const unica = lista.length === 1;
    ui.abas = unica ? null : montarBarraAbas(lista);
    const paineis = lista.map((k) => (ui.paineis[k] = h('section', { class: 'painel-aba painel-' + k, id: 'painel-' + k, role: unica ? null : 'tabpanel', 'aria-labelledby': unica ? null : 'tab-' + k, hidden: true })));
    $raiz.replaceChildren(...[montarTopo(), ui.abas, h('main', { class: 'pagina exp-pg' }, paineis)].filter(Boolean));
    ui.montada = true;
    ativarAba(abaInicial(lista), false);
  }
  root.addEventListener('hashchange', () => { if (!ui.montada || !ui.paineis) return; const a = ABAS.find((x) => x.hash === (root.location.hash || '').replace('#', '')); if (a && ui.paineis[a.k] && estado.tab !== a.k) ativarAba(a.k, false); });
  // a tela de Bipar sempre devolve o foco ao campo: um clique perdido não pode atrapalhar o leitor
  doc.addEventListener('click', (ev) => { if (estado.tab === 'bipar' && ui.bipeCampo && !estado.dialogos && !interativo(ev.target) && !root.getSelection().toString()) focarBipe(); });
  doc.addEventListener('keydown', (ev) => { if (estado.tab === 'bipar' && ui.bipeCampo && !estado.dialogos && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.length === 1 && /[0-9]/.test(ev.key) && !/^(INPUT|TEXTAREA|SELECT)$/.test((doc.activeElement || {}).tagName || '')) focarBipe(); });

  /* ---------- atualização automática ---------- */
  function atualizarSeCabe() {
    if (doc.hidden || !ui.montada || !estado.sessao || !estado.sessao.pode || estado.dialogos) return;
    if (estado.imp.fase === 'gravando' || estado.exp.aberta) return;
    if (estado.tab === 'geral') recarregar(true);
    else if (estado.tab === 'planilha') carregarPlanilha(true);
    else if (estado.tab === 'entregas') carregarEntregas(true);
    else if (estado.tab === 'bipar') carregarHistorico(true);
  }
  root.setInterval(atualizarSeCabe, 60000);
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden && estado.ultima && Date.now() - estado.ultima > 60000) atualizarSeCabe(); });
  if (TV) root.setInterval(() => { if (!doc.hidden) { const r = doc.querySelector('.tv-hora'); if (r) r.textContent = C.horaBR(new Date().toISOString()); } }, 15000);

  (async () => {
    iniciarPeriodo();
    await carregarSessao();
    desenhar();
  })();
})(window);
