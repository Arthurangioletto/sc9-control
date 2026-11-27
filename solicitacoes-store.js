/* Central de solicitações das vendedoras: pedido de ajuda à logística que pode ou não ter pedido (cancelar/segurar pedido, transferência de peça,
 * consulta de estoque, alterar pedido, nota fiscal, outro assunto). Lista compartilhada em solicitacoes-vendedoras.json.
 * É separada das prioridades e dos avisos: nada daqueles arquivos é lido nem gravado aqui.
 * Cada linha: { id, protocolo, tipo, pedido, dados{}, texto, prioridade, etapa, aTempo, pedidoPor, conta, filial, area, status, resposta,
 *               responsavel, respondidoPor, naoAchado, criadoEm, primeiraRespostaEm, concluidaEm, atualizadoEm, historico[] }.
 * O histórico só cresce (quem, quando, o quê). Só validação e mesclagem, sem acesso a disco. */
'use strict';
const { numeroDoPedido } = require('./prioridades-store.js');
const PQ = require('./para-quando.js');

const MAX_LINHAS = 5000;
const MAX_HISTORICO = 60;
const LIMITE_POR_DIA = 15; // solicitações por vendedora (login ou nome) em 24 h
const MAX_PEDIDOS_LOTE = 20; // pedidos numa mesma solicitação (um protocolo só)
const MAX_LISTA_BRUTA = 200; // acima disso a lista nem é lida: é recusada antes de normalizar
const DIAS_PARA_LIMPAR = 120; // só as concluídas/negadas; as ativas nunca somem
const FUSO = 'America/Sao_Paulo';

