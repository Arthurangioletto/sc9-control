/* Central de Pedidos · painel da logística: pedidos de prioridade enviados pelas vendedoras. Entra com usuário e senha do SC9
 * (administrador ou quem tem o acesso "Ocorr."). Indicadores, tabela com filtros e painel lateral para analisar, assumir, responder,
 * comentar e mudar o status. JavaScript puro; tudo do servidor entra como textContent. */
(function (root) {
  'use strict';
  const C = root.Central, h = C.h, ic = C.icone;
  const $raiz = root.document.getElementById('raiz');
  const CAB = { 'Content-Type': 'application/json', 'X-SC9-App': '1' };
  const ACAO = { criado: 'Pedido criado', reforco: 'Pedido reforçado', status: 'Status', assumir: 'Assumiu', interno: 'Comentário interno' };
  const VAZIO = { nivel: '', status: '', vendedora: '', filial: '', de: '', ate: '', fora: '' };
  const ATIVOS = ['recebida', 'em_analise', 'aprovada', 'em_atendimento'];
  const ATIVOS_AV = ['recebido', 'em_andamento'];
  const estado = { sessao: null, login: { usuario: '', senha: '', erro: '', entrando: false }, dados: null, erro: '', respostas: {}, internos: {}, filtro: Object.assign({}, VAZIO), aberta: null, gavAnim: null, salvando: '', vistos: null, novos: new Set(), link: null, linkErro: '', mostraLink: false, carregando: true, aba: 'fila', avisos: null, avisosErro: '', avisoAberto: null, avisoResp: {}, avisoInt: {}, avisosVistos: null, avisosNovos: new Set(), contas: null, contasErro: '', codigoTemp: null, consultas: null, filtroConta: '' };

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
      const fora = j.ativos.filter((l) => l.situacao === null).length;
      await carregarAvisos();
      const novosAv = estado.avisos ? estado.avisos.ativos.filter((l) => l.status === 'recebido').length : 0;
      root.document.title = (novosAv ? '✉ ' + novosAv + ' aviso' + (novosAv > 1 ? 's' : '') + ' · ' : '') + (fora ? '⚠ ' + fora + ' fora do SC9 · ' : '') + (j.ativos.length ? '(' + j.ativos.length + ') ' : '') + 'Painel da logística · ' + C.NOME;
    } catch (e) { estado.erro = e.message; }
    estado.carregando = false;
    const ativo = root.document.activeElement;
    if (!silencioso || !ativo || ativo === root.document.body || !/^(TEXTAREA|INPUT|SELECT)$/.test(ativo.tagName)) desenhar();
  }
  // Avisos das vendedoras à expedição (ocorrência / informação sobre um pedido). Falha aqui não derruba a fila de prioridades.
  async function carregarAvisos() {
    try {
      const j = await pedir('/api/avisos');
      const ids = new Set(j.ativos.map((l) => l.id));
      if (estado.avisosVistos) estado.avisosNovos = new Set([...ids].filter((i) => !estado.avisosVistos.has(i)).concat([...estado.avisosNovos].filter((i) => ids.has(i))));
      estado.avisosVistos = ids; estado.avisos = j; estado.avisosErro = '';
    } catch (e) { estado.avisosErro = e.message; }
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
  async function carregarContas() {
    if (!estado.sessao || !estado.sessao.admin) return;
    try { estado.contas = (await pedir('/api/vendedoras-contas')).contas; estado.contasErro = ''; estado.consultas = (await pedir('/api/vendedoras-consultas?max=2000')).consultas; } catch (e) { estado.contasErro = e.message; }
    desenhar();
  }
  async function acaoConta(c, acao) {
    if (acao === 'redefinir' && !root.confirm('Redefinir o código de ' + c.nome + '? Ela é desconectada de todos os aparelhos e precisa entrar com o código temporário que vai aparecer aqui (só uma vez).')) return;
    if (acao === 'desativar' && !root.confirm('Desativar o acesso de ' + c.nome + '? Ela não consegue mais entrar. As solicitações já feitas continuam na fila.')) return;
    try {
      const j = await pedir('/api/vendedoras-contas', { method: 'POST', body: JSON.stringify({ acao, id: c.id }) });
      estado.contas = j.contas; estado.contasErro = ''; estado.codigoTemp = j.codigoTemporario ? { nome: c.nome, login: c.login, codigo: j.codigoTemporario } : null;
      C.toast(acao === 'redefinir' ? 'Código redefinido. Copie o código temporário e passe para ela.' : acao === 'desativar' ? 'Acesso desativado.' : 'Acesso ativado.');
    } catch (e) { C.toast(e.message, 'erro'); }
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
  async function acaoAviso(l, corpo, aviso) {
    estado.salvando = l.id; desenhar();
    try {
      estado.avisos = await pedir('/api/avisos', { method: 'POST', body: JSON.stringify(Object.assign({ id: l.id }, corpo)) });
      estado.avisosVistos = new Set(estado.avisos.ativos.map((x) => x.id)); C.toast(aviso); estado.salvando = ''; desenhar(); return true;
    } catch (e) { C.toast(e.message, 'erro'); }
    estado.salvando = ''; desenhar(); return false;
  }
  async function responderAviso(l, status) {
    const resposta = (estado.avisoResp[l.id] || '').trim();
    if (status === 'resolvido' && !resposta && !l.resposta) { C.toast('Escreva a resposta para a vendedora antes de resolver.', 'erro'); return; }
    if (await acaoAviso(l, { acao: 'status', status, resposta }, 'Aviso atualizado: ' + C.STATUS_AVISO[status] + '. A vendedora já vê.')) delete estado.avisoResp[l.id];
  }
  async function comentarAviso(l) {
    const texto = (estado.avisoInt[l.id] || '').trim();
    if (!texto) { C.toast('Escreva o comentário interno.', 'erro'); return; }
    if (await acaoAviso(l, { acao: 'interno', texto }, 'Comentário interno salvo (a vendedora não vê).')) delete estado.avisoInt[l.id];
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
    if (f.fora && l.situacao !== null) return false; // só as ativas cujo pedido não está na carga do SC9
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

  /* ---------- exportar (CSV para Excel) ---------- */
  const txtSituacao = (l) => (l.situacao ? [l.situacao.texto, l.situacao.cliente, l.situacao.transportadora].filter(Boolean).join(' · ') : '');
  function exportarSolicitacoes() {
    C.baixarCsv(C.nomeArquivo('solicitacoes-de-prioridade'), ['Protocolo', 'Pedido', 'Prioridade', 'Status', 'Motivo', 'Vendedora', 'Login da vendedora', 'Filial', 'Solicitado em', 'Atualizado em', 'Responsável', 'Resposta para a vendedora', 'Observação', 'Situação do pedido (ativas)', 'Está no SC9? (ativas)', 'Reforços'],
      ordenadas().map((l) => [l.protocolo, l.pedido, C.NIVEL[l.nivel], C.STATUS[l.status], C.MOTIVO[l.motivo] || '', l.pedidoPor, l.conta || '', filialDe(l), C.dataHoraCsv(l.criadoEm), C.dataHoraCsv(l.atualizadoEm), l.responsavel, l.resposta, l.observacao, txtSituacao(l), l.situacao === null ? 'Não' : l.situacao ? 'Sim' : '', (l.historico || []).filter((x) => x.acao === 'reforco').length]));
  }
  function exportarHistorico() {
    const linhas = [];
    for (const l of ordenadas()) for (const x of (l.historico || [])) linhas.push([l.protocolo, l.pedido, C.dataHoraCsv(x.em), ACAO[x.acao] || x.acao, x.status ? C.STATUS[x.status] || x.status : '', x.por, x.acao === 'interno' ? 'Sim' : 'Não', x.texto]);
    C.baixarCsv(C.nomeArquivo('historico-de-prioridades'), ['Protocolo', 'Pedido', 'Quando', 'Evento', 'Status', 'Quem', 'Comentário interno', 'Texto'], linhas);
  }
  function telaExportar(linhas) {
    const n = linhas.length, ev = linhas.reduce((t, l) => t + (l.historico || []).length, 0);
    const bloco = (icone, titulo, texto, rotulo, fn, qtd) => h('div', { class: 'cartao-exportar', style: 'padding:14px 0;border-top:1px solid var(--linha)' }, h('div', { class: 'bola' }, ic(icone)), h('div', { class: 'meio' }, h('h3', { style: 'font-size:15px;font-weight:800', text: titulo }), h('p', { class: 'mudo peq', text: texto }), h('p', { class: 'peq', style: 'margin-top:2px', text: qtd + (qtd === 1 ? ' linha' : ' linhas') })),
      h('button', { class: 'btn primario', type: 'button', disabled: !qtd, onclick: fn }, ic('baixar'), rotulo));
    return h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('div', null, h('h2', { text: 'Exportar para planilha' }), h('p', { class: 'mudo peq', text: 'Arquivo CSV, abre direto no Excel. Vale o que está nos filtros abaixo (sem filtro: tudo que o painel carregou).' }))), barraFiltros(),
      h('p', { class: 'dica', style: 'margin:10px 0 4px', text: 'As solicitações em andamento entram todas; das já finalizadas entram as 300 mais recentes.' }),
      bloco('lista', 'Solicitações', 'Uma linha por solicitação: protocolo, pedido, prioridade, status, motivo, vendedora (e login), filial, datas, responsável, resposta e situação do pedido.', 'Baixar solicitações', exportarSolicitacoes, n),
      bloco('comentario', 'Histórico completo', 'Uma linha por acontecimento (criou, reforçou, assumiu, mudou o status, comentário interno). Serve para auditar quem fez o quê e quando. Contém os comentários internos: não compartilhe com as vendedoras.', 'Baixar histórico', exportarHistorico, ev));
  }

  const todosAvisos = () => (estado.avisos ? estado.avisos.ativos.concat(estado.avisos.demais) : []);
  function exportarAvisos() {
    C.baixarCsv(C.nomeArquivo('avisos-das-vendedoras'), ['Protocolo', 'Pedido', 'Tipo', 'O que a vendedora informou', 'Vendedora', 'Login da vendedora', 'Filial', 'Enviado em', 'Atualizado em', 'Status', 'Responsável', 'Resposta para a vendedora', 'Está no SC9?', 'Histórico'],
      todosAvisos().map((l) => [l.protocolo, l.pedido, C.TIPO_AVISO[l.tipo], l.texto, l.pedidoPor, l.conta || '', l.filial || (l.situacao && l.situacao.armazem) || '', C.dataHoraCsv(l.criadoEm), C.dataHoraCsv(l.atualizadoEm), C.STATUS_AVISO[l.status], l.responsavel, l.resposta, l.situacao === null ? 'Não' : l.situacao ? 'Sim' : '',
        (l.historico || []).map((x) => C.dataHoraCsv(x.em) + ' - ' + (x.acao === 'interno' ? 'Comentário interno' : x.acao === 'assumir' ? 'Assumiu' : x.acao === 'criar' ? 'Enviado' : 'Status ' + (C.STATUS_AVISO[x.status] || '')) + (x.por ? ' (' + x.por + ')' : '') + (x.texto ? ': ' + x.texto : '')).join(' | ')]));
  }

  /* ---------- avisos das vendedoras à expedição ---------- */
  function telaAvisos() {
    const a = estado.avisos, lista = todosAvisos();
    const cab = h('div', { class: 'card-titulo' }, h('div', null, h('h2', { text: 'Avisos das vendedoras à expedição' }), h('p', { class: 'mudo peq', text: 'Informações e ocorrências que as vendedoras mandam pelo link (endereço, retirada, transportadora, cancelamento...). Assuma, responda (ela vê a resposta) e marque como resolvido. Não alteram as ocorrências oficiais do SC9: se for o caso, registre lá também.' })),
      h('button', { class: 'btn peq primario', type: 'button', disabled: !lista.length, onclick: exportarAvisos }, ic('baixar'), 'Baixar avisos (CSV)'));
    if (estado.avisosErro && !a) return h('section', { class: 'card' }, cab, h('div', { class: 'erro', role: 'alert' }, ic('alerta'), estado.avisosErro));
    if (!a) return h('section', { class: 'card' }, cab, C.esqueleto(2));
    if (!lista.length) return h('section', { class: 'card' }, cab, C.vazio('caixaEntrada', 'Nenhum aviso por enquanto', 'Quando uma vendedora avisar a expedição sobre um pedido, ele aparece aqui.'));
    return h('section', { class: 'card' }, cab, h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', null, h('tr', null, ['Pedido', 'Vendedora', 'Tipo', 'Informação', 'Enviado', 'Status', 'Responsável'].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', null, lista.map((l) => h('tr', { class: 'linha' + (l.status === 'recebido' ? ' alta' : '') + (estado.avisoAberto === l.id ? ' sel' : '') + (estado.avisosNovos.has(l.id) ? ' novo-fio' : ''), tabindex: '0', role: 'button', 'aria-label': 'Abrir aviso do pedido ' + l.pedido,
        onclick: () => { estado.avisoAberto = l.id; desenhar(); }, onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); estado.avisoAberto = l.id; desenhar(); } } },
        h('td', null, h('span', { class: 'pedido', text: l.pedido }), h('span', { class: 'sub', text: l.protocolo || '' }), l.situacao === null && ATIVOS_AV.includes(l.status) ? C.selo('Fora do SC9', 'alta') : null),
        h('td', null, l.pedidoPor || '—', l.conta ? h('span', { class: 'sub', text: 'login ' + l.conta }) : null), h('td', { text: C.TIPO_AVISO[l.tipo] || l.tipo }),
        h('td', { style: 'max-width:340px', text: (l.texto || '').length > 110 ? l.texto.slice(0, 107) + '…' : l.texto }),
        h('td', null, C.dataHora(l.criadoEm), h('span', { class: 'sub', text: 'há ' + C.duracao(l.criadoEm) })), h('td', null, C.selo(C.STATUS_AVISO[l.status], l.status)), h('td', { text: l.responsavel || '—', class: l.responsavel ? '' : 'mudo' })))))));
  }
  function gavetaAviso(l) {
    const fecha = () => { estado.avisoAberto = null; estado.gavAnim = null; desenhar(); };
    const ativo = ATIVOS_AV.includes(l.status), ocupado = estado.salvando === l.id, s = l.situacao;
    const abre = estado.gavAnim !== l.id ? ' abre' : ''; estado.gavAnim = l.id;
    const bt = (st, rotulo, cls) => h('button', { class: 'btn peq ' + (cls || ''), type: 'button', disabled: ocupado, onclick: () => responderAviso(l, st) }, rotulo);
    return [h('div', { class: 'gaveta-fundo' + abre, onclick: fecha }),
      h('aside', { class: 'gaveta' + abre, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Aviso do pedido ' + l.pedido },
        h('div', { class: 'gaveta-cab' }, h('div', null, h('p', { class: 'mudo peq', text: l.protocolo || 'Aviso da vendedora' }), h('h3', { class: 'num', text: 'Pedido ' + l.pedido }), h('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' }, C.selo(C.TIPO_AVISO[l.tipo], 'normal', true), C.selo(C.STATUS_AVISO[l.status], l.status))),
          h('button', { class: 'btn peq fantasma', type: 'button', 'aria-label': 'Fechar', onclick: fecha }, ic('fechar'))),
        h('div', { class: 'gaveta-corpo' },
          h('div', { class: 'cx-situacao', style: 'background:#fff7e6;color:#7a4a00' }, h('b', { style: 'display:block', text: 'A vendedora informou' }), l.texto),
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Situação do pedido agora' }), s ? h('div', { class: 'cx-situacao' }, h('b', { text: s.texto }), h('div', { class: 'mudo peq', style: 'margin-top:4px', text: [s.cliente, s.armazem].filter(Boolean).join(' · ') }))
            : h('div', { class: 'aviso' }, ic('alerta'), h('div', null, h('b', { text: 'Este pedido não está no SC9 carregado. ' }), 'Recarregue o SC9 ou confira o número com a vendedora.'))),
          h('div', { class: 'resumo-lista', style: 'margin-top:0' }, [['Vendedora', (l.pedidoPor || '—') + (l.conta ? ' (login ' + l.conta + ')' : ' (só informou o nome)')], ['Enviado', C.dataHora(l.criadoEm) + ' (há ' + C.duracao(l.criadoEm) + ')'], ['Responsável', l.responsavel || 'Ninguém assumiu ainda']].map(([t, v]) => h('div', null, h('span', { text: t }), h('b', { text: v })))),
          l.resposta ? h('div', { class: 'cx-situacao', style: 'background:var(--azul-claro);color:var(--azul-escuro)' }, h('b', { text: 'Última resposta para a vendedora: ' }), l.resposta) : null,
          ativo ? h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
            h('button', { class: 'btn', type: 'button', disabled: ocupado, onclick: () => acaoAviso(l, { acao: 'assumir' }, 'Você assumiu este aviso.') }, ic('usuarioCheck'), l.responsavel ? 'Assumir para mim' : 'Assumir este aviso'),
            h('div', null, h('label', { class: 'rotulo', for: 'ar-' + l.id, text: 'Resposta para a vendedora (ela vê)' }), h('textarea', { id: 'ar-' + l.id, class: 'entrada', maxlength: '300', placeholder: 'Ex.: endereço alterado, já avisei a transportadora', oninput: (ev) => { estado.avisoResp[l.id] = ev.target.value; } }, estado.avisoResp[l.id] || '')),
            h('div', { class: 'botoes-status' }, l.status !== 'em_andamento' ? bt('em_andamento', 'Em andamento') : null, bt('resolvido', 'Marcar como resolvido', 'verde')),
            h('div', null, h('label', { class: 'rotulo', for: 'ai-' + l.id, text: 'Comentário interno (só a equipe vê)' }), h('textarea', { id: 'ai-' + l.id, class: 'entrada', maxlength: '300', placeholder: 'Ex.: liguei para a transportadora', oninput: (ev) => { estado.avisoInt[l.id] = ev.target.value; } }, estado.avisoInt[l.id] || ''), h('button', { class: 'btn peq', style: 'margin-top:8px', type: 'button', disabled: ocupado, onclick: () => comentarAviso(l) }, 'Salvar comentário')))
            : h('div', { class: 'aviso' }, ic('info'), 'Aviso resolvido. O histórico continua abaixo.'),
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Histórico' }), h('ol', { class: 'hist' }, (l.historico || []).slice().reverse().map((x) => h('li', { class: x.acao === 'interno' ? 'interno' : '' },
            h('span', { class: 'hora', text: C.dataHora(x.em) }), ' ', h('b', { text: x.acao === 'interno' ? 'Comentário interno' : x.acao === 'assumir' ? 'Assumiu' : x.acao === 'criar' ? 'Aviso enviado' : 'Status: ' + (C.STATUS_AVISO[x.status] || x.status || '') }), x.por ? h('span', { class: 'mudo', text: ' · ' + x.por }) : null, x.texto ? h('span', { text: ' — ' + x.texto }) : null))))))];
  }
  // Alerta no topo: avisos novos (ainda "recebido") que ninguém tratou.
  function faixaAvisos() {
    const a = estado.avisos; if (!a) return null;
    const novos = a.ativos.filter((l) => l.status === 'recebido');
    if (!novos.length) return null;
    return h('section', { class: 'alerta-sc9', role: 'alert' }, h('div', { class: 'bola' }, ic('comentario')), h('div', { class: 'meio' }, h('h2', { text: novos.length === 1 ? '1 aviso novo das vendedoras' : novos.length + ' avisos novos das vendedoras' }),
      h('p', { text: 'Pedidos: ' + novos.slice(0, 8).map((l) => l.pedido + ' (' + (C.TIPO_AVISO[l.tipo] || '').split(' ').slice(0, 3).join(' ') + ')').join(', ') + (novos.length > 8 ? '…' : '') + '. Elas estão aguardando.' })),
      h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.aba = 'avisos'; estado.aberta = null; desenhar(); } }, ic('lista'), 'Abrir avisos'));
  }

  /* ---------- acessos das vendedoras (só administrador) ---------- */
  const consultasFiltradas = () => (estado.consultas || []).filter((x) => !estado.filtroConta || x.conta === estado.filtroConta);
  function exportarConsultas() {
    C.baixarCsv(C.nomeArquivo('consultas-das-vendedoras'), ['Consultado em', 'Vendedora', 'Login', 'Pedido', 'Situação na hora', 'Filial', 'Cliente'], consultasFiltradas().map((x) => [C.dataHoraCsv(x.em), x.nome, x.conta, x.pedido, x.situacao, x.filial, x.cliente]));
  }
  function cartaoConsultas() {
    const lista = consultasFiltradas(), contas = estado.contas || [];
    return h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('div', null, h('h2', { text: 'Pedidos consultados pelas vendedoras' }), h('p', { class: 'mudo peq', text: 'Só de quem entrou com login (quem usa só o link não é identificada). Cada vendedora vê apenas as próprias consultas; aqui você vê todas. Guarda 90 dias.' })),
      h('button', { class: 'btn peq primario', type: 'button', disabled: !lista.length, onclick: exportarConsultas }, ic('baixar'), 'Baixar consultas (CSV)')),
      h('div', { class: 'filtros', style: 'margin-bottom:12px' }, h('div', null, h('label', { class: 'rotulo', for: 'f-conta', text: 'Vendedora' }), h('select', { id: 'f-conta', class: 'entrada', onchange: (ev) => { estado.filtroConta = ev.target.value; desenhar(); } }, h('option', { value: '', text: 'Todas' }), contas.map((c) => h('option', { value: c.login, text: c.nome + ' (' + c.login + ')', selected: estado.filtroConta === c.login }))))),
      !estado.consultas ? C.esqueleto(2) : !lista.length ? C.vazio('busca', 'Nenhuma consulta registrada ainda', 'Aparece aqui quando uma vendedora com login consultar um pedido.')
        : h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' }, h('thead', null, h('tr', null, ['Quando', 'Vendedora', 'Pedido', 'Situação na hora', 'Filial'].map((t) => h('th', { scope: 'col', text: t })))),
          h('tbody', null, lista.slice(0, 200).map((x) => h('tr', null, h('td', { text: C.dataHora(x.em) }), h('td', null, x.nome, h('span', { class: 'sub', text: 'login ' + x.conta })), h('td', null, h('span', { class: 'pedido', text: x.pedido })), h('td', { text: x.situacao || '—' }), h('td', { text: x.filial || '—' })))))),
      lista.length > 200 ? h('p', { class: 'dica', text: 'Mostrando as 200 mais recentes de ' + lista.length + '. O CSV leva todas.' }) : null);
  }
  function telaAcessos() {
    const cs = estado.contas;
    return h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('div', null, h('h2', { text: 'Acessos das vendedoras' }), h('p', { class: 'mudo peq', text: 'Login e código que elas criam (opcional) para acompanhar o que pediram em qualquer aparelho. O código ninguém vê, nem você: se esquecerem, redefina.' })), h('button', { class: 'btn peq', type: 'button', onclick: carregarContas }, ic('atualizar'), 'Atualizar')),
      estado.contasErro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), estado.contasErro) : null,
      estado.codigoTemp ? h('div', { class: 'aviso', style: 'flex-direction:column;align-items:stretch;margin-bottom:14px', role: 'status' }, h('div', null, h('b', { text: 'Código temporário de ' + estado.codigoTemp.nome + ' (login ' + estado.codigoTemp.login + '). ' }), 'Aparece só agora. Passe para ela (não por e-mail): ela entra com ele e depois troca em "Seu acesso".'),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, h('span', { class: 'cx-codigo', text: estado.codigoTemp.codigo }), h('button', { class: 'btn peq', type: 'button', onclick: () => C.copiar(estado.codigoTemp.codigo, 'Código copiado.') }, ic('copiar'), 'Copiar'), h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.codigoTemp = null; desenhar(); } }, 'Já passei, fechar'))) : null,
      !cs ? C.esqueleto(2) : !cs.length ? C.vazio('usuario', 'Nenhuma vendedora criou acesso ainda', 'Elas encontram a opção "Entrar" no alto da página do link das vendedoras.')
        : h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' }, h('thead', null, h('tr', null, ['Nome', 'Login', 'E-mail', 'Solicitações', 'Consultas', 'Criado em', 'Último acesso', 'Situação', ''].map((t) => h('th', { scope: 'col', text: t })))),
          h('tbody', null, cs.map((c) => h('tr', null, h('td', { text: c.nome }), h('td', { text: c.login }), h('td', { text: c.email || '—' }), h('td', { text: String(c.solicitacoes) }), h('td', { text: String(c.consultas || 0) }), h('td', { text: C.dataHora(c.criadoEm) }), h('td', { text: c.ultimoAcesso ? C.dataHora(c.ultimoAcesso) : '—' }), h('td', null, C.selo(c.ativo ? 'Ativo' : 'Desativado', c.ativo ? 'concluida' : 'nao_aprovada')),
            h('td', null, h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn peq', type: 'button', onclick: () => acaoConta(c, 'redefinir') }, 'Redefinir código'), h('button', { class: 'btn peq' + (c.ativo ? ' perigo' : ''), type: 'button', onclick: () => acaoConta(c, c.ativo ? 'desativar' : 'ativar') }, c.ativo ? 'Desativar' : 'Ativar')))))))));
  }
  function abas() {
    const nAv = estado.avisos ? estado.avisos.ativos.filter((l) => l.status === 'recebido').length : 0;
    const lista = [['fila', 'lista', 'Solicitações'], ['avisos', 'comentario', 'Avisos das vendedoras' + (nAv ? ' (' + nAv + ')' : '')], ['exportar', 'baixar', 'Exportar']].concat(estado.sessao.admin ? [['acessos', 'usuarioCheck', 'Acessos das vendedoras']] : []);
    return h('div', { class: 'cx-abas', role: 'group', 'aria-label': 'Seções do painel' }, lista.map(([id, i, nome]) => h('button', { type: 'button', 'aria-pressed': String(estado.aba === id), onclick: () => { estado.aba = id; estado.aberta = null; if (id === 'acessos' && !estado.contas) carregarContas(); desenhar(); } }, ic(i), nome)));
  }

  /* ---------- aviso: pedidos pedidos pelas vendedoras que ainda não estão no SC9 ---------- */
  // Calculado ao vivo: some sozinho quando o SC9 é recarregado e o pedido entra na base.
  // Se o pedido foi pedido DEPOIS da última carga, é só recarregar; se já era mais velho que a carga e continua fora, o número deve estar errado.
  function faixaSc9() {
    const d = estado.dados; if (!d) return null;
    const fora = d.ativos.filter((l) => l.situacao === null);
    if (!fora.length) return null;
    const base = d.baseEm ? Date.parse(d.baseEm) : 0;
    const esperando = fora.filter((l) => !(Date.parse(l.criadoEm) <= base)), conferir = fora.filter((l) => Date.parse(l.criadoEm) <= base);
    const lista = (ls) => ls.map((l) => l.pedido + (l.pedidoPor ? ' (' + l.pedidoPor + ')' : '')).join(', ');
    const verEsses = h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.aba = 'fila'; estado.filtro = Object.assign({}, VAZIO, { fora: '1' }); desenhar(); } }, ic('lista'), 'Ver esses pedidos');
    return h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      esperando.length ? h('section', { class: 'alerta-sc9', role: 'alert' }, h('div', { class: 'bola' }, ic('atualizar')), h('div', { class: 'meio' }, h('h2', { text: 'Recarregue o SC9' }),
        h('p', { text: (esperando.length === 1 ? '1 pedido com prioridade solicitada pelas vendedoras ainda não está no SC9' : esperando.length + ' pedidos com prioridade solicitada pelas vendedoras ainda não estão no SC9') + (d.baseEm ? ' (última carga em ' + C.dataHora(d.baseEm) + ')' : '') + ': ' + lista(esperando) + '. Carregue o SC9 de novo para mostrar as informações. Este aviso some sozinho quando eles entrarem na base.' })), verEsses) : null,
      conferir.length ? h('section', { class: 'aviso', role: 'status', style: 'align-items:center' }, ic('alerta'), h('div', { style: 'flex:1' }, h('b', { text: 'Conferir o número: ' }), 'mesmo depois da última carga (' + C.dataHora(d.baseEm) + ') não aparecem: ' + lista(conferir) + '. Pode ser número errado: confirme com a vendedora.'), esperando.length ? null : verEsses) : null);
  }

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
      estado.filtro.fora ? C.selo('Só pedidos fora do SC9', 'alta') : null,
      algumFiltro() ? h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.filtro = Object.assign({}, VAZIO); desenhar(); } }, ic('fechar'), 'Limpar filtros') : null);
  }
  function tabela(linhas) {
    if (!linhas.length) return C.vazio(algumFiltro() ? 'busca' : 'caixaEntrada', algumFiltro() ? 'Nenhuma solicitação com esses filtros' : 'Nenhuma solicitação por enquanto', algumFiltro() ? 'Tire algum filtro para ver mais.' : 'Quando uma vendedora pedir prioridade, ela aparece aqui na hora.');
    const abrir = (l) => { estado.aberta = l.id; desenhar(); };
    return h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', null, h('tr', null, ['Pedido', 'Vendedora', 'Filial', 'Prioridade', 'Motivo', 'Solicitado', 'Status', 'Responsável'].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', null, linhas.map((l) => h('tr', { class: 'linha ' + (ATIVOS.includes(l.status) ? l.nivel : '') + (estado.aberta === l.id ? ' sel' : '') + (estado.novos.has(l.id) ? ' novo-fio' : ''), tabindex: '0', role: 'button', 'aria-label': 'Abrir solicitação do pedido ' + l.pedido, onclick: () => abrir(l), onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(l); } } },
        h('td', null, h('span', { class: 'pedido', text: l.pedido }), h('span', { class: 'sub', text: l.protocolo || '' }), l.situacao === null ? C.selo('Fora do SC9', 'alta') : null),
        h('td', null, l.pedidoPor || '—', l.conta ? h('span', { class: 'sub', text: 'login ' + l.conta }) : null), h('td', { text: filialDe(l) || '—' }), h('td', null, C.selo(C.NIVEL[l.nivel], l.nivel)), h('td', { text: C.MOTIVO[l.motivo] ? C.MOTIVO[l.motivo].replace(' (explique na observação)', '') : '—' }),
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
          ativo ? h('div', null, h('p', { class: 'bloco-titulo', text: 'Situação do pedido agora' }), s ? h('div', { class: 'cx-situacao' }, h('b', { text: s.texto }), h('div', { class: 'mudo peq', style: 'margin-top:4px', text: [s.cliente, s.armazem, s.transportadora, s.dias != null ? s.dias + ' dias desde a liberação' : ''].filter(Boolean).join(' · ') }), s.ocorrencia ? h('div', { class: 'peq', style: 'margin-top:4px;color:#8a4207', text: 'Ocorrência: ' + s.ocorrencia }) : null) : h('div', { class: 'aviso' }, ic('alerta'), h('div', null, h('b', { text: 'Este pedido ainda não está no SC9. ' }), estado.dados && estado.dados.baseEm && Date.parse(l.criadoEm) <= Date.parse(estado.dados.baseEm) ? 'Mesmo depois da última carga ele não aparece: confira o número com a vendedora.' : 'Recarregue o SC9 para mostrar a situação dele (a vendedora já foi avisada de que a equipe vai recarregar).'))) : null,
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Solicitação' }), h('div', { class: 'resumo-lista', style: 'margin-top:0' },
            [['Vendedora', (l.pedidoPor || '—') + (l.conta ? ' (login ' + l.conta + ')' : ' (só informou o nome)')], ['Filial', filialDe(l) || '—'], ['Solicitado', C.dataHora(l.criadoEm) + ' (há ' + C.duracao(l.criadoEm) + ')'], ['Responsável', l.responsavel || 'ninguém assumiu'], ['Motivo', C.MOTIVO[l.motivo] || '—'], ['Observação', l.observacao || '—']].map(([t, v]) => h('div', null, h('span', { text: t }), h('b', { text: v })))),
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
      estado.sessao && estado.sessao.authed ? h('div', { class: 'topo-lado' }, h('a', { class: 'btn peq', href: '/fechamento-dia.html' }, ic('caminhao'), 'Fechamento do dia'), h('a', { class: 'btn peq', href: '/expedicao.html' }, ic('pacote'), 'Painel da Expedição'), estado.sessao.admin ? h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.mostraLink = !estado.mostraLink; desenhar(); } }, ic('link'), 'Link das vendedoras') : null, h('span', { class: 'mudo peq', text: estado.sessao.nome || 'Conta' }), h('button', { class: 'btn peq', type: 'button', onclick: sair }, ic('sair'), 'Sair')) : null));
    let corpo;
    if (!estado.sessao) corpo = h('main', { class: 'pagina' }, C.esqueleto(3));
    else if (!logado) corpo = telaLogin();
    else {
      const d = estado.dados, linhas = d ? ordenadas() : [];
      corpo = h('main', { class: 'pagina' },
        h('div', { class: 'card-titulo', style: 'margin:0' }, C.cabecalho('lista', 'Solicitações de prioridade', 'Quem decide é a logística: analise, aprove e responda. Atualiza sozinho a cada 20 segundos.'),
          h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.carregando = true; carregar(); } }, ic('atualizar'), 'Atualizar agora')),
        faixaSc9(),
        faixaAvisos(),
        abas(),
        estado.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), estado.erro) : null,
        estado.mostraLink && estado.sessao.admin ? cartaoLink() : null,
        estado.aba === 'avisos' ? telaAvisos() : estado.aba === 'exportar' ? (d ? telaExportar(linhas) : C.esqueleto(2)) : estado.aba === 'acessos' && estado.sessao.admin ? [telaAcessos(), cartaoConsultas()] : null,
        estado.aba !== 'fila' ? null : d ? indicadores() : C.esqueleto(2),
        estado.aba !== 'fila' ? null : d ? h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Solicitações' }), h('span', { class: 'mudo peq', text: linhas.length + (algumFiltro() ? ' de ' + todas().length : '') + (todas().length === 1 ? ' solicitação' : ' solicitações') })), barraFiltros(), h('div', { style: 'margin-top:14px' }, tabela(linhas))) : null);
    }
    const ab = logado && estado.dados && estado.aberta ? todas().find((x) => x.id === estado.aberta) : null;
    const av = logado && estado.avisos && estado.avisoAberto ? todosAvisos().find((x) => x.id === estado.avisoAberto) : null;
    $raiz.replaceChildren(topo, corpo, ...(ab ? gaveta(ab) : av ? gavetaAviso(av) : []));
    root.scrollTo(0, y);
    if (foco) { const e = root.document.getElementById(foco); if (e && e.focus) e.focus({ preventScroll: true }); }
  }

  root.setInterval(() => { if (!root.document.hidden) carregar(true); }, 20000);
  root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) carregar(true); });
  root.document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && (estado.aberta || estado.avisoAberto)) { estado.aberta = null; estado.avisoAberto = null; estado.gavAnim = null; desenhar(); } });
  (async () => { await carregarSessao(); desenhar(); await carregar(); carregarLink(); })();
})(window);
