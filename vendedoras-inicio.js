/* Central de Pedidos · área das vendedoras, aba "Início": entrada única "O que você precisa?".
 * Um campo de pedido(s) (cola uma lista), seis cartões e "Outro assunto". Ao escolher, a tela consulta cada pedido (/api/vendedoras/pedidos) e só oferece o que cabe
 * na etapa dele; o que não cabe fica desabilitado com o motivo. Vários pedidos viram UMA solicitação (um protocolo). Modelos rápidos e "Pedir de novo".
 * Os formulários antigos (Prioridade, Avisar, Solicitar) continuam acessíveis. JavaScript puro; tudo que vem do servidor entra como textContent. */
(function (root) {
  'use strict';
  const C = root.Central, S = root.SolComum, h = C.h, ic = S.ic;
  const MAX_PEDIDOS = 20, LS_MOD = 'sc9v_modelos', LS_IDS = 'sc9v_solic', LS_NOME = 'sc9v_nome';
  const lerLS = (k, padrao) => { try { const v = root.localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch (x) { return padrao; } };
  const gravarLS = (k, v) => { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (x) { /* sem armazenamento: segue sem lembrar */ } };
  let cfg = null; // { api, conta, redesenhar, faixa, irPara, repetir }, entregue por vendedoras.js
  const redesenhar = () => { if (cfg) cfg.redesenhar(); };
  const conta = () => (cfg && cfg.conta && cfg.conta()) || null;
  const hojeISO = () => C.diaSP(new Date().toISOString());
  const foco = (id) => root.setTimeout(() => { const x = root.document.getElementById(id); if (x && x.focus) x.focus(); }, 30);

  /* ---------- o que cada cartão oferece, e o que cabe em cada etapa do pedido ---------- */
  const NAO_ACHADO = 'Ainda não está no SC9 (ou o número está errado). Se é um pedido novo com PV, use "Subir um pedido".';
  const JA_DESP = 'Este pedido já foi despachado.';
  // etapa -> [cabe?, aviso (se cabe) ou motivo (se não cabe)]
  const REGRAS = {
    sair_hoje: { nao_separado: [1, ''], em_separacao: [1, 'Já está sendo separado.'], separado: [1, 'Já foi separado: ele sai na coleta. Peça só se precisa sair antes.'], conferido: [1, 'Já foi conferido: ele sai na coleta. Peça só se precisa sair antes.'], faturado: [0, 'Já está faturado: a separação já passou. Use "Como vai sair" para combinar a saída.'], despachado: [0, JA_DESP], nao_achado: [0, NAO_ACHADO] },
    saida_especial: { nao_separado: [1, ''], em_separacao: [1, ''], separado: [1, ''], conferido: [1, ''], faturado: [1, ''], despachado: [0, JA_DESP], nao_achado: [0, NAO_ACHADO] },
    cancelar_pedido: { nao_separado: [1, 'Ainda não foi separado: ainda dá tempo.'], em_separacao: [1, 'Já está sendo separado: a logística avalia se dá para parar.'], separado: [1, 'Já foi separado: pode não dar tempo. A logística avalia.'], conferido: [1, 'Já foi conferido: pode não dar tempo. A logística avalia.'], faturado: [0, 'Já está faturado: para cancelar, peça pela "Nota fiscal" (cancelar a nota).'], despachado: [0, JA_DESP], nao_achado: [0, NAO_ACHADO] },
    segurar_pedido: { nao_separado: [1, 'Ainda não foi separado: ainda dá tempo.'], em_separacao: [1, 'Já está sendo separado: a logística avalia se dá para parar.'], separado: [1, 'Já foi separado: pode não dar tempo.'], conferido: [1, 'Já foi conferido: pode não dar tempo.'], faturado: [0, 'Já está faturado: não dá para segurar a separação.'], despachado: [0, JA_DESP], nao_achado: [0, NAO_ACHADO] },
    alterar_pedido: { nao_separado: [1, ''], em_separacao: [1, 'Já está sendo separado: a mudança pode não dar tempo.'], separado: [1, 'Já foi separado: mudar itens pode não dar tempo.'], conferido: [1, 'Já foi conferido: mudar itens pode não dar tempo.'], faturado: [0, 'Já está faturado: para corrigir, peça pela "Nota fiscal".'], despachado: [0, JA_DESP], nao_achado: [0, NAO_ACHADO] },
    erro_pedido: { nao_separado: [1, ''], em_separacao: [1, ''], separado: [1, ''], conferido: [1, ''], faturado: [1, 'Já está faturado: a nota pode precisar de correção.'], despachado: [0, JA_DESP], nao_achado: [0, NAO_ACHADO] },
    falta_item: { nao_separado: [1, ''], em_separacao: [1, ''], separado: [1, 'Já foi separado: confirme com a logística o que faltou.'], conferido: [1, 'Já foi conferido: confirme com a logística o que faltou.'], faturado: [0, 'Já está faturado: a falta de item deve ser tratada com a nota.'], despachado: [0, JA_DESP], nao_achado: [0, NAO_ACHADO] },
    nota_fiscal: { nao_separado: [0, 'Ainda não tem nota fiscal: o pedido não foi faturado.'], em_separacao: [0, 'Ainda não tem nota fiscal: o pedido não foi faturado.'], separado: [0, 'Ainda não tem nota fiscal: o pedido não foi faturado.'], conferido: [0, 'Ainda não tem nota fiscal: o pedido não foi faturado.'], faturado: [1, ''], despachado: [1, ''], nao_achado: [0, NAO_ACHADO] }
  };
  Object.setPrototypeOf(REGRAS, null);
  const regra = (tipo, etapa) => { const r = (REGRAS[tipo] || {})[etapa || 'nao_achado'] || [1, '']; return { ok: Boolean(r[0]), texto: r[1] }; };
  const CARTOES = [
    { id: 'sair', icone: 'raio', tom: 'urg', titulo: 'Sair hoje', frase: 'Pressa, liberar, prioridade', opcoes: ['sair_hoje'], pedidos: true },
    { id: 'saida', icone: 'caminhao', tom: 'alta', titulo: 'Como vai sair', frase: 'Retirada, Sedex, motoboy, outra transportadora, saída pela filial', opcoes: ['saida_especial'], pedidos: true },
    { id: 'corrigir', icone: 'lapis', tom: 'azul', titulo: 'Corrigir ou cancelar', frase: 'Erro, falta de item, alterar, segurar, cancelar', opcoes: ['erro_pedido', 'falta_item', 'alterar_pedido', 'segurar_pedido', 'cancelar_pedido'], pedidos: true },
    { id: 'nf', icone: 'nota', tom: 'azul', titulo: 'Nota fiscal', frase: 'Cancelada, corrigir, 2ª via, enviar ao cliente', opcoes: ['nota_fiscal'], pedidos: true },
    { id: 'subir', icone: 'enviar', tom: 'azul', titulo: 'Subir um pedido', frase: 'Pedir para lançar um PV no sistema', opcoes: ['subir_pedido'], pedidos: false },
    { id: 'estoque', icone: 'troca', tom: 'azul', titulo: 'Transferência e estoque', frase: 'Mover peças entre armazéns ou filiais; consultar estoque', ir: 'transf' }
  ];
  const CARTAO_DO_TIPO = { sair_hoje: 'sair', saida_especial: 'saida', erro_pedido: 'corrigir', falta_item: 'corrigir', alterar_pedido: 'corrigir', segurar_pedido: 'corrigir', cancelar_pedido: 'corrigir', nota_fiscal: 'nf', subir_pedido: 'subir' };
  const OPCAO_ROTULO = { erro_pedido: ['Erro ou revisão', 'Algo está errado no pedido'], falta_item: ['Falta de item', 'Faltou peça: esperar, cortar ou substituir'], alterar_pedido: ['Alterar o pedido', 'Itens, quantidade ou endereço'], segurar_pedido: ['Segurar o pedido', 'Parar até o cliente confirmar'], cancelar_pedido: ['Cancelar o pedido', 'O cliente desistiu'], sair_hoje: ['Sair hoje', ''], saida_especial: ['Como vai sair', ''], nota_fiscal: ['Nota fiscal', ''], subir_pedido: ['Subir um pedido', ''] };
  const ehRetirada = (d) => d.modo === 'retirada';
  // Campos de cada formulário. q(dados): só aparece (e só vale) se verdadeiro. obrig pode ser função.
  const CAMPOS = {
    sair_hoje: [{ id: 'motivo', tipo: 'enum', rot: 'Por que precisa sair hoje?', op: S.ENUMS.motivoSair, obrig: true }],
    saida_especial: [{ id: 'modo', tipo: 'enum', rot: 'Como o pedido vai sair?', op: S.ENUMS.modoSaida, obrig: true }, { id: 'quem', tipo: 'texto', rot: 'Quem vai retirar?', max: 80, obrig: true, q: ehRetirada },
      { id: 'dia', tipo: 'data', rot: 'Em que dia?', obrig: true, q: ehRetirada }, { id: 'hora', tipo: 'hora', rot: 'A que horas? (opcional)', q: ehRetirada },
      { id: 'transportadora', tipo: 'texto', rot: 'Qual transportadora?', max: 60, obrig: true, q: (d) => d.modo === 'outra_transportadora' }, { id: 'filial', tipo: 'filial', rot: 'De qual filial sai?', obrig: true, q: (d) => d.modo === 'saida_filial' },
      { id: 'detalhe', tipo: 'area', rot: 'Detalhe (opcional)', max: 300 }],
    cancelar_pedido: [{ id: 'motivo', tipo: 'area', rot: 'Por que cancelar?', max: 300, obrig: true, dica: 'Ex.: o cliente desistiu da compra.' }],
    segurar_pedido: [{ id: 'motivo', tipo: 'area', rot: 'Por que segurar?', max: 300, obrig: true, dica: 'Ex.: o cliente vai confirmar o endereço.' }, { id: 'ate', tipo: 'data', rot: 'Segurar até quando? (opcional)' }],
    alterar_pedido: [{ id: 'o_que', tipo: 'area', rot: 'O que precisa mudar?', max: 500, obrig: true, dica: 'Diga o que sai e o que entra. Ex.: trocar 2 un do item A por 2 un do item B.' }],
    erro_pedido: [{ id: 'modo', tipo: 'enum', rot: 'É um erro ou uma revisão?', op: S.ENUMS.modoErro, obrig: true }, { id: 'o_que', tipo: 'area', rot: 'O que está errado ou precisa ser revisado?', max: 500, obrig: true }],
    falta_item: [{ id: 'acao', tipo: 'enum', rot: 'O que fazer com o item?', op: S.ENUMS.acaoFalta, obrig: true }, { id: 'detalhe', tipo: 'texto', rot: 'Substituir por qual produto?', max: 300, obrig: true, q: (d) => d.acao === 'substituir' }],
    nota_fiscal: [{ id: 'subtipo', tipo: 'enum', rot: 'O que você precisa da nota?', op: S.ENUMS.subtipoNf, obrig: true }, { id: 'o_que', tipo: 'area', rot: 'Explique (o que corrigir, motivo...)', max: 500, obrig: (d) => !['segunda_via', 'enviar_cliente'].includes(d.subtipo) }],
    subir_pedido: [{ id: 'pv', tipo: 'texto', rot: 'Número do PV', max: 30, obrig: true }, { id: 'filial', tipo: 'filial', rot: 'Filial (se souber)' }, { id: 'onde', tipo: 'area', rot: 'Onde está o PV?', max: 300, obrig: true, dica: 'Por enquanto diga onde achar (e-mail, pasta, link). O envio do arquivo vem numa próxima etapa.' }]
  };
  Object.setPrototypeOf(CAMPOS, null);
  const visivel = (c, d) => !c.q || c.q(d);
  const obrigatorio = (c, d) => (typeof c.obrig === 'function' ? c.obrig(d) : Boolean(c.obrig));

  /* ---------- estado ---------- */
  const novoForm = () => ({ dados: {}, itens: [], busca: '', achados: null, buscando: false, buscaErro: '', recado: '', pq: { tipo: '', data: '' }, nome: lerLS(LS_NOME, '') });
  const st = { texto: '', info: {}, consultando: false, card: '', opcao: '', f: novoForm(), excl: {}, enviando: false, erro: '', enviado: null, aviso: '',
    mod: { lista: null, erro: '', carregando: false, nome: '', abrir: false, salvando: false } };
  let seqBusca = 0, timerBusca = 0;

  /* ---------- pedidos digitados ---------- */
  const normPedido = (t) => { const d = String(t == null ? '' : t).replace(/\.0+$/, '').replace(/\D/g, '').replace(/^0+/, ''); return d.length >= 4 && d.length <= 10 ? d : ''; };
  function lerPedidos(texto) {
    const lista = [], vistos = new Set(); let ruins = 0, excesso = 0;
    for (const t of String(texto || '').split(/[\s,;]+/).filter(Boolean)) {
      const p = normPedido(t);
      if (!p) { ruins++; continue; }
      if (vistos.has(p)) continue;
      vistos.add(p); if (lista.length < MAX_PEDIDOS) lista.push(p); else excesso++;
    }
    return { lista, ruins, excesso };
  }
  const pedidos = () => lerPedidos(st.texto).lista;
  const etapaDe = (p) => { const i = st.info[p]; return i && i.estado === 'ok' ? (i.r.achado ? i.r.etapa || '' : 'nao_achado') : ''; };
  async function consultar(lista) {
    const faltam = lista.filter((p) => !st.info[p] || st.info[p].estado !== 'ok' || Date.now() - st.info[p].em > 120000);
    if (!faltam.length || !cfg) return;
    st.consultando = true; faltam.forEach((p) => { st.info[p] = { estado: 'carregando' }; }); redesenhar();
    try {
      const j = await cfg.api('/api/vendedoras/pedidos?pedidos=' + faltam.join(','));
      const por = new Map((j.pedidos || []).map((r) => [normPedido(r.pedido), r]));
      faltam.forEach((p) => { const r = por.get(p); st.info[p] = r ? { estado: 'ok', r, em: Date.now() } : { estado: 'erro', erro: 'Sem resposta para este pedido.' }; });
    } catch (x) { faltam.forEach((p) => { st.info[p] = { estado: 'erro', erro: x.message }; }); }
    st.consultando = false; redesenhar();
  }
  const conferir = () => { const l = pedidos(); st.excl = {}; if (l.length) consultar(l); else redesenhar(); };

  /* ---------- peças de tela ---------- */
  const orbe = (c, extra) => h('span', { class: 'sol-orbe tom-' + c.tom + (extra ? ' ' + extra : '') }, ic(c.icone));
  function campoPedidos(obrigatorio) {
    const l = lerPedidos(st.texto);
    const nota = () => { const r = lerPedidos(st.texto); return r.lista.length + (r.lista.length === 1 ? ' pedido reconhecido' : ' pedidos reconhecidos') + (r.ruins ? ' · ' + r.ruins + ' número(s) ignorado(s) (use de 4 a 10 dígitos)' : '') + (r.excesso ? ' · só os ' + MAX_PEDIDOS + ' primeiros entram' : ''); };
    return h('div', { class: 'sol-campo ini-pedidos' }, h('label', { class: 'rotulo', for: 'ini-pedidos', text: obrigatorio ? 'Número do pedido (um ou vários)' : 'Número do pedido (se tiver; um ou vários)' }),
      h('textarea', { id: 'ini-pedidos', class: 'entrada num', rows: '2', maxlength: '600', autocomplete: 'off', inputmode: 'text', placeholder: 'Ex.: 123456   ou cole uma lista: 123456, 123457, 123458', value: st.texto,
        oninput: (ev) => { st.texto = ev.target.value; const c = root.document.getElementById('ini-contagem'); if (c) c.textContent = nota(); },
        onchange: conferir, onpaste: () => root.setTimeout(() => { const t = root.document.getElementById('ini-pedidos'); if (t) { st.texto = t.value; conferir(); } }, 30) }, st.texto),
      h('p', { class: 'dica', id: 'ini-contagem', role: 'status', text: nota() }),
      l.lista.length ? h('ul', { class: 'ini-fichas', 'aria-label': 'Pedidos digitados' }, l.lista.map((p) => { const i = st.info[p], e = etapaDe(p);
        return h('li', { class: 'ini-ficha ' + (!i ? '' : i.estado === 'carregando' ? 'carregando' : i.estado === 'erro' ? 'erro' : e === 'nao_achado' ? 'fora' : 'ok') },
          h('b', { class: 'num', text: p }), h('span', { text: !i ? 'Toque em "Conferir" para ver a situação' : i.estado === 'carregando' ? 'Consultando…' : i.estado === 'erro' ? 'Não consegui consultar' : e === 'nao_achado' ? 'Não está no SC9' : (S.ETAPA[e] || (i.r.resumo && i.r.resumo.texto) || '') + (i.r.detalhes && i.r.detalhes.cliente ? ' · ' + i.r.detalhes.cliente : '') })); })) : null,
      l.lista.length ? h('div', { class: 'acoes', style: 'margin:0' }, h('button', { class: 'btn peq', type: 'button', disabled: st.consultando, onclick: () => { l.lista.forEach((p) => { delete st.info[p]; }); conferir(); } }, ic('atualizar'), st.consultando ? 'Consultando…' : 'Conferir a situação')) : null);
  }
  const OUTROS = [['prioridade', 'raio', 'Pedir prioridade (formulário antigo)'], ['avisar', 'comentario', 'Avisar a expedição (formulário antigo)'], ['solicitar', 'enviar', 'Solicitar à logística (formulário antigo)']];

  /* ---------- modelos rápidos ---------- */
  async function carregarModelos() {
    if (st.mod.carregando) return; st.mod.carregando = true;
    try {
      if (conta()) { const j = await cfg.api('/api/vendedoras/modelos'); st.mod.lista = j.modelos || []; }
      else st.mod.lista = (lerLS(LS_MOD, []) || []).filter((m) => m && m.id && m.nome && S.TIPOS[m.tipo]);
      st.mod.erro = '';
    } catch (x) { st.mod.erro = x.message; st.mod.lista = st.mod.lista || []; }
    st.mod.carregando = false; redesenhar();
  }
  const dadosParaEnvio = () => { const d = {}; for (const c of CAMPOS[st.opcao] || []) { const v = String(st.f.dados[c.id] == null ? '' : st.f.dados[c.id]).trim(); if (v && visivel(c, st.f.dados)) d[c.id] = v; } return d; };
  async function guardarModelo() {
    const nome = st.mod.nome.trim(); if (nome.length < 2) { st.erro = 'Dê um nome ao modelo (mínimo 2 letras).'; return redesenhar(); }
    const pq = st.f.pq.tipo && st.f.pq.tipo !== 'data' ? { tipo: st.f.pq.tipo } : null;
    const modelo = { nome, tipo: st.opcao, dados: dadosParaEnvio(), texto: st.f.recado.trim(), paraQuando: pq };
    if (st.opcao === 'falta_item') modelo.dados.itens = st.f.itens.filter((x) => x.codigo).map((x) => ({ produto: x.codigo, qt: Number(x.qt) || 1 }));
    st.mod.salvando = true; st.erro = ''; redesenhar();
    try {
      if (conta()) { const j = await cfg.api('/api/vendedoras/modelos', { method: 'POST', body: JSON.stringify({ acao: 'salvar', modelo }) }); st.mod.lista = j.modelos || []; }
      else {
        const lista = lerLS(LS_MOD, []) || [];
        if (lista.some((m) => String(m.nome).toLowerCase() === nome.toLowerCase())) throw new Error('Já existe um modelo com este nome.');
        if (lista.length >= 20) throw new Error('Você já tem 20 modelos. Apague algum para guardar outro.');
        lista.push(Object.assign({ id: 'l' + Date.now().toString(36) }, modelo)); gravarLS(LS_MOD, lista); st.mod.lista = lista;
      }
      st.mod.nome = ''; st.mod.abrir = false; C.toast('Modelo guardado' + (conta() ? '.' : ' neste aparelho. Com acesso criado, ele vale em qualquer aparelho.'));
    } catch (x) { st.erro = x.message; }
    st.mod.salvando = false; redesenhar();
  }
  async function apagarModelo(m) {
    try {
      if (conta()) { const j = await cfg.api('/api/vendedoras/modelos', { method: 'POST', body: JSON.stringify({ acao: 'apagar', id: m.id }) }); st.mod.lista = j.modelos || []; }
      else { const lista = (lerLS(LS_MOD, []) || []).filter((x) => x.id !== m.id); gravarLS(LS_MOD, lista); st.mod.lista = lista; }
      C.toast('Modelo apagado.');
    } catch (x) { C.toast(x.message, 'erro'); }
    redesenhar();
  }
  // Abre o formulário já preenchido (modelo ou "pedir de novo"). Os pedidos NÃO vêm do modelo.
  function preencher(tipo, dados, recado, pq) {
    st.card = CARTAO_DO_TIPO[tipo] || 'corrigir'; st.opcao = tipo; st.f = novoForm(); st.erro = ''; st.enviado = null;
    for (const c of CAMPOS[tipo] || []) if (dados && dados[c.id] != null) st.f.dados[c.id] = String(dados[c.id]);
    if (tipo === 'falta_item' && dados && Array.isArray(dados.itens)) st.f.itens = dados.itens.slice(0, 30).map((x) => ({ codigo: String(x.produto || ''), descricao: String(x.descricao || ''), qt: String(x.qt || '') }));
    st.f.recado = String(recado || ''); if (pq && pq.tipo && pq.tipo !== 'data') st.f.pq = { tipo: pq.tipo, data: '' };
    const l = pedidos(); if (l.length) consultar(l);
    redesenhar(); root.scrollTo(0, 0); foco('ini-pedidos');
  }
  const usarModelo = (m) => preencher(m.tipo, m.dados, m.texto, m.paraQuando);
  function repetir(l) { // "Pedir de novo": copia a solicitação anterior (incluindo os pedidos) para o formulário, editável
    const ps = (l.pedidos && l.pedidos.length ? l.pedidos.map((x) => x.pedido) : [l.pedido]).filter(Boolean);
    st.texto = ps.join('\n'); st.info = {}; st.excl = {}; preencher(l.tipo, l.dados || {}, l.texto, l.paraQuando);
  }

  /* ---------- formulário ---------- */
  function campo(c) {
    const d = st.f.dados, id = 'ini-c-' + c.id, v = d[c.id] == null ? '' : d[c.id], rot = c.rot;
    let ent;
    if (c.tipo === 'enum') ent = h('select', { id, class: 'entrada', onchange: (ev) => { d[c.id] = ev.target.value; redesenhar(); } }, h('option', { value: '', text: 'Escolha', selected: !v }), c.op.map(([ov, ot]) => h('option', { value: ov, text: ot, selected: v === ov })));
    else if (c.tipo === 'filial') ent = h('select', { id, class: 'entrada', onchange: (ev) => { d[c.id] = ev.target.value; } }, h('option', { value: '', text: obrigatorio(c, d) ? 'Escolha a filial' : 'Não sei', selected: !v }), S.FILIAIS.map((k) => h('option', { value: k, text: S.FILIAIS_ROTULO[k], selected: v === k })));
    else if (c.tipo === 'data') ent = h('input', { id, class: 'entrada', type: 'date', min: hojeISO(), value: v, onchange: (ev) => { d[c.id] = ev.target.value; } });
    else if (c.tipo === 'hora') ent = h('input', { id, class: 'entrada', type: 'time', value: v, onchange: (ev) => { d[c.id] = ev.target.value; } });
    else if (c.tipo === 'area') ent = h('textarea', { id, class: 'entrada', rows: '3', maxlength: String(c.max || 300), oninput: (ev) => { d[c.id] = ev.target.value; } }, v);
    else ent = h('input', { id, class: 'entrada', type: 'text', maxlength: String(c.max || 80), autocomplete: 'off', value: v, oninput: (ev) => { d[c.id] = ev.target.value; } });
    return h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: id, text: rot }), ent, c.dica ? h('p', { class: 'dica', text: c.dica }) : null);
  }
  // Falta de item: busca o produto (código ou nome) e põe na lista com a quantidade que faltou.
  function buscarProdutos() {
    const f = st.f; root.clearTimeout(timerBusca); const q = f.busca.trim();
    if (q.length < 2) { f.achados = null; f.buscando = false; return pintarBusca(); }
    f.buscando = true; f.buscaErro = ''; pintarBusca(); const meu = ++seqBusca;
    timerBusca = root.setTimeout(async () => {
      try { const j = await cfg.api('/api/vendedoras/produtos?q=' + encodeURIComponent(q)); if (meu !== seqBusca) return; f.achados = (j.produtos || []).slice(0, 8); }
      catch (x) { if (meu !== seqBusca) return; f.buscaErro = x.status === 429 ? 'Muitas buscas seguidas. Espere alguns segundos.' : x.message; }
      f.buscando = false; pintarBusca();
    }, 250);
  }
  function pintarBusca() { const ul = root.document.getElementById('ini-achados'); if (ul) ul.replaceChildren(...filhosBusca()); }
  function filhosBusca() {
    const f = st.f, msg = (t) => h('li', { class: 'sol-sug-msg', role: 'presentation', text: t });
    if (f.busca.trim().length < 2) return [msg('Digite pelo menos 2 letras ou números do código ou do nome.')];
    if (f.buscando) return [msg('Buscando produtos…')]; if (f.buscaErro) return [msg(f.buscaErro)];
    if (!f.achados) return []; if (!f.achados.length) return [msg('Nenhum produto encontrado. Tente outro trecho do nome ou o código.')];
    return f.achados.map((p) => h('li', null, h('button', { class: 'sol-sug-item', type: 'button', onclick: () => {
      if (f.itens.some((x) => x.codigo === p.codigo)) { C.toast('Este produto já está na lista.', 'erro'); return; }
      if (f.itens.length >= 30) { C.toast('No máximo 30 produtos.', 'erro'); return; }
      f.itens.push({ codigo: p.codigo, descricao: p.descricao || '', qt: '' }); f.busca = ''; f.achados = null; redesenhar(); foco('ini-qt-' + (f.itens.length - 1)); } },
      h('b', { class: 'num sol-sug-cod', text: p.codigo }), h('span', { class: 'sol-sug-desc', text: p.descricao || 'Sem descrição' }))));
  }
  function campoItens() {
    const f = st.f;
    return h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: 'ini-busca', text: 'Quais produtos faltaram?' }),
      h('input', { id: 'ini-busca', class: 'entrada', type: 'text', maxlength: '80', autocomplete: 'off', spellcheck: 'false', placeholder: 'Código ou nome do produto', value: f.busca, 'aria-controls': 'ini-achados', oninput: (ev) => { f.busca = ev.target.value; buscarProdutos(); } }),
      h('ul', { id: 'ini-achados', class: 'sol-sug ini-achados', 'aria-label': 'Produtos encontrados' }, filhosBusca()),
      f.itens.length ? h('ul', { class: 'ini-itens', 'aria-label': 'Produtos em falta' }, f.itens.map((x, i) => h('li', null, h('span', { class: 'ini-item-txt' }, h('b', { class: 'num', text: x.codigo }), h('span', { text: x.descricao || '' })),
        h('label', { class: 'sr', for: 'ini-qt-' + i, text: 'Quantidade que faltou de ' + x.codigo }), h('input', { id: 'ini-qt-' + i, class: 'entrada num', type: 'text', inputmode: 'numeric', maxlength: '5', placeholder: 'Qtd', value: x.qt, oninput: (ev) => { const v = ev.target.value.replace(/\D/g, '').slice(0, 5); if (ev.target.value !== v) ev.target.value = v; x.qt = v; } }),
        h('button', { class: 'btn peq fantasma perigo', type: 'button', 'aria-label': 'Tirar o produto ' + x.codigo, onclick: () => { f.itens.splice(i, 1); redesenhar(); } }, ic('fechar'))))) : h('p', { class: 'dica', text: 'Nenhum produto ainda: busque acima e escolha da lista.' }));
  }
  // O que cabe: de cada pedido marcado, os que cabem na opção e os que não (com o motivo).
  function particao(tipo) {
    const marc = pedidos().filter((p) => !st.excl[p]), cabem = [], fora = [];
    for (const p of marc) { const e = etapaDe(p); if (!e && st.info[p] && st.info[p].estado === 'erro') { cabem.push({ p, aviso: 'Não consegui consultar: a logística confere.' }); continue; } const r = regra(tipo, e); (r.ok ? cabem : fora).push({ p, aviso: r.texto, motivo: r.texto, etapa: e }); }
    return { marc, cabem, fora };
  }
  function validar(tipo, cabem) {
    const f = st.f, d = f.dados;
    const cardDef = CARTOES.find((c) => c.id === CARTAO_DO_TIPO[tipo]);
    if (cardDef && cardDef.pedidos && !cabem.length) return pedidos().length ? 'Nenhum dos pedidos marcados cabe nesta ação. Veja o motivo acima.' : 'Digite o número do pedido.';
    for (const c of CAMPOS[tipo]) {
      if (!visivel(c, d)) continue;
      const v = String(d[c.id] == null ? '' : d[c.id]).trim();
      if (!v) { if (obrigatorio(c, d)) return 'Preencha: ' + c.rot.replace(/\?$/, '').replace(/ \(opcional\)/, '') + '.'; continue; }
      if ((c.tipo === 'texto' || c.tipo === 'area') && obrigatorio(c, d) && v.length < 3) return 'Escreva um pouco mais em "' + c.rot.replace(/\?$/, '') + '".';
      if (c.tipo === 'data' && v < hojeISO()) return 'A data de "' + c.rot.replace(/\?$/, '').replace(/ \(opcional\)/, '') + '" não pode ser no passado.';
    }
    if (tipo === 'falta_item') { if (!f.itens.length) return 'Inclua pelo menos um produto que faltou.'; const ruim = f.itens.find((x) => !/^\d+$/.test(x.qt) || Number(x.qt) < 1); if (ruim) return 'Informe a quantidade que faltou de ' + ruim.codigo + ' (número inteiro de 1 a 99999).'; }
    if (tipo === 'sair_hoje' && d.motivo === 'outro' && f.recado.trim().length < 5) return 'Explique o motivo no recado (mínimo 5 letras).';
    const pe = S.erroParaQuando(f.pq, hojeISO()); if (pe) return pe;
    if (!conta() && f.nome.trim().length < 2) return 'Diga seu nome para a logística saber quem pediu.';
    return '';
  }
  async function enviar() {
    const tipo = st.opcao, c = conta(); if (!tipo || st.enviando) return;
    const l = pedidos(); await consultar(l);
    const { cabem, fora } = particao(tipo), erro = validar(tipo, cabem);
    if (erro) { st.erro = erro; return redesenhar(); }
    const f = st.f, corpo = { tipo, pedidoPor: c ? c.nome : f.nome.trim(), dados: dadosParaEnvio() };
    if (f.recado.trim()) corpo.texto = f.recado.trim();
    const pq = S.corpoParaQuando(f.pq); if (pq) corpo.paraQuando = pq;
    if (tipo === 'falta_item') corpo.dados.itens = f.itens.map((x) => ({ produto: x.codigo, qt: Number(x.qt) }));
    if (cabem.length === 1) corpo.pedido = cabem[0].p; else if (cabem.length > 1) corpo.pedidos = cabem.map((x) => x.p);
    st.enviando = true; st.erro = ''; redesenhar();
    try {
      const j = await cfg.api('/api/vendedoras/solicitacao', { method: 'POST', body: JSON.stringify(corpo) });
      if (!c) gravarLS(LS_NOME, f.nome.trim());
      gravarLS(LS_IDS, [j.linha.id].concat((lerLS(LS_IDS, []) || []).filter((x) => x !== j.linha.id)).slice(0, 80));
      st.enviado = { linha: j.linha, etapa: j.linha.etapa || j.etapa || '', aviso: j.linha.aviso || j.aviso || '', cabem: cabem.map((x) => x.p), fora: fora.map((x) => x.p), foraDoSc9: Boolean(j.naoAchado) };
      st.f = novoForm(); st.opcao = ''; st.card = ''; st.texto = ''; st.info = {}; st.excl = {};
      C.toast('Solicitação enviada para a logística.'); if (root.SolicitacoesVend) root.SolicitacoesVend.carregar(true);
    } catch (x) { st.erro = x.message; }
    st.enviando = false; redesenhar(); root.scrollTo(0, 0);
  }

  /* ---------- telas ---------- */
  function telaEnviado() {
    const { linha: l, etapa, aviso, cabem, fora } = st.enviado, tom = S.etapaTom({ aTempo: l.aTempo, etapa });
    return h('section', { class: 'card' }, h('div', { class: 'protocolo-ok' }, h('div', { class: 'selo-ok' }, ic('ok')), h('h2', { text: 'Solicitação enviada' }), h('p', { class: 'mudo', text: 'Guarde o protocolo:' }), h('div', { class: 'codigo', text: l.protocolo || '' }),
      cabem.length > 1 ? h('p', { class: 'forte', text: 'Um protocolo só para os ' + cabem.length + ' pedidos: ' + cabem.join(', ') + '.' }) : null,
      fora.length ? h('div', { class: 'aviso', style: 'width:100%' }, ic('alerta'), h('div', null, h('b', { text: 'Ficaram de fora (não cabem nesta ação): ' }), fora.join(', ') + '. Veja as outras opções em "Início".')) : null,
      aviso && cabem.length === 1 && ['cancelar_pedido', 'segurar_pedido'].includes(l.tipo) ? h('div', { class: 'sol-etapa ' + tom, role: 'status' }, ic(tom === 'ok' ? 'okCirculo' : 'alerta'), h('div', null, h('b', { text: tom === 'ok' ? 'Ainda dá tempo' : 'A logística vai avaliar' }), h('p', { text: aviso }))) : null,
      l.status === 'aguardando_aprovacao' ? h('div', { class: 'aviso', style: 'width:100%' }, ic('relogio'), h('div', null, h('b', { text: 'Aguardando aprovação da equipe. ' }), 'Motoboy urgente só sai depois que a equipe aprova. Acompanhe em "Minhas".')) : null,
      st.enviado.foraDoSc9 ? h('div', { class: 'aviso', style: 'width:100%' }, ic('atualizar'), h('div', null, h('b', { text: 'Algum pedido ainda não está no SC9. ' }), 'A equipe também foi avisada para recarregar o SC9.')) : null,
      h('div', { class: 'resumo-lista' }, [['Assunto', S.tipoDe(l).rotulo], l.paraQuando ? ['Para quando', S.paraQuandoTxt(l.paraQuando)] : null, ['Status', S.STATUS[l.status] || l.status], ['Enviada em', C.dataHora(l.criadoEm)]].filter(Boolean).map(([a, v]) => h('div', null, h('span', { text: a }), h('b', { text: v })))),
      h('div', { class: 'processo compacta forte', role: 'status' }, ic('relogio'), h('p', null, h('b', { text: 'Agora é só aguardar. ' }), 'A logística responde em até ' + S.minTxt(S.tipoDe(l).sla) + '. A resposta aparece em "Minhas".')),
      h('div', { class: 'acoes', style: 'justify-content:center' }, h('button', { class: 'btn primario', type: 'button', onclick: () => cfg.irPara('minhas') }, ic('lista'), 'Ver em Minhas'), h('button', { class: 'btn', type: 'button', onclick: () => { st.enviado = null; redesenhar(); foco('ini-pedidos'); } }, 'Fazer outra solicitação'))));
  }
  function telaOpcoes() {
    const card = CARTOES.find((c) => c.id === st.card), tipo = st.opcao;
    const lista = pedidos(), temPedidos = Boolean(card.pedidos);
    const bloco = [h('div', { class: 'acoes', style: 'margin:0' }, h('button', { class: 'btn peq', type: 'button', onclick: () => { st.card = ''; st.opcao = ''; st.erro = ''; redesenhar(); root.scrollTo(0, 0); } }, ic('voltar'), 'Voltar ao início')),
      h('section', { class: 'card sol-form-card' }, h('div', { class: 'sol-form-cab' }, orbe(card, 'grande'), h('div', null, h('h2', { text: card.titulo }), h('p', { class: 'mudo', text: card.frase }))),
        temPedidos ? campoPedidos(true) : null)];
    if (temPedidos && st.consultando && !lista.some((p) => etapaDe(p))) bloco.push(h('p', { class: 'buscando', role: 'status', text: 'Consultando a situação dos pedidos…' }));
    // opções do cartão (só as que cabem em algum pedido ficam ativas; as outras mostram o motivo)
    if (card.opcoes.length > 1) {
      bloco.push(h('section', { class: 'card', 'aria-label': 'O que você precisa' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'O que você precisa fazer?' })),
        h('div', { class: 'sol-escolha', role: 'radiogroup', 'aria-label': 'Ação' }, card.opcoes.map((o) => {
          const pt = lista.length ? particao(o) : { cabem: [], fora: [], marc: [] }, desabilitada = Boolean(lista.length && !st.consultando && pt.marc.length && !pt.cabem.length), motivo = desabilitada ? (pt.fora[0] && pt.fora[0].motivo) || '' : '';
          const [rot, sub] = OPCAO_ROTULO[o];
          return h('button', { class: 'sol-op tom-' + S.TIPOS[o].tom + (desabilitada ? ' desabilitada' : ''), type: 'button', role: 'radio', 'aria-checked': String(tipo === o), 'aria-disabled': desabilitada ? 'true' : null, 'aria-describedby': desabilitada ? 'ini-mot-' + o : null,
            onclick: () => { if (desabilitada) return; st.opcao = o; st.erro = ''; st.f.dados = {}; redesenhar(); foco('ini-form'); } },
            h('span', { class: 'sol-orbe tom-' + S.TIPOS[o].tom }, ic(S.TIPOS[o].icone)), h('span', null, h('b', { text: rot }), h('small', { id: 'ini-mot-' + o, text: desabilitada ? 'Não disponível: ' + motivo : sub })));
        }))));
    }
    if (!tipo) { if (card.opcoes.length > 1) bloco.push(h('p', { class: 'dica', text: 'Escolha acima o que você precisa fazer.' })); return bloco; }
    const pt = lista.length ? particao(tipo) : { marc: [], cabem: [], fora: [] }, t = S.TIPOS[tipo], f = st.f, c = conta();
    if (temPedidos && lista.length > 1) {
      bloco.push(h('section', { class: 'card', 'aria-label': 'Pedidos desta solicitação' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Quais pedidos entram?' }), h('span', { class: 'mudo peq', text: pt.cabem.length + ' de ' + lista.length + ' vão nesta solicitação' })),
        h('ul', { class: 'ini-lote' }, lista.map((p) => { const e = etapaDe(p), r = regra(tipo, e), marcado = !st.excl[p];
          return h('li', { class: r.ok ? '' : 'nao-cabe' }, h('label', { class: 'sol-check', for: 'ini-m-' + p }, h('input', { id: 'ini-m-' + p, type: 'checkbox', checked: marcado, onchange: (ev) => { if (ev.target.checked) delete st.excl[p]; else st.excl[p] = true; redesenhar(); } }), h('b', { class: 'num', text: p }), h('span', { class: 'mudo', text: e ? S.ETAPA[e] || '' : '' })),
            marcado && e ? h('span', { class: 'ini-lote-nota ' + (r.ok ? (r.texto ? 'aviso-leve' : '') : 'motivo'), text: r.ok ? r.texto : 'Fica de fora: ' + r.texto }) : null); }))));
    } else if (temPedidos && lista.length === 1) {
      const e = etapaDe(lista[0]), r = e ? regra(tipo, e) : null;
      if (r && r.texto) bloco.push(h('div', { class: 'sol-etapa ' + (r.ok ? (e === 'nao_separado' ? 'ok' : 'tarde') : 'info'), role: 'status' }, ic(r.ok ? (e === 'nao_separado' ? 'okCirculo' : 'alerta') : 'info'), h('div', null, h('b', { text: r.ok ? (S.ETAPA[e] || 'Situação do pedido') : 'Não disponível para este pedido' }), h('p', { text: r.texto }))));
    }
    bloco.push(h('section', { class: 'card sol-form-card', id: 'ini-form', tabindex: '-1', 'aria-label': t.rotulo },
      card.opcoes.length > 1 ? h('div', { class: 'sol-form-cab' }, h('span', { class: 'sol-orbe grande tom-' + t.tom }, ic(t.icone)), h('div', null, h('h2', { text: OPCAO_ROTULO[tipo][0] }), h('p', { class: 'sol-tipo-prazo' }, ic('relogio'), 'A logística responde em até ' + S.minTxt(t.sla)))) : h('p', { class: 'sol-tipo-prazo' }, ic('relogio'), 'A logística responde em até ' + S.minTxt(t.sla)),
      h('form', { class: 'form', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); enviar(); } },
        CAMPOS[tipo].filter((x) => visivel(x, f.dados)).map(campo),
        tipo === 'falta_item' ? campoItens() : null,
        tipo === 'saida_especial' && f.dados.modo === 'motoboy' ? h('div', { class: 'aviso', role: 'note' }, ic('relogio'), h('div', null, h('b', { text: 'Motoboy urgente precisa de aprovação. ' }), 'A solicitação fica "Aguardando aprovação" até a equipe decidir.')) : null,
        tipo === 'cancelar_pedido' ? null : S.campoParaQuando(f.pq, redesenhar, 'ini-pq', hojeISO()),
        h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: 'ini-recado', text: 'Recado para a logística (opcional)' }), h('textarea', { id: 'ini-recado', class: 'entrada', rows: '2', maxlength: '500', placeholder: 'Algo mais que a logística precise saber', oninput: (ev) => { f.recado = ev.target.value; } }, f.recado)),
        c ? h('div', { class: 'sol-quem' }, ic('usuarioCheck'), h('span', null, 'Pedido feito por ', h('b', { text: c.nome }))) : h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: 'ini-nome', text: 'Seu nome' }), h('input', { id: 'ini-nome', class: 'entrada', type: 'text', autocomplete: 'name', maxlength: '60', placeholder: 'Ex.: Ana (Vendas)', value: f.nome, oninput: (ev) => { f.nome = ev.target.value; } })),
        pt.fora.length && lista.length > 1 ? h('div', { class: 'aviso', role: 'status' }, ic('info'), h('div', null, h('b', { text: pt.fora.length + (pt.fora.length === 1 ? ' pedido não cabe e fica de fora: ' : ' pedidos não cabem e ficam de fora: ') }), pt.fora.map((x) => x.p).join(', ') + '.')) : null,
        st.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), st.erro) : null,
        h('div', { class: 'acoes' }, h('button', { class: 'btn primario sol-enviar', type: 'submit', disabled: st.enviando }, ic('enviar'), st.enviando ? 'Enviando…' : lista.length > 1 && pt.cabem.length ? 'Enviar ' + (pt.cabem.length === 1 ? 'o pedido' : pt.cabem.length + ' pedidos') + ' para a logística' : 'Enviar para a logística'),
          h('button', { class: 'btn', type: 'button', onclick: () => { st.mod.abrir = !st.mod.abrir; redesenhar(); if (st.mod.abrir) foco('ini-mod-nome'); } }, ic('lapis'), 'Guardar como modelo')),
        st.mod.abrir ? h('div', { class: 'ini-modelo-form' }, h('label', { class: 'rotulo', for: 'ini-mod-nome', text: 'Nome do modelo' }), h('input', { id: 'ini-mod-nome', class: 'entrada', type: 'text', maxlength: '40', placeholder: 'Ex.: Cliente retira hoje', value: st.mod.nome, oninput: (ev) => { st.mod.nome = ev.target.value; } }),
          h('button', { class: 'btn peq', type: 'button', disabled: st.mod.salvando, onclick: guardarModelo }, ic('ok'), st.mod.salvando ? 'Guardando…' : 'Guardar'),
          h('p', { class: 'dica', text: conta() ? 'O modelo guarda o jeito de preencher (sem os números de pedido) e vale em qualquer aparelho.' : 'Sem acesso criado, o modelo fica só neste aparelho. Os números de pedido não são guardados.' })) : null)));
    return bloco;
  }
  function telaInicio() {
    const l = pedidos(), modelos = st.mod.lista || [];
    const aoEscolher = (cartao) => {
      if (cartao.ir) return cfg.irPara('solicitar', cartao.ir);
      if (cartao.pedidos && !l.length) { st.erro = 'Digite primeiro o número do pedido (ou cole uma lista).'; redesenhar(); return foco('ini-pedidos'); }
      st.card = cartao.id; st.opcao = cartao.opcoes.length === 1 ? cartao.opcoes[0] : ''; st.f = novoForm(); st.erro = ''; st.excl = {}; if (l.length && cartao.pedidos) consultar(l); redesenhar(); root.scrollTo(0, 0);
      if (st.opcao) foco('ini-form');
    };
    return [C.cabecalho('enviar', 'O que você precisa?', 'Digite o pedido (ou cole vários) e escolha o assunto. A tela mostra só o que cabe na etapa em que o pedido está.'), cfg.faixa ? cfg.faixa('solicitar') : null,
      h('section', { class: 'card sol-passo' }, h('div', { class: 'card-titulo' }, h('h2', null, h('span', { class: 'sol-n', text: '1' }), 'Qual pedido?')), campoPedidos(false),
        st.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), st.erro) : null),
      h('section', { class: 'card sol-passo', 'aria-label': 'Assuntos' }, h('div', { class: 'card-titulo' }, h('h2', null, h('span', { class: 'sol-n', text: '2' }), 'Do que se trata?')),
        h('div', { class: 'ini-cartoes' }, CARTOES.map((c) => h('button', { class: 'ini-cartao tom-' + c.tom, type: 'button', onclick: () => aoEscolher(c) }, orbe(c), h('span', { class: 'ini-cartao-txt' }, h('b', { text: c.titulo }), h('small', { text: c.frase })))),
          h('button', { class: 'ini-cartao tom-neutro ini-outro', type: 'button', onclick: () => cfg.irPara('solicitar', 'outro') }, h('span', { class: 'sol-orbe tom-neutro' }, ic('comentario')), h('span', { class: 'ini-cartao-txt' }, h('b', { text: 'Outro assunto' }), h('small', { text: 'Algo que não está nas opções' }))))),
      modelos.length ? h('section', { class: 'card', 'aria-label': 'Modelos rápidos' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Seus modelos rápidos' }), h('span', { class: 'mudo peq', text: conta() ? 'valem em qualquer aparelho' : 'só neste aparelho' })),
        h('ul', { class: 'ini-modelos' }, modelos.map((m) => h('li', null, h('button', { class: 'chip', type: 'button', onclick: () => usarModelo(m) }, ic(S.TIPOS[m.tipo].icone), m.nome), h('button', { class: 'btn peq fantasma perigo', type: 'button', 'aria-label': 'Apagar o modelo ' + m.nome, onclick: () => apagarModelo(m) }, ic('fechar')))))) : null,
      st.mod.erro && !modelos.length && conta() ? h('p', { class: 'dica', role: 'status', text: 'Não consegui carregar seus modelos: ' + st.mod.erro }) : null,
      h('section', { class: 'card ini-antigos', 'aria-label': 'Outros caminhos' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Outros caminhos' })), h('p', { class: 'mudo peq', text: 'Os formulários de antes continuam aqui, caso prefira.' }),
        h('div', { class: 'acoes', style: 'margin-top:8px' }, OUTROS.map(([id, i, nome]) => h('button', { class: 'btn peq', type: 'button', onclick: () => cfg.irPara(id) }, ic(i), nome))))];
  }
  function tela() {
    if (!st.mod.lista && !st.mod.carregando) carregarModelos();
    return h('div', { class: 'sol-vend ini-raiz', id: 'ini-raiz' }, ...[].concat(st.enviado ? [telaEnviado()] : st.card ? telaOpcoes() : telaInicio()));
  }
  function ligar(opcoes) { cfg = opcoes; }
  root.VendInicio = { _teste: { regra, lerPedidos, REGRAS, CAMPOS, CARTOES, CARTAO_DO_TIPO, particaoPura: (tipo, etapas) => etapas.map((e) => regra(tipo, e)) }, ligar, tela, repetir, guiado: (tipo) => Boolean(CARTAO_DO_TIPO[tipo]), recarregarModelos: () => { st.mod.lista = null; } };
})(window);