// tipo -> rótulo, se exige número de pedido, área padrão e prazo (minutos) para a 1ª resposta da equipe
const TIPOS = {
  cancelar_pedido: { rotulo: 'Cancelar pedido (não separar)', pedido: true, lote: true, area: 'estoque', sla: 30 },
  segurar_pedido: { rotulo: 'Segurar pedido (não separar/despachar)', pedido: true, lote: true, area: 'estoque', sla: 60 },
  transferencia_peca: { rotulo: 'Transferência de peça', pedido: false, area: 'estoque', sla: 240 },
  consulta_estoque: { rotulo: 'Consulta de estoque', pedido: false, area: 'estoque', sla: 60 },
  alterar_pedido: { rotulo: 'Alterar pedido (itens/quantidade/endereço)', pedido: true, lote: true, area: 'expedicao', sla: 120 },
  nota_fiscal: { rotulo: 'Nota fiscal (reemitir/enviar/corrigir)', pedido: true, lote: true, area: 'faturamento', sla: 120 },
  outro: { rotulo: 'Outro assunto', pedido: false, area: 'expedicao', sla: 240 },
  // Entrada única "O que você precisa?" (ondas 1 e 2): acrescentados sem mexer nos tipos acima. lote = aceita vários pedidos (pedidos[]) num protocolo só.
  sair_hoje: { rotulo: 'Sair hoje (pressa, liberar, prioridade)', pedido: true, lote: true, area: 'estoque', sla: 60 },
  saida_especial: { rotulo: 'Saída especial (retirada, Sedex, motoboy, outra transportadora, saída pela filial)', pedido: true, lote: true, area: 'expedicao', sla: 60 },
  subir_pedido: { rotulo: 'Subir um pedido (PV)', pedido: false, area: 'faturamento', sla: 120 },
  falta_item: { rotulo: 'Falta de item', pedido: true, lote: true, area: 'estoque', sla: 60 },
  erro_pedido: { rotulo: 'Erro ou revisão do pedido', pedido: true, lote: true, area: 'expedicao', sla: 120 }
};
Object.setPrototypeOf(TIPOS, null); // "constructor", "__proto__" etc. não contam como tipo
const TIPOS_IDS = Object.keys(TIPOS);
const AREAS = ['estoque', 'expedicao', 'faturamento'];
const AREAS_ROTULO = { estoque: 'Estoque', expedicao: 'Expedição', faturamento: 'Faturamento' };
// aguardando_aprovacao: só a saída por motoboy urgente nasce assim (a equipe aprova mudando para em andamento, ou nega).
const STATUS = ['recebida', 'em_analise', 'em_andamento', 'concluida', 'negada', 'aguardando_aprovacao'];
const ATIVOS = ['recebida', 'em_analise', 'em_andamento', 'aguardando_aprovacao'];
const FINAIS = ['concluida', 'negada'];
const PRIORIDADES = ['normal', 'alta', 'urgente'];
const PESO_PRIORIDADE = { normal: 0, alta: 1, urgente: 2 };
const ETAPAS = ['nao_separado', 'em_separacao', 'separado', 'conferido', 'faturado', 'despachado', 'nao_achado'];
const ACOES_HIST = ['criado', 'status', 'assumir', 'interno', 'prioridade', 'area', 'pedido_concluido'];
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
  oque: { k: 'o_que', t: 'texto', max: 500, obrig: true, nome: 'o que precisa ser feito' },
  // campos dos tipos novos. quando(d): só vale (e só é exigido) se a condição sobre os campos já lidos for verdadeira; obrig pode ser função.
  enum: (k, opcoes, obrig, nome) => ({ k, t: 'enum', opcoes, obrig, nome }),
  texto: (k, max, obrig, nome, quando) => ({ k, t: 'texto', max, obrig, nome, quando })
};
const MOTIVOS_SAIR = ['cliente_aguardando', 'prazo_combinado', 'cliente_importante', 'erro_nosso', 'retirada', 'outro'];
const MODOS_SAIDA = ['retirada', 'sedex', 'motoboy', 'outra_transportadora', 'saida_filial'];
const SUBTIPOS_NF = ['cancelada', 'corrigir', 'segunda_via', 'enviar_cliente'];
const ACOES_FALTA = ['esperar', 'cortar', 'substituir'];
const MODOS_ERRO = ['erro', 'revisao'];
const CAMPOS = {
  cancelar_pedido: [C.motivo(true)],
  segurar_pedido: [C.motivo(true), C.data('ate', 'a data (até quando segurar)')],
  transferencia_peca: [], // formato próprio (itens, origem, destino): ver dadosTransferencia
  consulta_estoque: [C.produto, C.qt, C.filial('filial', false, 'a filial')],
  alterar_pedido: [C.oque],
  nota_fiscal: [C.enum('subtipo', SUBTIPOS_NF, false, 'o tipo de pedido sobre a nota'), Object.assign({}, C.oque, { obrig: (d) => !['segunda_via', 'enviar_cliente'].includes(d.subtipo) })],
  outro: [],
  sair_hoje: [C.enum('motivo', MOTIVOS_SAIR, true, 'o motivo')],
  saida_especial: [C.enum('modo', MODOS_SAIDA, true, 'como o pedido vai sair'),
    C.texto('quem', 80, true, 'quem vai retirar', (d) => d.modo === 'retirada'),
    { k: 'dia', t: 'data', obrig: true, nome: 'o dia da retirada', quando: (d) => d.modo === 'retirada' },
    { k: 'hora', t: 'hora', obrig: false, nome: 'a hora da retirada', quando: (d) => d.modo === 'retirada' },
    C.texto('transportadora', 60, true, 'a transportadora', (d) => d.modo === 'outra_transportadora'),
    { k: 'filial', t: 'filial', obrig: true, nome: 'a filial de saída', quando: (d) => d.modo === 'saida_filial' },
    C.texto('detalhe', 300, false, 'o detalhe')],
  subir_pedido: [C.texto('pv', 30, true, 'o número do PV'), C.filial('filial', false, 'a filial'), C.texto('onde', 300, true, 'onde está o PV (e-mail, pasta, link...)')],
  falta_item: [C.enum('acao', ACOES_FALTA, true, 'o que fazer com o item (esperar, cortar ou substituir)'), C.texto('detalhe', 300, (d) => d.acao === 'substituir', 'por qual produto substituir')],
  erro_pedido: [C.enum('modo', MODOS_ERRO, true, 'se é erro ou revisão'), Object.assign({}, C.oque, { nome: 'o que está errado ou precisa ser revisado' })]
};

