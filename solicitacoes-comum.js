/* Central de solicitações · peças compartilhadas pela área da vendedora (solicitacoes-vend.js) e pelo painel da logística (solicitacoes-ui.js):
 * tabela de tipos (rótulos, campos, prazos), status, etapas do pedido e alguns ícones a mais. JavaScript puro, sem nada de fora.
 * Carregue DEPOIS de central-ui.js e ANTES de vendedoras.js / prioridades.js (os ícones novos entram em Central.icone). */
(function (root) {
  'use strict';
  const C = root.Central;
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------- ícones a mais (mesmo traço dos ícones da Central) ---------- */
  const EXTRAS = {
    ban: [['c', 12, 12, 10], ['p', 'm4.9 4.9 14.2 14.2']],
    pausa: [['r', 6, 4, 4, 16, 1], ['r', 14, 4, 4, 16, 1]],
    troca: [['p', 'm17 2 4 4-4 4'], ['p', 'M3 11V9a3 3 0 0 1 3-3h15'], ['p', 'm7 22-4-4 4-4'], ['p', 'M21 13v2a3 3 0 0 1-3 3H3']],
    lapis: [['p', 'M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z'], ['p', 'm15 5 4 4']],
    grafico: [['p', 'M3 3v18h18'], ['p', 'm7 15 4-4 3 3 5-6']],
    imprimir: [['p', 'M6 9V2h12v7'], ['p', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2'], ['r', 6, 14, 12, 8, 1]],
    voltar: [['p', 'm12 19-7-7 7-7'], ['p', 'M19 12H5']],
    pino: [['p', 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z'], ['c', 12, 10, 3]],
    chave: [['p', 'm21 2-9.6 9.6'], ['c', 7.5, 15.5, 5.5], ['p', 'm15.5 7.5 3 3L22 7l-3-3']]
  };
  function desenhar(nome, extra) {
    const svg = root.document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ic' + (extra ? ' ' + extra : '')); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    for (const it of EXTRAS[nome]) {
      const el = root.document.createElementNS(NS, it[0] === 'p' ? 'path' : it[0] === 'c' ? 'circle' : 'rect');
      if (it[0] === 'p') el.setAttribute('d', it[1]);
      else if (it[0] === 'c') { el.setAttribute('cx', it[1]); el.setAttribute('cy', it[2]); el.setAttribute('r', it[3]); }
      else { el.setAttribute('x', it[1]); el.setAttribute('y', it[2]); el.setAttribute('width', it[3]); el.setAttribute('height', it[4]); el.setAttribute('rx', it[5]); }
      svg.appendChild(el);
    }
    return svg;
  }
  // Acrescenta os ícones novos sem mexer nos que já existem.
  if (C && !C.iconesSolicitacoes) {
    const original = C.icone;
    C.icone = (nome, extra) => (EXTRAS[nome] ? desenhar(nome, extra) : original(nome, extra));
    C.iconesSolicitacoes = true;
  }
  const ic = (nome, extra) => C.icone(nome, extra);

  /* ---------- tipos (o servidor também valida; esta tabela é só para a tela) ---------- */
  // Filiais (nomes dos armazéns de pedidos, usados na consulta de estoque): mesma lista do resto do app (ARMAZENS_GERAL em server.js).
  const FILIAIS = ['Cambuci', 'Tambore', 'BH', 'CE', 'DF', 'RJ'];
  const FILIAIS_ROTULO = { Cambuci: 'Cambuci', Tambore: 'Tamboré', BH: 'BH', CE: 'CE', DF: 'DF', RJ: 'RJ' };
  // Código da filial no Protheus (só para mostrar; o servidor aceita a chave, o nome ou o código): Cambuci 01, Tamboré 03; as demais só têm a sigla.
  const FILIAIS_COD = { Cambuci: '01', Tambore: '03' };
  // Armazéns oferecidos quando a lista da logística não carregou (reserva). A lista de verdade vem de /api/vendedoras/armazens, por filial, e o servidor
  // recusa qualquer armazém que não esteja nela: não existe mais campo livre para digitar armazém.
  const ARMAZENS = ['01', '02'];
  const ROTULO_TRANSF = { entre_armazens: 'Entre armazéns', entre_filiais: 'Entre filiais' };
  const AREAS = { estoque: 'Estoque', expedicao: 'Expedição', faturamento: 'Faturamento' };
  const GRUPOS = { pedido: 'Mexer em um pedido', outros: 'Estoque e outros assuntos' };
  // Listas de escolha dos tipos novos: [valor, rótulo]. O servidor confere o valor; aqui é só o texto na tela.
  const ENUMS = {
    motivoSair: [['cliente_aguardando', 'Cliente aguardando'], ['prazo_combinado', 'Prazo combinado com o cliente'], ['cliente_importante', 'Cliente importante'], ['erro_nosso', 'Erro nosso'], ['retirada', 'Cliente vai retirar'], ['outro', 'Outro (explique no recado)']],
    modoSaida: [['retirada', 'Retirada (alguém vem buscar)'], ['sedex', 'Sedex'], ['motoboy', 'Motoboy urgente (precisa de aprovação)'], ['outra_transportadora', 'Outra transportadora'], ['saida_filial', 'Saída pela filial']],
    subtipoNf: [['cancelada', 'Nota cancelada'], ['corrigir', 'Corrigir a nota'], ['segunda_via', '2ª via da nota'], ['enviar_cliente', 'Enviar a nota ao cliente']],
    acaoFalta: [['esperar', 'Esperar chegar o item'], ['cortar', 'Cortar o item do pedido'], ['substituir', 'Substituir por outro produto']],
    modoErro: [['erro', 'Há um erro no pedido'], ['revisao', 'Preciso de uma revisão']]
  };
  const rotuloEnum = (lista, v) => { const x = lista.find((y) => y[0] === v); return x ? x[1] : String(v == null ? '' : v); };
  const TIPOS = {
    cancelar_pedido: { rotulo: 'Cancelar pedido', completo: 'Cancelar pedido (não separar)', frase: 'O cliente desistiu? A logística para antes de separar.', icone: 'ban', tom: 'urg', grupo: 'pedido', pedido: true, lote: true, area: 'estoque', sla: 30,
      campos: [{ id: 'motivo', rotulo: 'Por que cancelar?', tipo: 'area', obrig: true, max: 300, dica: 'Ex.: o cliente desistiu da compra.' }] },
    segurar_pedido: { rotulo: 'Segurar pedido', completo: 'Segurar pedido (não separar/despachar)', frase: 'Pare a separação ou o envio até o cliente confirmar.', icone: 'pausa', tom: 'alta', grupo: 'pedido', pedido: true, lote: true, area: 'estoque', sla: 60,
      campos: [{ id: 'motivo', rotulo: 'Por que segurar?', tipo: 'area', obrig: true, max: 300, dica: 'Ex.: o cliente vai confirmar o endereço.' }, { id: 'ate', rotulo: 'Segurar até quando? (opcional)', tipo: 'data' }] },
    alterar_pedido: { rotulo: 'Alterar pedido', completo: 'Alterar pedido (itens/quantidade/endereço)', frase: 'Mudar itens, quantidade ou endereço de entrega.', icone: 'lapis', tom: 'azul', grupo: 'pedido', pedido: true, lote: true, area: 'expedicao', sla: 120,
      campos: [{ id: 'o_que', rotulo: 'O que precisa mudar?', tipo: 'area', obrig: true, max: 300, dica: 'Diga o que sai e o que entra. Ex.: trocar 2 un do item A por 2 un do item B.' }] },
    nota_fiscal: { rotulo: 'Nota fiscal', completo: 'Nota fiscal (reemitir/enviar/corrigir)', frase: 'Reemitir, enviar ao cliente ou corrigir a nota.', icone: 'nota', tom: 'azul', grupo: 'pedido', pedido: true, lote: true, area: 'faturamento', sla: 120,
      campos: [{ id: 'subtipo', rotulo: 'Que tipo de pedido sobre a nota? (opcional)', tipo: 'enum', opcoes: ENUMS.subtipoNf }, { id: 'o_que', rotulo: 'O que fazer com a nota?', tipo: 'area', obrig: true, max: 300, dica: 'Ex.: enviar a nota por e-mail para o cliente.' }] },
    transferencia_peca: { rotulo: 'Transferência de peça', completo: 'Transferência de peça', frase: 'Levar peças de um armazém ou filial para outro.', icone: 'troca', tom: 'azul', grupo: 'outros', pedido: false, area: 'estoque', sla: 240, especial: 'transferencia', campos: [] },
    consulta_estoque: { rotulo: 'Consulta de estoque', completo: 'Consulta de estoque', frase: 'Tem a peça? Em qual filial?', icone: 'busca', tom: 'azul', grupo: 'outros', pedido: false, area: 'estoque', sla: 60,
      campos: [{ id: 'produto', rotulo: 'Peça (código ou nome)', tipo: 'peca', obrig: true, max: 80, dica: 'Digite o código ou parte do nome e escolha na lista.' }, { id: 'qt', rotulo: 'Quantidade que precisa', tipo: 'numero', obrig: true, min: 1, max: 99999 },
        { id: 'filial', rotulo: 'Filial (se souber)', tipo: 'filial' }] },
    outro: { rotulo: 'Outro assunto', completo: 'Outro assunto', frase: 'Algo que não está nas opções ao lado.', icone: 'comentario', tom: 'neutro', grupo: 'outros', pedido: false, area: 'expedicao', sla: 240,
      campos: [{ id: 'texto', rotulo: 'Conte o que você precisa', tipo: 'area', obrig: true, max: 500, dica: 'Escreva tudo que a equipe precisa para agir, sem depender de outra mensagem.' }] }
  };
  // Tipos da central unificada (tela "Início"): o servidor também os conhece (solicitacoes-store.js).
  Object.assign(TIPOS, {
    sair_hoje: { rotulo: 'Sair hoje', completo: 'Sair hoje (pressa, liberar, prioridade)', frase: 'O pedido precisa sair logo.', icone: 'raio', tom: 'urg', grupo: 'pedido', pedido: true, lote: true, area: 'estoque', sla: 60,
      campos: [{ id: 'motivo', rotulo: 'Motivo', tipo: 'enum', obrig: true, opcoes: ENUMS.motivoSair }] },
    saida_especial: { rotulo: 'Como vai sair', completo: 'Saída especial (retirada, Sedex, motoboy, outra transportadora, saída pela filial)', frase: 'Combinar como o pedido sai.', icone: 'caminhao', tom: 'alta', grupo: 'pedido', pedido: true, lote: true, area: 'expedicao', sla: 60,
      campos: [{ id: 'modo', rotulo: 'Como vai sair', tipo: 'enum', obrig: true, opcoes: ENUMS.modoSaida }, { id: 'quem', rotulo: 'Quem retira', tipo: 'texto', max: 80 }, { id: 'dia', rotulo: 'Dia da retirada', tipo: 'data' }, { id: 'hora', rotulo: 'Hora da retirada', tipo: 'hora' },
        { id: 'transportadora', rotulo: 'Transportadora', tipo: 'texto', max: 60 }, { id: 'filial', rotulo: 'Filial de saída', tipo: 'filial' }, { id: 'detalhe', rotulo: 'Detalhe', tipo: 'area', max: 300 }] },
    subir_pedido: { rotulo: 'Subir um pedido', completo: 'Subir um pedido (PV)', frase: 'Pedir para lançar um PV no sistema.', icone: 'enviar', tom: 'azul', grupo: 'outros', pedido: false, area: 'faturamento', sla: 120,
      campos: [{ id: 'pv', rotulo: 'Número do PV', tipo: 'texto', obrig: true, max: 30 }, { id: 'filial', rotulo: 'Filial', tipo: 'filial' }, { id: 'onde', rotulo: 'Onde está o PV', tipo: 'area', obrig: true, max: 300, dica: 'Ex.: no e-mail enviado hoje, na pasta Vendas, neste link.' }] },
    falta_item: { rotulo: 'Falta de item', completo: 'Falta de item', frase: 'Faltou peça no pedido.', icone: 'pacote', tom: 'alta', grupo: 'pedido', pedido: true, lote: true, area: 'estoque', sla: 60,
      campos: [{ id: 'acao', rotulo: 'O que fazer com o item', tipo: 'enum', obrig: true, opcoes: ENUMS.acaoFalta }, { id: 'detalhe', rotulo: 'Substituir por', tipo: 'texto', max: 300 }] },
    erro_pedido: { rotulo: 'Erro ou revisão', completo: 'Erro ou revisão do pedido', frase: 'Algo errado no pedido.', icone: 'alerta', tom: 'alta', grupo: 'pedido', pedido: true, lote: true, area: 'expedicao', sla: 120,
      campos: [{ id: 'modo', rotulo: 'É um erro ou uma revisão', tipo: 'enum', obrig: true, opcoes: ENUMS.modoErro }, { id: 'o_que', rotulo: 'O que está errado ou precisa ser revisado', tipo: 'area', obrig: true, max: 500 }] }
  });
  Object.setPrototypeOf(TIPOS, null);
  const ORDEM_TIPOS = Object.keys(TIPOS);
  const tipoDe = (l) => TIPOS[l && l.tipo] || { rotulo: (l && l.tipo) || 'Solicitação', completo: (l && l.tipo) || 'Solicitação', frase: '', icone: 'comentario', tom: 'neutro', grupo: 'outros', pedido: false, area: 'expedicao', sla: 240, campos: [] };

  const STATUS = { recebida: 'Recebida', em_analise: 'Em análise', em_andamento: 'Em andamento', concluida: 'Concluída', negada: 'Negada', aguardando_aprovacao: 'Aguardando aprovação' };
  const ATIVOS = ['recebida', 'em_analise', 'em_andamento', 'aguardando_aprovacao'];
  const PRIORIDADE = { normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
  const PESO = { urgente: 2, alta: 1, normal: 0 };
  const ETAPA = { nao_separado: 'Ainda não separado', em_separacao: 'Em separação', separado: 'Já separado', conferido: 'Já conferido', faturado: 'Já faturado', despachado: 'Já despachado', nao_achado: 'Não encontrado no SC9' };
  const ACAO = { criar: 'Solicitação enviada', status: 'Status', assumir: 'Assumiu', interno: 'Comentário interno', prioridade: 'Prioridade', area: 'Área' };

  /* ---------- "Para quando?" (opcional; Prioridade e Solicitar usam o mesmo campo) ---------- */
  const PARA_QUANDO = [['hoje_coleta', 'Hoje, antes da coleta'], ['hoje_16h', 'Hoje, até as 16h'], ['amanha', 'Amanhã'], ['data', 'Escolher data']];
  const dataBR2 = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) : '');
  // Texto de um paraQuando que veio do servidor ({ tipo, data }).
  const paraQuandoTxt = (pq) => {
    if (!pq || typeof pq !== 'object' || !pq.tipo) return '';
    if (pq.tipo === 'data') return 'Até ' + (pq.data ? dataBR2(pq.data) + '/' + pq.data.slice(0, 4) : 'data não informada');
    const r = PARA_QUANDO.find((x) => x[0] === pq.tipo);
    return r ? r[1] + (pq.data ? ' (' + dataBR2(pq.data) + ')' : '') : '';
  };
  // Confere o que ela escolheu: '' se está bom (ou vazio), senão o texto do problema. pq = { tipo:'', data:'' }.
  function erroParaQuando(pq, hojeISO) {
    if (!pq || !pq.tipo) return '';
    if (pq.tipo === 'data') { if (!pq.data) return 'Escolha a data em "Para quando" ou toque de novo na opção para tirar.'; if (hojeISO && pq.data < hojeISO) return 'A data de "Para quando" não pode ser no passado.'; }
    return '';
  }
  const corpoParaQuando = (pq) => (pq && pq.tipo ? (pq.tipo === 'data' ? { tipo: 'data', data: pq.data } : { tipo: pq.tipo }) : undefined);
  // Chips "Para quando?": toque numa opção para marcar, toque de novo para tirar. pq é o objeto { tipo, data } do formulário; aoMudar() redesenha.
  function campoParaQuando(pq, aoMudar, idBase, hojeISO, opcoes) {
    const h = C.h, id = idBase || 'pq', lista = opcoes && opcoes.semData ? PARA_QUANDO.filter((x) => x[0] !== 'data') : PARA_QUANDO;
    return h('div', { class: 'sol-pq' }, h('span', { class: 'rotulo', id: id + '-rot', text: 'Para quando? (opcional)' }),
      h('div', { class: 'sol-chips', role: 'group', 'aria-labelledby': id + '-rot' }, lista.map(([v, t]) => h('button', { class: 'chip', type: 'button', id: id + '-' + v, 'aria-pressed': String(pq.tipo === v), onclick: () => { pq.tipo = pq.tipo === v ? '' : v; if (pq.tipo !== 'data') pq.data = ''; aoMudar(); } }, t))),
      pq.tipo === 'data' ? h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: id + '-data', text: 'Data' }), h('input', { id: id + '-data', class: 'entrada', type: 'date', min: hojeISO || null, value: pq.data || '', onchange: (ev) => { pq.data = ev.target.value; } })) : null,
      h('p', { class: 'dica', text: 'Ajuda a logística a ordenar a fila. Não é uma promessa de horário.' }));
  }

  /* ---------- textos e números ---------- */
  const minTxt = (min) => {
    min = Math.max(0, Math.round(Number(min) || 0));
    const d = Math.floor(min / 1440), hh = Math.floor((min % 1440) / 60), m = min % 60;
    if (d >= 1) return d + (d === 1 ? ' dia' : ' dias') + (hh ? ' ' + hh + ' h' : '');
    if (hh >= 1) return hh + ' h' + (m ? ' ' + m + ' min' : '');
    return m + ' min';
  };
  const dataCurtaISO = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : iso || '');
  const soDigitos = (t) => String(t || '').replace(/\D/g, '');
  const pedidoValido = (t) => { const p = soDigitos(t); return p.length >= 4 && p.length <= 10 ? p : ''; };

  // Os dados que a vendedora preencheu, com os rótulos de cada campo, em ordem: [[rótulo, valor], ...]
  function dadosLegiveis(l) {
    const t = tipoDe(l), d = (l && l.dados) || {}, saida = [];
    for (const c of t.campos) {
      let v = d[c.id];
      if (v == null || v === '') continue;
      if (c.tipo === 'data') v = dataCurtaISO(String(v));
      if (c.tipo === 'filial') v = nomeFilial(v);
      if (c.tipo === 'enum') v = rotuloEnum(c.opcoes || [], v);
      if (c.tipo === 'numero') v = String(v) + (Number(v) === 1 ? ' peça' : ' peças');
      saida.push([c.rotulo.replace(/ \(opcional\)| \(se souber\)/, '').replace(/\?$/, ''), String(v)]);
    }
    return saida;
  }
  // Uma frase curta para a lista (sem o protocolo): o que é, em poucas palavras.
  function resumo(l) {
    const d = (l && l.dados) || {};
    switch (l && l.tipo) {
      case 'transferencia_peca': { const t = totaisTransf(d.itens); return d.origem && d.destino ? plural(t.produtos, 'produto', 'produtos') + ' · ' + plural(t.pecas, 'peça', 'peças') + ' · ' + localCurto(d.origem) + ' para ' + localCurto(d.destino) : l.texto || ''; }
      case 'consulta_estoque': return [d.qt ? d.qt + ' un' : '', d.produto, d.filial].filter(Boolean).join(' · ');
      case 'cancelar_pedido': case 'segurar_pedido': return d.motivo || l.texto || '';
      case 'alterar_pedido': return d.o_que || l.texto || '';
      case 'nota_fiscal': return [d.subtipo ? rotuloEnum(ENUMS.subtipoNf, d.subtipo) : '', d.o_que].filter(Boolean).join(' · ') || l.texto || '';
      case 'sair_hoje': return [rotuloEnum(ENUMS.motivoSair, d.motivo), l.texto].filter(Boolean).join(' · ');
      case 'saida_especial': return [rotuloEnum(ENUMS.modoSaida, d.modo), d.quem, d.transportadora, d.filial ? nomeFilial(d.filial) : '', d.dia ? dataCurtaISO(d.dia) + (d.hora ? ' ' + d.hora : '') : ''].filter(Boolean).join(' · ');
      case 'subir_pedido': return ['PV ' + (d.pv || ''), d.onde].filter(Boolean).join(' · ');
      case 'falta_item': return [rotuloEnum(ENUMS.acaoFalta, d.acao), d.itens && d.itens.length ? plural(d.itens.length, 'produto', 'produtos') : '', d.detalhe].filter(Boolean).join(' · ');
      case 'erro_pedido': return [rotuloEnum(ENUMS.modoErro, d.modo), d.o_que].filter(Boolean).join(' · ');
      default: return d.texto || l.texto || '';
    }
  }
  // Aviso colorido sobre o pedido de cancelar/segurar: ainda dá tempo ou não.

  /* ---------- transferência: funções puras (sem tela), usadas pela vendedora, pela logística e nos testes ---------- */
  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
  const norm = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const nomeFilial = (chave) => { const k = Object.keys(FILIAIS_ROTULO).find((x) => norm(x) === norm(chave) || norm(FILIAIS_ROTULO[x]) === norm(chave)); return k ? FILIAIS_ROTULO[k] : String(chave || ''); };
  const chaveFilial = (nome) => Object.keys(FILIAIS_ROTULO).find((x) => norm(x) === norm(nome) || norm(FILIAIS_ROTULO[x]) === norm(nome)) || String(nome || '');
  const nomeDe = (l) => (l && typeof l === 'object' ? l.nome || nomeFilial(l.filial) : '');
  // Local da transferência: { filial:'Cambuci', armazem:'01' } (o servidor devolve também nome e codigo). Rótulo: "Tamboré 01".
  const localCurto = (l) => (l && typeof l === 'object' ? nomeDe(l) + ' ' + (l.armazem || '?') : String(l || ''));
  const localLongo = (l) => (l && typeof l === 'object' ? nomeDe(l) + ' (armazém ' + (l.armazem || '?') + ')' : String(l || ''));
  const armNorm = (a) => { const t = String(a == null ? '' : a).trim().toUpperCase(); return /^\d$/.test(t) ? '0' + t : t; };
  const mesmaFilial = (a, b) => Boolean(a && b && a.filial && norm(chaveFilial(a.filial)) === norm(chaveFilial(b.filial)));
  const mesmoLocal = (a, b) => mesmaFilial(a, b) && armNorm(a.armazem) === armNorm(b.armazem);
  const tipoDaTransf = (origem, destino) => (mesmaFilial(origem, destino) ? 'entre_armazens' : 'entre_filiais');
  const totaisTransf = (itens) => { const l = Array.isArray(itens) ? itens : []; return { produtos: l.length, pecas: l.reduce((s, i) => s + (Number(i && i.qt) || 0), 0) }; };
  // Saldo do produto naquele local (filial+armazém) a partir de saldos[] da busca; null = sem informação de saldo.
  function saldoNoLocal(prod, local) {
    if (!prod || prod.saldoDisponivel === false || !local) return null;
    if (prod.saldoOrigem !== undefined && prod.saldoOrigem !== null && prod.__origem && mesmoLocal(prod.__origem, local)) return Number(prod.saldoOrigem) || 0;
    const lista = Array.isArray(prod.saldos) ? prod.saldos : [];
    if (!lista.length) return prod.saldoDisponivel ? 0 : null;
    return lista.filter((x) => mesmoLocal(x, local)).reduce((s, x) => s + (Number(x.saldo) || 0), 0);
  }
  // Lotes que existem naquele local, com saldo, os que vencem primeiro no topo.
  function lotesNoLocal(prod, local) {
    const lista = prod && Array.isArray(prod.lotes) ? prod.lotes : [];
    return lista.filter((x) => local && mesmoLocal(x, local) && Number(x.saldo) > 0)
      .sort((a, b) => String(a.validade || '9999').localeCompare(String(b.validade || '9999')) || String(a.lote).localeCompare(String(b.lote)));
  }
  // Quanto há disponível para o item: do lote escolhido, ou do local inteiro. null = não sei.
  function saldoDoItem(item, local) {
    if (!item || !item.produto) return null;
    if (item.lote) { const l = lotesNoLocal(item.produto, local).find((x) => x.lote === item.lote); return l ? Number(l.saldo) || 0 : null; }
    return saldoNoLocal(item.produto, local);
  }
  const acimaDoSaldo = (item, local) => { const s = saldoDoItem(item, local), q = Number(item && item.qt); return s != null && Number.isFinite(q) && q > s; };
  const validadeCurta = (iso) => (iso && /^\d{4}-\d{2}/.test(iso) ? iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
  // Confere a transferência antes de enviar (o servidor confere de novo). Devolve o texto do 1º problema, ou ''.
  function validarTransf(t, hojeISO) {
    if (!t.origem.filial || !t.origem.armazem) return 'Escolha a filial e o armazém de origem.';
    if (!t.destino.filial || !t.destino.armazem) return 'Escolha a filial e o armazém de destino.';
    if (mesmoLocal(t.origem, t.destino)) return 'A origem e o destino precisam ser diferentes.';
    if (!t.itens.length || t.itens.length > 30) return 'Inclua de 1 a 30 produtos.';
    const vistos = new Set();
    for (let i = 0; i < t.itens.length; i++) {
      const it = t.itens[i], n = i + 1;
      if (!it.produto) return 'Produto ' + n + ': escolha a peça na lista de sugestões.';
      const q = Number(it.qt);
      if (!/^\d+$/.test(String(it.qt || '')) || q < 1 || q > 99999) return 'Produto ' + n + ' (' + it.produto.codigo + '): digite uma quantidade inteira de 1 a 99999.';
      const chave = it.produto.codigo + '|' + (it.lote || '');
      if (vistos.has(chave)) return 'O produto ' + it.produto.codigo + (it.lote ? ' (lote ' + it.lote + ')' : '') + ' está repetido. Junte as quantidades em uma linha só.';
      vistos.add(chave);
    }
    if (t.prazo && hojeISO && t.prazo < hojeISO) return 'O prazo não pode ser uma data que já passou.';
    if (t.motivo && t.motivo.length > 300) return 'O motivo aceita até 300 letras.';
    return '';
  }
  // O que vai no corpo do envio. A descrição NÃO vai: quem preenche é o servidor, a partir do catálogo.
  function corpoTransf(t) {
    const dados = { itens: t.itens.map((i) => { const o = { produto: i.produto.codigo, qt: Number(i.qt) }; if (i.lote) o.lote = i.lote; return o; }),
      origem: { filial: t.origem.filial, armazem: t.origem.armazem }, destino: { filial: t.destino.filial, armazem: t.destino.armazem } };
    if (t.prazo) dados.prazo = t.prazo;
    if (t.motivo && t.motivo.trim()) dados.motivo = t.motivo.trim();
    return dados;
  }
  const textoRevisao = (t) => { const x = totaisTransf(t.itens); return 'Você está pedindo transferir ' + plural(x.produtos, 'produto', 'produtos') + ', ' + plural(x.pecas, 'peça', 'peças') + ', de ' + localLongo(t.origem) + ' para ' + localLongo(t.destino) + '.'; };


  /* ---------- peças de tela da transferência (iguais para a vendedora e para a logística) ---------- */
  // Origem -> destino em destaque, com o selo "entre armazéns" / "entre filiais".
  function rotaTransf(dados) {
    const h = C.h, d = dados || {}, tipo = d.tipoTransferencia || tipoDaTransf(d.origem, d.destino);
    const ponta = (rot, l) => h('div', { class: 'sol-ponta' }, h('span', { class: 'sol-ponta-rot', text: rot }), h('b', { text: l && typeof l === 'object' ? nomeDe(l) : String(l || '—') }), h('span', { class: 'sol-ponta-arm', text: l && typeof l === 'object' ? 'Armazém ' + (l.armazem || '?') : '' }));
    return h('div', { class: 'sol-rota', role: 'group', 'aria-label': 'Origem e destino' }, ponta('Sai de', d.origem), h('span', { class: 'sol-rota-seta' }, ic('seta')), ponta('Vai para', d.destino), h('span', { class: 'sol-selo-tipo tipo-' + tipo, text: ROTULO_TRANSF[tipo] || '' }));
  }
  // Tabela dos itens: código, descrição, lote, quantidade e (equipe) saldo na origem com alerta. Vira lista de cartões no celular.
  function tabelaItens(dados, opcoes) {
    const h = C.h, op = opcoes || {}, itens = (dados && dados.itens) || [];
    const cel = (rot, filho, cls) => h('td', { 'data-rot': rot, class: cls || null }, filho);
    return h('div', { class: 'sol-tabela-caixa' }, h('table', { class: 'sol-tabela' + (op.saldo ? ' com-saldo' : '') },
      h('thead', null, h('tr', null, h('th', { text: 'Código' }), h('th', { text: 'Descrição' }), op.semLote ? null : h('th', { text: 'Lote' }), h('th', { class: 'dir', text: 'Quantidade' }), op.saldo ? h('th', { class: 'dir', text: 'Saldo na origem' }) : null)),
      h('tbody', null, itens.map((i) => h('tr', { class: i.acimaDoSaldo ? 'acima' : null },
        cel('Código', h('b', { class: 'num', text: String(i.produto || '') })),
        cel('Descrição', String(i.descricao || '—')),
        op.semLote ? null : cel('Lote', i.lote ? String(i.lote) : h('span', { class: 'mudo', text: 'Qualquer' })),
        cel('Quantidade', h('b', { class: 'num', text: String(i.qt) }), 'dir'),
        op.saldo ? cel('Saldo na origem', i.saldoOrigem == null ? h('span', { class: 'mudo', text: 'Não informado' }) : [h('span', { class: 'num', text: String(i.saldoOrigem) }), i.acimaDoSaldo ? h('span', { class: 'sol-alerta-saldo' }, ic('alerta'), 'Pediu mais que o saldo') : null], 'dir') : null)))));
  }

  // Pedidos de uma solicitação em lote: [{ pedido, etapa, naoAchado, concluido }]. Texto de progresso: "2 de 5 atendidos".
  const progressoLote = (l) => { const p = (l && l.pedidos) || []; return p.length > 1 ? p.filter((x) => x.concluido).length + ' de ' + p.length + ' atendidos' : ''; };
  const etapaTom = (l) => (l && l.aTempo ? 'ok' : l && l.etapa === 'nao_achado' ? 'info' : 'tarde');

  root.SolComum = { ENUMS, rotuloEnum, progressoLote, PARA_QUANDO, paraQuandoTxt, erroParaQuando, corpoParaQuando, campoParaQuando, ic, norm, chaveFilial, nomeDe, armNorm, mesmaFilial, FILIAIS, FILIAIS_ROTULO, FILIAIS_COD, ARMAZENS, ROTULO_TRANSF, plural, nomeFilial, localCurto, localLongo, mesmoLocal, tipoDaTransf, totaisTransf, saldoNoLocal, lotesNoLocal, saldoDoItem, acimaDoSaldo, validadeCurta, validarTransf, corpoTransf, textoRevisao, rotaTransf, tabelaItens, AREAS, GRUPOS, TIPOS, ORDEM_TIPOS, tipoDe, STATUS, ATIVOS, PRIORIDADE, PESO, ETAPA, ACAO, minTxt, dataCurtaISO, soDigitos, pedidoValido, dadosLegiveis, resumo, etapaTom };
})(window);
