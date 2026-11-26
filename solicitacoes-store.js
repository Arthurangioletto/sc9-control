/* Central de solicitações das vendedoras: pedido de ajuda à logística que pode ou não ter pedido (cancelar/segurar pedido, transferência de peça,
 * consulta de estoque, alterar pedido, nota fiscal, outro assunto). Lista compartilhada em solicitacoes-vendedoras.json.
 * É separada das prioridades e dos avisos: nada daqueles arquivos é lido nem gravado aqui.
 * Cada linha: { id, protocolo, tipo, pedido, dados{}, texto, prioridade, etapa, aTempo, pedidoPor, conta, filial, area, status, resposta,
 *               responsavel, respondidoPor, naoAchado, criadoEm, primeiraRespostaEm, concluidaEm, atualizadoEm, historico[] }.
 * O histórico só cresce (quem, quando, o quê). Só validação e mesclagem, sem acesso a disco. */
'use strict';
const { numeroDoPedido } = require('./prioridades-store.js');

const MAX_LINHAS = 5000;
const MAX_HISTORICO = 60;
const LIMITE_POR_DIA = 15; // solicitações por vendedora (login ou nome) em 24 h
const DIAS_PARA_LIMPAR = 120; // só as concluídas/negadas; as ativas nunca somem
const FUSO = 'America/Sao_Paulo';

// tipo -> rótulo, se exige número de pedido, área padrão e prazo (minutos) para a 1ª resposta da equipe
const TIPOS = {
  cancelar_pedido: { rotulo: 'Cancelar pedido (não separar)', pedido: true, area: 'estoque', sla: 30 },
  segurar_pedido: { rotulo: 'Segurar pedido (não separar/despachar)', pedido: true, area: 'estoque', sla: 60 },
  transferencia_peca: { rotulo: 'Transferência de peça', pedido: false, area: 'estoque', sla: 240 },
  consulta_estoque: { rotulo: 'Consulta de estoque', pedido: false, area: 'estoque', sla: 60 },
  alterar_pedido: { rotulo: 'Alterar pedido (itens/quantidade/endereço)', pedido: true, area: 'expedicao', sla: 120 },
  nota_fiscal: { rotulo: 'Nota fiscal (reemitir/enviar/corrigir)', pedido: true, area: 'faturamento', sla: 120 },
  outro: { rotulo: 'Outro assunto', pedido: false, area: 'expedicao', sla: 240 }
};
Object.setPrototypeOf(TIPOS, null); // "constructor", "__proto__" etc. não contam como tipo
const TIPOS_IDS = Object.keys(TIPOS);
const AREAS = ['estoque', 'expedicao', 'faturamento'];
const AREAS_ROTULO = { estoque: 'Estoque', expedicao: 'Expedição', faturamento: 'Faturamento' };
const STATUS = ['recebida', 'em_analise', 'em_andamento', 'concluida', 'negada'];
const ATIVOS = ['recebida', 'em_analise', 'em_andamento'];
const FINAIS = ['concluida', 'negada'];
const PRIORIDADES = ['normal', 'alta', 'urgente'];
const PESO_PRIORIDADE = { normal: 0, alta: 1, urgente: 2 };
const ETAPAS = ['nao_separado', 'em_separacao', 'separado', 'conferido', 'faturado', 'despachado', 'nao_achado'];
const ACOES_HIST = ['criado', 'status', 'assumir', 'interno', 'prioridade', 'area'];
// Filiais: a chave é o mesmo nome de armazém que o resto do SC9 usa (ARMAZENS_GERAL em server.js: "Tambore" sem acento).
// codigo = código da filial no Protheus (Cambuci = 01, Tamboré = 03); BH, CE, DF e RJ o app só conhece pela sigla, então a sigla é o código.
const FILIAIS_INFO = [
  { chave: 'Cambuci', codigo: '01', nome: 'Cambuci' }, { chave: 'Tambore', codigo: '03', nome: 'Tamboré' },
  { chave: 'BH', codigo: 'BH', nome: 'BH' }, { chave: 'CE', codigo: 'CE', nome: 'CE' }, { chave: 'DF', codigo: 'DF', nome: 'DF' }, { chave: 'RJ', codigo: 'RJ', nome: 'RJ' }
];
const FILIAIS = FILIAIS_INFO.map((f) => f.chave);
const FILIAIS_ROTULO = Object.fromEntries(FILIAIS_INFO.map((f) => [f.chave, f.nome]));
const MAX_ITENS_TRANSFERENCIA = 30;

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const dataHora = (v) => { const s = texto(v, 30); return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : ''; };
const diaSP = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: FUSO });
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