Object.setPrototypeOf(CAMPOS, null);
const semZeros = (v) => (/^\d+$/.test(v) ? String(Number(v)) : v);
// Aceita a chave, o nome ou o código da filial ("Tambore", "Tamboré", "03", "3", "bh").
function filialDe(v) {
  const q = semAcento(texto(v, 40));
  if (!q) return '';
  const f = FILIAIS_INFO.find((x) => semAcento(x.chave) === q || semAcento(x.nome) === q || semZeros(x.codigo.toLowerCase()) === semZeros(q));
  return f ? f.chave : '';
}
// Armazém: "1" e "01" são o mesmo lugar; letras ficam em maiúsculas. Até 6 caracteres.
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
  // lista de armazéns da logística (armazens-vendedoras.js): o servidor recusa código fora da lista ou não liberado para esse papel
  if (estrito && ctx && typeof ctx.armazemPermitido === 'function') {
    const eo = ctx.armazemPermitido(org.local.filial, org.local.armazem, 'origem'); if (eo) return { erro: eo };
    const ed = ctx.armazemPermitido(dst.local.filial, dst.local.armazem, 'destino'); if (ed) return { erro: ed };
  }
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

// Itens em falta (falta_item): { produto, descricao, qt }; a descrição vem do catálogo do servidor (ctx.produto), nunca do aparelho.
function itensFalta(bruto, estrito, ctx) {
  const o = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  const brutos = Array.isArray(o.itens) ? o.itens : [];
  if (estrito) {
    if (!brutos.length) return { erro: 'Inclua pelo menos um produto que está em falta.' };
    if (brutos.length > MAX_ITENS_TRANSFERENCIA) return { erro: 'No máximo ' + MAX_ITENS_TRANSFERENCIA + ' produtos por solicitação.' };
  }
  const itens = [], vistos = new Set();
  for (let i = 0; i < Math.min(brutos.length, MAX_ITENS_TRANSFERENCIA); i++) {
    const b = brutos[i] && typeof brutos[i] === 'object' ? brutos[i] : {};
    const produto = texto(b.produto, 40), qt = inteiro(b.qt), n = i + 1;
    if (!produto || qt == null || qt < 1 || qt > 99999) { if (estrito) return { erro: !produto ? 'Produto ' + n + ': informe o código do produto.' : 'Produto ' + n + ' (' + produto + '): a quantidade deve ser um número inteiro de 1 a 99999.' }; continue; }
    if (vistos.has(produto.toLowerCase())) { if (estrito) return { erro: 'O produto ' + produto + ' aparece mais de uma vez. Some as quantidades em uma linha só.' }; continue; }
    vistos.add(produto.toLowerCase());
    let descricao = texto(b.descricao, 200);
    if (estrito) { const achou = ctx && typeof ctx.produto === 'function' ? ctx.produto(produto, { filial: '', armazem: '', lote: '' }) : null; descricao = achou && achou.descricao ? texto(achou.descricao, 200) : ''; }
    itens.push({ produto, descricao, qt });
  }
  return { itens };
}
const HORA_OK = /^([01]\d|2[0-3]):[0-5]\d$/;

