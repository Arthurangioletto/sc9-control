/* Painel da equipe: pedidos de prioridade enviados pelas vendedoras. Entra com usuário e senha do SC9 (administrador ou quem tem o acesso
 * "Ocorr."). Mostra cada pedido com a situação atual dele e deixa responder (status + resposta que a vendedora vê). JavaScript puro. */
(function (root) {
  'use strict';
  const FUSO = 'America/Sao_Paulo';
  const $app = root.document.getElementById('app');
  const CAB = { 'Content-Type': 'application/json', 'X-SC9-App': '1' };
  const NIVEL = { normal: 'Normal', media: 'Média', alta: 'Alta', urgente: 'Urgente' };
  const STATUS = { recebida: 'Recebida', em_analise: 'Em análise', aprovada: 'Aprovada', em_atendimento: 'Em atendimento', concluida: 'Concluída', nao_aprovada: 'Não aprovada' };
  const MOTIVO = { cliente_aguardando: 'Cliente esperando o pedido', prazo_combinado: 'Prazo combinado com o cliente', cliente_importante: 'Cliente estratégico', erro_nosso: 'Atraso por erro nosso', retirada: 'Cliente vai retirar', outro: 'Outro' };
  const ACAO = { criado: 'Pedido criado', reforco: 'Pedido reforçado', status: 'Status', assumir: 'Assumiu', interno: 'Comentário interno' };
  const VAZIO = { nivel: '', status: '', vendedora: '', filial: '', de: '', ate: '' };
  const estado = { sessao: null, login: { usuario: '', senha: '', erro: '', entrando: false }, dados: null, erro: '', respostas: {}, internos: {}, abertos: new Set(), filtro: Object.assign({}, VAZIO), salvando: '', vistos: null, novos: new Set(), link: null, linkErro: '', aviso: '' };

  const h = (tag, props, ...filhos) => {
    const e = root.document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else e.setAttribute(k, v);
    }
    for (const f of filhos.flat(Infinity)) { if (f == null || f === false) continue; e.appendChild(typeof f === 'string' || typeof f === 'number' ? root.document.createTextNode(String(f)) : f); }
    return e;
  };
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const ha = (iso) => { const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return min >= 1440 ? Math.floor(min / 1440) + ' d' : min >= 60 ? Math.floor(min / 60) + ' h' : Math.max(1, min) + ' min'; };

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
    if (!estado.sessao || !estado.sessao.pode) return;
    try {
      const j = await pedir('/api/prioridades');
      const ids = new Set(j.ativos.map((l) => l.id));
      if (estado.vistos) estado.novos = new Set([...ids].filter((i) => !estado.vistos.has(i)).concat([...estado.novos].filter((i) => ids.has(i))));
      estado.vistos = ids; estado.dados = j; estado.erro = '';
      root.document.title = (j.ativos.length ? '(' + j.ativos.length + ') ' : '') + 'Prioridades das vendedoras · SC9';
    } catch (e) { estado.erro = e.message; }
    if (!silencioso) desenhar(); else if (!root.document.activeElement || root.document.activeElement === root.document.body || !/^(TEXTAREA|INPUT)$/.test(root.document.activeElement.tagName)) desenhar();
  }
  async function carregarLink() {
    if (!estado.sessao || !estado.sessao.admin) return;
    try { estado.link = await pedir('/api/vendedoras-link'); estado.linkErro = ''; } catch (e) { estado.linkErro = e.message; }
    desenhar();
  }
  async function acaoLink(acao) {
    if (acao === 'gerar' && estado.link && estado.link.token && !root.confirm('Gerar um link novo faz o link antigo parar de funcionar. As vendedoras vão precisar do novo link. Continuar?')) return;
    if (acao === 'desativar' && !root.confirm('Desativar o link das vendedoras? Ninguém consegue abrir até gerar outro.')) return;
    try { estado.link = await pedir('/api/vendedoras-link', { method: 'POST', body: JSON.stringify({ acao }) }); estado.linkErro = ''; } catch (e) { estado.linkErro = e.message; }
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
  async function sair() { try { await root.fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: CAB }); } catch (e) { /* segue */ } estado.dados = null; estado.link = null; await carregarSessao(); desenhar(); }

  async function enviarAcao(l, corpo, aviso) {
    estado.salvando = l.id; estado.erro = ''; desenhar();
    try {
      estado.dados = await pedir('/api/prioridades', { method: 'POST', body: JSON.stringify(Object.assign({ id: l.id }, corpo)) });
      estado.vistos = new Set(estado.dados.ativos.map((x) => x.id)); estado.aviso = aviso;
      setTimeout(() => { estado.aviso = ''; desenhar(); }, 2500);
    } catch (e) { estado.erro = e.message; }
    estado.salvando = ''; desenhar();
  }
  async function responder(l, status) {
    const resposta = (estado.respostas[l.id] || '').trim();
    if (status === 'nao_aprovada' && !resposta) { estado.erro = 'Explique o motivo na resposta para a vendedora.'; return desenhar(); }
    await enviarAcao(l, { acao: 'status', status, resposta }, 'Status atualizado. A vendedora já vê.');
    if (!estado.erro) delete estado.respostas[l.id];
  }
  async function assumir(l) { await enviarAcao(l, { acao: 'assumir' }, 'Você assumiu este pedido de prioridade.'); }
  async function comentar(l) {
    const texto = (estado.internos[l.id] || '').trim();
    if (!texto) { estado.erro = 'Escreva o comentário interno.'; return desenhar(); }
    await enviarAcao(l, { acao: 'interno', texto }, 'Comentário interno salvo (a vendedora não vê).');
    if (!estado.erro) delete estado.internos[l.id];
  }

  /* ---------- filtros ---------- */
  const diaSP = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: FUSO }) : '');
  const filialDe = (l) => l.filial || (l.situacao && l.situacao.armazem) || '';
  const todas = () => (estado.dados ? estado.dados.ativos.concat(estado.dados.demais) : []);
  const passa = (l) => {
    const f = estado.filtro;
    if (f.nivel && l.nivel !== f.nivel) return false;
    if (f.status && l.status !== f.status) return false;
    if (f.vendedora && String(l.pedidoPor || '').toLowerCase() !== f.vendedora) return false;
    if (f.filial && filialDe(l) !== f.filial) return false;
    const dia = diaSP(l.criadoEm);
    if (f.de && dia < f.de) return false;
    if (f.ate && dia > f.ate) return false;
    return true;
  };
  const algumFiltro = () => Object.values(estado.filtro).some(Boolean);
  function barraFiltros() {
    const lista = todas();
    const vend = [...new Map(lista.filter((l) => l.pedidoPor).map((l) => [l.pedidoPor.toLowerCase(), l.pedidoPor])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const fils = [...new Set(lista.map(filialDe).filter(Boolean))].sort();
    const sel = (id, rotulo, chave, opcoes) => h('div', null, h('label', { for: id, text: rotulo }), h('select', { id, onchange: (ev) => { estado.filtro[chave] = ev.target.value; desenhar(); } }, h('option', { value: '', text: 'Todos' }), opcoes.map(([v, t]) => h('option', { value: v, text: t, selected: estado.filtro[chave] === v }))));
    return h('section', { class: 'cartao filtros' }, h('h3', { text: 'Filtros' }),
      h('div', { class: 'grade-filtros' },
        sel('f-nivel', 'Prioridade', 'nivel', Object.entries(NIVEL)), sel('f-status', 'Status', 'status', Object.entries(STATUS)),
        sel('f-vend', 'Vendedora', 'vendedora', vend), sel('f-filial', 'Filial', 'filial', fils.map((x) => [x, x])),
        h('div', null, h('label', { for: 'f-de', text: 'De' }), h('input', { id: 'f-de', type: 'date', value: estado.filtro.de, onchange: (ev) => { estado.filtro.de = ev.target.value; desenhar(); } })),
        h('div', null, h('label', { for: 'f-ate', text: 'Até' }), h('input', { id: 'f-ate', type: 'date', value: estado.filtro.ate, onchange: (ev) => { estado.filtro.ate = ev.target.value; desenhar(); } }))),
      algumFiltro() ? h('button', { class: 'btn peq', type: 'button', style: 'margin-top:10px', onclick: () => { estado.filtro = Object.assign({}, VAZIO); desenhar(); }, text: 'Limpar filtros' }) : null);
  }

  function historico(l) {
    const n = (l.historico || []).length;
    return h('details', { class: 'hist-det', open: estado.abertos.has(l.id), ontoggle: (ev) => { if (ev.target.open) estado.abertos.add(l.id); else estado.abertos.delete(l.id); } },
      h('summary', { text: 'Histórico (' + n + ')' }),
      h('ol', { class: 'hist' }, (l.historico || []).slice().reverse().map((x) => h('li', { class: x.acao === 'interno' ? 'interno' : '' },
        h('span', { class: 'hora', text: dataHora(x.em) }), ' ', h('b', { text: (ACAO[x.acao] || x.acao) + (x.acao === 'status' && x.status ? ': ' + STATUS[x.status] : x.acao === 'assumir' && x.status ? ' (em análise)' : '') }), x.por ? ' · ' + x.por : '', x.texto ? ' · ' + x.texto : ''))));
  }
  function cartaoPedido(l, ativo) {
    const s = l.situacao;
    const ocupado = estado.salvando === l.id;
    return h('div', { class: 'pedido' + (estado.novos.has(l.id) ? ' novo' : '') + (ativo && l.nivel === 'urgente' ? ' urg' : ''), id: 'p-' + l.id },
      h('div', { class: 'l1' }, h('b', { text: 'Pedido ' + l.pedido }), h('span', { class: 'tag ' + l.nivel, text: NIVEL[l.nivel] }), h('span', { class: 'tag ' + l.status, text: STATUS[l.status] }),
        l.protocolo ? h('span', { class: 'mudo peq', text: l.protocolo }) : null, estado.novos.has(l.id) ? h('span', { class: 'tag recebida', text: 'NOVO' }) : null),
      h('p', { class: 'mudo peq', text: 'Vendedora: ' + (l.pedidoPor || '—') + ' · ' + dataHora(l.criadoEm) + ' (há ' + ha(l.criadoEm) + ')' + (filialDe(l) ? ' · Filial: ' + filialDe(l) : '') + ' · Motivo: ' + (MOTIVO[l.motivo] || '—') }),
      h('p', { class: 'mudo peq', text: 'Responsável: ' + (l.responsavel || 'ninguém assumiu ainda') }),
      l.observacao ? h('p', { text: 'Observação: ' + l.observacao }) : null,
      (l.historico || []).filter((x) => x.acao === 'reforco').map((x) => h('p', { class: 'mudo peq', text: 'Reforço de ' + (x.por || '—') + ' (' + dataHora(x.em) + ')' + (x.texto ? ': ' + x.texto : '') })),
      ativo ? (s ? h('div', { class: 'sit' }, h('b', { text: s.texto + ' ' }), [s.cliente, s.armazem, s.transportadora, s.dias != null ? s.dias + ' dias desde a liberação' : ''].filter(Boolean).join(' · '), s.ocorrencia ? ' · Ocorrência: ' + s.ocorrencia : '') : h('div', { class: 'sit' }, l.naoAchado ? 'Pedido não encontrado na base do SC9 (confira o número).' : 'Pedido não encontrado na base atual do SC9.')) : null,
      l.resposta ? h('div', { class: 'resp' }, h('b', { text: 'Resposta para a vendedora: ' }), l.resposta) : null,
      ativo ? h('div', { class: 'acoes' },
        h('div', { class: 'campo' }, h('label', { for: 'r-' + l.id, text: 'Resposta para a vendedora (ela vê)' }), h('textarea', { id: 'r-' + l.id, maxlength: '300', placeholder: 'Ex.: aprovado, separando agora; sai hoje às 16h', oninput: (ev) => { estado.respostas[l.id] = ev.target.value; } }, estado.respostas[l.id] || '')),
        h('div', { class: 'botoes' },
          h('button', { class: 'btn peq', type: 'button', disabled: ocupado, onclick: () => assumir(l), text: l.responsavel ? 'Assumir para mim' : 'Assumir' }),
          ['em_analise', 'aprovada', 'em_atendimento', 'concluida', 'nao_aprovada'].filter((st) => st !== l.status).map((st) => h('button', { class: 'btn peq' + (st === 'concluida' ? ' primario' : ''), type: 'button', disabled: ocupado, onclick: () => responder(l, st), text: STATUS[st] }))),
        h('div', { class: 'campo' }, h('label', { for: 'i-' + l.id, text: 'Comentário interno (só a equipe vê)' }), h('textarea', { id: 'i-' + l.id, maxlength: '300', placeholder: 'Ex.: falei com o separador, falta 1 item', oninput: (ev) => { estado.internos[l.id] = ev.target.value; } }, estado.internos[l.id] || ''), h('button', { class: 'btn peq', type: 'button', style: 'margin-top:6px', disabled: ocupado, onclick: () => comentar(l), text: 'Salvar comentário interno' }))) : null,
      historico(l));
  }

  function desenhar() {
    const foco = root.document.activeElement && root.document.activeElement.id ? root.document.activeElement.id : '';
    const y = root.scrollY;
    const cab = h('header', { class: 'topo' }, h('div', null, h('p', { class: 'sobre', text: 'SC9 Control · Expedição' }), h('h1', { text: 'Prioridades das vendedoras' }), h('p', { class: 'mudo peq', text: 'Pedidos que as vendedoras pediram para priorizar. Atualiza sozinho a cada 20 segundos.' })),
      estado.sessao && estado.sessao.authed ? h('div', null, h('span', { class: 'mudo peq', text: (estado.sessao.nome || 'Conta') + ' · ' }), h('button', { class: 'btn peq', type: 'button', onclick: sair, text: 'Sair' })) : null);
    const corpo = [];
    if (!estado.sessao) corpo.push(h('p', { class: 'mudo', text: 'Carregando…' }));
    else if (!estado.sessao.pode) {
      const l = estado.login;
      corpo.push(h('section', { class: 'cartao' }, h('h2', { text: 'Entrar' }), h('p', { class: 'mudo peq', style: 'margin:4px 0 10px', text: estado.sessao.authed ? 'Seu usuário não tem o acesso "Ocorrências". Peça ao administrador para liberar, ou entre com outro usuário.' : 'Use o usuário e a senha do SC9. O administrador deixa o usuário vazio.' }),
        h('form', { class: 'login', onsubmit: (ev) => { ev.preventDefault(); entrar(); } },
          h('div', null, h('label', { for: 'u', text: 'Usuário' }), h('input', { id: 'u', value: l.usuario, autocomplete: 'username', oninput: (ev) => { l.usuario = ev.target.value; } })),
          h('div', null, h('label', { for: 's', text: 'Senha' }), h('input', { id: 's', type: 'password', value: l.senha, autocomplete: 'current-password', oninput: (ev) => { l.senha = ev.target.value; } })),
          h('button', { class: 'btn primario', type: 'submit', disabled: l.entrando, text: l.entrando ? 'Entrando…' : 'Entrar' })),
        l.erro ? h('p', { class: 'erro', role: 'alert', style: 'margin-top:10px', text: l.erro }) : null));
    } else {
      if (estado.aviso) corpo.push(h('p', { class: 'ok', role: 'status', text: estado.aviso }));
      if (estado.erro) corpo.push(h('p', { class: 'erro', role: 'alert', text: estado.erro }));
      if (estado.sessao.admin) corpo.push(h('section', { class: 'cartao' }, h('h3', { text: 'Link das vendedoras' }), h('p', { class: 'mudo peq', style: 'margin:4px 0 8px', text: 'É esse link que você passa para as vendedoras (rastrear pedido + pedir prioridade). Quem sair da empresa: gere um novo, e o antigo para de funcionar.' }),
        estado.link && estado.link.token ? h('div', { class: 'link-vend' }, h('input', { readonly: true, value: urlDoLink(), 'aria-label': 'Link das vendedoras', onfocus: (ev) => ev.target.select() }), h('button', { class: 'btn peq', type: 'button', onclick: async () => { try { await root.navigator.clipboard.writeText(urlDoLink()); estado.aviso = 'Link copiado.'; } catch (e) { estado.aviso = 'Selecione o link e copie.'; } desenhar(); setTimeout(() => { estado.aviso = ''; desenhar(); }, 2500); }, text: 'Copiar' }), h('button', { class: 'btn peq', type: 'button', onclick: () => acaoLink('gerar'), text: 'Trocar o link' }), h('button', { class: 'btn peq', type: 'button', onclick: () => acaoLink('desativar'), text: 'Desativar' }))
          : h('div', null, h('p', { class: 'mudo peq', text: 'Ainda não há link ativo.' }), h('button', { class: 'btn primario', type: 'button', style: 'margin-top:8px', onclick: () => acaoLink('gerar'), text: 'Gerar o link das vendedoras' })),
        estado.linkErro ? h('p', { class: 'erro', style: 'margin-top:8px', text: estado.linkErro }) : null));
      const d = estado.dados;
      if (d) corpo.push(barraFiltros());
      const ativos = d ? d.ativos.filter(passa) : [], demais = d ? d.demais.filter(passa) : [];
      corpo.push(h('section', { class: 'cartao' }, h('h2', { text: 'Para atender' + (d ? ' (' + ativos.length + (algumFiltro() ? ' de ' + d.ativos.length : '') + ')' : '') }),
        !d ? h('p', { class: 'mudo', text: 'Carregando…' }) : ativos.length ? ativos.map((l) => cartaoPedido(l, true)) : h('p', { class: 'mudo', style: 'margin-top:6px', text: algumFiltro() ? 'Nenhum pedido ativo com esses filtros.' : 'Nenhum pedido de prioridade esperando agora.' })));
      if (d && demais.length) corpo.push(h('section', { class: 'cartao' }, h('h2', { text: 'Finalizados (' + demais.length + ')' }), demais.map((l) => cartaoPedido(l, false))));
    }
    $app.replaceChildren(cab, ...corpo);
    root.scrollTo(0, y);
    if (foco) { const e = root.document.getElementById(foco); if (e && e.focus) e.focus({ preventScroll: true }); }
  }

  root.setInterval(() => { if (!root.document.hidden) carregar(true); }, 20000);
  root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) carregar(true); });
  (async () => { await carregarSessao(); desenhar(); await carregar(); carregarLink(); })();
})(window);