let contador = 0;
const novoId = (agora) => 's' + Number(agora || Date.now()).toString(36) + (contador++ % 1296).toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);

// ---- campos de cada tipo (dados{}) ---------------------------------------------------------------------------------------------------
const C = {
  motivo: (obrig) => ({ k: 'motivo', t: 'texto', max: 300, obrig, nome: 'o motivo' }),
  produto: { k: 'produto', t: 'texto', max: 80, obrig: true, nome: 'o produto (código ou nome)' },
  qt: { k: 'qt', t: 'int', obrig: true, nome: 'a quantidade' },
  data: (k, nome) => ({ k, t: 'data', obrig: false, nome }),
  filial: (k, obrig, nome) => ({ k, t: 'filial', obrig, nome }),
  oque: { k: 'o_que', t: 'texto', max: 500, obrig: true, nome: 'o que precisa ser feito' }
};
const CAMPOS = {
  cancelar_pedido: [C.motivo(true)],
  segurar_pedido: [C.motivo(true), C.data('ate', 'a data (até quando segurar)')],
  transferencia_peca: [], // formato próprio (itens, origem, destino): ver dadosTransferencia
  consulta_estoque: [C.produto, C.qt, C.filial('filial', false, 'a filial')],
  alterar_pedido: [C.oque],
  nota_fiscal: [C.oque],
  outro: []
};