// Normaliza os dados do tipo. estrito (criação): devolve { erro } no primeiro problema; senão (leitura do arquivo) só limpa, sem reclamar.
function dadosDoTipo(tipo, bruto, estrito, agora, ctx) {
  if (tipo === 'transferencia_peca') return dadosTransferencia(bruto, estrito, agora, ctx);
  const campos = CAMPOS[tipo] || [], origem = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {}, dados = {};
  const hoje = diaSP(agora || Date.now());
  for (const c of campos) {
    if (c.quando && !c.quando(dados)) continue; // campo que só vale em certos casos (ex.: "quem retira" só na retirada)
    const v = origem[c.k], obrig = typeof c.obrig === 'function' ? Boolean(c.obrig(dados)) : c.obrig;
    let limpo = '';
    if (c.t === 'texto') limpo = texto(v, c.max);
    else if (c.t === 'int') { const n = inteiro(v); limpo = n != null && n >= 1 && n <= 99999 ? n : ''; }
    else if (c.t === 'filial') limpo = filialDe(v);
    else if (c.t === 'data') limpo = dataValida(v);
    else if (c.t === 'enum') limpo = typeof v === 'string' && c.opcoes.includes(v) ? v : '';
    else if (c.t === 'hora') limpo = typeof v === 'string' && HORA_OK.test(v.trim()) ? v.trim() : '';
    const informado = v != null && String(v).trim() !== '';
    if (estrito) {
      if (obrig && limpo === '') return { erro: c.t === 'int' ? 'Quantidade: informe um número inteiro de 1 a 99999.' : c.t === 'filial' || c.t === 'enum' ? 'Escolha ' + c.nome + ' da lista.' : 'Informe ' + c.nome + '.' };
      if (obrig && c.t === 'texto' && limpo.length < 3) return { erro: 'Informe ' + c.nome + ' (mínimo 3 letras).' };
      if (!obrig && informado && limpo === '') return { erro: c.t === 'filial' || c.t === 'enum' ? 'Escolha ' + c.nome + ' da lista.' : c.t === 'data' ? 'Data inválida em ' + c.nome + ' (use o calendário).' : c.t === 'hora' ? 'Hora inválida em ' + c.nome + ' (use HH:MM).' : 'Valor inválido em ' + c.nome + '.' };
      if (c.t === 'data' && limpo) {
        if (limpo < hoje) return { erro: 'A data não pode ser no passado.' };
        if (limpo > somaDias(hoje, 366)) return { erro: 'A data está muito distante (no máximo 1 ano).' };
      }
    }
    if (limpo !== '') dados[c.k] = limpo;
  }
  if (tipo === 'falta_item') { const f = itensFalta(bruto, estrito, ctx); if (f.erro) return f; if (f.itens.length) dados.itens = f.itens; }
  return { dados };
}

