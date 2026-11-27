/* Central de solicitações · painel da logística: abas "Caixa de entrada" (fila unificada, filtros, painel lateral para atender) e "Dashboard"
 * (KPIs, por dia, por tipo, por vendedora, por filial, cancelamentos a tempo, transferências e fila). Plugado em prioridades.js por um gancho
 * (SolicitacoesUI.tela / .gaveta / .contagem). JavaScript puro, gráficos em SVG/CSS próprio; tudo que vem do servidor entra como textContent. */
(function (root) {
  'use strict';
  const C = root.Central, S = root.SolComum, h = C.h, ic = S.ic;
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs, ...filhos) => {
    const el = root.document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    for (const f of filhos.flat()) if (f != null) el.appendChild(typeof f === 'string' ? root.document.createTextNode(f) : f);
    return el;
  };
  const VAZIO = { tipo: '', status: '', area: '', atrasadas: false, q: '', vista: 'ativas', kpi: '' };
  const u = { ctx: null, aba: '', dados: null, erro: '', carregando: false, filtro: Object.assign({}, VAZIO), aberta: null, gavAnim: null, resp: {}, interno: {}, salvando: '', vistos: null, novos: new Set(), dash: null, dashErro: '', dias: 30, dashCarregando: false, assinatura: '' };
  const num = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
  const pct = (n) => (n == null ? '—' : n + '%');
  const min = (n) => (n == null ? '—' : S.minTxt(n));
  const redesenhar = () => { if (u.ctx) u.ctx.redesenhar(); };
  const todas = () => (u.dados ? u.dados.ativos.concat(u.dados.demais) : []);
  const agoraMs = () => (u.dados && u.dados.agora ? Date.parse(u.dados.agora) + (Date.now() - u.dados.recebidoEm) : Date.now());

  /* ---------- dados ---------- */
  async function carregar(silencioso) {
    if (!u.ctx || !u.ctx.sessao() || !u.ctx.sessao().pode) return;
    try {
      const j = await u.ctx.pedir('/api/solicitacoes'); j.recebidoEm = Date.now();
      const ids = new Set(j.ativos.map((l) => l.id));
      if (u.vistos) u.novos = new Set([...ids].filter((i) => !u.vistos.has(i)).concat([...u.novos].filter((i) => ids.has(i))));
      u.vistos = ids; u.dados = j; u.erro = '';
    } catch (x) { u.erro = x.message; }
    u.carregando = false;
    const assin = u.dados ? u.dados.ativos.map((l) => l.id + l.atualizadoEm + l.prioridade).join() + '|' + u.dados.demais.length + '|' + u.erro : u.erro;
    if (!silencioso || assin !== u.assinatura) { u.assinatura = assin; if (['solic', 'dash'].includes(u.aba) || !silencioso) redesenhar(); }
  }
  async function carregarDash(silencioso) {
    if (!u.ctx || !u.ctx.sessao() || !u.ctx.sessao().pode) return;
    if (!silencioso) { u.dashCarregando = true; redesenhar(); }
    try { u.dash = await u.ctx.pedir('/api/solicitacoes/dashboard?dias=' + u.dias); u.dashErro = ''; } catch (x) { u.dashErro = x.message; }
    u.dashCarregando = false; if (u.aba === 'dash') redesenhar();
  }
  async function agir(l, corpo, aviso) {
    u.salvando = l.id; redesenhar();
    try {
      const j = await u.ctx.pedir('/api/solicitacoes', { method: 'POST', body: JSON.stringify(Object.assign({ id: l.id }, corpo)) }); j.recebidoEm = Date.now();
      u.dados = j; u.vistos = new Set(j.ativos.map((x) => x.id)); u.novos.delete(l.id); C.toast(aviso); u.salvando = ''; redesenhar(); return true;
    } catch (x) { C.toast(x.message, 'erro'); u.salvando = ''; redesenhar(); return false; }
  }
  const mudarStatus = async (l, status) => {
    const resposta = (u.resp[l.id] || '').trim();
    if (status === 'negada' && !resposta && !l.resposta) return C.toast('Explique o motivo na resposta antes de negar: a vendedora vai ler.', 'erro');
    if (await agir(l, { acao: 'status', status, resposta }, 'Status: ' + S.STATUS[status] + '.')) delete u.resp[l.id];
  };

  /* ---------- SLA ---------- */
  function sla(l) {
    const ativa = S.ATIVOS.includes(l.status), venc = l.slaVenceEm ? Date.parse(l.slaVenceEm) : null;
    if (l.primeiraRespostaEm) {
      const m = Math.max(0, Math.round((Date.parse(l.primeiraRespostaEm) - Date.parse(l.criadoEm)) / 6e4)), dentro = l.slaMin == null || m <= l.slaMin;
      return { tom: dentro ? 'ok' : 'tarde', icone: dentro ? 'ok' : 'alerta', texto: '1ª resposta em ' + S.minTxt(m), dica: dentro ? 'Dentro do prazo' : 'Fora do prazo (' + S.minTxt(l.slaMin) + ')' };
    }
    if (!ativa || venc == null) return { tom: 'neutro', icone: 'relogio', texto: '—', dica: '' };
    const resta = Math.round((venc - agoraMs()) / 6e4);
    if (l.atrasada || resta < 0) return { tom: 'atraso', icone: 'alerta', texto: 'Atrasada há ' + S.minTxt(Math.abs(Math.min(resta, 0))), dica: 'Prazo da 1ª resposta: ' + S.minTxt(l.slaMin) };
    if (resta <= Math.max(10, (l.slaMin || 60) * 0.25)) return { tom: 'alerta', icone: 'relogio', texto: 'Vence em ' + S.minTxt(resta), dica: 'Prazo da 1ª resposta: ' + S.minTxt(l.slaMin) };
    return { tom: 'ok', icone: 'relogio', texto: 'No prazo: ' + S.minTxt(resta) + ' restantes', dica: 'Prazo da 1ª resposta: ' + S.minTxt(l.slaMin) };
  }
  const seloSla = (l) => { const s = sla(l); return h('span', { class: 'sol-sla ' + s.tom, title: s.dica }, ic(s.icone), s.texto); };
  const seloPrio = (p) => C.selo(S.PRIORIDADE[p] || p, p === 'urgente' ? 'urgente' : p === 'alta' ? 'alta' : 'normal');
  const cancelaOuSegura = (l) => l.tipo === 'cancelar_pedido' || l.tipo === 'segurar_pedido';
  const seloTempo = (l) => (cancelaOuSegura(l) && S.ATIVOS.includes(l.status) ? (l.aTempo ? h('span', { class: 'sol-tempo sim' }, ic('raio'), 'Ainda dá tempo') : l.etapa === 'nao_achado' ? h('span', { class: 'sol-tempo nd' }, ic('info'), 'Pedido não achado') : l.etapa ? h('span', { class: 'sol-tempo nao' }, ic('alerta'), (S.ETAPA[l.etapa] || 'Já andou')) : null) : null);

  /* ---------- filtros ---------- */
  const haystack = (l) => S.norm([l.protocolo, l.pedido, l.pedidoPor, l.conta, l.filial, l.texto, S.tipoDe(l).rotulo, S.resumo(l), l.dados && l.dados.itens ? l.dados.itens.map((i) => i.produto + ' ' + i.descricao + ' ' + i.lote).join(' ') : '', l.dados && l.dados.produto].join(' '));
  function filtradas() {
    const f = u.filtro, ate = S.ATIVOS, q = S.norm(f.q).split(/\s+/).filter(Boolean);
    let lista = f.vista === 'ativas' ? u.dados.ativos : f.vista === 'encerradas' ? u.dados.demais : todas();
    lista = lista.filter((l) => (!f.tipo || l.tipo === f.tipo) && (!f.status || l.status === f.status) && (!f.area || l.area === f.area) && (!f.atrasadas || l.atrasada)
      && (f.kpi !== 'novas' || l.status === 'recebida') && (f.kpi !== 'urgentes' || (l.prioridade === 'urgente' && ate.includes(l.status))) && (f.kpi !== 'tempo' || (cancelaOuSegura(l) && l.aTempo && ate.includes(l.status))));
    if (q.length) { lista = lista.filter((l) => { const t = haystack(l); return q.every((p) => t.includes(p)); }); }
    return lista;
  }
  const algumFiltro = () => { const f = u.filtro; return Boolean(f.tipo || f.status || f.area || f.atrasadas || f.q || f.kpi || f.vista !== 'ativas'); };

  /* ---------- Caixa de entrada ---------- */
  function kpisCaixa() {
    const at = u.dados.ativos, n = { novas: at.filter((l) => l.status === 'recebida').length, urgentes: at.filter((l) => l.prioridade === 'urgente').length, atras: at.filter((l) => l.atrasada).length, tempo: at.filter((l) => cancelaOuSegura(l) && l.aTempo).length };
    const k = (id, icone, rot, valor, urg) => h('button', { class: 'kpi' + (urg && valor ? ' urg' : '') + (u.filtro.kpi === id ? ' ativo' : ''), type: 'button', 'aria-pressed': String(u.filtro.kpi === id), onclick: () => { u.filtro.kpi = u.filtro.kpi === id ? '' : id; if (id === 'atras') u.filtro.atrasadas = !u.filtro.atrasadas; u.filtro.vista = 'ativas'; redesenhar(); } }, ic(icone), h('b', { text: String(valor) }), h('span', { text: rot }));
    return h('div', { class: 'kpis sol-kpis4' },
      k('novas', 'caixaEntrada', 'Novas (ninguém viu)', n.novas, true), k('urgentes', 'raio', 'Urgentes', n.urgentes, true),
      h('button', { class: 'kpi' + (n.atras ? ' urg' : '') + (u.filtro.atrasadas ? ' ativo' : ''), type: 'button', 'aria-pressed': String(u.filtro.atrasadas), onclick: () => { u.filtro.atrasadas = !u.filtro.atrasadas; u.filtro.kpi = ''; u.filtro.vista = 'ativas'; redesenhar(); } }, ic('relogio'), h('b', { text: String(n.atras) }), h('span', { text: 'Passaram do prazo' })),
      k('tempo', 'ban', 'Cancelar/segurar ainda a tempo', n.tempo, true));
  }
  function barraFiltros() {
    const f = u.filtro, sel = (id, rot, valor, opcoes, aoMudar) => h('div', null, h('label', { class: 'rotulo', for: id, text: rot }), h('select', { id, class: 'entrada', onchange: (ev) => { aoMudar(ev.target.value); redesenhar(); } }, h('option', { value: '', text: 'Todos', selected: !valor }), opcoes.map(([v, t]) => h('option', { value: v, text: t, selected: valor === v }))));
    return h('div', { class: 'filtros sol-filtros' },
      h('div', { class: 'sol-busca' }, h('label', { class: 'rotulo', for: 'sol-q', text: 'Buscar' }), h('div', { class: 'sol-combo' }, h('span', { class: 'sol-combo-ic' }, ic('busca')), h('input', { id: 'sol-q', class: 'entrada', type: 'search', autocomplete: 'off', placeholder: 'Pedido, protocolo, vendedora, produto…', value: f.q, oninput: (ev) => { f.q = ev.target.value; pintarLista(); } }))),
      sel('sol-f-tipo', 'Assunto', f.tipo, S.ORDEM_TIPOS.map((k) => [k, S.TIPOS[k].rotulo]), (v) => { f.tipo = v; }),
      sel('sol-f-status', 'Status', f.status, Object.keys(S.STATUS).map((k) => [k, S.STATUS[k]]), (v) => { f.status = v; if (v && !S.ATIVOS.includes(v) && f.vista === 'ativas') f.vista = 'todas'; }),
      sel('sol-f-area', 'Área', f.area, Object.keys(S.AREAS).map((k) => [k, S.AREAS[k]]), (v) => { f.area = v; }),
      h('div', { class: 'sol-mostrar' }, h('span', { class: 'rotulo', text: 'Mostrar' }), h('div', { class: 'abas-pequenas', role: 'group', 'aria-label': 'Mostrar' }, [['ativas', 'Abertas'], ['encerradas', 'Encerradas'], ['todas', 'Todas']].map(([id, t]) => h('button', { type: 'button', 'aria-pressed': String(f.vista === id), onclick: () => { f.vista = id; redesenhar(); }, text: t })))),
      h('label', { class: 'sol-check' }, h('input', { type: 'checkbox', checked: f.atrasadas, onchange: (ev) => { f.atrasadas = ev.target.checked; redesenhar(); } }), h('span', { text: 'Só as que passaram do prazo' })),
      algumFiltro() ? h('button', { class: 'btn peq', type: 'button', onclick: () => { u.filtro = Object.assign({}, VAZIO); redesenhar(); } }, ic('fechar'), 'Limpar filtros') : null);
  }
  function linha(l) {
    const t = S.tipoDe(l), ativa = S.ATIVOS.includes(l.status), resumoTxt = S.resumo(l), tr = l.tipo === 'transferencia_peca' && l.dados && l.dados.origem;
    return h('button', { class: 'sol-linha prio-' + l.prioridade + (cancelaOuSegura(l) && l.aTempo && ativa ? ' destaque' : '') + (u.aberta === l.id ? ' sel' : '') + (u.novos.has(l.id) ? ' novo-fio' : ''), type: 'button', role: 'listitem', 'aria-label': 'Abrir ' + t.rotulo + ' ' + (l.protocolo || ''), onclick: () => { u.aberta = l.id; u.gavAnim = null; redesenhar(); } },
      h('span', { class: 'sol-orbe tom-' + t.tom }, ic(t.icone)),
      h('span', { class: 'sol-l-corpo' },
        h('span', { class: 'sol-l-topo' }, h('b', { text: t.rotulo }), seloPrio(l.prioridade), C.selo(S.STATUS[l.status] || l.status, l.status), seloTempo(l), tr ? h('span', { class: 'sol-selo-tipo tipo-' + (l.dados.tipoTransferencia || S.tipoDaTransf(l.dados.origem, l.dados.destino)), text: S.ROTULO_TRANSF[l.dados.tipoTransferencia || S.tipoDaTransf(l.dados.origem, l.dados.destino)] }) : null),
        resumoTxt ? h('span', { class: 'sol-l-resumo', text: resumoTxt }) : null,
        h('span', { class: 'sol-l-meta' }, l.pedido ? h('span', { class: 'num', text: 'Pedido ' + l.pedido + (l.pedidos && l.pedidos.length > 1 ? ' +' + (l.pedidos.length - 1) + ' (' + S.progressoLote(l) + ')' : '') }) : null, l.paraQuando ? h('span', { class: 'sol-pq-tag', title: 'Para quando a vendedora precisa' }, ic('relogio'), S.paraQuandoTxt(l.paraQuando)) : null, h('span', { text: l.pedidoPor || '—' }), l.filial ? h('span', { text: S.nomeFilial(l.filial) }) : null, h('span', { text: S.AREAS[l.area] || l.area }), h('span', { class: 'mudo', text: l.protocolo || '' }))),
      h('span', { class: 'sol-l-lado' }, ativa ? seloSla(l) : h('span', { class: 'mudo peq', text: 'Encerrada ' + (l.concluidaEm ? 'há ' + C.duracao(l.concluidaEm) : '') }), h('span', { class: 'mudo peq', text: 'Pedida há ' + C.duracao(l.criadoEm) }), l.responsavel ? h('span', { class: 'mudo peq', text: 'Com ' + l.responsavel }) : ativa ? h('span', { class: 'peq sem-dono', text: 'Sem responsável' }) : null));
  }
  const corpoLista = () => {
    const lista = filtradas();
    if (!lista.length) return C.vazio('caixaEntrada', algumFiltro() ? 'Nada com esses filtros' : 'Caixa de entrada vazia', algumFiltro() ? 'Tire algum filtro para ver mais.' : 'Quando uma vendedora pedir algo, aparece aqui na hora.');
    return h('div', { class: 'sol-lista', role: 'list' }, lista.map(linha));
  };
  function pintarLista() {
    const cx = root.document.getElementById('sol-lista-caixa'), ct = root.document.getElementById('sol-contagem'); if (!cx) return;
    cx.replaceChildren(corpoLista()); if (ct) ct.textContent = contagemTxt();
  }
  const contagemTxt = () => { const n = filtradas().length; return n + (algumFiltro() ? ' de ' + (u.filtro.vista === 'ativas' ? u.dados.ativos.length : todas().length) : '') + (n === 1 ? ' solicitação' : ' solicitações'); };
  function telaCaixa() {
    if (!u.dados) return u.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), u.erro) : C.esqueleto(3);
    const novas = u.dados.ativos.filter((l) => l.status === 'recebida').length;
    return [u.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), u.erro) : null,
      novas ? h('section', { class: 'alerta-sc9', role: 'status' }, h('div', { class: 'bola' }, ic('caixaEntrada')), h('div', { class: 'meio' }, h('h2', { text: novas === 1 ? '1 solicitação nova das vendedoras' : novas + ' solicitações novas das vendedoras' }), h('p', { text: 'Ninguém da logística olhou ainda. Cancelar e segurar pedido têm prazo curto.' })), h('button', { class: 'btn peq', type: 'button', onclick: () => { u.filtro = Object.assign({}, VAZIO, { kpi: 'novas' }); redesenhar(); } }, ic('lista'), 'Ver as novas')) : null,
      kpisCaixa(),
      h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('div', null, h('h2', { text: 'Caixa de entrada' }), h('p', { class: 'mudo peq', id: 'sol-contagem', text: contagemTxt() })),
        h('div', { class: 'acoes', style: 'margin:0' }, h('a', { class: 'btn peq', href: '/api/solicitacoes/exportar', download: '' }, ic('baixar'), 'Baixar tudo (CSV)'), h('button', { class: 'btn peq', type: 'button', onclick: () => { u.carregando = true; carregar(); } }, ic('atualizar'), 'Atualizar agora'))),
        barraFiltros(), h('div', { id: 'sol-lista-caixa', style: 'margin-top:14px' }, corpoLista()))];
  }

  /* ---------- painel lateral ---------- */
  function gaveta(l) {
    const t = S.tipoDe(l), ativa = S.ATIVOS.includes(l.status), ocupado = u.salvando === l.id, s = l.situacao, d = l.dados || {};
    const fecha = () => { u.aberta = null; u.gavAnim = null; redesenhar(); };
    const abre = u.gavAnim !== l.id ? ' abre' : ''; u.gavAnim = l.id;
    const bt = (st, texto, cls) => h('button', { class: 'btn peq ' + (cls || ''), type: 'button', disabled: ocupado, onclick: () => mudarStatus(l, st) }, texto);
    const dados = S.dadosLegiveis(l), sl = sla(l);
    const infos = [['Vendedora', (l.pedidoPor || '—') + (l.conta ? ' (login ' + l.conta + ')' : ' (só informou o nome)')], ['Filial', l.filial ? S.nomeFilial(l.filial) : '—'], ['Pedida', C.dataHora(l.criadoEm) + ' (há ' + C.duracao(l.criadoEm) + ')'], ['Para quando', l.paraQuando ? S.paraQuandoTxt(l.paraQuando) : 'Não informado'], ['Responsável', l.responsavel || 'ninguém assumiu'], ['Área', S.AREAS[l.area] || l.area],
      ['Prazo da 1ª resposta', S.minTxt(l.slaMin)], ['1ª resposta', l.primeiraRespostaEm ? C.dataHora(l.primeiraRespostaEm) : 'ainda não']];
    return [h('div', { class: 'gaveta-fundo' + abre, onclick: fecha }),
      h('aside', { class: 'gaveta' + abre, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Solicitação ' + (l.protocolo || t.rotulo) },
        h('div', { class: 'gaveta-cab' }, h('div', null, h('p', { class: 'mudo peq', text: l.protocolo || 'Solicitação' }), h('h3', { text: t.rotulo }), h('div', { class: 'sol-selos' }, seloPrio(l.prioridade), C.selo(S.STATUS[l.status] || l.status, l.status), l.pedido ? C.selo('Pedido ' + l.pedido, 'normal', true) : null, ativa ? seloSla(l) : null)), h('button', { class: 'btn peq fantasma', type: 'button', 'aria-label': 'Fechar', onclick: fecha }, ic('fechar'))),
        h('div', { class: 'gaveta-corpo' },
          cancelaOuSegura(l) ? h('div', { class: 'sol-etapa ' + (l.aTempo ? 'ok' : l.etapa === 'nao_achado' ? 'info' : 'tarde'), role: 'note' }, ic(l.aTempo ? 'raio' : l.etapa === 'nao_achado' ? 'info' : 'alerta'),
            h('div', null, h('b', { text: l.aTempo ? 'Ainda não separado: dá para parar agora' : l.etapa === 'nao_achado' ? 'Pedido não encontrado no SC9' : 'O pedido já andou' }), l.etapa ? h('span', { class: 'sol-etapa-nome', text: 'Situação no SC9 quando a vendedora pediu: ' + (S.ETAPA[l.etapa] || l.etapa) }) : null)) : null,
          l.pedido && ativa ? h('div', null, h('p', { class: 'bloco-titulo', text: 'Situação do pedido agora' }), s ? h('div', { class: 'cx-situacao' }, h('b', { text: s.texto }), h('div', { class: 'mudo peq', style: 'margin-top:4px', text: [s.cliente, s.armazem].filter(Boolean).join(' · ') })) : h('div', { class: 'cx-situacao' }, 'Pedido ainda não está no SC9 carregado. Recarregue o SC9 para ver a situação.')) : null,
          l.tipo === 'transferencia_peca' && d.itens ? h('div', null, h('p', { class: 'bloco-titulo', text: 'Transferência pedida' }), S.rotaTransf(d), S.tabelaItens(d, { saldo: true }),
            d.acimaDoSaldo ? h('div', { class: 'aviso', style: 'margin-top:10px' }, ic('alerta'), h('div', null, h('b', { text: 'Algum item passa do saldo da origem. ' }), 'O saldo é o de quando ela pediu.')) : null,
            h('div', { class: 'resumo-lista' }, [['Total', S.plural(d.totalProdutos || d.itens.length, 'produto', 'produtos') + ', ' + S.plural(d.totalPecas != null ? d.totalPecas : S.totaisTransf(d.itens).pecas, 'peça', 'peças')], ['Prazo', d.prazo ? S.dataCurtaISO(d.prazo) : 'sem prazo'], d.motivo ? ['Motivo', d.motivo] : null].filter(Boolean).map(([a, v]) => h('div', null, h('span', { text: a }), h('b', { text: v }))))) : null,
          l.status === 'aguardando_aprovacao' ? h('div', { class: 'aviso', role: 'note' }, ic('relogio'), h('div', null, h('b', { text: 'Motoboy urgente: aguardando a aprovação da equipe. ' }), 'Aprove para a logística providenciar ou negue explicando o motivo.', h('div', { class: 'botoes-status', style: 'margin-top:8px' }, bt('em_andamento', 'Aprovar o motoboy', 'primario'), bt('negada', 'Negar', 'perigo')))) : null,
          l.pedidos && l.pedidos.length > 1 ? h('div', null, h('p', { class: 'bloco-titulo', text: 'Pedidos desta solicitação · ' + S.progressoLote(l) }), h('ul', { class: 'sol-lote-lista' }, l.pedidos.map((x) => h('li', { class: x.concluido ? 'feito' : '' },
            h('b', { class: 'num', text: x.pedido }), h('span', { class: 'mudo', text: x.naoAchado ? 'Fora do SC9 quando pediu' : x.etapa ? S.ETAPA[x.etapa] || '' : '' }), x.concluido ? h('span', { class: 'peq', text: 'Atendido' + (x.concluidoPor ? ' por ' + x.concluidoPor : '') }) : null,
            ativa || x.concluido ? h('button', { class: 'btn peq' + (x.concluido ? '' : ' primario'), type: 'button', disabled: ocupado, style: 'margin-left:auto', onclick: () => agir(l, { acao: 'concluir_pedido', pedido: x.pedido, desfazer: x.concluido || undefined }, x.concluido ? 'Pedido ' + x.pedido + ' reaberto.' : 'Pedido ' + x.pedido + ' concluído.') }, x.concluido ? 'Reabrir' : 'Concluir este pedido') : null)))) : null,
          l.tipo === 'falta_item' && d.itens ? h('div', null, h('p', { class: 'bloco-titulo', text: 'Produtos em falta' }), S.tabelaItens(d, { semLote: true })) : null,
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Pedido da vendedora' }), h('div', { class: 'resumo-lista', style: 'margin-top:0' }, dados.concat(infos).map(([a, v]) => h('div', null, h('span', { text: a }), h('b', { text: v }))))),
          h('p', { class: 'sol-sla-linha' }, seloSla(l), h('span', { class: 'mudo peq', text: sl.dica })),
          l.resposta ? h('div', { class: 'cx-situacao', style: 'background:var(--azul-claro);color:var(--azul-escuro)' }, h('b', { text: 'Última resposta para a vendedora: ' }), l.resposta) : null,
          ativa ? h('div', { class: 'sol-acoes' },
            h('button', { class: 'btn', type: 'button', disabled: ocupado, onclick: () => agir(l, { acao: 'assumir' }, 'Você assumiu esta solicitação.') }, ic('usuarioCheck'), l.responsavel ? 'Assumir para mim' : 'Assumir esta solicitação'),
            h('div', null, h('label', { class: 'rotulo', for: 'sr-' + l.id, text: 'Resposta para a vendedora (ela vê)' }), h('textarea', { id: 'sr-' + l.id, class: 'entrada', maxlength: '300', placeholder: 'Ex.: transferência feita, chega amanhã; ou: pedido parado, não separe.', oninput: (ev) => { u.resp[l.id] = ev.target.value; } }, u.resp[l.id] || '')),
            h('div', { class: 'botoes-status' }, l.status !== 'em_analise' ? bt('em_analise', 'Em análise') : null, l.status !== 'em_andamento' ? bt('em_andamento', 'Em andamento') : null, bt('concluida', 'Concluir', 'primario'), bt('negada', 'Negar', 'perigo')))
            : h('div', { class: 'aviso' }, ic('info'), h('div', null, h('b', { text: 'Solicitação encerrada. ' }), 'Se precisar, reabra:', h('div', { class: 'botoes-status', style: 'margin-top:8px' }, bt('em_andamento', 'Reabrir (em andamento)')))),
          h('div', { class: 'sol-ajustes' },
            h('div', null, h('span', { class: 'rotulo', text: 'Prioridade' }), h('div', { class: 'abas-pequenas', role: 'group', 'aria-label': 'Prioridade' }, Object.keys(S.PRIORIDADE).map((p) => h('button', { type: 'button', disabled: ocupado, 'aria-pressed': String(l.prioridade === p), onclick: () => { if (l.prioridade !== p) agir(l, { acao: 'prioridade', prioridade: p }, 'Prioridade: ' + S.PRIORIDADE[p] + '.'); }, text: S.PRIORIDADE[p] })))),
            h('div', null, h('label', { class: 'rotulo', for: 'sa-' + l.id, text: 'Área responsável' }), h('select', { id: 'sa-' + l.id, class: 'entrada', disabled: ocupado, onchange: (ev) => { if (ev.target.value !== l.area) agir(l, { acao: 'area', area: ev.target.value }, 'Área: ' + S.AREAS[ev.target.value] + '.'); } }, Object.keys(S.AREAS).map((k) => h('option', { value: k, text: S.AREAS[k], selected: l.area === k }))))),
          h('div', null, h('label', { class: 'rotulo', for: 'si-' + l.id, text: 'Comentário interno (só a equipe vê)' }), h('textarea', { id: 'si-' + l.id, class: 'entrada', maxlength: '300', placeholder: 'Ex.: falei com o estoque, falta 1 item.', oninput: (ev) => { u.interno[l.id] = ev.target.value; } }, u.interno[l.id] || ''),
            h('button', { class: 'btn peq', type: 'button', style: 'margin-top:8px', disabled: ocupado, onclick: async () => { const tx = (u.interno[l.id] || '').trim(); if (!tx) return C.toast('Escreva o comentário.', 'erro'); if (await agir(l, { acao: 'interno', texto: tx }, 'Comentário salvo.')) delete u.interno[l.id]; } }, ic('comentario'), 'Salvar comentário')),
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Histórico' }), h('ol', { class: 'hist', 'aria-label': 'Histórico' }, (l.historico || []).slice().reverse().map((x) => h('li', { class: x.acao === 'interno' ? 'interno' : '' },
            h('span', { class: 'hora', text: C.dataHora(x.em) }), ' ', h('b', { text: (S.ACAO[x.acao] || x.acao === 'criado' ? 'Pedida' : x.acao) + (x.acao === 'status' && x.status ? ': ' + (S.STATUS[x.status] || x.status) : x.acao === 'prioridade' && x.prioridade ? ': ' + (S.PRIORIDADE[x.prioridade] || x.prioridade) : x.acao === 'area' && x.area ? ': ' + (S.AREAS[x.area] || x.area) : '') }), x.por ? h('span', { class: 'quem', text: ' · ' + x.por }) : null, x.texto ? ' · ' + x.texto : '')))))) ];
  }

  /* ---------- Dashboard ---------- */
  const SERIES = [['solicitacoes', 'Solicitações da central', 'serie-a'], ['prioridades', 'Prioridades de pedido', 'serie-b'], ['avisos', 'Avisos à expedição', 'serie-c']];
  function graficoDias(porDia) {
    const W = 720, H = 250, mE = 38, mD = 8, mT = 12, mB = 30, n = porDia.length, iw = W - mE - mD, ih = H - mT - mB;
    const maxV = Math.max(1, ...porDia.map((d) => d.solicitacoes + d.prioridades + d.avisos)), topo = maxV <= 4 ? 4 : Math.ceil(maxV / 4) * 4, passo = iw / n, bw = Math.max(2, Math.min(26, passo * 0.72));
    const y = (v) => mT + ih - (v / topo) * ih, fmt = (iso) => iso.slice(8) + '/' + iso.slice(5, 7);
    const g = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'sol-svg', role: 'img', 'aria-label': 'Gráfico de barras empilhadas por dia: solicitações, prioridades e avisos', preserveAspectRatio: 'xMidYMid meet' },
      sv('defs', null, sv('pattern', { id: 'pat-b', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, sv('rect', { width: 6, height: 6, fill: '#f5a04d' }), sv('rect', { width: 2.4, height: 6, fill: '#a9500a' })),
        sv('pattern', { id: 'pat-c', width: 5, height: 5, patternUnits: 'userSpaceOnUse' }, sv('rect', { width: 5, height: 5, fill: '#bfe6dc' }), sv('circle', { cx: 2.5, cy: 2.5, r: 1.3, fill: '#0f6e5a' }))));
    for (let k = 0; k <= 4; k++) { const v = (topo / 4) * k; g.appendChild(sv('line', { x1: mE, x2: W - mD, y1: y(v), y2: y(v), class: 'sol-grade' })); g.appendChild(sv('text', { x: mE - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'sol-eixo' }, String(Math.round(v)))); }
    const cada = n <= 8 ? 1 : n <= 16 ? 2 : n <= 31 ? 5 : 10;
    porDia.forEach((d, i) => {
      const x = mE + i * passo + (passo - bw) / 2, partes = [[d.solicitacoes, 'serie-a'], [d.prioridades, 'serie-b'], [d.avisos, 'serie-c']];
      let acum = 0; const gr = sv('g', { class: 'sol-dia' }, sv('title', null, fmt(d.dia) + ': ' + d.solicitacoes + ' solicitações, ' + d.prioridades + ' prioridades, ' + d.avisos + ' avisos'));
      gr.appendChild(sv('rect', { x: mE + i * passo, y: mT, width: passo, height: ih, fill: 'transparent' }));
      for (const [v, cl] of partes) { if (!v) continue; gr.appendChild(sv('rect', { x, y: y(acum + v), width: bw, height: Math.max(1, y(acum) - y(acum + v)), class: 'sol-b ' + cl, rx: bw > 6 ? 2 : 0 })); acum += v; }
      g.appendChild(gr);
      if (i % cada === 0 || i === n - 1) g.appendChild(sv('text', { x: x + bw / 2, y: H - 10, 'text-anchor': 'middle', class: 'sol-eixo' }, fmt(d.dia)));
    });
    return g;
  }
  const legenda = () => h('ul', { class: 'sol-legenda', 'aria-label': 'Legenda' }, SERIES.map(([, nome, cl]) => h('li', null, h('i', { class: 'sol-amostra ' + cl }), nome)));
  function barras(itens, opcoes) { // itens: [{rotulo, valor, extra, parte}]
    const op = opcoes || {}, max = Math.max(1, ...itens.map((i) => i.valor));
    if (!itens.length) return h('p', { class: 'mudo peq', text: 'Sem dados no período.' });
    return h('ul', { class: 'sol-barras' }, itens.map((i) => h('li', null, h('span', { class: 'sol-b-rot', text: i.rotulo }), h('span', { class: 'sol-b-trilho', 'aria-hidden': 'true' }, h('i', { class: 'sol-b-todo', style: 'width:' + Math.max(2, Math.round((i.valor / max) * 100)) + '%' }, i.parte ? h('i', { class: 'sol-b-parte', style: 'width:' + Math.round((i.parte / Math.max(1, i.valor)) * 100) + '%' }) : null)), h('b', { class: 'num', text: num(i.valor) }), i.extra ? h('span', { class: 'sol-b-extra mudo peq', text: i.extra }) : null)));
  }
  const blocoDash = (titulo, sub, ...filhos) => h('section', { class: 'card sol-bloco' }, h('div', { class: 'card-titulo' }, h('div', null, h('h2', { text: titulo }), sub ? h('p', { class: 'mudo peq', text: sub }) : null)), ...filhos);
  function telaDash() {
    const d = u.dash;
    const cab = h('div', { class: 'sol-dash-topo no-print' }, h('div', { class: 'abas-pequenas', role: 'group', 'aria-label': 'Período' }, [7, 30, 90].map((n) => h('button', { type: 'button', 'aria-pressed': String(u.dias === n), onclick: () => { u.dias = n; u.dash = null; carregarDash(); }, text: 'Últimos ' + n + ' dias' }))),
      h('div', { class: 'acoes', style: 'margin:0' }, h('button', { class: 'btn peq', type: 'button', onclick: () => carregarDash() }, ic('atualizar'), 'Atualizar'), h('button', { class: 'btn peq', type: 'button', onclick: () => root.print() }, ic('imprimir'), 'Imprimir')));
    if (!d) return [cab, u.dashErro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), u.dashErro) : C.esqueleto(3)];
    const k = d.kpis || {}, kp = (rot, valor, dica, tom) => h('div', { class: 'sol-kpi ' + (tom || '') }, h('span', { text: rot }), h('b', { class: 'num', text: valor }), dica ? h('small', { text: dica }) : null);
    const tr = d.transferencias || { rotas: [], produtos: [] }, cn = d.cancelamentos || {}, f = d.fontes || {};
    const totalDia = (d.porDia || []).reduce((s, x) => s + x.solicitacoes + x.prioridades + x.avisos, 0);
    return [cab, u.dashErro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), u.dashErro) : null,
      h('p', { class: 'mudo peq' }, 'Período: ' + S.dataCurtaISO(d.periodo.de) + ' a ' + S.dataCurtaISO(d.periodo.ate) + ' (' + d.periodo.dias + ' dias). No período: ' + num(f.solicitacoes) + ' solicitações da central, ' + num(f.prioridades) + ' prioridades de pedido e ' + num(f.avisos) + ' avisos. Atualizado às ' + C.horaBR(d.geradoEm) + '.'),
      h('div', { class: 'sol-kpis', role: 'group', 'aria-label': 'Indicadores' },
        kp('Abertas agora', num(k.abertas), 'ainda sem conclusão'), kp('Passaram do prazo', num(k.atrasadasSla), 'sem 1ª resposta no prazo', k.atrasadasSla ? 'ruim' : 'bom'), kp('Criadas no período', num(k.criadasNoPeriodo)), kp('Concluídas', num(k.concluidasNoPeriodo), 'no período'),
        kp('Negadas', num(k.negadas), 'no período'), kp('Tempo até a 1ª resposta', min(k.tempoMedioPrimeiraRespostaMin != null ? k.tempoMedioPrimeiraRespostaMin : k.tempoMedio1aRespostaMin), 'média'), kp('Tempo até concluir', min(k.tempoMedioResolucaoMin), 'média'), kp('Respondidas no prazo', pct(k.pctNoPrazo), 'dentro do prazo de cada tipo', k.pctNoPrazo != null ? (k.pctNoPrazo >= 80 ? 'bom' : 'ruim') : '')),
      blocoDash('Pedidos por dia', 'Barras empilhadas: solicitações da central, prioridades de pedido e avisos à expedição.', totalDia ? [graficoDias(d.porDia), legenda(),
        h('details', { class: 'sol-detalhes' }, h('summary', { class: 'resumo-como', text: 'Ver os números de cada dia' }), h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela', style: 'min-width:0' }, h('thead', null, h('tr', null, h('th', { text: 'Dia' }), h('th', { text: 'Solicitações' }), h('th', { text: 'Prioridades' }), h('th', { text: 'Avisos' }), h('th', { text: 'Concluídas' }))), h('tbody', null, d.porDia.slice().reverse().map((x) => h('tr', null, h('td', { text: S.dataCurtaISO(x.dia) }), h('td', { class: 'num', text: String(x.solicitacoes) }), h('td', { class: 'num', text: String(x.prioridades) }), h('td', { class: 'num', text: String(x.avisos) }), h('td', { class: 'num', text: String(x.concluidas) })))))))] : C.vazio('busca', 'Nenhum pedido neste período', 'Escolha um período maior.')),
      h('div', { class: 'sol-dupla' },
        blocoDash('Por assunto', 'Quantas, e como a logística respondeu.', barras((d.porTipo || []).filter((x) => x.total).map((x) => ({ rotulo: x.rotulo, valor: x.total, extra: [x.abertas ? x.abertas + ' abertas' : '', x.medResp != null ? 'resp. em ' + S.minTxt(x.medResp) : '', x.pctNoPrazo != null ? x.pctNoPrazo + '% no prazo' : ''].filter(Boolean).join(' · ') })))),
        blocoDash('Cancelar e segurar: deu tempo?', 'Pedidos que ainda não tinham sido separados quando a vendedora pediu.', cn.total ? [h('div', { class: 'sol-grande' }, h('b', { class: 'num', text: pct(cn.pctATempo) }), h('span', { text: 'chegaram a tempo' })),
          h('div', { class: 'sol-empilhada', role: 'img', 'aria-label': cn.aTempo + ' a tempo e ' + cn.tarde + ' tarde' }, cn.aTempo ? h('i', { class: 'a-tempo', style: 'flex:' + cn.aTempo }) : null, cn.tarde ? h('i', { class: 'tarde', style: 'flex:' + cn.tarde }) : null),
          h('ul', { class: 'sol-legenda' }, h('li', null, h('i', { class: 'sol-amostra a-tempo' }), 'A tempo: ' + cn.aTempo), h('li', null, h('i', { class: 'sol-amostra tarde' }), 'Já tinha andado: ' + cn.tarde))] : h('p', { class: 'mudo', text: 'Nenhum cancelamento ou pedido para segurar no período.' }))),
      h('div', { class: 'sol-dupla' },
        blocoDash('Por vendedora', 'As 15 que mais pediram.', barras((d.porVendedora || []).map((x) => ({ rotulo: x.nome, valor: x.total, parte: x.abertas, extra: (x.abertas ? x.abertas + ' abertas · ' : '') + 'mais pede: ' + (x.tipoMaisComumRotulo || (S.TIPOS[x.tipoMaisComum] ? S.TIPOS[x.tipoMaisComum].rotulo : x.tipoMaisComum || '—')) })))),
        blocoDash('Por filial', 'Filial do pedido (ou a de origem, nas transferências).', barras((d.porFilial || []).map((x) => ({ rotulo: S.nomeFilial(x.filial) || 'Sem filial', valor: x.total }))))),
      blocoDash('Transferências de peça', num(tr.total) + (tr.total === 1 ? ' pedido' : ' pedidos') + ' no período' + (tr.totalPecas != null ? ', ' + num(tr.totalPecas) + ' peças' : '') + (tr.totalProdutos != null ? ' em ' + num(tr.totalProdutos) + ' produtos diferentes' : '') + '.',
        tr.total ? h('div', { class: 'sol-dupla sem-card' },
          h('div', null, h('h3', { text: 'Rotas mais usadas (origem → destino)' }), h('ul', { class: 'sol-rotas' }, tr.rotas.map((r) => h('li', null, h('span', { class: 'sol-rota-mini' }, h('b', { text: r.origemRotulo || r.origem }), ic('seta'), h('b', { text: r.destinoRotulo || r.destino })), h('span', { class: 'sol-selo-tipo tipo-' + r.tipoTransferencia, text: S.ROTULO_TRANSF[r.tipoTransferencia] || '' }), h('span', { class: 'mudo peq num', text: S.plural(r.total, 'pedido', 'pedidos') + ' · ' + S.plural(r.pecas, 'peça', 'peças') }))))),
          h('div', null, h('h3', { text: 'Produtos mais transferidos' }), h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela', style: 'min-width:0' }, h('thead', null, h('tr', null, h('th', { text: 'Código' }), h('th', { text: 'Descrição' }), h('th', { class: 'dir', text: 'Pedidos' }), h('th', { class: 'dir', text: 'Peças' }))), h('tbody', null, tr.produtos.map((p) => h('tr', null, h('td', { class: 'num', text: p.produto }), h('td', { text: p.descricao || '—' }), h('td', { class: 'num dir', text: String(p.pedidos) }), h('td', { class: 'num dir', text: num(p.pecas) })))))))) : h('p', { class: 'mudo', text: 'Nenhuma transferência no período.' })),
      blocoDash('Fila dos mais antigos', 'Solicitações, prioridades e avisos ainda abertos, do mais antigo para o mais novo.', (d.fila || []).length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela', style: 'min-width:640px' }, h('thead', null, h('tr', null, h('th', { text: 'Origem' }), h('th', { text: 'O que é' }), h('th', { text: 'Pedido' }), h('th', { text: 'Vendedora' }), h('th', { text: 'Status' }), h('th', { text: 'Parada há' }), h('th', { class: 'no-print' }))),
        h('tbody', null, d.fila.map((x) => h('tr', { class: x.atrasada ? 'alta' : '' }, h('td', null, h('span', { class: 'sol-fonte', text: x.fonte === 'solicitacao' ? 'Solicitação' : x.fonte === 'prioridade' ? 'Prioridade' : 'Aviso' })), h('td', null, h('b', { text: x.rotulo || '—' }), h('span', { class: 'sub', text: x.protocolo || '' })), h('td', { class: 'num', text: x.pedido || '—' }), h('td', { text: x.vendedora || '—' }),
          h('td', null, C.selo(S.STATUS[x.status] || C.STATUS[x.status] || C.STATUS_AVISO[x.status] || x.status, x.status), x.atrasada ? h('span', { class: 'sol-sla atraso', style: 'margin-left:6px' }, ic('alerta'), 'Passou do prazo') : null), h('td', { text: C.duracao(x.criadoEm) }),
          h('td', { class: 'no-print' }, x.fonte === 'solicitacao' ? h('button', { class: 'btn peq', type: 'button', onclick: () => { u.aberta = x.id; u.gavAnim = null; if (u.ctx.irPara) u.ctx.irPara('solic'); } }, 'Abrir') : x.fonte === 'prioridade' && u.ctx.irPara ? h('button', { class: 'btn peq', type: 'button', onclick: () => u.ctx.irPara('fila') }, 'Ver') : x.fonte === 'aviso' && u.ctx.irPara ? h('button', { class: 'btn peq', type: 'button', onclick: () => u.ctx.irPara('avisos') }, 'Ver') : null)))))) : C.vazio('okCirculo', 'Nada esperando', 'Não há nada aberto agora.'))];
  }

  /* ---------- ponto de entrada (chamado por prioridades.js a cada desenho) ---------- */
  let iniciado = false;
  function iniciar() {
    if (iniciado) return; iniciado = true;
    u.carregando = true; carregar(true);
    root.setInterval(() => { if (!root.document.hidden && u.ctx && u.ctx.sessao() && u.ctx.sessao().pode) { carregar(true); if (u.aba === 'dash') carregarDash(true); } }, 20000);
    root.document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && u.aberta) { u.aberta = null; u.gavAnim = null; redesenhar(); } });
  }
  // ctx: { pedir, redesenhar, sessao(), irPara(aba) }
  function tela(aba, ctx) {
    u.ctx = ctx; u.aba = aba; iniciar();
    if (aba !== 'solic' && aba !== 'dash') return null;
    if (aba === 'dash' && !u.dash && !u.dashCarregando && !u.dashErro) { u.dashCarregando = true; carregarDash(true); }
    return aba === 'solic' ? telaCaixa() : telaDash();
  }
  const gavetaAberta = () => (u.aberta && u.dados ? todas().find((x) => x.id === u.aberta) : null);
  const contagem = () => (u.dados ? u.dados.ativos.filter((l) => l.status === 'recebida').length : 0);
  root.SolicitacoesUI = { tela, gaveta: () => { const l = gavetaAberta(); return l && (u.aba === 'solic' || u.aba === 'dash') ? gaveta(l) : []; }, contagem, abrir: (id) => { u.aberta = id; u.gavAnim = null; } };
})(window);