const semZeros = (v) => (/^\d+$/.test(v) ? String(Number(v)) : v);
// Aceita a chave, o nome ou o código da filial ("Tambore", "Tamboré", "03", "3", "bh").
function filialDe(v) {
  const q = semAcento(texto(v, 40));
  if (!q) return '';
  const f = FILIAIS_INFO.find((x) => semAcento(x.chave) === q || semAcento(x.nome) === q || semZeros(x.codigo.toLowerCase()) === semZeros(q));
  return f ? f.chave : '';
}
// Armazém: "1" e "01" são o mesmo lugar; letras ficam em maiúsculas (ex.: "ZZ2"). Até 6 caracteres.
function armazemDe(v) {
  const s = texto(typeof v === 'number' ? String(v) : v, 10).toUpperCase().replace(/\s+/g, '');
  if (!/^[0-9A-Z]{1,6}$/.test(s)) return '';
  return /^\d+$/.test(s) ? String(Number(s)).padStart(2, '0') : s;
}
const rotuloLocal = (l) => (l && l.filial ? (FILIAIS_ROTULO[l.filial] || l.filial) + (l.armazem ? ' ' + l.armazem : '') : '');
function dataValida(v) {
  const s = texto(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : '';
}
function inteiro(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\s*\d{1,6}\s*$/.test(v)) return Number(v);
  return null;
}
const somaDias = (dia, n) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---- transferência de peça (itens + origem + destino) -----------------------------------------------------------------------------------
// dados = { itens:[{ produto, descricao, lote, qt, saldoOrigem, acimaDoSaldo }], origem:{ filial, codigo, nome, armazem }, destino:{ ... }, tipoTransferencia,
//           prazo, motivo, totalPecas, totalProdutos, acimaDoSaldo }.
// A descrição e o saldo vêm do servidor (ctx.produto): o que o aparelho mandar nesses campos é ignorado.
function localDe(v, nome, estrito) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const filial = filialDe(o.filial), armazem = armazemDe(o.armazem);
  if (estrito) {
    if (!filial) return { erro: 'Escolha a filial de ' + nome + ' da lista.' };
    if (!armazem) return { erro: 'Informe o armazém de ' + nome + ' (ex.: 01, 02).' };
  }
  if (!filial || !armazem) return { local: null };
  const info = FILIAIS_INFO.find((f) => f.chave === filial);
  return { local: { filial, codigo: info.codigo, nome: info.nome, armazem } };
}
function dadosTransferencia(bruto, estrito, agora, ctx) {
  const o = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  const hoje = diaSP(agora || Date.now());
  const brutos = Array.isArray(o.itens) ? o.itens : [];
  if (estrito) {
    if (!brutos.length) return { erro: 'Inclua pelo menos um produto na transferência.' };
    if (brutos.length > MAX_ITENS_TRANSFERENCIA) return { erro: 'No máximo ' + MAX_ITENS_TRANSFERENCIA + ' produtos por transferência. Faça outra solicitação para o restante.' };
  }
  const org = localDe(o.origem, 'origem', estrito); if (org.erro) return { erro: org.erro };
  const dst = localDe(o.destino, 'destino', estrito); if (dst.erro) return { erro: dst.erro };
  if (estrito && org.local.filial === dst.local.filial && org.local.armazem === dst.local.armazem) return { erro: 'A origem e o destino precisam ser diferentes (mude a filial ou o armazém).' };
  const itens = [], vistos = new Set();
  for (let i = 0; i < Math.min(brutos.length, MAX_ITENS_TRANSFERENCIA); i++) {
    const b = brutos[i] && typeof brutos[i] === 'object' ? brutos[i] : {};
    const produto = texto(b.produto, 40), lote = texto(b.lote, 40), qt = inteiro(b.qt);
    const n = i + 1;
    if (!produto || qt == null || qt < 1 || qt > 99999) {
      if (estrito) return { erro: !produto ? 'Produto ' + n + ': informe o código do produto.' : 'Produto ' + n + ' (' + produto + '): a quantidade deve ser um número inteiro de 1 a 99999.' };
      continue;
    }
    const chave = produto.toLowerCase() + '|' + lote.toLowerCase();
    if (vistos.has(chave)) { if (estrito) return { erro: 'O produto ' + produto + (lote ? ' (lote ' + lote + ')' : '') + ' aparece mais de uma vez. Some as quantidades em uma linha só.' }; continue; }
    vistos.add(chave);
    let descricao = texto(b.descricao, 200), saldoOrigem = Number.isFinite(b.saldoOrigem) ? b.saldoOrigem : null;
    if (estrito) { // não confia no que veio do aparelho: descrição e saldo são os do servidor
      const achou = ctx && typeof ctx.produto === 'function' && org.local ? ctx.produto(produto, { filial: org.local.filial, armazem: org.local.armazem, lote }) : null;
      descricao = achou && achou.descricao ? texto(achou.descricao, 200) : '';
      saldoOrigem = achou && Number.isFinite(achou.saldoOrigem) ? achou.saldoOrigem : null;
    }
    itens.push({ produto, descricao, lote, qt, saldoOrigem, acimaDoSaldo: saldoOrigem != null && qt > saldoOrigem });
  }
  if (estrito && !itens.length) return { erro: 'Inclua pelo menos um produto na transferência.' };
  const prazo = dataValida(o.prazo);
  if (estrito) {
    if (o.prazo != null && String(o.prazo).trim() !== '' && !prazo) return { erro: 'Data inválida no prazo (use o calendário).' };
    if (prazo && prazo < hoje) return { erro: 'O prazo não pode ser no passado.' };
    if (prazo && prazo > somaDias(hoje, 366)) return { erro: 'O prazo está muito distante (no máximo 1 ano).' };
  }
  const motivo = texto(o.motivo, 300);
  if (estrito && motivo && motivo.length < 3) return { erro: 'Explique o motivo (mínimo 3 letras) ou deixe em branco.' };
  if (!org.local || !dst.local || !itens.length) return { dados: {} };
  const dados = {
    itens, origem: org.local, destino: dst.local, tipoTransferencia: org.local.filial === dst.local.filial ? 'entre_armazens' : 'entre_filiais',
    totalPecas: itens.reduce((a, it) => a + it.qt, 0), totalProdutos: itens.length, acimaDoSaldo: itens.some((it) => it.acimaDoSaldo)
  };
  if (prazo) dados.prazo = prazo;
  if (motivo) dados.motivo = motivo;
  return { dados };
}