// ---- linha -----------------------------------------------------------------------------------------------------------------------------
// Lote de pedidos de uma solicitação: [{ pedido, etapa, naoAchado, concluido, concluidoEm, concluidoPor }]. Linhas antigas não têm: lista vazia.
function pedidosDaLinha(bruto) {
  const saida = [], vistos = new Set();
  for (const p of (Array.isArray(bruto) ? bruto : []).slice(0, MAX_PEDIDOS_LOTE)) {
    const num = numeroDoPedido(p && p.pedido);
    if (!num || vistos.has(num)) continue;
    vistos.add(num);
    saida.push({ pedido: num, etapa: ETAPAS.includes(p.etapa) ? p.etapa : '', naoAchado: Boolean(p.naoAchado), concluido: Boolean(p.concluido), concluidoEm: dataHora(p.concluidoEm), concluidoPor: texto(p.concluidoPor, 60) });
  }
  return saida;
}
// Lista de pedidos pedida pelo aparelho: { lista, lote, erro? }. Sem `pedidos` vale só o `pedido` (comportamento de sempre).
function listaDePedidos(corpo, def) {
  const unico = corpo && corpo.pedido != null && String(corpo.pedido).trim() !== '' ? numeroDoPedido(corpo.pedido) : null;
  const bruto = corpo ? corpo.pedidos : undefined;
  if (bruto == null || (Array.isArray(bruto) && !bruto.length)) return { lista: unico ? [unico] : [], lote: false };
  if (!Array.isArray(bruto)) return { erro: 'A lista de pedidos é inválida.' };
  if (!def || !def.lote) return { erro: 'Este assunto aceita um pedido por vez.' };
  if (bruto.length > MAX_LISTA_BRUTA) return { erro: 'No máximo ' + MAX_PEDIDOS_LOTE + ' pedidos por solicitação. Faça outra solicitação para o restante.' };
  const lista = [], vistos = new Set();
  for (const b of unico ? [unico].concat(bruto) : bruto) {
    if (typeof b !== 'string' && typeof b !== 'number') return { erro: 'A lista de pedidos é inválida.' };
    const num = typeof b === 'string' && b.length > 24 ? null : numeroDoPedido(b);
    if (!num) return { erro: 'O número "' + texto(String(b), 14) + '" não é um pedido válido (só números, de 4 a 10 dígitos).' };
    if (vistos.has(num)) continue;
    vistos.add(num); lista.push(num);
    if (lista.length > MAX_PEDIDOS_LOTE) return { erro: 'No máximo ' + MAX_PEDIDOS_LOTE + ' pedidos por solicitação. Faça outra solicitação para o restante.' };
  }
  return { lista, lote: true };
}
// A etapa mais adiantada de um conjunto de pedidos (a que manda no aviso: basta um já separado para "pode não dar tempo"). Pedido não achado não conta.
function etapaMaisAdiantada(etapas) {
  const ordem = ETAPAS.filter((e) => e !== 'nao_achado'), achadas = etapas.filter((e) => ordem.includes(e));
  if (!achadas.length) return etapas.length && etapas.every((e) => e === 'nao_achado') ? 'nao_achado' : '';
  return achadas.reduce((a, b) => (ordem.indexOf(b) > ordem.indexOf(a) ? b : a));
}
// O que não dá para pedir quando o pedido já está nessa etapa (só nos tipos novos; os antigos continuam aceitando tudo, como sempre).
const ETAPAS_RECUSADAS = { sair_hoje: ['despachado'], saida_especial: ['despachado'], falta_item: ['despachado'], erro_pedido: ['despachado'] };
Object.setPrototypeOf(ETAPAS_RECUSADAS, null);

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
    paraQuando: PQ.normalizar(x.paraQuando), pedidos: pedidosDaLinha(x.pedidos),
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
function prioridadeInicial(tipo, etapa, dados, agora, paraQuando) {
  if (tipo === 'cancelar_pedido' || tipo === 'segurar_pedido') return aTempoDaEtapa(etapa) ? 'urgente' : 'alta';
  const hoje = PQ.ehHoje(paraQuando, agora);
  if (tipo === 'sair_hoje') return hoje ? 'urgente' : 'alta';
  if (tipo === 'saida_especial' && dados && dados.modo === 'motoboy') return 'alta';
  if (tipo === 'transferencia_peca' && dados && dados.prazo && dados.prazo <= somaDias(diaSP(agora || Date.now()), 1)) return 'alta';
  return hoje ? 'alta' : 'normal'; // "para quando" é hoje: sobe de normal para alta
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
    const listaP = listaDePedidos(corpo, def);
    if (listaP.erro) return { linhas, erro: listaP.erro };
    const pedido = listaP.lote ? listaP.lista[0] || '' : numeroDoPedido(corpo.pedido) || '';
    if ((def.pedido || pedidoInformado) && !pedido) return { linhas, erro: 'Número do pedido inválido (só números, de 4 a 10 dígitos).' };
    const pedidoPor = texto(corpo.pedidoPor, 60);
    if (pedidoPor.length < 2) return { linhas, erro: 'Diga seu nome para a equipe saber quem pediu.' };
    const feitoDados = dadosDoTipo(tipo, corpo.dados, true, now, ctx);
    if (feitoDados.erro) return { linhas, erro: feitoDados.erro };
    const pq = PQ.validar(corpo.paraQuando, now);
    if (pq.erro) return { linhas, erro: pq.erro };
    const msg = texto(corpo.texto != null ? corpo.texto : (corpo.dados && corpo.dados.texto), 500);
    if (tipo === 'outro' && msg.length < 5) return { linhas, erro: 'Escreva o que você precisa (mínimo 5 letras).' };
    if (tipo === 'sair_hoje' && feitoDados.dados.motivo === 'outro' && msg.length < 5) return { linhas, erro: 'Explique o motivo no recado (mínimo 5 letras).' };
    // situação de cada pedido no SC9, calculada pelo servidor (corpo.pedidosInfo = [{ pedido, etapa, naoAchado }])
    const info = new Map((Array.isArray(corpo.pedidosInfo) ? corpo.pedidosInfo : []).filter((i) => i && typeof i === 'object').map((i) => [numeroDoPedido(i.pedido), i]));
    const infoDe = (p) => info.get(p) || (listaP.lista.length === 1 && p === pedido && corpo.etapa ? { etapa: corpo.etapa, naoAchado: corpo.naoAchado } : {});
    const recusa = ETAPAS_RECUSADAS[tipo];
    if (recusa) for (const p of listaP.lista) if (recusa.includes(infoDe(p).etapa)) return { linhas, erro: 'O pedido ' + p + ' já foi despachado: não dá mais para pedir isso por aqui. Se precisar, use "Outro assunto".' };
    const conta = texto(corpo.conta, 24), nome = pedidoPor.toLowerCase(), desde = now - 864e5;
    const dela = (l) => (conta && l.conta === conta) || l.pedidoPor.toLowerCase() === nome;
    if (linhas.filter((l) => dela(l) && Date.parse(l.criadoEm) >= desde).length >= LIMITE_POR_DIA) return { linhas, erro: 'Você já enviou ' + LIMITE_POR_DIA + ' solicitações hoje. Fale direto com a logística.' };
    if ((tipo === 'cancelar_pedido' || tipo === 'segurar_pedido')) {
      for (const p of listaP.lista) {
        const igual = linhas.find((l) => l.tipo === tipo && ATIVOS.includes(l.status) && dela(l) && (l.pedido === p || l.pedidos.some((x) => x.pedido === p && !x.concluido)));
        if (igual) return { linhas, erro: 'Você já pediu isso para o pedido ' + p + ' (protocolo ' + igual.protocolo + '). Acompanhe em "Minhas".' };
      }
    }
    if (linhas.length >= MAX_LINHAS) return { linhas, erro: 'A lista de solicitações está cheia no momento. Fale com a logística.' };
    const cancela = tipo === 'cancelar_pedido' || tipo === 'segurar_pedido';
    const etapas = listaP.lista.map((p) => (ETAPAS.includes(infoDe(p).etapa) ? infoDe(p).etapa : ''));
    const etapa = cancela ? (listaP.lote ? etapaMaisAdiantada(etapas.filter(Boolean)) : ETAPAS.includes(corpo.etapa) ? corpo.etapa : '') : '';
    const pedidos = listaP.lote ? listaP.lista.map((p, i) => ({ pedido: p, etapa: etapas[i], naoAchado: Boolean(infoDe(p).naoAchado), concluido: false, concluidoEm: '', concluidoPor: '' })) : [];
    const aguarda = tipo === 'saida_especial' && feitoDados.dados.modo === 'motoboy'; // motoboy urgente precisa de aprovação da equipe
    const status = aguarda ? 'aguardando_aprovacao' : 'recebida';
    const nova = {
      id: novoId(now), protocolo: novoProtocolo(linhas, now), tipo, pedido, dados: feitoDados.dados, texto: msg, prioridade: prioridadeInicial(tipo, etapa, feitoDados.dados, now, pq.valor),
      etapa, aTempo: aTempoDaEtapa(etapa), pedidoPor, conta, filial: texto(corpo.filial, 40) || (feitoDados.dados.origem && feitoDados.dados.origem.filial) || feitoDados.dados.filial || '', area: def.area, status,
      resposta: '', responsavel: '', respondidoPor: '', naoAchado: listaP.lote ? pedidos.some((x) => x.naoAchado) : Boolean(corpo.naoAchado), criadoEm: quando, primeiraRespostaEm: '', concluidaEm: '', atualizadoEm: quando, paraQuando: pq.valor, pedidos, historico: []
    };
    add(nova, { em: quando, acao: 'criado', por: pedidoPor, texto: msg, status });
    linhas.unshift(nova);
    return { linhas, resultado: { id: nova.id, protocolo: nova.protocolo } };
  }
  const l = linhas.find((x) => x.id === texto(corpo && corpo.id, 40));
  if (['status', 'assumir', 'interno', 'prioridade', 'area', 'concluir_pedido'].includes(acao) && !l) return { linhas, erro: 'Solicitação não encontrada.' };
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
  if (acao === 'concluir_pedido') {
    // Lote: a equipe conclui um pedido de cada vez; quando todos estiverem atendidos a solicitação conclui sozinha.
    const p = numeroDoPedido(corpo.pedido), alvo = p ? l.pedidos.find((x) => x.pedido === p) : null;
    if (!alvo) return { linhas, erro: 'Este pedido não faz parte da solicitação.' };
    if (corpo.desfazer === true) {
      if (!alvo.concluido) return { linhas, resultado: { id: l.id } };
      alvo.concluido = false; alvo.concluidoEm = ''; alvo.concluidoPor = ''; l.atualizadoEm = quando;
      add(l, { em: quando, acao: 'pedido_concluido', por, texto: 'Pedido ' + p + ' reaberto' });
      if (FINAIS.includes(l.status)) { l.status = 'em_andamento'; l.concluidaEm = ''; add(l, { em: quando, acao: 'status', por, texto: 'Voltou para andamento: o pedido ' + p + ' foi reaberto.', status: 'em_andamento' }); }
      return { linhas, resultado: { id: l.id } };
    }
    if (!ATIVOS.includes(l.status)) return { linhas, erro: 'Esta solicitação já foi encerrada.' };
    if (alvo.concluido) return { linhas, resultado: { id: l.id } };
    alvo.concluido = true; alvo.concluidoEm = quando; alvo.concluidoPor = por;
    if (!l.responsavel && por) l.responsavel = por;
    if (!l.primeiraRespostaEm) l.primeiraRespostaEm = quando;
    l.respondidoPor = por; l.atualizadoEm = quando;
    add(l, { em: quando, acao: 'pedido_concluido', por, texto: 'Pedido ' + p + ' atendido' });
    if (l.pedidos.every((x) => x.concluido)) {
      const resposta = texto(corpo.resposta, 300) || 'Todos os pedidos foram atendidos.';
      l.status = 'concluida'; l.concluidaEm = quando; l.resposta = resposta;
      add(l, { em: quando, acao: 'status', por, texto: resposta, status: 'concluida' });
    }
    return { linhas, resultado: { id: l.id } };
  }
  return { linhas, erro: 'ação inválida' };
}

