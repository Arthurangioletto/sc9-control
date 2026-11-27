/* Central de solicitações · área da vendedora, aba "Solicitar": Transferência (completa, com busca de produto, saldo e lote), Pedido (cancelar, segurar,
 * alterar, nota fiscal), Consulta de estoque, Outro e "Minhas solicitações". Plugado em vendedoras.js por um gancho (SolicitacoesVend.ligar / .tela).
 * JavaScript puro; tudo que vem do servidor entra como textContent. */
(function (root) {
  'use strict';
  const C = root.Central, S = root.SolComum, h = C.h, ic = S.ic;
  const LS_IDS = 'sc9v_solic', LS_NOME = 'sc9v_nome'; // o nome é o mesmo que as outras telas guardam
  const lerLS = (k, padrao) => { try { const v = root.localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch (x) { return padrao; } };
  const gravarLS = (k, v) => { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (x) { /* sem armazenamento: segue sem lembrar */ } };
  const SUBS = [['transf', 'troca', 'Transferência'], ['pedido', 'pacote', 'Pedido'], ['consulta', 'busca', 'Consulta de estoque'], ['outro', 'comentario', 'Outro'], ['minhas', 'lista', 'Minhas solicitações']];
  const TIPOS_PEDIDO = ['cancelar_pedido', 'segurar_pedido', 'alterar_pedido', 'nota_fiscal'];
  const SUB_TIPO = { transf: 'transferencia_peca', consulta: 'consulta_estoque', outro: 'outro' };

  let cfg = null; // { api, conta, redesenhar }, entregue por vendedoras.js
  let seqItem = 0;
  const novoItem = () => ({ k: ++seqItem, produto: null, lote: '', qt: '', busca: '', aberto: false, lista: null, estado: 'idle', erro: '', ativo: -1, seq: 0, timer: 0, ctl: null });
  const novoLocal = () => ({ filial: '', armazem: '' });
  const novaTransf = () => ({ origem: novoLocal(), destino: novoLocal(), itens: [novoItem()], prazo: '', motivo: '', rev: false, erro: '', atualizando: false });
  const e = { arm: { dados: null, erro: '', carregando: false }, pq: {}, pedInfo: {}, sub: 'transf', pedidoTipo: 'cancelar_pedido', nome: lerLS(LS_NOME, ''), t: novaTransf(), f: {}, consulta: novoItem(), enviado: null, enviando: false, erro: '', lista: null, listaErro: '', aberta: null, gavAnim: null, carregando: false };
  const redesenhar = () => { if (cfg) cfg.redesenhar(); };
  const conta = () => (cfg && cfg.conta && cfg.conta()) || null;
  const hoje = () => C.diaSP(new Date().toISOString());
  const prazoTxt = (t) => 'A logística responde em até ' + S.minTxt(t.sla);
  const foco = (id) => root.setTimeout(() => { const x = root.document.getElementById(id); if (x && x.focus) x.focus(); }, 30);
  const apenasDigitos = (ev, max) => { const v = ev.target.value.replace(/\D/g, '').slice(0, max); if (ev.target.value !== v) ev.target.value = v; return v; };
  const formDe = (tipo) => e.f[tipo] || (e.f[tipo] = { pedido: '', dados: {} });
  const pqPrevia = (chave) => { const c = S.corpoParaQuando(pqDe(chave)); return c ? { tipo: c.tipo, data: c.data || '' } : null; };
  const pqDe = (chave) => e.pq[chave] || (e.pq[chave] = { tipo: '', data: '' });

  /* ---------- lista da vendedora ---------- */
  async function carregar(silencioso) {
    if (!cfg) return;
    const c = conta();
    try {
      e.lista = await cfg.api('/api/vendedoras/solicitacoes?ids=' + encodeURIComponent(lerLS(LS_IDS, []).join(',')) + '&nome=' + encodeURIComponent((c && c.nome) || lerLS(LS_NOME, '')));
      e.listaErro = '';
    } catch (x) { e.listaErro = x.message; }
    e.carregando = false;
    if (cfg && cfg.aoCarregar && cfg.aoCarregar()) return redesenhar(); // a aba Minhas/Exportar mostra esta lista
    if (!silencioso || root.document.getElementById('sol-vend-raiz')) redesenhar();
  }
  // Armazéns que ela pode escolher, por filial (lista mantida pela logística). Carrega uma vez; o servidor confere de novo ao enviar.
  async function carregarArmazens() {
    if (!cfg || e.arm.carregando) return;
    e.arm.carregando = true;
    try { const j = await cfg.api('/api/vendedoras/armazens'); e.arm.dados = Array.isArray(j.filiais) ? j.filiais : []; e.arm.erro = ''; }
    catch (x) { e.arm.erro = x.message; }
    e.arm.carregando = false; redesenhar();
  }
  // Armazéns de uma filial para o papel 'origem' ou 'destino' (só o que a logística liberou). Sem lista carregada: reserva 01/02.
  const armazensDe = (filial, papel) => {
    if (!e.arm.dados) return S.ARMAZENS.map((a) => ({ codigo: a, rotulo: 'Armazém ' + a, comSaldo: true, nota: '' }));
    const f = e.arm.dados.find((x) => x.filial === filial);
    return f ? f.armazens.filter((a) => a[papel]) : [];
  };
  const filiaisDe = (papel) => (e.arm.dados ? e.arm.dados.filter((f) => f.armazens.some((a) => a[papel])).map((f) => f.filial) : S.FILIAIS);
  // Consulta o pedido ANTES de enviar: etapa e aviso ("ainda dá tempo" / "já foi separado"). Guardado por número, atualizado a cada consulta.
  async function consultarPedido(numero) {
    const p = S.pedidoValido(numero); if (!p || !cfg) return null;
    const i = e.pedInfo[p] || (e.pedInfo[p] = { estado: 'idle' });
    if (i.estado === 'carregando') return i;
    i.estado = 'carregando'; i.erro = ''; redesenhar();
    try { const r = await cfg.api('/api/vendedoras/pedido?pedido=' + p); i.estado = 'ok'; i.r = r; i.em = Date.now(); }
    catch (x) { i.estado = 'erro'; i.erro = x.message; }
    redesenhar(); return i;
  }
  // Caixa "situação do pedido agora" (etapa + aviso), para quem vai cancelar/segurar/alterar.
  function caixaPedido(numero, tipo) {
    const p = S.pedidoValido(numero); if (!p) return null;
    const i = e.pedInfo[p];
    if (!i || i.estado === 'idle') return h('button', { class: 'btn peq', type: 'button', onclick: () => consultarPedido(p) }, ic('busca'), 'Conferir o pedido agora');
    if (i.estado === 'carregando') return h('p', { class: 'dica', role: 'status', text: 'Consultando o pedido ' + p + '…' });
    if (i.estado === 'erro') return h('div', { class: 'aviso', role: 'status' }, ic('alerta'), h('div', null, 'Não consegui consultar o pedido agora (' + i.erro + '). Você pode enviar assim mesmo.'));
    const r = i.r, etapa = r.etapa || '', tom = !r.achado ? 'info' : etapa === 'nao_separado' ? 'ok' : 'tarde';
    const det = r.detalhes || {};
    return h('div', { class: 'sol-etapa ' + (r.achado ? tom : 'info'), role: 'status' }, ic(!r.achado ? 'info' : tom === 'ok' ? 'okCirculo' : 'alerta'),
      h('div', null, h('b', { text: !r.achado ? 'O pedido ' + p + ' ainda não está no SC9' : (S.ETAPA[etapa] || 'Situação do pedido') + (det.cliente ? ' · ' + det.cliente : '') }),
        r.achado && r.resumo ? h('span', { class: 'sol-etapa-nome', text: r.resumo.texto }) : null,
        h('p', { text: !r.achado ? 'Confira o número. Se estiver certo, você pode enviar: a equipe é avisada para recarregar o SC9.' : (r.avisoEtapa || '') }),
        h('button', { class: 'btn peq fantasma', type: 'button', onclick: () => consultarPedido(p) }, ic('atualizar'), 'Conferir de novo')));
  }
  const ativas = () => (e.lista && e.lista.ativas) || [];
  const recentes = () => (e.lista && e.lista.recentes) || [];

  /* ---------- busca de produto (combobox) ---------- */
  const urlProdutos = (q, o) => '/api/vendedoras/produtos?q=' + encodeURIComponent(q) + (o && o.filial ? '&filial=' + encodeURIComponent(o.filial) + (o.armazem ? '&armazem=' + encodeURIComponent(o.armazem) : '') : '');
  const marcar = (p, o) => Object.assign({}, p, { __origem: o ? { filial: o.filial, armazem: o.armazem } : null });
  const saldoOrigem = (p, o) => (o && o.filial ? S.saldoNoLocal(p, o) : null);
  const qtTxt = (n) => Number(n).toLocaleString('pt-BR');
  function buscar(item, getO) {
    root.clearTimeout(item.timer); if (item.ctl) item.ctl.abort();
    const q = item.busca.trim();
    if (q.length < 2) { item.lista = null; item.estado = 'idle'; return pintar(item, getO); }
    item.estado = 'carregando'; item.erro = ''; pintar(item, getO);
    const meu = ++item.seq;
    item.timer = root.setTimeout(async () => {
      const ctl = new root.AbortController(); item.ctl = ctl;
      try {
        const j = await cfg.api(urlProdutos(q, getO()), { signal: ctl.signal });
        if (meu !== item.seq) return;
        const o = getO(); item.lista = (j.produtos || []).map((p) => marcar(p, o)); item.estado = 'ok';
      } catch (x) {
        if (x && x.name === 'AbortError') return;
        if (meu !== item.seq) return;
        item.estado = 'erro'; item.erro = x.status === 429 ? 'Muitas buscas seguidas. Espere alguns segundos e continue digitando.' : x.message;
      }
      item.ctl = null; item.ativo = -1; pintar(item, getO);
    }, 250);
  }
  function linhaSaldo(p, o) {
    if (!p.saldoDisponivel) return h('span', { class: 'sol-saldo nd' }, 'Saldo indisponível');
    const s = saldoOrigem(p, o), partes = [];
    if (o && o.filial) partes.push(s == null ? h('span', { class: 'sol-saldo nd' }, 'Saldo na origem indisponível') : s > 0 ? h('span', { class: 'sol-saldo ok' }, 'Saldo em ' + (o.armazem ? S.localCurto(o) : S.nomeFilial(o.filial)) + ': ', h('b', { text: qtTxt(s) })) : h('span', { class: 'sol-saldo zero' }, 'Sem saldo em ' + (o.armazem ? S.localCurto(o) : S.nomeFilial(o.filial))));
    if (p.saldoTotal != null) partes.push(h('span', { class: 'sol-saldo tot', title: 'Soma só dos armazéns de venda' }, 'Total em todas as filiais (só armazéns de venda): ', h('b', { text: qtTxt(p.saldoTotal) })));
    if (p.saldoSeparadoTotal > 0) partes.push(h('span', { class: 'sol-saldo sep', title: 'Não entra no total: não é estoque de venda' }, 'Saldo separado (não é de venda): ', h('b', { text: qtTxt(p.saldoSeparadoTotal) }), ' · ' + (p.saldoSeparado || []).map((x) => S.nomeFilial(x.filial) + ' ' + x.armazem + ': ' + qtTxt(x.saldo)).join(', ')));
    return partes;
  }
  function filhosSug(item, getO) {
    const msg = (t, cls) => h('li', { class: 'sol-sug-msg ' + (cls || ''), role: 'presentation', text: t });
    if (item.busca.trim().length < 2) return [msg('Digite pelo menos 2 letras ou números do código ou do nome.')];
    if (item.estado === 'carregando') return [msg('Buscando produtos…', 'carregando')];
    if (item.estado === 'erro') return [msg(item.erro, 'erro')];
    if (!item.lista) return [];
    if (!item.lista.length) return [msg('Nenhum produto encontrado para "' + item.busca.trim() + '". Tente outro trecho do nome ou o código.')];
    const o = getO();
    return item.lista.map((p, i) => h('li', { id: 'opt-' + item.k + '-' + i, class: 'sol-sug-item' + (i === item.ativo ? ' ativo' : ''), role: 'option', 'aria-selected': String(i === item.ativo), onclick: () => item.escolher(p) },
      h('b', { class: 'num sol-sug-cod', text: p.codigo }), h('span', { class: 'sol-sug-desc', text: p.descricao || 'Sem descrição' }), h('span', { class: 'sol-sug-saldos' }, linhaSaldo(p, o))));
  }
  function pintar(item, getO) {
    const ul = root.document.getElementById('sug-' + item.k), inp = root.document.getElementById('sv-busca-' + item.k);
    if (!ul || !inp) return;
    ul.replaceChildren(...filhosSug(item, getO)); ul.hidden = !item.aberto;
    inp.setAttribute('aria-expanded', String(item.aberto));
    if (item.aberto && item.ativo >= 0) { inp.setAttribute('aria-activedescendant', 'opt-' + item.k + '-' + item.ativo); const li = root.document.getElementById('opt-' + item.k + '-' + item.ativo); if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }); } else inp.removeAttribute('aria-activedescendant');
  }
  // op: { getO, rotulo, placeholder, desabilitado, dica, escolher(p), digitou(texto) }
  function combo(item, op) {
    item.escolher = (p) => { item.aberto = false; item.lista = null; item.estado = 'idle'; op.escolher(p); };
    const tecla = (ev) => {
      const n = item.lista ? item.lista.length : 0;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); item.aberto = true; item.ativo = n ? Math.min(n - 1, item.ativo + 1) : -1; pintar(item, op.getO); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); item.ativo = n ? Math.max(0, item.ativo - 1) : -1; pintar(item, op.getO); }
      else if (ev.key === 'Enter' && item.aberto && n && item.ativo >= 0) { ev.preventDefault(); item.escolher(item.lista[item.ativo]); }
      else if (ev.key === 'Escape' && item.aberto) { ev.preventDefault(); ev.stopPropagation(); item.aberto = false; pintar(item, op.getO); }
    };
    const inp = h('input', { id: 'sv-busca-' + item.k, class: 'entrada', type: 'text', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': String(item.aberto), 'aria-controls': 'sug-' + item.k, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '80', placeholder: op.placeholder, value: item.busca, disabled: op.desabilitado,
      oninput: (ev) => { item.busca = ev.target.value; item.aberto = true; item.ativo = -1; if (op.digitou) op.digitou(item.busca); buscar(item, op.getO); },
      onfocus: () => { if (item.busca.trim().length >= 2 || item.lista) { item.aberto = true; pintar(item, op.getO); } },
      onblur: () => root.setTimeout(() => { item.aberto = false; pintar(item, op.getO); }, 120), onkeydown: tecla });
    const ul = h('ul', { id: 'sug-' + item.k, class: 'sol-sug', role: 'listbox', 'aria-label': 'Produtos encontrados', hidden: !item.aberto, onmousedown: (ev) => ev.preventDefault() }, filhosSug(item, op.getO));
    return h('div', { class: 'sol-campo' }, op.rotulo ? h('label', { class: 'rotulo', for: 'sv-busca-' + item.k, text: op.rotulo }) : null, h('div', { class: 'sol-combo' }, h('span', { class: 'sol-combo-ic' }, ic('busca')), inp, ul), op.dica ? h('p', { class: 'dica', text: op.dica }) : null);
  }

  /* ---------- transferência ---------- */
  const origemOk = (t) => t.origem.filial && t.origem.armazem;
  const getOrigemT = () => (origemOk(e.t) ? { filial: e.t.origem.filial, armazem: e.t.origem.armazem } : e.t.origem.filial ? { filial: e.t.origem.filial, armazem: '' } : null);
  let timerRef = 0;
  function agendarRefresh() { root.clearTimeout(timerRef); timerRef = root.setTimeout(refrescarItens, 500); }
  async function refrescarItens() {
    const t = e.t, o = getOrigemT(), com = t.itens.filter((i) => i.produto);
    if (!o || !o.armazem || !com.length) return;
    t.atualizando = true; redesenhar();
    for (const it of com) {
      try {
        const j = await cfg.api(urlProdutos(it.produto.codigo, o)), p = (j.produtos || []).find((x) => x.codigo === it.produto.codigo);
        if (p) { it.produto = marcar(p, o); if (it.lote && !S.lotesNoLocal(it.produto, o).some((l) => l.lote === it.lote)) it.lote = ''; }
      } catch (x) { /* fica com o que já tinha: o saldo por filial continua na lista */ }
    }
    t.atualizando = false; redesenhar();
  }
  // Filial + armazém por lista (sem campo livre): o armazém só aparece se a logística liberou para este papel (origem ou destino).
  function localCampo(rot, id, loc, aoMudar, papel) {
    const filiais = filiaisDe(papel), arms = loc.filial ? armazensDe(loc.filial, papel) : [];
    const escolheFilial = (ev) => { loc.filial = ev.target.value; const l = armazensDe(loc.filial, papel); loc.armazem = l.some((a) => a.codigo === '01') ? '01' : l.length === 1 ? l[0].codigo : ''; aoMudar(); };
    const atual = arms.find((a) => a.codigo === loc.armazem);
    return h('fieldset', { class: 'sol-local' }, h('legend', { text: rot }),
      h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: id + '-f', text: 'Filial' }),
        h('select', { id: id + '-f', class: 'entrada', onchange: escolheFilial }, h('option', { value: '', text: 'Escolha a filial', selected: !loc.filial }), filiais.map((k) => h('option', { value: k, text: S.FILIAIS_ROTULO[k] || k, selected: loc.filial === k })))),
      h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: id + '-a', text: 'Armazém' }),
        h('select', { id: id + '-a', class: 'entrada', disabled: !loc.filial || !arms.length, onchange: (ev) => { loc.armazem = ev.target.value; aoMudar(); } },
          h('option', { value: '', text: !loc.filial ? 'Escolha a filial primeiro' : arms.length ? 'Escolha o armazém' : 'Nenhum armazém liberado', selected: !loc.armazem }),
          arms.map((a) => h('option', { value: a.codigo, text: a.rotulo + (papel === 'origem' && a.comSaldo === false ? ' (sem saldo no momento)' : ''), selected: loc.armazem === a.codigo })))),
      loc.filial && !arms.length ? h('p', { class: 'dica', text: 'A logística não liberou nenhum armazém desta filial para ' + (papel === 'origem' ? 'sair' : 'receber') + ' transferência.' }) : null,
      atual && atual.nota ? h('p', { class: 'dica', text: atual.nota }) : null,
      e.arm.erro && !e.arm.dados ? h('p', { class: 'dica', role: 'status' }, 'Não consegui carregar a lista de armazéns (' + e.arm.erro + '). Mostrando só 01 e 02; o servidor confere ao enviar. ', h('button', { class: 'btn peq fantasma', type: 'button', onclick: carregarArmazens }, 'Tentar de novo')) : null);
  }
  const itemParaComum = (i) => ({ produto: i.produto, lote: i.lote, qt: i.qt });
  function textoAviso(i, o) {
    const sd = S.saldoDoItem(itemParaComum(i), o), q = Number(i.qt);
    if (sd == null || !Number.isFinite(q) || q <= sd) return null;
    return 'Você pediu ' + qtTxt(q) + ', mas o saldo ' + (i.lote ? 'do lote ' + i.lote : 'na origem') + ' é ' + qtTxt(sd) + '. Dá para enviar mesmo assim: a logística vai avaliar.';
  }
  function pintarAviso(i) {
    const cx = root.document.getElementById('aviso-' + i.k); if (!cx) return;
    const t = textoAviso(i, getOrigemT());
    cx.replaceChildren(...(t ? [ic('alerta'), h('span', { text: t })] : [])); cx.hidden = !t;
  }
  function cartaoItem(i, n, t) {
    const o = getOrigemT(), semOrigem = !t.origem.filial;
    const remover = t.itens.length > 1 ? h('button', { class: 'btn peq fantasma perigo', type: 'button', 'aria-label': 'Remover o produto ' + n, onclick: () => { t.itens = t.itens.filter((x) => x !== i); redesenhar(); } }, ic('fechar'), 'Remover') : null;
    const cab = h('div', { class: 'sol-item-cab' }, h('b', { text: 'Produto ' + n }), remover);
    if (!i.produto) return h('div', { class: 'sol-item', role: 'group', 'aria-label': 'Produto ' + n }, cab,
      combo(i, { getO: getOrigemT, rotulo: 'Código ou nome do produto', placeholder: semOrigem ? 'Escolha a origem acima primeiro' : 'Ex.: 030012 ou resina A2', desabilitado: semOrigem, dica: semOrigem ? 'A busca mostra o saldo na origem, por isso a origem vem primeiro.' : 'Digite e escolha na lista. Aparece o saldo na origem e o total.',
        escolher: (p) => { i.produto = marcar(p, getOrigemT()); i.busca = ''; i.lote = ''; redesenhar(); foco('sv-qt-' + i.k); } }));
    const p = i.produto, lotes = S.lotesNoLocal(p, o), sd = S.saldoDoItem(itemParaComum(i), o);
    const dupl = t.itens.some((x) => x !== i && x.produto && x.produto.codigo === p.codigo && x.lote === i.lote);
    return h('div', { class: 'sol-item escolhido', role: 'group', 'aria-label': 'Produto ' + n + ': ' + p.codigo }, cab,
      h('div', { class: 'sol-prod' }, h('div', { class: 'sol-prod-txt' }, h('b', { class: 'num sol-prod-cod', text: p.codigo }), h('p', { class: 'sol-prod-desc', text: p.descricao || 'Sem descrição no catálogo' })),
        h('button', { class: 'btn peq fantasma', type: 'button', onclick: () => { i.produto = null; i.lote = ''; i.busca = ''; redesenhar(); foco('sv-busca-' + i.k); } }, ic('busca'), 'Trocar produto')),
      h('div', { class: 'sol-saldos' }, linhaSaldo(p, o)),
      h('div', { class: 'sol-item-campos' },
        h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: 'sv-lote-' + i.k, text: 'Lote' }),
          h('select', { id: 'sv-lote-' + i.k, class: 'entrada', disabled: !lotes.length, onchange: (ev) => { i.lote = ev.target.value; redesenhar(); } },
            h('option', { value: '', text: lotes.length ? 'Qualquer lote' + (sd != null && !i.lote ? ' (saldo ' + qtTxt(sd) + ')' : '') : 'Sem lote informado', selected: !i.lote }),
            lotes.map((l) => h('option', { value: l.lote, text: l.lote + ' · saldo ' + qtTxt(l.saldo) + (l.validade ? ' · vence ' + S.validadeCurta(l.validade) : ''), selected: i.lote === l.lote })))),
        h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: 'sv-qt-' + i.k, text: 'Quantidade' }), h('input', { id: 'sv-qt-' + i.k, class: 'entrada num', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '5', placeholder: 'Ex.: 10', value: i.qt, oninput: (ev) => { i.qt = apenasDigitos(ev, 5); pintarAviso(i); } }))),
      !lotes.length && p.saldoDisponivel ? h('p', { class: 'dica', text: 'Não há lote com saldo nesta origem. A logística escolhe o lote.' }) : null,
      dupl ? h('p', { class: 'sol-alerta-linha' }, ic('alerta'), 'Este produto (e lote) já está em outra linha. Junte as quantidades.') : null,
      h('div', { id: 'aviso-' + i.k, class: 'sol-aviso-saldo', role: 'status', hidden: !textoAviso(i, o) }, ...(textoAviso(i, o) ? [ic('alerta'), h('span', { text: textoAviso(i, o) })] : [])));
  }
  function dadosPrevia(t) {
    const o = getOrigemT();
    return { itens: t.itens.map((i) => ({ produto: i.produto.codigo, descricao: i.produto.descricao, lote: i.lote, qt: Number(i.qt), saldoOrigem: S.saldoDoItem(itemParaComum(i), o), acimaDoSaldo: S.acimaDoSaldo(itemParaComum(i), o) })), origem: t.origem, destino: t.destino, tipoTransferencia: S.tipoDaTransf(t.origem, t.destino) };
  }
  function revisarTransf() {
    const t = e.t, c = conta();
    t.erro = S.validarTransf(t, hoje()) || (!c && e.nome.trim().length < 2 ? 'Diga seu nome para a logística saber quem pediu.' : '');
    t.rev = !t.erro; redesenhar(); root.scrollTo(0, 0);
  }
  function telaTransf() {
    const t = e.t, c = conta(), tipo = S.TIPOS.transferencia_peca;
    const aoMudarOrigem = () => { redesenhar(); agendarRefresh(); };
    const passo = (n, titulo, ...filhos) => h('section', { class: 'card sol-passo' }, h('div', { class: 'card-titulo' }, h('h2', null, h('span', { class: 'sol-n', text: String(n) }), titulo)), ...filhos);
    if (t.rev) {
      const d = dadosPrevia(t), acima = d.itens.some((i) => i.acimaDoSaldo);
      return h('section', { class: 'card sol-passo' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Confira antes de enviar' })),
        h('p', { class: 'sol-frase', text: S.textoRevisao(t) }), S.rotaTransf(d), S.tabelaItens(d, { saldo: true }),
        acima ? h('div', { class: 'aviso', role: 'note' }, ic('alerta'), h('div', null, h('b', { text: 'Algum produto passa do saldo. ' }), 'Você pode enviar assim mesmo: a logística confere e responde.')) : null,
        h('div', { class: 'resumo-lista' }, [['Para quando', S.paraQuandoTxt(pqPrevia('transferencia_peca')) || 'Não informado'], ['Prazo', t.prazo ? S.dataCurtaISO(t.prazo) : 'Sem prazo'], ['Motivo', t.motivo.trim() || '—'], ['Pedido feito por', c ? c.nome : e.nome.trim()]].map(([a, v]) => h('div', null, h('span', { text: a }), h('b', { text: v })))),
        e.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), e.erro) : null,
        h('div', { class: 'acoes' }, h('button', { class: 'btn primario sol-enviar', type: 'button', disabled: e.enviando, onclick: () => enviar('transferencia_peca') }, ic('enviar'), e.enviando ? 'Enviando…' : 'Confirmar e enviar'), h('button', { class: 'btn', type: 'button', disabled: e.enviando, onclick: () => { t.rev = false; e.erro = ''; redesenhar(); } }, ic('voltar'), 'Voltar e corrigir')),
        h('p', { class: 'sol-tipo-prazo' }, ic('relogio'), prazoTxt(tipo)));
    }
    const mesmo = origemOk(t) && S.mesmoLocal(t.origem, t.destino);
    return [
      passo(1, 'De onde para onde?', h('div', { class: 'sol-locais' }, localCampo('Sai de (origem)', 'sv-o', t.origem, aoMudarOrigem, 'origem'), h('span', { class: 'sol-locais-seta', 'aria-hidden': 'true' }, ic('seta')), localCampo('Vai para (destino)', 'sv-d', t.destino, () => redesenhar(), 'destino')),
        mesmo ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), 'A origem e o destino precisam ser diferentes.') : origemOk(t) && t.destino.filial && t.destino.armazem ? S.rotaTransf({ origem: t.origem, destino: t.destino }) : null),
      passo(2, 'Quais produtos?', h('div', { class: 'sol-itens' }, t.itens.map((i, n) => cartaoItem(i, n + 1, t))),
        t.atualizando ? h('p', { class: 'dica', role: 'status', text: 'Atualizando os saldos da nova origem…' }) : null,
        t.itens.length < 30 ? h('button', { class: 'btn', type: 'button', onclick: () => { const novo = novoItem(); t.itens.push(novo); redesenhar(); foco('sv-busca-' + novo.k); } }, ic('lista'), 'Adicionar outro produto') : h('p', { class: 'dica', text: 'Limite de 30 produtos por pedido.' })),
      passo(3, 'Prazo e motivo', S.campoParaQuando(pqDe('transferencia_peca'), redesenhar, 'sv-pq-transf', hoje(), { semData: true }), h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: 'sv-prazo', text: 'Precisa chegar até quando? (opcional)' }), h('input', { id: 'sv-prazo', class: 'entrada', type: 'date', min: hoje(), value: t.prazo, onchange: (ev) => { t.prazo = ev.target.value; } })),
        h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: 'sv-motivo', text: 'Motivo (opcional)' }), h('textarea', { id: 'sv-motivo', class: 'entrada', maxlength: '300', rows: '3', placeholder: 'Ex.: reposição para a campanha do fim do mês.', oninput: (ev) => { t.motivo = ev.target.value; } }, t.motivo)),
        c ? h('div', { class: 'sol-quem' }, ic('usuarioCheck'), h('span', null, 'Pedido feito por ', h('b', { text: c.nome }))) : campoNome(),
        t.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), t.erro) : null,
        h('button', { class: 'btn primario sol-enviar', type: 'button', onclick: revisarTransf }, 'Revisar pedido', ic('seta')),
        h('p', { class: 'sol-tipo-prazo' }, ic('relogio'), prazoTxt(tipo)))];
  }
  const campoNome = () => h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: 'sv-nome', text: 'Seu nome' }), h('input', { id: 'sv-nome', class: 'entrada', type: 'text', autocomplete: 'name', maxlength: '60', placeholder: 'Ex.: Ana (Vendas)', value: e.nome, oninput: (ev) => { e.nome = ev.target.value; } }));

  /* ---------- formulários simples (pedido, consulta, outro) ---------- */
  function validar(tipo) {
    const t = S.TIPOS[tipo], f = formDe(tipo), d = f.dados, p = S.soDigitos(f.pedido);
    if (t.pedido && !p) return 'Digite o número do pedido (só números).';
    if (p && !S.pedidoValido(p)) return 'O número do pedido tem de 4 a 10 números.';
    for (const c of t.campos) {
      const v = String(d[c.id] == null ? '' : d[c.id]).trim();
      if (!v) { if (c.obrig) return 'Preencha: ' + c.rotulo.replace(/\?$/, '') + '.'; continue; }
      if (c.tipo === 'numero') { const n = Number(v); if (!Number.isInteger(n) || n < c.min || n > c.max) return 'Em "' + c.rotulo + '", digite um número inteiro de ' + c.min + ' a ' + c.max + '.'; }
      if (c.tipo === 'data' && v < hoje()) return 'A data de "' + c.rotulo.replace(/ \(opcional\)/, '') + '" não pode ser no passado.';
      if (c.tipo === 'texto' || c.tipo === 'area') { if (v.length < 3) return 'Escreva um pouco mais em "' + c.rotulo.replace(/\?$/, '') + '".'; if (c.max && v.length > c.max) return '"' + c.rotulo + '" aceita até ' + c.max + ' letras.'; }
    }
    const pe = S.erroParaQuando(pqDe(tipo), hoje()); if (pe) return pe;
    if (!conta() && e.nome.trim().length < 2) return 'Diga seu nome para a logística saber quem pediu.';
    return '';
  }
  async function enviar(tipo, confirmado) {
    const t = S.TIPOS[tipo], c = conta();
    if (tipo === 'transferencia_peca') { const er = S.validarTransf(e.t, hoje()); if (er) { e.t.rev = false; e.t.erro = er; return redesenhar(); } }
    else { e.erro = validar(tipo); if (e.erro) return redesenhar(); }
    if (tipo === 'transferencia_peca') { const pe = S.erroParaQuando(pqDe(tipo), hoje()); if (pe) { e.t.rev = false; e.t.erro = pe; return redesenhar(); } }
    // Cancelar, segurar, alterar e nota: confere o pedido ANTES de enviar. Se já andou, mostra o aviso e pede um segundo toque para enviar mesmo assim.
    const pedidoNum = t.pedido ? S.pedidoValido(formDe(tipo).pedido) : '';
    if (pedidoNum) {
      const i = e.pedInfo[pedidoNum], velho = !i || i.estado !== 'ok' || Date.now() - i.em > 120000;
      e.enviando = true; e.erro = ''; redesenhar();
      const ni = velho ? await consultarPedido(pedidoNum) : i;
      e.enviando = false;
      const r = ni && ni.estado === 'ok' ? ni.r : null, tarde = r && r.achado && r.etapa && r.etapa !== 'nao_separado' && ['cancelar_pedido', 'segurar_pedido'].includes(tipo);
      if (tarde && e.confirmouTarde !== pedidoNum + '|' + tipo) { e.confirmouTarde = pedidoNum + '|' + tipo; e.erro = ''; redesenhar(); return root.setTimeout(() => { const b = root.document.getElementById('sv-enviar'); if (b) b.focus(); }, 30); }
    }
    const corpo = { tipo, pedidoPor: c ? c.nome : e.nome.trim() };
    const pqc = S.corpoParaQuando(pqDe(tipo)); if (pqc) corpo.paraQuando = pqc;
    if (tipo === 'transferencia_peca') corpo.dados = S.corpoTransf(e.t);
    else {
      const f = formDe(tipo), dados = {};
      for (const campo of t.campos) { const v = String(f.dados[campo.id] == null ? '' : f.dados[campo.id]).trim(); if (v) dados[campo.id] = campo.tipo === 'numero' ? Number(v) : v; }
      corpo.dados = dados; const p = S.soDigitos(f.pedido); if (p) corpo.pedido = p;
      if (tipo === 'outro' && dados.texto) corpo.texto = dados.texto;
    }
    e.enviando = true; e.erro = ''; redesenhar();
    try {
      const j = await cfg.api('/api/vendedoras/solicitacao', { method: 'POST', body: JSON.stringify(corpo) });
      if (!c) gravarLS(LS_NOME, e.nome.trim());
      gravarLS(LS_IDS, [j.linha.id].concat(lerLS(LS_IDS, []).filter((x) => x !== j.linha.id)).slice(0, 80));
      e.enviado = Object.assign({}, j.linha, { etapa: j.linha.etapa || j.etapa || '', aviso: j.linha.aviso || j.aviso || '' });
      if (tipo === 'transferencia_peca') e.t = novaTransf(); else delete e.f[tipo];
      delete e.pq[tipo]; e.confirmouTarde = '';
      if (tipo === 'consulta_estoque') e.consulta = novoItem();
      C.toast('Solicitação enviada para a logística.'); carregar(true);
    } catch (x) { e.erro = x.message; if (tipo === 'transferencia_peca') e.t.rev = false; }
    e.enviando = false; redesenhar(); root.scrollTo(0, 0);
  }
  const orbe = (t, extra) => h('span', { class: 'sol-orbe tom-' + t.tom + (extra ? ' ' + extra : '') }, ic(t.icone));
  function campo(tipo, c) {
    const d = formDe(tipo).dados, id = 'sv-' + c.id, v = d[c.id] == null ? '' : d[c.id];
    let ent;
    if (c.tipo === 'peca') {
      const item = e.consulta, o = () => (d.filial ? { filial: d.filial, armazem: '' } : null);
      if (!item.busca && v && !item.produto) item.busca = v;
      return h('div', null, combo(item, { getO: o, rotulo: c.rotulo, placeholder: 'Ex.: 030012 ou resina A2', dica: c.dica, digitou: (tx) => { d[c.id] = tx; item.produto = null; }, escolher: (p) => { item.produto = marcar(p, o()); item.busca = (p.codigo + ' · ' + (p.descricao || '')).slice(0, 80); d[c.id] = item.busca; redesenhar(); foco('sv-qt'); } }),
        item.produto ? h('div', { class: 'sol-saldos', style: 'margin-top:8px' }, linhaSaldo(item.produto, o())) : null);
    }
    if (c.tipo === 'area') ent = h('textarea', { id, class: 'entrada', maxlength: String(c.max || 300), rows: '3', oninput: (ev) => { d[c.id] = ev.target.value; } }, v);
    else if (c.tipo === 'enum') ent = h('select', { id, class: 'entrada', onchange: (ev) => { d[c.id] = ev.target.value; redesenhar(); } }, h('option', { value: '', text: c.obrig ? 'Escolha' : 'Nenhum', selected: !v }), (c.opcoes || []).map(([ov, ot]) => h('option', { value: ov, text: ot, selected: v === ov })));
    else if (c.tipo === 'hora') ent = h('input', { id, class: 'entrada', type: 'time', value: v, onchange: (ev) => { d[c.id] = ev.target.value; } });
    else if (c.tipo === 'filial') ent = h('select', { id, class: 'entrada', onchange: (ev) => { d[c.id] = ev.target.value; redesenhar(); } }, h('option', { value: '', text: 'Não sei / qualquer uma', selected: !v }), S.FILIAIS.map((fl) => h('option', { value: fl, text: S.FILIAIS_ROTULO[fl], selected: v === fl })));
    else if (c.tipo === 'data') ent = h('input', { id, class: 'entrada', type: 'date', min: hoje(), value: v, onchange: (ev) => { d[c.id] = ev.target.value; } });
    else if (c.tipo === 'numero') ent = h('input', { id: c.id === 'qt' ? 'sv-qt' : id, class: 'entrada num', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '5', placeholder: 'Ex.: 10', value: v, oninput: (ev) => { d[c.id] = apenasDigitos(ev, 5); } });
    else ent = h('input', { id, class: 'entrada', type: 'text', maxlength: String(c.max || 80), autocomplete: 'off', value: v, oninput: (ev) => { d[c.id] = ev.target.value; } });
    return h('div', { class: 'sol-campo sol-campo-' + c.tipo }, h('label', { class: 'rotulo', for: c.tipo === 'numero' && c.id === 'qt' ? 'sv-qt' : id, text: c.rotulo }), ent, c.dica ? h('p', { class: 'dica', text: c.dica }) : null);
  }
  function telaSimples(tipo) {
    const t = S.TIPOS[tipo], f = formDe(tipo), c = conta();
    const escolhaPedido = tipo !== 'outro' && tipo !== 'consulta_estoque' ? h('div', { class: 'sol-escolha', role: 'radiogroup', 'aria-label': 'O que fazer com o pedido' }, TIPOS_PEDIDO.map((k) => { const x = S.TIPOS[k]; return h('button', { class: 'sol-op tom-' + x.tom, type: 'button', role: 'radio', 'aria-checked': String(k === tipo), onclick: () => { e.pedidoTipo = k; e.erro = ''; redesenhar(); } }, orbe(x), h('span', null, h('b', { text: x.rotulo }), h('small', { text: 'resposta em até ' + S.minTxt(x.sla) }))); })) : null;
    return h('section', { class: 'card sol-form-card' }, escolhaPedido,
      h('div', { class: 'sol-form-cab' }, orbe(t, 'grande'), h('div', null, h('h2', { text: t.completo }), h('p', { class: 'mudo', text: t.frase }), h('p', { class: 'sol-tipo-prazo', style: 'margin-top:6px' }, ic('relogio'), prazoTxt(t)))),
      h('form', { class: 'form', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); enviar(tipo); } },
        h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: 'sv-pedido', text: t.pedido ? 'Número do pedido' : 'Número do pedido (se tiver)' }), h('input', { id: 'sv-pedido', class: 'entrada num', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '14', placeholder: 'Ex.: 123456', value: f.pedido, oninput: (ev) => { f.pedido = ev.target.value; e.confirmouTarde = ''; }, onchange: () => { if (t.pedido && S.pedidoValido(f.pedido)) consultarPedido(f.pedido); } })),
        t.pedido ? caixaPedido(f.pedido, tipo) : null,
        t.campos.map((x) => campo(tipo, x)),
        tipo === 'consulta_estoque' || tipo === 'cancelar_pedido' ? null : S.campoParaQuando(pqDe(tipo), redesenhar, 'sv-pq-' + tipo, hoje()),
        c ? h('div', { class: 'sol-quem' }, ic('usuarioCheck'), h('span', null, 'Pedido feito por ', h('b', { text: c.nome }))) : campoNome(),
        e.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), e.erro) : null,
        e.confirmouTarde === S.pedidoValido(f.pedido) + '|' + tipo ? h('div', { class: 'aviso', role: 'alert' }, ic('alerta'), h('div', null, h('b', { text: 'O pedido já andou. ' }), 'Veja a situação acima: pode não dar tempo de parar. Toque em "Enviar mesmo assim" para a logística tentar.')) : null,
        h('button', { class: 'btn primario sol-enviar', id: 'sv-enviar', type: 'submit', disabled: e.enviando }, ic('enviar'), e.enviando ? 'Enviando…' : e.confirmouTarde === S.pedidoValido(f.pedido) + '|' + tipo ? 'Enviar mesmo assim' : 'Enviar para a logística')));
  }

  /* ---------- protocolo ---------- */
  function telaEnviado() {
    const l = e.enviado, t = S.tipoDe(l), pedidoDoTipo = l.tipo === 'cancelar_pedido' || l.tipo === 'segurar_pedido', tom = S.etapaTom(l), d = l.dados || {};
    return h('section', { class: 'card' }, h('div', { class: 'protocolo-ok' }, h('div', { class: 'selo-ok' }, ic('ok')), h('h2', { text: 'Solicitação enviada' }), h('p', { class: 'mudo', text: 'Guarde o protocolo:' }),
      h('div', { class: 'codigo', text: l.protocolo || '' }),
      pedidoDoTipo && (l.etapa || l.aviso) ? h('div', { class: 'sol-etapa ' + tom, role: 'status' }, ic(tom === 'ok' ? 'okCirculo' : tom === 'info' ? 'info' : 'alerta'),
        h('div', null, h('b', { text: tom === 'ok' ? 'Ainda dá tempo' : tom === 'info' ? 'Pedido não encontrado no SC9' : 'A logística vai avaliar' }), l.etapa ? h('span', { class: 'sol-etapa-nome', text: 'Situação do pedido agora: ' + (S.ETAPA[l.etapa] || l.etapa) }) : null, l.aviso ? h('p', { text: l.aviso }) : null)) : null,
      l.tipo === 'transferencia_peca' && d.itens ? h('div', { class: 'sol-enviado-transf' }, S.rotaTransf(d), S.tabelaItens(d, { saldo: true }), d.acimaDoSaldo ? h('div', { class: 'aviso' }, ic('alerta'), h('div', null, h('b', { text: 'Algum produto passa do saldo. ' }), 'A logística vai conferir e avisar se não der para atender tudo.')) : null) : null,
      h('div', { class: 'resumo-lista' }, [['Assunto', t.rotulo], l.pedido ? ['Pedido', l.pedido] : null, l.paraQuando ? ['Para quando', S.paraQuandoTxt(l.paraQuando)] : null, ['Enviada em', C.dataHora(l.criadoEm)], ['Status', S.STATUS[l.status] || l.status]].filter(Boolean).map(([a, v]) => h('div', null, h('span', { text: a }), h('b', { text: v })))),
      h('div', { class: 'processo compacta forte', role: 'status' }, ic('relogio'), h('p', null, h('b', { text: 'Agora é só aguardar. ' }), prazoTxt(t) + '. A resposta aparece em "Minhas solicitações".')),
      l.foraDoSc9 ? h('div', { class: 'aviso', style: 'width:100%' }, ic('atualizar'), h('div', null, h('b', { text: 'Este pedido ainda não está no SC9. ' }), 'A equipe também foi avisada. Se o número estava errado, fale com a logística.')) : null,
      h('div', { class: 'acoes', style: 'justify-content:center' }, h('button', { class: 'btn primario', type: 'button', onclick: () => { e.sub = 'minhas'; e.enviado = null; redesenhar(); root.scrollTo(0, 0); } }, ic('lista'), 'Ver minhas solicitações'), h('button', { class: 'btn', type: 'button', onclick: () => { e.enviado = null; redesenhar(); } }, 'Fazer outra solicitação'))));
  }

  /* ---------- minhas solicitações ---------- */
  function cartaoMinha(l) {
    const t = S.tipoDe(l), ativa = S.ATIVOS.includes(l.status), r = S.resumo(l);
    return h('button', { class: 'cartao-lista sol-minha st-' + l.status, type: 'button', onclick: () => { e.aberta = l.id; redesenhar(); } },
      h('div', { class: 'l1' }, orbe(t, 'pequena'), h('b', { text: t.rotulo }), l.pedido ? h('span', { class: 'num mudo', text: 'Pedido ' + l.pedido + (l.pedidos && l.pedidos.length > 1 ? ' +' + (l.pedidos.length - 1) : '') }) : null, C.selo(S.STATUS[l.status] || l.status, l.status), h('span', { class: 'mudo peq', style: 'margin-left:auto', text: l.protocolo || '' })),
      r ? h('p', { class: 'sol-resumo', text: r }) : null,
      h('div', { class: 'l2' }, S.progressoLote(l) ? h('span', { class: 'forte', text: S.progressoLote(l) }) : null, l.paraQuando ? h('span', { text: 'Para quando: ' + S.paraQuandoTxt(l.paraQuando) }) : null, h('span', { text: 'Enviada em ' + C.dataHora(l.criadoEm) }),
        l.resposta ? h('span', { class: 'sol-resposta-previa', text: 'Logística: ' + l.resposta }) : null,
        ativa && !l.resposta ? h('span', { class: 'aguarde', text: l.status === 'recebida' ? 'Aguarde: a logística ainda vai ver.' : l.status === 'aguardando_aprovacao' ? 'Aguardando a aprovação da equipe.' : 'Em andamento: a logística está cuidando.' }) : null,
        l.foraDoSc9 ? h('span', { class: 'aguarde', text: 'Pedido ainda fora do SC9: a equipe foi avisada.' }) : null));
  }
  function gaveta(l) {
    const t = S.tipoDe(l), fecha = () => { e.aberta = null; e.gavAnim = null; redesenhar(); };
    const abre = e.gavAnim !== l.id ? ' abre' : ''; e.gavAnim = l.id;
    const pedidoDoTipo = l.tipo === 'cancelar_pedido' || l.tipo === 'segurar_pedido', tom = S.etapaTom(l), dados = S.dadosLegiveis(l), d = l.dados || {};
    return [h('div', { class: 'gaveta-fundo' + abre, onclick: fecha }),
      h('aside', { class: 'gaveta' + abre, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Solicitação ' + (l.protocolo || t.rotulo) },
        h('div', { class: 'gaveta-cab' }, h('div', null, h('p', { class: 'mudo peq', text: l.protocolo || 'Solicitação' }), h('h3', { text: t.rotulo }), h('div', { class: 'sol-selos' }, l.pedido ? C.selo('Pedido ' + l.pedido, 'normal', true) : null, C.selo(S.STATUS[l.status] || l.status, l.status))), h('button', { class: 'btn peq fantasma', type: 'button', 'aria-label': 'Fechar', onclick: fecha }, ic('fechar'))),
        h('div', { class: 'gaveta-corpo' },
          pedidoDoTipo && (l.etapa || l.aviso) ? h('div', { class: 'sol-etapa ' + tom }, ic(tom === 'ok' ? 'okCirculo' : tom === 'info' ? 'info' : 'alerta'), h('div', null, l.etapa ? h('b', { text: 'Pedido: ' + (S.ETAPA[l.etapa] || l.etapa) }) : null, l.aviso ? h('p', { text: l.aviso }) : null)) : null,
          l.foraDoSc9 ? h('div', { class: 'aviso' }, ic('atualizar'), h('div', null, h('b', { text: 'Este pedido ainda não está no SC9. ' }), 'A equipe foi avisada para recarregar.')) : null,
          l.tipo === 'transferencia_peca' && d.itens ? [S.rotaTransf(d), S.tabelaItens(d, { saldo: true }), d.prazo || d.motivo ? h('div', { class: 'resumo-lista', style: 'margin-top:0' }, [d.prazo ? ['Prazo', S.dataCurtaISO(d.prazo)] : null, d.motivo ? ['Motivo', d.motivo] : null].filter(Boolean).map(([a, v]) => h('div', null, h('span', { text: a }), h('b', { text: v })))) : null] : null,
          l.pedidos && l.pedidos.length > 1 ? h('div', null, h('p', { class: 'bloco-titulo', text: 'Pedidos desta solicitação (' + S.progressoLote(l) + ')' }), h('ul', { class: 'sol-lote-lista' }, l.pedidos.map((x) => h('li', { class: x.concluido ? 'feito' : '' }, h('b', { class: 'num', text: x.pedido }), h('span', { class: 'mudo', text: x.concluido ? 'Atendido' : x.naoAchado ? 'Ainda fora do SC9' : x.etapa ? S.ETAPA[x.etapa] || '' : 'Em andamento' }))))) : null,
          l.tipo === 'falta_item' && d.itens ? S.tabelaItens(d, { semLote: true }) : null,
          dados.length || l.paraQuando ? h('div', { class: 'resumo-lista', style: 'margin-top:0' }, (l.paraQuando ? [['Para quando', S.paraQuandoTxt(l.paraQuando)]] : []).concat(dados).map(([a, v]) => h('div', null, h('span', { text: a }), h('b', { text: v })))) : null,
          l.resposta ? h('div', { class: 'ok sol-resposta' }, ic('comentario'), h('div', null, h('b', { style: 'display:block', text: 'Resposta da logística' }), l.resposta)) : null,
          h('div', { class: 'resumo-lista', style: 'margin-top:0' }, [['Enviada em', C.dataHora(l.criadoEm)], ['Última atualização', C.dataHora(l.atualizadoEm)]].map(([a, v]) => h('div', null, h('span', { text: a }), h('b', { text: v || '—' })))),
          cfg && cfg.repetir ? h('div', { class: 'acoes' }, h('button', { class: 'btn peq', type: 'button', onclick: () => { e.aberta = null; e.gavAnim = null; cfg.repetir(l); } }, ic('atualizar'), 'Pedir de novo')) : null,
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Histórico' }), h('ol', { class: 'hist', 'aria-label': 'Histórico da solicitação' }, (l.historico || []).filter((x) => x.acao !== 'interno').slice().reverse().map((x) => h('li', null, h('span', { class: 'hora', text: C.dataHora(x.em) }), ' ', h('b', { text: x.status ? S.STATUS[x.status] || x.status : S.ACAO[x.acao] || '' }), x.texto ? ' · ' + x.texto : ''))))))];
  }
  function telaMinhas() {
    const a = ativas(), r = recentes(), blocos = [];
    if (e.listaErro) blocos.push(h('div', { class: 'erro', role: 'alert' }, ic('alerta'), e.listaErro));
    if (!e.lista && !e.listaErro) blocos.push(C.esqueleto(2));
    else if (e.lista) {
      if (!a.length && !r.length) blocos.push(h('section', { class: 'card' }, C.vazio('caixaEntrada', 'Nenhuma solicitação ainda', 'Quando você pedir algo para a logística, aparece aqui com o protocolo e a resposta.'), h('div', { class: 'acoes', style: 'justify-content:center' }, h('button', { class: 'btn primario peq', type: 'button', onclick: () => { e.sub = 'transf'; redesenhar(); } }, ic('enviar'), 'Fazer uma solicitação'))));
      else {
        if (a.length) blocos.push(h('section', { class: 'card', 'aria-label': 'Em andamento' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Em andamento' }), h('span', { class: 'mudo peq', text: a.length + (a.length === 1 ? ' solicitação' : ' solicitações') })), a.map(cartaoMinha)));
        if (r.length) blocos.push(h('section', { class: 'card', 'aria-label': 'Respondidas' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Respondidas e concluídas' })), r.map(cartaoMinha)));
        blocos.push(h('p', { class: 'dica', text: (conta() ? 'Lista do seu login, em qualquer aparelho.' : 'Esta lista é deste aparelho. Crie seu acesso para vê-la em qualquer aparelho.') + ' Atualiza sozinha a cada minuto.' }));
      }
    }
    const aberta = e.aberta && a.concat(r).find((x) => x.id === e.aberta);
    if (aberta) blocos.push(...gaveta(aberta));
    return blocos;
  }

  /* ---------- ponto de entrada ---------- */
  function subAbas() {
    const n = ativas().length;
    return h('div', { class: 'sol-subabas', role: 'group', 'aria-label': 'Tipo de solicitação' }, SUBS.map(([id, i, nome]) => h('button', { type: 'button', 'aria-pressed': String(e.sub === id), onclick: () => { e.sub = id; e.enviado = null; e.erro = ''; e.t.rev = false; if (id === 'minhas') carregar(true); redesenhar(); } }, ic(i), nome + (id === 'minhas' && n ? ' (' + n + ')' : ''))));
  }
  function tela() {
    if (!e.lista && !e.carregando && !e.listaErro) { e.carregando = true; carregar(true); }
    if (!e.arm.dados && !e.arm.erro && !e.arm.carregando) carregarArmazens();
    let corpo;
    if (e.enviado) corpo = telaEnviado();
    else if (e.sub === 'minhas') corpo = telaMinhas();
    else if (e.sub === 'transf') corpo = telaTransf();
    else if (e.sub === 'pedido') corpo = telaSimples(e.pedidoTipo);
    else corpo = telaSimples(SUB_TIPO[e.sub]);
    const cab = [C.cabecalho('enviar', 'Solicitar à logística', 'Peça uma transferência, cancele ou segure um pedido, consulte estoque. A logística responde e você acompanha por aqui.'), cfg && cfg.faixa ? cfg.faixa('solicitar') : null, e.enviado ? null : subAbas()];
    return [h('div', { class: 'sol-vend', id: 'sol-vend-raiz' }, cab, corpo)];
  }
  function ligar(opcoes) { cfg = opcoes; }
  root.setInterval(() => { if (!root.document.hidden && root.document.getElementById('sol-vend-raiz') && e.sub === 'minhas' && !e.enviando) carregar(true); }, 60000);
  root.document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && e.aberta) { e.aberta = null; e.gavAnim = null; redesenhar(); } });
  // "Pedir de novo": copia uma solicitação anterior (transferência, consulta de estoque, outro assunto) para o formulário, editável. Os saldos são consultados de novo.
  function repetir(l) {
    const d = (l && l.dados) || {};
    e.enviado = null; e.erro = '';
    if (l.tipo === 'transferencia_peca' && d.origem && d.destino) {
      const t = novaTransf();
      t.origem = { filial: S.chaveFilial(d.origem.filial), armazem: d.origem.armazem || '' }; t.destino = { filial: S.chaveFilial(d.destino.filial), armazem: d.destino.armazem || '' };
      t.itens = (d.itens || []).slice(0, 30).map((x) => Object.assign(novoItem(), { produto: { codigo: x.produto, descricao: x.descricao || '', saldoDisponivel: false, saldos: [], lotes: [] }, lote: x.lote || '', qt: String(x.qt || '') }));
      if (!t.itens.length) t.itens = [novoItem()];
      t.motivo = d.motivo || ''; e.t = t; e.sub = 'transf'; agendarRefresh();
    } else if (l.tipo === 'consulta_estoque') { e.f.consulta_estoque = { pedido: '', dados: { produto: d.produto || '', qt: d.qt ? String(d.qt) : '', filial: d.filial || '' } }; e.consulta = novoItem(); e.sub = 'consulta'; }
    else { e.f.outro = { pedido: l.pedido || '', dados: { texto: d.texto || l.texto || '' } }; e.sub = 'outro'; }
    if (l.paraQuando && l.paraQuando.tipo && l.paraQuando.tipo !== 'data') e.pq[SUB_TIPO[e.sub] || 'transferencia_peca'] = { tipo: l.paraQuando.tipo, data: '' };
    redesenhar(); root.scrollTo(0, 0);
  }
  // Para a aba "Minhas" de vendedoras.js, que mostra tudo numa lista só: cartão, painel da solicitação aberta e a lista inteira (ativas + recentes).
  const todasMinhas = () => ativas().concat(recentes());
  const gavetaAberta = () => { const l = e.aberta && todasMinhas().find((x) => x.id === e.aberta); return l ? gaveta(l) : []; };
  root.SolicitacoesVend = { abrirSub: (sub) => { e.sub = sub; e.enviado = null; e.erro = ''; e.t.rev = false; }, repetir, abertaId: () => e.aberta, ligar, tela, carregar, idsGuardados: () => lerLS(LS_IDS, []), cartao: cartaoMinha, gavetaAberta, fechar: () => { e.aberta = null; e.gavAnim = null; }, todas: todasMinhas, carregada: () => Boolean(e.lista), erro: () => e.listaErro };
})(window);