// Normaliza os dados do tipo. estrito (criação): devolve { erro } no primeiro problema; senão (leitura do arquivo) só limpa, sem reclamar.
function dadosDoTipo(tipo, bruto, estrito, agora, ctx) {
  if (tipo === 'transferencia_peca') return dadosTransferencia(bruto, estrito, agora, ctx);
  const campos = CAMPOS[tipo] || [], origem = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {}, dados = {};
  const hoje = diaSP(agora || Date.now());
  for (const c of campos) {
    const v = origem[c.k];
    let limpo = '';
    if (c.t === 'texto') limpo = texto(v, c.max);
    else if (c.t === 'int') { const n = inteiro(v); limpo = n != null && n >= 1 && n <= 99999 ? n : ''; }
    else if (c.t === 'filial') limpo = filialDe(v);
    else if (c.t === 'data') limpo = dataValida(v);
    const informado = v != null && String(v).trim() !== '';
    if (estrito) {
      if (c.obrig && limpo === '') return { erro: c.t === 'int' ? 'Quantidade: informe um número inteiro de 1 a 99999.' : c.t === 'filial' ? 'Escolha ' + c.nome + ' da lista.' : 'Informe ' + c.nome + '.' };
      if (c.obrig && c.t === 'texto' && limpo.length < 3) return { erro: 'Informe ' + c.nome + ' (mínimo 3 letras).' };
      if (!c.obrig && informado && limpo === '') return { erro: c.t === 'filial' ? 'Escolha ' + c.nome + ' da lista.' : c.t === 'data' ? 'Data inválida em ' + c.nome + ' (use o calendário).' : 'Valor inválido em ' + c.nome + '.' };
      if (c.t === 'data' && limpo) {
        if (limpo < hoje) return { erro: 'A data não pode ser no passado.' };
        if (limpo > somaDias(hoje, 366)) return { erro: 'A data está muito distante (no máximo 1 ano).' };
      }
    }
    if (limpo !== '') dados[c.k] = limpo;
  }
  return { dados };
}

// ---- linha -----------------------------------------------------------------------------------------------------------------------------
function normalizarLinha(x) {
  if (!x || typeof x !== 'object') return null;
  const id = texto(x.id, 40);
  if (!id) return null;
  const tipo = TIPOS[x.tipo] ? x.tipo : 'outro';
  return {
    id, protocolo: texto(x.protocolo, 30), tipo, pedido: numeroDoPedido(x.pedido) || '', dados: dadosDoTipo(tipo, x.dados, false).dados, texto: texto(x.texto, 500),
    prioridade: PRIORIDADES.includes(x.prioridade) ? x.prioridade : 'normal', etapa: ETAPAS.includes(x.etapa) ? x.etapa : '', aTempo: Boolean(x.aTempo),
    pedidoPor: texto(x.pedidoPor, 60), conta: texto(x.conta, 24), filial: texto(x.filial, 40), area: AREAS.includes(x.area) ? x.area : TIPOS[tipo].area,
    status: STATUS.includes(x.status) ? x.status : 'recebida', resposta: texto(x.resposta, 300), responsavel: texto(x.responsavel, 60), respondidoPor: texto(x.respondidoPor, 60),
    naoAchado: Boolean(x.naoAchado), criadoEm: dataHora(x.criadoEm), primeiraRespostaEm: dataHora(x.primeiraRespostaEm), concluidaEm: dataHora(x.concluidaEm), atualizadoEm: dataHora(x.atualizadoEm),
    historico: (Array.isArray(x.historico) ? x.historico : []).slice(-MAX_HISTORICO).map((h) => ({
      em: dataHora(h && h.em), acao: ACOES_HIST.includes(h && h.acao) ? h.acao : 'status', por: texto(h && h.por, 60), texto: texto(h && h.texto, 500),
      status: STATUS.includes(h && h.status) ? h.status : '', prioridade: PRIORIDADES.includes(h && h.prioridade) ? h.prioridade : '', area: AREAS.includes(h && h.area) ? h.area : ''
    }))
  };
}
function normalizarLista(dado) {
  const lista = [], ids = new Set();
  for (const it of (dado && Array.isArray(dado.linhas) ? dado.linhas : [])) {
    const l = normalizarLinha(it);
    if (!l || ids.has(l.id)) continue;
    ids.add(l.id); lista.push(l);
    if (lista.length >= MAX_LINHAS) break;
  }
  return lista;
}
function limpar(linhas, agora) {
  const corte = (agora || Date.now()) - DIAS_PARA_LIMPAR * 864e5;
  return linhas.filter((l) => ATIVOS.includes(l.status) || Date.parse(l.concluidaEm || l.atualizadoEm || l.criadoEm || 0) >= corte);
}
// Protocolo legível: S-AAMMDD-NNN (NNN = ordem do dia)
function novoProtocolo(linhas, agora) {
  const prefixo = 'S-' + diaSP(agora || Date.now()).replace(/-/g, '').slice(2) + '-';
  let maior = 0;
  for (const l of linhas) if (l.protocolo && l.protocolo.startsWith(prefixo)) maior = Math.max(maior, Number(l.protocolo.slice(prefixo.length)) || 0);
  return prefixo + String(maior + 1).padStart(3, '0');
}
const add = (l, h) => { l.historico = l.historico.concat([Object.assign({ texto: '', status: '', prioridade: '', area: '' }, h)]).slice(-MAX_HISTORICO); };