// ---- o que cada lado vê ------------------------------------------------------------------------------------------------------------------
// A vendedora vê o que aconteceu e quando, sem nomes da equipe e sem comentários internos.
function historicoPublico(l) {
  const saida = [];
  for (const h of l.historico) {
    if (h.acao === 'criado') saida.push({ em: h.em, status: h.status || 'recebida', texto: '' });
    else if (h.acao === 'pedido_concluido') saida.push({ em: h.em, status: '', texto: h.texto });
    else if (h.acao === 'status') saida.push({ em: h.em, status: h.status, texto: h.texto });
    else if (h.acao === 'assumir' && h.status) saida.push({ em: h.em, status: h.status, texto: '' });
  }
  return saida;
}
const visaoMeu = (l) => ({
  id: l.id, protocolo: l.protocolo, tipo: l.tipo, rotulo: (TIPOS[l.tipo] || TIPOS.outro).rotulo, pedido: l.pedido, dados: l.dados, texto: l.texto, status: l.status, resposta: l.resposta,
  etapa: l.etapa, aTempo: l.aTempo, aviso: l.etapa ? avisoDaEtapa(l.etapa) : '', criadoEm: l.criadoEm, atualizadoEm: l.atualizadoEm, historico: historicoPublico(l),
  paraQuando: l.paraQuando, pedidos: l.pedidos.map((p) => ({ pedido: p.pedido, etapa: p.etapa, naoAchado: p.naoAchado, concluido: p.concluido, concluidoEm: p.concluidoEm }))
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
    if (palavras.length) { const feno = semAcento([l.protocolo, l.pedido, (l.pedidos || []).map((x) => x.pedido).join(' '), l.pedidoPor, l.texto, l.filial, (TIPOS[l.tipo] || {}).rotulo, textoBusca(l.dados)].join(' ')); if (!palavras.every((w) => feno.includes(w))) return false; }
    return true;
  });
}

