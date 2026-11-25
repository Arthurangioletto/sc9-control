/* Central de Pedidos · fechamento do dia da expedição, por transportadora. Entra com o usuário do SC9 (administrador ou quem tem o
 * acesso "Recebimento" ou "Despacho"). Mostra, do Recebimento na Expedição do dia: recebidos, volumes, confirmados na planilha de
 * Entrega, "não sai hoje" (com motivo), o que ficou sem confirmação e transportadora diferente entre SC5 e Entrega. JavaScript puro. */
(function (root) {
  'use strict';
  const C = root.Central, h = C.h, ic = C.icone;
  const $raiz = root.document.getElementById('raiz');
  const CAB = { 'Content-Type': 'application/json', 'X-SC9-App': '1' };
  const estado = { sessao: null, login: { usuario: '', senha: '', erro: '', entrando: false }, dia: '', dados: null, erro: '', carregando: true };

  async function carregarSessao() {
    try {
      const j = await (await root.fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' })).json();
      const perfis = j.perfis || [];
      estado.sessao = { authed: Boolean(j.authed), nome: j.nome || j.usuario || '', admin: j.role === 'admin', pode: Boolean(j.authed && (j.role === 'admin' || perfis.includes('recebimento') || perfis.includes('despacho'))) };
    } catch (e) { estado.sessao = { authed: false, pode: false }; }
  }
  async function carregar(silencioso) {
    if (!estado.sessao || !estado.sessao.pode) { estado.carregando = false; return; }
    try {
      const r = await root.fetch('/api/recebimento/fechamento' + (estado.dia ? '?dia=' + encodeURIComponent(estado.dia) : ''), { cache: 'no-store', credentials: 'same-origin', headers: CAB });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Não consegui falar com o servidor.');
      estado.dados = j; estado.erro = ''; if (!estado.dia) estado.dia = j.dia;
    } catch (e) { estado.erro = e.message; }
    estado.carregando = false;
    const ativo = root.document.activeElement;
    if (!silencioso || !ativo || ativo === root.document.body || !/^(TEXTAREA|INPUT|SELECT)$/.test(ativo.tagName)) desenhar();
  }
  async function entrar() {
    const l = estado.login; l.entrando = true; l.erro = ''; desenhar();
    try {
      const r = await root.fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: CAB, body: JSON.stringify({ usuario: l.usuario, password: l.senha }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'Não consegui entrar.');
      l.senha = ''; await carregarSessao(); await carregar();
    } catch (e) { l.erro = e.message; }
    l.entrando = false; desenhar();
  }

  const num = (n) => String(n).replace('.', ',');
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '');
  const dataBr = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');
  function resumoTexto(f) {
    const t = f.totais, linhas = ['Fechamento da expedição · ' + dataBr(f.dia) + ': ' + t.recebidos + ' pedidos recebidos, ' + t.confirmados + ' confirmados na Entrega, ' + t.naoSai + ' que não saem hoje, ' + t.semConfirmacao + ' sem confirmação.'];
    for (const g of f.transportadoras) linhas.push('- ' + g.nome + ': ' + g.recebidos + ' recebidos, ' + num(g.volumes) + ' volumes' + (g.semVolume ? ' (' + g.semVolume + ' sem volume informado)' : '') + ', ' + g.confirmados + ' confirmados' + (g.naoSai ? ', ' + g.naoSai + ' não saem hoje' : '') + (g.semConfirmacao ? ', ' + g.semConfirmacao + ' sem confirmação' : '') + '.');
    if (t.divergencias) linhas.push('Atenção: ' + t.divergencias + ' pedido(s) com transportadora diferente entre o SC5 e a Entrega.');
    return linhas.join('\n');
  }
  const kpi = (n, rotulo, tom, dica) => h('div', { class: 'kpi' + (tom ? ' ' + tom : ''), title: dica || null, style: 'cursor:default' }, h('b', { text: String(n) }), h('span', { text: rotulo }));
  const lista = (titulo, itens, linha) => (itens.length ? h('details', { style: 'margin-top:10px' }, h('summary', { style: 'cursor:pointer;font-weight:700;font-size:14px;min-height:32px', text: titulo + ' (' + itens.length + ')' }),
    h('ul', { style: 'list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px' }, itens.map((x) => h('li', { class: 'mudo', style: 'font-size:14px;color:var(--tinta-2)' }, h('b', { text: x.pedido }), ' · ' + linha(x))))) : null);

  function cartaoTransportadora(g) {
    const pend = g.semConfirmacao;
    return h('section', { class: 'card', 'aria-label': 'Transportadora ' + g.nome },
      h('div', { class: 'card-titulo' }, h('h3', { text: g.nome }), pend ? C.selo(pend + ' sem confirmação', 'laranja') : C.selo('tudo confirmado', 'verde')),
      h('div', { class: 'fatos' }, C.fato('pacote', 'Recebidos', String(g.recebidos)), C.fato('caixaEntrada', 'Volumes', g.semVolume === g.recebidos ? 'não informados' : num(g.volumes) + (g.semVolume ? ' (' + g.semVolume + ' sem volume informado)' : '')), C.fato('okCirculo', 'Confirmados na Entrega', String(g.confirmados)), C.fato('relogio', 'Não saem hoje', String(g.naoSai))),
      lista('Sem confirmação na Entrega', g.semConfirmacaoLista, (x) => (x.cliente || 'sem cliente') + (x.volumes != null ? ' · ' + num(x.volumes) + ' vol.' : ' · volumes não informados') + (x.recebidoEm ? ' · recebido às ' + hora(x.recebidoEm) : '')),
      lista('Não saem hoje', g.naoSaiLista, (x) => (x.cliente || 'sem cliente') + ' · ' + x.motivo),
      lista('Transportadora diferente (SC5 x Entrega)', g.divergentes, (x) => 'SC5: ' + (x.sc5 || '—') + ' · Entrega: ' + (x.entrega || '—')));
  }
  function telaLogin() {
    const l = estado.login;
    return h('main', { class: 'pagina estreita' }, h('section', { class: 'card login-caixa' }, h('h2', { text: 'Entrar' }),
      h('p', { class: 'mudo peq', style: 'margin:4px 0 14px', text: estado.sessao && estado.sessao.authed ? 'Seu usuário não tem o acesso "Recebimento" nem "Despacho". Peça ao administrador para liberar, ou entre com outro usuário.' : 'Use o usuário e a senha do SC9. O administrador deixa o usuário vazio.' }),
      h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); entrar(); } },
        h('div', null, h('label', { class: 'rotulo', for: 'u', text: 'Usuário' }), h('input', { id: 'u', class: 'entrada', value: l.usuario, autocomplete: 'username', oninput: (ev) => { l.usuario = ev.target.value; } })),
        h('div', null, h('label', { class: 'rotulo', for: 's', text: 'Senha' }), h('input', { id: 's', class: 'entrada', type: 'password', value: l.senha, autocomplete: 'current-password', oninput: (ev) => { l.senha = ev.target.value; } })),
        h('button', { class: 'btn primario', type: 'submit', disabled: l.entrando, text: l.entrando ? 'Entrando…' : 'Entrar' }),
        l.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), l.erro) : null)));
  }
  function desenhar() {
    const foco = root.document.activeElement && root.document.activeElement.id ? root.document.activeElement.id : '';
    const y = root.scrollY, logado = estado.sessao && estado.sessao.pode, d = estado.dados;
    const topo = h('header', { class: 'topo' }, h('div', { class: 'topo-in' }, C.marca('Fechamento do dia'), h('div', { class: 'topo-lado' }, h('a', { class: 'btn peq', href: '/expedicao.html' }, ic('caminhao'), 'Painel da Expedição'), h('a', { class: 'btn peq', href: '/prioridades.html' }, ic('painel'), 'Painel da logística'))));
    let corpo;
    if (!estado.sessao) corpo = h('main', { class: 'pagina' }, C.esqueleto(3));
    else if (!logado) corpo = telaLogin();
    else {
      const t = d && d.totais;
      corpo = h('main', { class: 'pagina' },
        h('div', { class: 'card-titulo', style: 'margin:0' }, C.cabecalho('caminhao', 'Fechamento da expedição', 'Do Recebimento na Expedição: o que chegou, quantos volumes, o que a planilha de Entrega já confirmou e o que ficou sem confirmação, por transportadora.'),
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:end' },
            h('div', null, h('label', { class: 'rotulo', for: 'dia', text: 'Dia' }), h('input', { id: 'dia', class: 'entrada', type: 'date', value: estado.dia, max: d ? d.hoje : null, onchange: (ev) => { estado.dia = ev.target.value; estado.carregando = true; carregar(); } })),
            h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.carregando = true; carregar(); } }, ic('atualizar'), 'Atualizar'),
            d && d.totais.recebidos ? h('button', { class: 'btn peq primario', type: 'button', onclick: () => C.copiar(resumoTexto(d), 'Resumo copiado.') }, ic('copiar'), 'Copiar resumo') : null)),
        estado.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), estado.erro) : null,
        d ? h('div', { class: 'processo compacta', role: 'note' }, ic('info'), h('p', null, d.entregaEnviadaEm ? 'Última planilha de Entrega enviada em ' + C.dataHora(d.entregaEnviadaEm) + '. O que não está nela aparece como "sem confirmação".' : 'A planilha de Entrega ainda não foi enviada: por isso tudo aparece como "sem confirmação".')) : null,
        d ? h('div', { class: 'kpis' }, kpi(t.recebidos, 'Recebidos'), kpi(t.semVolume === t.recebidos && t.recebidos ? '—' : num(t.volumes), 'Volumes', '', t.semVolume ? t.semVolume + ' pedidos sem volume informado' : ''), kpi(t.confirmados, 'Confirmados na Entrega'), kpi(t.semConfirmacao, 'Sem confirmação', t.semConfirmacao ? 'urg' : 'urg zero'), kpi(t.divergencias, 'Transportadora diferente', t.divergencias ? 'urg' : 'urg zero', 'SC5 x planilha de Entrega')) : C.esqueleto(1),
        d && !t.recebidos ? h('section', { class: 'card' }, C.vazio('caixaEntrada', 'Nada recebido neste dia', 'Quando a expedição bipar pedidos no Recebimento, o fechamento aparece aqui.')) : null,
        d ? d.transportadoras.map(cartaoTransportadora) : null);
    }
    $raiz.replaceChildren(topo, corpo);
    root.scrollTo(0, y);
    if (foco) { const e = root.document.getElementById(foco); if (e && e.focus) e.focus({ preventScroll: true }); }
  }
  root.setInterval(() => { if (!root.document.hidden && estado.dia) carregar(true); }, 60000);
  (async () => { await carregarSessao(); desenhar(); await carregar(); })();
})(window);