// ---- cancelamento esperto --------------------------------------------------------------------------------------------------------------
// Em que ponto está o pedido, a partir do rastreio (rastreio.js montarRastreio). Pedido fora do SC9 = nao_achado.
function etapaDoRastreio(r) {
  if (!r || !r.achado) return 'nao_achado';
  const feita = (cod) => (r.etapas || []).some((e) => e.cod === cod && e.estado === 'feita');
  if (feita('desp') || (r.detalhes && r.detalhes.despachadoEm)) return 'despachado';
  if (feita('fat')) return 'faturado';
  if (feita('conf')) return 'conferido';
  if (feita('sep')) return 'separado';
  const sep = (r.etapas || []).find((e) => e.cod === 'sep');
  return sep && sep.estado === 'atual' && /^Em separa/.test(sep.titulo || '') ? 'em_separacao' : 'nao_separado';
}
const aTempoDaEtapa = (etapa) => etapa === 'nao_separado';
const AVISO_ETAPA = {
  nao_separado: 'O pedido ainda não começou a ser separado: a logística foi avisada com urgência e deve conseguir parar a tempo.',
  em_separacao: 'O pedido já está em separação: a logística vai avaliar com urgência, mas pode não dar tempo.',
  separado: 'O pedido já foi separado: a logística vai avaliar; pode não dar tempo.',
  conferido: 'O pedido já foi separado e conferido: a logística vai avaliar; pode não dar tempo.',
  faturado: 'O pedido já tem nota fiscal emitida: a logística vai avaliar; provavelmente será preciso cancelar a nota.',
  despachado: 'O pedido já foi despachado: não dá mais para parar na logística. A equipe vai avaliar o que pode ser feito.',
  nao_achado: 'Não encontramos este pedido na base do SC9 (talvez ainda não tenha sido carregado). A equipe vai conferir; confira o número do pedido.'
};
const avisoDaEtapa = (etapa) => AVISO_ETAPA[etapa] || '';

// Prioridade calculada pelo servidor (a equipe pode mudar depois).
function prioridadeInicial(tipo, etapa, dados, agora) {
  if (tipo === 'cancelar_pedido' || tipo === 'segurar_pedido') return aTempoDaEtapa(etapa) ? 'urgente' : 'alta';
  if (tipo === 'transferencia_peca' && dados && dados.prazo && dados.prazo <= somaDias(diaSP(agora || Date.now()), 1)) return 'alta';
  return 'normal';
}

// ---- SLA -------------------------------------------------------------------------------------------------------------------------------
// slaVenceEm = criação + prazo do tipo; atrasada = ainda ativa, sem 1ª resposta da equipe e prazo vencido.
function slaDe(l, agora) {
  const min = (TIPOS[l.tipo] || TIPOS.outro).sla, base = Date.parse(l.criadoEm);
  if (Number.isNaN(base)) return { slaMin: min, slaVenceEm: '', atrasada: false };
  const vence = base + min * 60000;
  return { slaMin: min, slaVenceEm: new Date(vence).toISOString(), atrasada: ATIVOS.includes(l.status) && !l.primeiraRespostaEm && (agora || Date.now()) > vence };
}
const minutos = (de, ate) => { const a = Date.parse(de), b = Date.parse(ate); return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, Math.round((b - a) / 60000)); };