// ---- CSV ------------------------------------------------------------------------------------------------------------------------------
// as 3 últimas colunas foram acrescentadas depois (para quando, pedidos do lote, quantos já atendidos): as anteriores continuam na mesma ordem
const CABECALHO_CSV = ['id', 'protocolo', 'tipo', 'pedido', 'vendedora', 'filial', 'status', 'prioridade', 'criada', '1ª resposta', 'concluída', 'minutos até resposta', 'minutos até conclusão', 'para quando', 'pedidos do lote', 'pedidos atendidos'];
const celula = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // não deixa a planilha executar fórmula vinda de texto digitado
  return /[";\r\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function paraCsv(linhas) {
  const dt = (v) => (v ? new Date(v).toLocaleString('sv-SE', { timeZone: FUSO }) : '');
  const corpo = linhas.map((l) => [l.id, l.protocolo, (TIPOS[l.tipo] || TIPOS.outro).rotulo, l.pedido, l.pedidoPor, FILIAIS_ROTULO[l.filial] || l.filial, l.status, l.prioridade, dt(l.criadoEm), dt(l.primeiraRespostaEm), dt(l.concluidaEm),
    l.primeiraRespostaEm ? minutos(l.criadoEm, l.primeiraRespostaEm) : '', l.concluidaEm ? minutos(l.criadoEm, l.concluidaEm) : '', PQ.rotulo(l.paraQuando), l.pedidos.map((p) => p.pedido).join(' '), l.pedidos.length ? l.pedidos.filter((p) => p.concluido).length + ' de ' + l.pedidos.length : ''].map(celula).join(';'));
  return '﻿' + [CABECALHO_CSV.map(celula).join(';')].concat(corpo).join('\r\n') + '\r\n';
}

module.exports = {
  MAX_LINHAS, MAX_HISTORICO, LIMITE_POR_DIA, MAX_PEDIDOS_LOTE, DIAS_PARA_LIMPAR, TIPOS, TIPOS_IDS, AREAS, AREAS_ROTULO, STATUS, ATIVOS, FINAIS, PRIORIDADES, ETAPAS, FILIAIS, FILIAIS_INFO, FILIAIS_ROTULO, MAX_ITENS_TRANSFERENCIA,
  armazemDe, rotuloLocal, textoBusca, normalizarLinha, normalizarLista, limpar, novoProtocolo, aplicar, dadosDoTipo, filialDe, etapaDoRastreio, avisoDaEtapa, aTempoDaEtapa, prioridadeInicial, slaDe, minutos,
  historicoPublico, visaoMeu, ehDela, ehDonoPorNome, vincularConta, ordenarFila, filtrar, paraCsv, diaSP,
  listaDePedidos, etapaMaisAdiantada, ETAPAS_RECUSADAS, MOTIVOS_SAIR, MODOS_SAIDA, SUBTIPOS_NF, ACOES_FALTA, MODOS_ERRO
};
