/* Central de Pedidos · painel da logística: pedidos de prioridade enviados pelas vendedoras. Entra com usuário e senha do SC9
 * (administrador ou quem tem o acesso "Ocorr."). Indicadores, tabela com filtros e painel lateral para analisar, assumir, responder,
 * comentar e mudar o status. JavaScript puro; tudo do servidor entra como textContent. */
(function (root) {
  'use strict';
  const C = root.Central, h = C.h, ic = C.icone;
  const $raiz = root.document.getElementById('raiz');
  const CAB = { 'Content-Type': 'application/json', 'X-SC9-App': '1' };
  const ACAO = { criado: 'Pedido criado', reforco: 'Pedido reforçado', status: 'Status', assumir: 'Assumiu', interno: 'Comentário interno' };
  const VAZIO = { nivel: '', status: '', vendedora: '', filial: '', de: '', ate: '' };
  const ATIVOS = ['recebida', 'em_analise', 'aprovada', 'em_atendimento'];
  const estado = { sessao: null, login: { usuario: '', senha: '', erro: '', entrando: false }, dados: null, erro: '', respostas: {}, internos: {}, filtro: Object.assign({}, VAZIO), aberta: null, gavAnim: null, salvando: '', vistos: null, novos: new Set(), link: null, linkErro: '', mostraLink: false, carregando: true };

  async function pedir(url, opcoes) {
    const r = await root.fetch(url, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, opcoes, { headers: CAB }));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) { estado.sessao = Object.assign({}, estado.sessao, { pode: false }); throw new Error(r.status === 401 ? 'Entre com usuário e senha.' : 'Seu usuário não tem o acesso "Ocorrências". Peça ao administrador para liberar.'); }
    if (!r.ok) throw new Error(j.error || 'Não consegui falar com o servidor.');
    return j;
  }
  async function carregarSessao() {
    try {
      const j = await (await root.fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' })).json();
      estado.sessao = { authed: Boolean(j.authed), nome: j.nome || j.usuario || '', admin: j.role === 'admin', pode: Boolean(j.authed && (j.role === 'admin' || (j.perfis || []).includes('ocorrencias'))) };
    } catch (e) { estado.sessao = { authed: false, pode: false }; }
  }
  async function carregar(silencioso) {
    if (!estado.sessao || !estado.sessao.pode) { estado.carregando = false; return; }
    try {
      const j = await pedir('/api/prioridades');
      const ids = new Set(j.ativos.map((l) => l.id));
      if (estado.vistos) estado.novos = new Set([...ids].filter((i) => !estado.vistos.has(i)).concat([...estado.novos].filter((i) => ids.has(i))));
      estado.vistos = ids; estado.dados = j; estado.erro = '';
      root.document.title = (j.ativos.length ? '(' + j.ativos.length + ') ' : '') + 'Painel da logística · ' + C.NOME;
    } catch (e) { estado.erro = e.message; }
    estado.carregando = false;
    const ativo = root.document.activeElement;
    if (!silencioso || !ativo || ativo === root.document.body || !/^(TEXTAREA|INPUT|SELECT)$/.test(ativo.tagName)) desenhar();
  }
  async function carregarLink() {
    if (!estado.sessao || !estado.sessao.admin) return;
    try { estado.link = await pedir('/api/vendedoras-link'); estado.linkErro = ''; if (!estado.link.token) estado.mostraLink = true; } catch (e) { estado.linkErro = e.message; }
    desenhar();
  }
  async function acaoLink(acao) {
    if (acao === 'gerar' && estado.link && estado.link.token && !root.confirm('Gerar um link novo faz o link antigo parar de funcionar. As vendedoras vão precisar do novo link. Continuar?')) return;
    if (acao === 'desativar' && !root.confirm('Desativar o link das vendedoras? Ninguém consegue abrir até gerar outro.')) return;
    try { estado.link = await pedir('/api/vendedoras-link', { method: 'POST', body: JSON.stringify({ acao }) }); estado.linkErro = ''; C.toast(acao === 'gerar' ? 'Link gerado.' : 'Link desativado.'); } catch (e) { estado.linkErro = e.message; }
    desenhar();
  }
  const urlDoLink = () => (estado.link && estado.link.token ? root.location.origin + '/vendedoras.html?k=' + estado.link.token : '');

  async function entrar() {
    const l = estado.login; l.entrando = true; l.erro = ''; desenhar();
    try {
      const r = await root.fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: CAB, body: JSON.stringify({ usuario: l.usuario, password: l.senha }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'Não consegui entrar.');
      l.senha = ''; await carregarSessao(); await carregar(); carregarLink();
    } catch (e) { l.erro = e.message; }
    l.entrando = false; desenhar();
  }
  async function sair() { try { await root.fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: CAB }); } catch (e) { /* segue */ } estado.dados = null; estado.link = null; estado.aberta = null; await carregarSessao(); desenhar(); }

  /* ---------- ações sobre uma solicitação ---------- */
  async function enviarAcao(l, corpo, aviso) {
    estado.salvando = l.id; estado.erro = ''; desenhar();
    try {
      estado.dados = await pedir('/api/prioridades', { method: 'POST', body: JSON.stringify(Object.assign({ id: l.id }, corpo)) });
      estado.vistos = new Set(estado.dados.ativos.map((x) => x.id)); C.toast(aviso); estado.salvando = ''; desenhar(); return true;
    } catch (e) { C.toast(e.message, 'erro'); }
    estado.salvando = ''; desenhar(); return false;
  }
  async function responder(l, status) {
    const resposta = (estado.respostas[l.id] || '').trim();
    if (status === 'nao_aprovada' && !resposta) { C.toast('Explique o motivo na resposta para a vendedora.', 'erro'); return; }
    if (await enviarAcao(l, { acao: 'status', status, resposta }, 'Status atualizado: ' + C.STATUS[status] + '. A vendedora já vê.')) delete estado.respostas[l.id];
  }
  const assumir = (l) => enviarAcao(l, { acao: 'assumir' }, 'Você assumiu este pedido de prioridade.');
  async function comentar(l) {
    const texto = (estado.internos[l.id] || '').trim();
    if (!texto) { C.toast('Escreva o comentário interno.', 'erro'); return; }
    if (await enviarAcao(l, { acao: 'interno', texto }, 'Comentário interno salvo (a vendedora não vê).')) delete estado.internos[l.id];
  }

  /* ---------- dados derivados e filtros ---------- */
  const filialDe = (l) => l.filial || (l.situacao && l.situacao.armazem) || '';
  const todas = () => (estado.dados ? estado.dados.ativos.concat(estado.dados.demais) : []);
  const hoje = () => C.diaSP(new Date().toISOString());
  const passa = (l) => {
    const f = estado.filtro;
    if (f.nivel && l.nivel !== f.nivel) return false;
    if (f.status && l.status !== f.status) return false;
    if (f.vendedora && String(l.pedidoPor || '').toLowerCase() !== f.vendedora) return false;
    if (f.filial && filialDe(l) !== f.filial) return false;
    const dia = C.diaSP(l.criadoEm);
    if (f.de && dia < f.de) return false;
    if (f.ate && dia > f.ate) return false;
    return true;
  };
  const algumFiltro = () => Object.values(estado.filtro).some(Boolean);
  const PESO = { urgente: 3, alta: 2, media: 1, normal: 0 };
  const ordenadas = () => {
    const l = todas().filter(passa);
    return l.filter((x) => ATIVOS.includes(x.status)).sort((a, b) => (PESO[b.nivel] - PESO[a.nivel]) || String(a.criadoEm).localeCompare(String(b.criadoEm)))
      .concat(l.filter((x) => !ATIVOS.includes(x.status)).sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm))));
  };

  /* ---------- peças da tela ---------- */
  function indicadores() {
    const l = todas(), d = hoje();
    const k = [
      ['recebidas', 'Recebidas hoje', l.filter((x) => C.diaSP(x.criadoEm) === d).length, 'caixaEntrada', { de: d, ate: d }, ''],
      ['analise', 'Aguardando análise', l.filter((x) => x.status === 'recebida').length, 'relogio', { status: 'recebida' }, ''],
      ['urgentes', 'Prioridades urgentes', l.filter((x) => x.nivel === 'urgente' && ATIVOS.includes(x.status)).length, 'raio', { nivel: 'urgente' }, 'urg'],
      ['atendimento', 'Em atendimento', l.filter((x) => x.status === 'em_atendimento').length, 'pacote', { status: 'em_atendimento' }, ''],
      ['concluidas', 'Concluídas', l.filter((x) => x.status === 'concluida').length, 'okCirculo', { status: 'concluida' }, '']
    ];
    return h('div', { class: 'kpis' }, k.map(([id, nome, n, i, f, cls]) => {
      const ativo = Object.keys(f).every((c) => estado.filtro[c] === f[c]) && Object.keys(VAZIO).filter((c) => !(c in f)).every((c) => !estado.filtro[c]);
      return h('button', { class: 'kpi ' + cls + (n === 0 ? ' zero' : '') + (ativo ? ' ativo' : ''), type: 'button', 'aria-pressed': String(ativo), onclick: () => { estado.filtro = ativo ? Object.assign({}, VAZIO) : Object.assign({}, VAZIO, f); desenhar(); } }, ic(i), h('b', { text: String(n) }), h('span', { text: nome }));
    }));
  }
  function barraFiltros() {
    const lista = todas();
    const vend = [...new Map(lista.filter((l) => l.pedidoPor).map((l) => [l.pedidoPor.toLowerCase(), l.pedidoPor])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const fils = [...new Set(lista.map(filialDe).filter(Boolean))].sort();
    const sel = (id, rotulo, chave, opcoes) => h('div', null, h('label', { class: 'rotulo', for: id, text: rotulo }), h('select', { id, class: 'entrada', onchange: (ev) => { estado.filtro[chave] = ev.target.value; desenhar(); } }, h('option', { value: '', text: 'Todos' }), opcoes.map(([v, t]) => h('option', { value: v, text: t, selected: estado.filtro[chave] === v }))));
    return h('div', { class: 'filtros' },
      sel('f-nivel', 'Prioridade', 'nivel', Object.entries(C.NIVEL)), sel('f-status', 'Status', 'status', Object.entries(C.STATUS)), sel('f-vend', 'Vendedora', 'vendedora', vend), sel('f-filial', 'Filial', 'filial', fils.map((x) => [x, x])),
      h('div', null, h('label', { class: 'rotulo', for: 'f-de', text: 'De' }), h('input', { id: 'f-de', class: 'entrada', type: 'date', value: estado.filtro.de, onchange: (ev) => { estado.filtro.de = ev.target.value; desenhar(); } })),
      h('div', null, h('label', { class: 'rotulo', for: 'f-ate', text: 'Até' }), h('input', { id: 'f-ate', class: 'entrada', type: 'date', value: estado.filtro.ate, onchange: (ev) => { estado.filtro.ate = ev.target.value; desenhar(); } })),
      algumFiltro() ? h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.filtro = Object.assign({}, VAZIO); desenhar(); } }, ic('fechar'), 'Limpar filtros') : null);
  }
  function tabela(linhas) {
    if (!linhas.length) return C.vazio(algumFiltro() ? 'busca' : 'caixaEntrada', algumFiltro() ? 'Nenhuma solicitação com esses filtros' : 'Nenhuma solicitação por enquanto', algumFiltro() ? 'Tire algum filtro para ver mais.' : 'Quando uma vendedora pedir prioridade, ela aparece aqui na hora.');
    const abrir = (l) => { estado.aberta = l.id; desenhar(); };
    return h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', null, h('tr', null, ['Pedido', 'Vendedora', 'Filial', 'Prioridade', 'Motivo', 'Solicitado', 'Status', 'Responsável'].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', null, linhas.map((l) => h('tr', { class: 'linha ' + (ATIVOS.includes(l.status) ? l.nivel : '') + (estado.aberta === l.id ? ' sel' : '') + (estado.novos.has(l.id) ? ' novo-fio' : ''), tabindex: '0', role: 'button', 'aria-label': 'Abrir solicitação do pedido ' + l.pedido, onclick: () => abrir(l), onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(l); } } },
        h('td', null, h('span', { class: 'pedido', text: l.pedido }), h('span', { class: 'sub', text: l.protocolo || '' })),
        h('td', { text: l.pedidoPor || '—' }), h('td', { text: filialDe(l) || '—' }), h('td', null, C.selo(C.NIVEL[l.nivel], l.nivel)), h('td', { text: C.MOTIVO[l.motivo] ? C.MOTIVO[l.motivo].replace(' (explique na observação)', '') : '—' }),
        h('td', null, C.dataHora(l.criadoEm), h('span', { class: 'sub', text: 'há ' + C.duracao(l.criadoEm) })), h('td', null, C.selo(C.STATUS[l.status], l.status)), h('td', { text: l.responsavel || '—', class: l.responsavel ? '' : 'mudo' }))))));
  }
  function gaveta(l) {
    const fecha = () => { estado.aberta = null; estado.gavAnim = null; desenhar(); };
    const ativo = ATIVOS.includes(l.status), ocupado = estado.salvando === l.id, s = l.situacao;
    const abre = estado.gavAnim !== l.id ? ' abre' : ''; estado.gavAnim = l.id;
    const bt = (st, rotulo, cls) => h('button', { class: 'btn peq ' + (cls || ''), type: 'button', disabled: ocupado, onclick: () => responder(l, st) }, rotulo);
    return [h('div', { class: 'gaveta-fundo' + abre, onclick: fecha }),
      h('aside', { class: 'gaveta' + abre, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Solicitação do pedido ' + l.pedido },
        h('div', { class: 'gaveta-cab' }, h('div', null, h('p', { class: 'mudo peq', text: l.protocolo || 'Solicitação de prioridade' }), h('h3', { class: 'num', text: 'Pedido ' + l.pedido }), h('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' }, C.selo(C.NIVEL[l.nivel], l.nivel), C.selo(C.STATUS[l.status], l.status))),
          h('button', { class: 'btn peq fantasma', type: 'button', 'aria-label': 'Fechar', onclick: fecha }, ic('fechar'))),
        h('div', { class: 'gaveta-corpo' },
          ativo ? h('div', null, h('p', { class: 'bloco-titulo', text: 'Situação do pedido agora' }), s ? h('div', { class: 'cx-situacao' }, h('b', { text: s.texto }), h('div', { class: 'mudo peq', style: 'margin-top:4px', text: [s.cliente, s.armazem, s.transportadora, s.dias != null ? s.dias + ' dias desde a liberação' : ''].filter(Boolean).join(' · ') }), s.ocorrencia ? h('div', { class: 'peq', style: 'margin-top:4px;color:#8a4207', text: 'Ocorrência: ' + s.ocorrencia }) : null) : h('div', { class: 'aviso' }, ic('alerta'), l.naoAchado ? 'Pedido não encontrado na base do SC9. Confira o número.' : 'Pedido não encontrado na base atual do SC9.')) : null,
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Solicitação' }), h('div', { class: 'resumo-lista', style: 'margin-top:0' },
            [['Vendedora', l.pedidoPor || '—'], ['Filial', filialDe(l) || '—'], ['Solicitado', C.dataHora(l.criadoEm) + ' (há ' + C.duracao(l.criadoEm) + ')'], ['Responsável', l.responsavel || 'ninguém assumiu'], ['Motivo', C.MOTIVO[l.motivo] || '—'], ['Observação', l.observacao || '—']].map(([t, v]) => h('div', null, h('span', { text: t }), h('b', { text: v })))),
            (l.historico || []).filter((x) => x.acao === 'reforco').map((x) => h('p', { class: 'mudo peq', style: 'margin-top:8px', text: 'Reforço de ' + (x.por || '—') + ' (' + C.dataHora(x.em) + ')' + (x.texto ? ': ' + x.texto : '') }))),
          l.resposta ? h('div', { class: 'cx-situacao', style: 'background:var(--azul-claro);color:var(--azul-escuro)' }, h('b', { text: 'Última resposta para a vendedora: ' }), l.resposta) : null,
          ativo ? h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
            h('button', { class: 'btn', type: 'button', disabled: ocupado, onclick: () => assumir(l) }, ic('usuarioCheck'), l.responsavel ? 'Assumir para mim' : 'Assumir este pedido'),
            h('div', null, h('label', { class: 'rotulo', for: 'r-' + l.id, text: 'Resposta para a vendedora (ela vê)' }), h('textarea', { id: 'r-' + l.id, class: 'entrada', maxlength: '300', placeholder: 'Ex.: aprovado, separando agora; sai hoje às 16h', oninput: (ev) => { estado.respostas[l.id] = ev.target.value; } }, estado.respostas[l.id] || '')),
            h('div', { class: 'botoes-status' }, l.status !== 'em_analise' ? bt('em_analise', 'Em análise') : null, l.status !== 'aprovada' ? bt('aprovada', 'Aprovar', 'verde') : null, l.status !== 'em_atendimento' ? bt('em_atendimento', 'Em atendimento') : null, bt('concluida', 'Concluir', 'primario'), bt('nao_aprovada', 'Não aprovar', 'perigo')),
            h('div', null, h('label', { class: 'rotulo', for: 'i-' + l.id, text: 'Comentário interno (só a equipe vê)' }), h('textarea', { id: 'i-' + l.id, class: 'entrada', maxlength: '300', placeholder: 'Ex.: falei com o separador, falta 1 item', oninput: (ev) => { estado.internos[l.id] = ev.target.value; } }, estado.internos[l.id] || ''), h('button', { class: 'btn peq', type: 'button', style: 'margin-top:8px', disabled: ocupado, onclick: () => comentar(l) }, ic('comentario'), 'Salvar comentário'))) : null,
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Histórico de alterações' }), h('ol', { class: 'hist' }, (l.historico || []).slice().reverse().map((x) => h('li', { class: x.acao === 'interno' ? 'interno' : '' },
            h('span', { class: 'hora', text: C.dataHora(x.em) }), ' ', h('b', { text: (ACAO[x.acao] || x.acao) + (x.acao === 'status' && x.status ? ': ' + C.STATUS[x.status] : x.acao === 'assumir' && x.status ? ' (em análise)' : '') }), x.por ? h('span', { class: 'quem', text: ' · ' + x.por }) : null, x.texto ? ' · ' + x.texto : '')))))) ];
  }
  function cartaoLink() {
    const url = urlDoLink();
    return h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('div', null, h('h3', { text: 'Link das vendedoras' }), h('p', { class: 'mudo peq', text: 'É esse link que você passa para elas (acompanhar pedido e pedir prioridade). Quem sair da empresa: gere um novo, e o antigo para de funcionar.' })), h('button', { class: 'btn peq fantasma', type: 'button', onclick: () => { estado.mostraLink = false; desenhar(); } }, ic('fechar'), 'Fechar')),
      url ? h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, h('input', { class: 'entrada', style: 'flex:1 1 300px;font-size:14px', readonly: true, value: url, 'aria-label': 'Link das vendedoras', onfocus: (ev) => ev.target.select() }),
        h('button', { class: 'btn primario', type: 'button', onclick: () => C.copiar(url, 'Link copiado.') }, ic('copiar'), 'Copiar'), h('button', { class: 'btn', type: 'button', onclick: () => acaoLink('gerar') }, ic('atualizar'), 'Trocar o link'), h('button', { class: 'btn perigo', type: 'button', onclick: () => acaoLink('desativar') }, 'Desativar'))
        : h('div', null, h('p', { class: 'mudo', style: 'margin-bottom:10px', text: 'Ainda não há link ativo.' }), h('button', { class: 'btn primario', type: 'button', onclick: () => acaoLink('gerar') }, ic('link'), 'Gerar o link das vendedoras')),
      estado.linkErro ? h('div', { class: 'erro', style: 'margin-top:10px' }, ic('alerta'), estado.linkErro) : null);
  }
  function telaLogin() {
    const l = estado.login;
    return h('main', { class: 'pagina estreita' }, h('section', { class: 'card login-caixa' }, h('h2', { text: 'Entrar no painel' }),
      h('p', { class: 'mudo peq', style: 'margin:4px 0 14px', text: estado.sessao && estado.sessao.authed ? 'Seu usuário não tem o acesso "Ocorrências". Peça ao administrador para liberar, ou entre com outro usuário.' : 'Use o usuário e a senha do SC9. O administrador deixa o usuário vazio.' }),
      h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); entrar(); } },
        h('div', null, h('label', { class: 'rotulo', for: 'u', text: 'Usuário' }), h('input', { id: 'u', class: 'entrada', value: l.usuario, autocomplete: 'username', oninput: (ev) => { l.usuario = ev.target.value; } })),
        h('div', null, h('label', { class: 'rotulo', for: 's', text: 'Senha' }), h('input', { id: 's', class: 'entrada', type: 'password', value: l.senha, autocomplete: 'current-password', oninput: (ev) => { l.senha = ev.target.value; } })),
        h('button', { class: 'btn primario', type: 'submit', disabled: l.entrando, text: l.entrando ? 'Entrando…' : 'Entrar' }),
        l.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), l.erro) : null)));
  }

  function desenhar() {
    const foco = root.document.activeElement && root.document.activeElement.id ? root.document.activeElement.id : '';
    const y = root.scrollY;
    const logado = estado.sessao && estado.sessao.pode;
    const topo = h('header', { class: 'topo' }, h('div', { class: 'topo-in' }, C.marca('Painel da logística'),
      estado.sessao && estado.sessao.authed ? h('div', { class: 'topo-lado' }, estado.sessao.admin ? h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.mostraLink = !estado.mostraLink; desenhar(); } }, ic('link'), 'Link das vendedoras') : null, h('span', { class: 'mudo peq', text: estado.sessao.nome || 'Conta' }), h('button', { class: 'btn peq', type: 'button', onclick: sair }, ic('sair'), 'Sair')) : null));
    let corpo;
    if (!estado.sessao) corpo = h('main', { class: 'pagina' }, C.esqueleto(3));
    else if (!logado) corpo = telaLogin();
    else {
      const d = estado.dados, linhas = d ? ordenadas() : [];
      corpo = h('main', { class: 'pagina' },
        h('div', { class: 'card-titulo', style: 'margin:0' }, h('div', null, h('h1', { style: 'font-size:clamp(24px,4vw,30px);font-weight:800;letter-spacing:-.02em', text: 'Solicitações de prioridade' }), h('p', { class: 'mudo', style: 'margin-top:4px', text: 'Quem decide é a logística: analise, aprove e responda. Atualiza sozinho a cada 20 segundos.' })),
          h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.carregando = true; carregar(); } }, ic('atualizar'), 'Atualizar agora')),
        estado.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), estado.erro) : null,
        estado.mostraLink && estado.sessao.admin ? cartaoLink() : null,
        d ? indicadores() : C.esqueleto(2),
        d ? h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Solicitações' }), h('span', { class: 'mudo peq', text: linhas.length + (algumFiltro() ? ' de ' + todas().length : '') + (todas().length === 1 ? ' solicitação' : ' solicitações') })), barraFiltros(), h('div', { style: 'margin-top:14px' }, tabela(linhas))) : null);
    }
    const ab = logado && estado.dados && estado.aberta ? todas().find((x) => x.id === estado.aberta) : null;
    $raiz.replaceChildren(topo, corpo, ...(ab ? gaveta(ab) : []));
    root.scrollTo(0, y);
    if (foco) { const e = root.document.getElementById(foco); if (e && e.focus) e.focus({ preventScroll: true }); }
  }

  root.setInterval(() => { if (!root.document.hidden) carregar(true); }, 20000);
  root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) carregar(true); });
  root.document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && estado.aberta) { estado.aberta = null; estado.gavAnim = null; desenhar(); } });
  (async () => { await carregarSessao(); desenhar(); await carregar(); carregarLink(); })();
})(window);