// ---- ações -----------------------------------------------------------------------------------------------------------------------------
// criar      { tipo, pedido?, texto?, dados?, pedidoPor, conta?, filial?, etapa?, naoAchado? }   (a vendedora; ctx.produto(codigo, {filial, armazem, lote}) completa a transferência)
// status     { id, status, resposta }     (a equipe; negada exige resposta)
// assumir    { id }                       (a equipe: registra quem pegou; recebida vira em análise)
// interno    { id, texto }                (comentário só da equipe)
// prioridade { id, prioridade }           (a equipe)
// area       { id, area }                 (a equipe)
function aplicar(linhasAtuais, corpo, quem, agora, ctx) {
  const linhas = limpar(normalizarLista({ linhas: linhasAtuais }), agora);
  const acao = corpo && corpo.acao, now = agora || Date.now(), quando = new Date(now).toISOString(), por = texto(quem, 60);
  if (acao === 'criar') {
    const tipo = corpo.tipo, def = TIPOS[tipo];
    if (!def) return { linhas, erro: 'Escolha o tipo de solicitação.' };
    const pedidoInformado = corpo.pedido != null && String(corpo.pedido).trim() !== '';
    const pedido = numeroDoPedido(corpo.pedido) || '';
    if ((def.pedido || pedidoInformado) && !pedido) return { linhas, erro: 'Número do pedido inválido (só números, de 4 a 10 dígitos).' };
    const pedidoPor = texto(corpo.pedidoPor, 60);
    if (pedidoPor.length < 2) return { linhas, erro: 'Diga seu nome para a equipe saber quem pediu.' };
    const feitoDados = dadosDoTipo(tipo, corpo.dados, true, now, ctx);
    if (feitoDados.erro) return { linhas, erro: feitoDados.erro };
    const msg = texto(corpo.texto != null ? corpo.texto : (corpo.dados && corpo.dados.texto), 500);
    if (tipo === 'outro' && msg.length < 5) return { linhas, erro: 'Escreva o que você precisa (mínimo 5 letras).' };
    const conta = texto(corpo.conta, 24), nome = pedidoPor.toLowerCase(), desde = now - 864e5;
    const dela = (l) => (conta && l.conta === conta) || l.pedidoPor.toLowerCase() === nome;
    if (linhas.filter((l) => dela(l) && Date.parse(l.criadoEm) >= desde).length >= LIMITE_POR_DIA) return { linhas, erro: 'Você já enviou ' + LIMITE_POR_DIA + ' solicitações hoje. Fale direto com a logística.' };
    if ((tipo === 'cancelar_pedido' || tipo === 'segurar_pedido')) {
      const igual = linhas.find((l) => l.tipo === tipo && l.pedido === pedido && ATIVOS.includes(l.status) && dela(l));
      if (igual) return { linhas, erro: 'Você já pediu isso para o pedido ' + pedido + ' (protocolo ' + igual.protocolo + '). Acompanhe em "Minhas solicitações".' };
    }
    if (linhas.length >= MAX_LINHAS) return { linhas, erro: 'A lista de solicitações está cheia no momento. Fale com a logística.' };
    const cancela = tipo === 'cancelar_pedido' || tipo === 'segurar_pedido';
    const etapa = cancela && ETAPAS.includes(corpo.etapa) ? corpo.etapa : '';
    const nova = {
      id: novoId(now), protocolo: novoProtocolo(linhas, now), tipo, pedido, dados: feitoDados.dados, texto: msg, prioridade: prioridadeInicial(tipo, etapa, feitoDados.dados, now),
      etapa, aTempo: aTempoDaEtapa(etapa), pedidoPor, conta, filial: texto(corpo.filial, 40) || (feitoDados.dados.origem && feitoDados.dados.origem.filial) || feitoDados.dados.filial || '', area: def.area, status: 'recebida',
      resposta: '', responsavel: '', respondidoPor: '', naoAchado: Boolean(corpo.naoAchado), criadoEm: quando, primeiraRespostaEm: '', concluidaEm: '', atualizadoEm: quando, historico: []
    };
    add(nova, { em: quando, acao: 'criado', por: pedidoPor, texto: msg, status: 'recebida' });
    linhas.unshift(nova);
    return { linhas, resultado: { id: nova.id, protocolo: nova.protocolo } };
  }
  const l = linhas.find((x) => x.id === texto(corpo && corpo.id, 40));
  if (['status', 'assumir', 'interno', 'prioridade', 'area'].includes(acao) && !l) return { linhas, erro: 'Solicitação não encontrada.' };
  if (acao === 'status') {
    if (!STATUS.includes(corpo.status)) return { linhas, erro: 'Status inválido.' };
    const resposta = texto(corpo.resposta, 300);
    if (corpo.status === 'negada' && !resposta && !l.resposta) return { linhas, erro: 'Explique o motivo para a vendedora ao negar (resposta obrigatória).' };
    const jaNesseStatus = l.status === corpo.status;
    l.status = corpo.status; if (resposta) l.resposta = resposta;
    if (!l.responsavel && por) l.responsavel = por;
    if (!l.primeiraRespostaEm && corpo.status !== 'recebida') l.primeiraRespostaEm = quando;
    if (!FINAIS.includes(l.status)) l.concluidaEm = ''; else if (!jaNesseStatus || !l.concluidaEm) l.concluidaEm = quando;
    l.respondidoPor = por; l.atualizadoEm = quando;
    add(l, { em: quando, acao: 'status', por, texto: resposta, status: corpo.status });
    return { linhas, resultado: { id: l.id } };
  }
  if (acao === 'assumir') {
    if (!por) return { linhas, erro: 'Quem está assumindo?' };
    if (!ATIVOS.includes(l.status)) return { linhas, erro: 'Esta solicitação já foi encerrada.' };
    l.responsavel = por; l.atualizadoEm = quando;
    if (!l.primeiraRespostaEm) l.primeiraRespostaEm = quando;
    const muda = l.status === 'recebida'; if (muda) l.status = 'em_analise';
    add(l, { em: quando, acao: 'assumir', por, status: muda ? 'em_analise' : '' });
    return { linhas, resultado: { id: l.id } };
  }
  if (acao === 'interno') {
    const t = texto(corpo.texto, 300);
    if (!t) return { linhas, erro: 'Escreva o comentário.' };
    l.atualizadoEm = quando; add(l, { em: quando, acao: 'interno', por, texto: t });
    return { linhas, resultado: { id: l.id } };
  }
  if (acao === 'prioridade') {
    if (!PRIORIDADES.includes(corpo.prioridade)) return { linhas, erro: 'Prioridade inválida (normal, alta ou urgente).' };
    if (l.prioridade !== corpo.prioridade) { l.prioridade = corpo.prioridade; l.atualizadoEm = quando; add(l, { em: quando, acao: 'prioridade', por, prioridade: corpo.prioridade }); }
    return { linhas, resultado: { id: l.id } };
  }
  if (acao === 'area') {
    if (!AREAS.includes(corpo.area)) return { linhas, erro: 'Área inválida (estoque, expedição ou faturamento).' };
    if (l.area !== corpo.area) { l.area = corpo.area; l.atualizadoEm = quando; add(l, { em: quando, acao: 'area', por, area: corpo.area }); }
    return { linhas, resultado: { id: l.id } };
  }
  return { linhas, erro: 'ação inválida' };
}

// ---- o que cada lado vê ------------------------------------------------------------------------------------------------------------------
// A vendedora vê o que aconteceu e quando, sem nomes da equipe e sem comentários internos.
function historicoPublico(l) {
  const saida = [];
  for (const h of l.historico) {
    if (h.acao === 'criado') saida.push({ em: h.em, status: 'recebida', texto: '' });
    else if (h.acao === 'status') saida.push({ em: h.em, status: h.status, texto: h.texto });
    else if (h.acao === 'assumir' && h.status) saida.push({ em: h.em, status: h.status, texto: '' });
  }
  return saida;
}
const visaoMeu = (l) => ({
  id: l.id, protocolo: l.protocolo, tipo: l.tipo, rotulo: (TIPOS[l.tipo] || TIPOS.outro).rotulo, pedido: l.pedido, dados: l.dados, texto: l.texto, status: l.status, resposta: l.resposta,
  etapa: l.etapa, aTempo: l.aTempo, aviso: l.etapa ? avisoDaEtapa(l.etapa) : '', criadoEm: l.criadoEm, atualizadoEm: l.atualizadoEm, historico: historicoPublico(l)
});
// Cada vendedora só enxerga o que ela mesma enviou: pelo login, ou pelo nome quando não tem login (junto com o id guardado no aparelho).
const ehDela = (l, login) => Boolean(login) && l.conta === login;
const ehDonoPorNome = (l, nome) => !l.conta && Boolean(nome) && l.pedidoPor.toLowerCase() === String(nome).toLowerCase();

// Liga ao login da vendedora as solicitações que ela já tinha enviado neste aparelho (só as sem conta e com o mesmo nome).
function vincularConta(linhasAtuais, ids, nome, login) {
  const linhas = normalizarLista({ linhas: linhasAtuais });
  const quero = new Set((Array.isArray(ids) ? ids : []).map((x) => texto(x, 40)).filter(Boolean).slice(0, 100)), n = texto(nome, 60).toLowerCase();
  let mudou = 0;
  for (const l of linhas) if (quero.has(l.id) && !l.conta && l.pedidoPor.toLowerCase() === n) { l.conta = login; mudou++; }
  return { linhas, mudou };
}

// ---- lista da equipe --------------------------------------------------------------------------------------------------------------------
// Fila: mais urgente primeiro; dentro da mesma prioridade, a mais antiga.
function ordenarFila(linhas) {
  return linhas.slice().sort((a, b) => (PESO_PRIORIDADE[b.prioridade] - PESO_PRIORIDADE[a.prioridade]) || String(a.criadoEm).localeCompare(String(b.criadoEm)));
}
// texto pesquisável dos dados: valores simples; na transferência, código, descrição e lote dos itens e as filiais/armazéns.
function textoBusca(dados) {
  const d = dados || {}, partes = [];
  for (const [k, v] of Object.entries(d)) if (v == null || typeof v !== 'object') partes.push(v);
  for (const it of Array.isArray(d.itens) ? d.itens : []) partes.push(it.produto, it.descricao, it.lote);
  for (const l of [d.origem, d.destino]) if (l && typeof l === 'object') partes.push(l.filial, l.nome, l.codigo, l.armazem);
  return partes.filter((x) => x != null && x !== '').join(' ');
}
// filtros { status, tipo, area, de, ate (AAAA-MM-DD, pelo dia da criação em São Paulo), q }; valor vazio ou desconhecido não filtra.
function filtrar(linhas, f) {
  const p = f || {}, palavras = semAcento(texto(p.q, 80)).split(' ').filter(Boolean), de = dataValida(p.de), ate = dataValida(p.ate);
  return linhas.filter((l) => {
    if (STATUS.includes(p.status) && l.status !== p.status) return false;
    if (TIPOS[p.tipo] && l.tipo !== p.tipo) return false;
    if (AREAS.includes(p.area) && l.area !== p.area) return false;
    if (de || ate) { const dia = l.criadoEm ? diaSP(Date.parse(l.criadoEm)) : ''; if (!dia || (de && dia < de) || (ate && dia > ate)) return false; }
    if (palavras.length) { const feno = semAcento([l.protocolo, l.pedido, l.pedidoPor, l.texto, l.filial, (TIPOS[l.tipo] || {}).rotulo, textoBusca(l.dados)].join(' ')); if (!palavras.every((w) => feno.includes(w))) return false; }
    return true;
  });
}

// ---- CSV ------------------------------------------------------------------------------------------------------------------------------
const CABECALHO_CSV = ['id', 'protocolo', 'tipo', 'pedido', 'vendedora', 'filial', 'status', 'prioridade', 'criada', '1ª resposta', 'concluída', 'minutos até resposta', 'minutos até conclusão'];
const celula = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // não deixa a planilha executar fórmula vinda de texto digitado
  return /[";\r\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function paraCsv(linhas) {
  const dt = (v) => (v ? new Date(v).toLocaleString('sv-SE', { timeZone: FUSO }) : '');
  const corpo = linhas.map((l) => [l.id, l.protocolo, (TIPOS[l.tipo] || TIPOS.outro).rotulo, l.pedido, l.pedidoPor, FILIAIS_ROTULO[l.filial] || l.filial, l.status, l.prioridade, dt(l.criadoEm), dt(l.primeiraRespostaEm), dt(l.concluidaEm),
    l.primeiraRespostaEm ? minutos(l.criadoEm, l.primeiraRespostaEm) : '', l.concluidaEm ? minutos(l.criadoEm, l.concluidaEm) : ''].map(celula).join(';'));
  return '﻿' + [CABECALHO_CSV.map(celula).join(';')].concat(corpo).join('\r\n') + '\r\n';
}

module.exports = {
  MAX_LINHAS, MAX_HISTORICO, LIMITE_POR_DIA, DIAS_PARA_LIMPAR, TIPOS, TIPOS_IDS, AREAS, AREAS_ROTULO, STATUS, ATIVOS, FINAIS, PRIORIDADES, ETAPAS, FILIAIS, FILIAIS_INFO, FILIAIS_ROTULO, MAX_ITENS_TRANSFERENCIA,
  armazemDe, rotuloLocal, textoBusca, normalizarLinha, normalizarLista, limpar, novoProtocolo, aplicar, dadosDoTipo, filialDe, etapaDoRastreio, avisoDaEtapa, aTempoDaEtapa, prioridadeInicial, slaDe, minutos,
  historicoPublico, visaoMeu, ehDela, ehDonoPorNome, vincularConta, ordenarFila, filtrar, paraCsv, diaSP
};
