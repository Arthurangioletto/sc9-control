/* Avisos das vendedoras para a expedição: a vendedora informa algo sobre um pedido (cliente mudou o endereço, vai retirar, trocar a
 * transportadora...) e a equipe vê, assume, responde e resolve. Lista compartilhada em avisos-vendedoras.json.
 * É separado das ocorrências oficiais da expedição: a equipe decide o que vira ocorrência.
 * Cada linha: { id, protocolo, pedido, tipo, texto, pedidoPor, conta, filial, status, resposta, responsavel, respondidoPor, naoAchado,
 *               criadoEm, atualizadoEm, historico[] }. O histórico só cresce (quem, quando, o quê).
 * Só validação e mesclagem, sem acesso a disco. */
'use strict';
const { numeroDoPedido } = require('./prioridades-store.js');

const MAX_LINHAS = 3000;
const MAX_HISTORICO = 60;
const TIPOS = ['endereco', 'retirada', 'transportadora', 'cancelar', 'produto', 'outro'];
const STATUS = ['recebido', 'em_andamento', 'resolvido'];
const ATIVOS = ['recebido', 'em_andamento'];
const ACOES_HIST = ['criado', 'status', 'assumir', 'interno'];
const LIMITE_POR_DIA = 10; // avisos por vendedora (login ou nome) em 24 h
const DIAS_PARA_LIMPAR = 90;
const FUSO = 'America/Sao_Paulo';

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const dataHora = (v) => { const s = texto(v, 30); return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : ''; };

let contador = 0;
const novoId = (agora) => 'a' + Number(agora || Date.now()).toString(36) + (contador++ % 1296).toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);

function normalizarLinha(x) {
  if (!x || typeof x !== 'object') return null;
  const pedido = numeroDoPedido(x.pedido), id = texto(x.id, 40);
  if (!pedido || !id) return null;
  return {
    id, pedido, protocolo: texto(x.protocolo, 30), tipo: TIPOS.includes(x.tipo) ? x.tipo : 'outro', texto: texto(x.texto, 500),
    pedidoPor: texto(x.pedidoPor, 60), conta: texto(x.conta, 24), filial: texto(x.filial, 40), status: STATUS.includes(x.status) ? x.status : 'recebido',
    resposta: texto(x.resposta, 300), responsavel: texto(x.responsavel, 60), respondidoPor: texto(x.respondidoPor, 60), naoAchado: Boolean(x.naoAchado),
    criadoEm: dataHora(x.criadoEm), atualizadoEm: dataHora(x.atualizadoEm),
    historico: (Array.isArray(x.historico) ? x.historico : []).slice(-MAX_HISTORICO).map((h) => ({
      em: dataHora(h && h.em), acao: ACOES_HIST.includes(h && h.acao) ? h.acao : 'status', por: texto(h && h.por, 60), texto: texto(h && h.texto, 500), status: STATUS.includes(h && h.status) ? h.status : ''
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
  return linhas.filter((l) => ATIVOS.includes(l.status) || Date.parse(l.atualizadoEm || l.criadoEm || 0) >= corte);
}
// Protocolo legível: AVI-AAAAMMDD-NNN (NNN = ordem do dia)
function novoProtocolo(linhas, agora) {
  const prefixo = 'AVI-' + new Date(agora || Date.now()).toLocaleDateString('sv-SE', { timeZone: FUSO }).replace(/-/g, '') + '-';
  let maior = 0;
  for (const l of linhas) if (l.protocolo && l.protocolo.startsWith(prefixo)) maior = Math.max(maior, Number(l.protocolo.slice(prefixo.length)) || 0);
  return prefixo + String(maior + 1).padStart(3, '0');
}
const add = (l, h) => { l.historico = l.historico.concat([h]).slice(-MAX_HISTORICO); };

// criar   { pedido, tipo, texto, pedidoPor, conta?, filial?, naoAchado? }   (a vendedora)
// status  { id, status, resposta }                                          (a equipe logada)
// assumir { id }                                                            (a equipe: registra quem pegou; recebido vira em andamento)
// interno { id, texto }                                                     (comentário só da equipe)
function aplicar(linhasAtuais, corpo, quem, agora) {
  const linhas = limpar(normalizarLista({ linhas: linhasAtuais }), agora);
  const acao = corpo && corpo.acao, quando = new Date(agora || Date.now()).toISOString(), por = texto(quem, 60);
  if (acao === 'criar') {
    const pedido = numeroDoPedido(corpo.pedido);
    if (!pedido) return { linhas, erro: 'Número do pedido inválido (só números, de 4 a 10 dígitos).' };
    if (!TIPOS.includes(corpo.tipo)) return { linhas, erro: 'Escolha o tipo de aviso.' };
    const msg = texto(corpo.texto, 500);
    if (msg.length < 5) return { linhas, erro: 'Escreva a informação para a expedição (mínimo 5 letras).' };
    const pedidoPor = texto(corpo.pedidoPor, 60);
    if (pedidoPor.length < 2) return { linhas, erro: 'Diga seu nome para a equipe saber quem avisou.' };
    const desde = (agora || Date.now()) - 864e5, quemAvisou = pedidoPor.toLowerCase();
    if (linhas.filter((l) => l.pedidoPor.toLowerCase() === quemAvisou && Date.parse(l.criadoEm) >= desde).length >= LIMITE_POR_DIA) return { linhas, erro: 'Você já enviou ' + LIMITE_POR_DIA + ' avisos hoje. Fale direto com a equipe da expedição.' };
    if (linhas.length >= MAX_LINHAS) return { linhas, erro: 'A lista de avisos está cheia no momento. Fale com a equipe da expedição.' };
    const nova = { id: novoId(agora), protocolo: novoProtocolo(linhas, agora), pedido, tipo: corpo.tipo, texto: msg, pedidoPor, conta: texto(corpo.conta, 24), filial: texto(corpo.filial, 40), status: 'recebido', resposta: '', responsavel: '', respondidoPor: '', naoAchado: Boolean(corpo.naoAchado), criadoEm: quando, atualizadoEm: quando, historico: [{ em: quando, acao: 'criado', por: pedidoPor, texto: msg, status: 'recebido' }] };
    linhas.unshift(nova);
    return { linhas, resultado: { id: nova.id } };
  }
  const l = linhas.find((x) => x.id === texto(corpo && corpo.id, 40));
  if (['status', 'assumir', 'interno'].includes(acao) && !l) return { linhas, erro: 'Aviso não encontrado.' };
  if (acao === 'status') {
    if (!STATUS.includes(corpo.status)) return { linhas, erro: 'Status inválido.' };
    const resposta = texto(corpo.resposta, 300);
    l.status = corpo.status; if (resposta) l.resposta = resposta;
    if (!l.responsavel && por) l.responsavel = por;
    l.respondidoPor = por; l.atualizadoEm = quando;
    add(l, { em: quando, acao: 'status', por, texto: resposta, status: corpo.status });
    return { linhas, resultado: { id: l.id } };
  }
  if (acao === 'assumir') {
    if (!por) return { linhas, erro: 'Quem está assumindo?' };
    if (!ATIVOS.includes(l.status)) return { linhas, erro: 'Este aviso já foi resolvido.' };
    l.responsavel = por; l.atualizadoEm = quando;
    const muda = l.status === 'recebido'; if (muda) l.status = 'em_andamento';
    add(l, { em: quando, acao: 'assumir', por, texto: '', status: muda ? 'em_andamento' : '' });
    return { linhas, resultado: { id: l.id } };
  }
  if (acao === 'interno') {
    const t = texto(corpo.texto, 300);
    if (!t) return { linhas, erro: 'Escreva o comentário.' };
    l.atualizadoEm = quando; add(l, { em: quando, acao: 'interno', por, texto: t, status: '' });
    return { linhas, resultado: { id: l.id } };
  }
  return { linhas, erro: 'ação inválida' };
}

// O que a vendedora vê do histórico: o que aconteceu e quando, sem nomes da equipe e sem comentários internos.
function historicoPublico(l) {
  const saida = [];
  for (const h of l.historico) {
    if (h.acao === 'criado') saida.push({ em: h.em, status: 'recebido', texto: '' });
    else if (h.acao === 'status') saida.push({ em: h.em, status: h.status, texto: h.texto });
    else if (h.acao === 'assumir' && h.status) saida.push({ em: h.em, status: h.status, texto: '' });
  }
  return saida;
}
const visaoMeu = (l) => ({ id: l.id, protocolo: l.protocolo, pedido: l.pedido, tipo: l.tipo, texto: l.texto, status: l.status, resposta: l.resposta, criadoEm: l.criadoEm, atualizadoEm: l.atualizadoEm, historico: historicoPublico(l) });
// Cada vendedora só enxerga os avisos que ela mesma enviou: pelo login, ou pelo nome quando não tem login (junto com o id do aviso).
const ehDela = (l, login) => Boolean(login) && l.conta === login;
const ehDonoPorNome = (l, nome) => !l.conta && Boolean(nome) && l.pedidoPor.toLowerCase() === String(nome).toLowerCase();

// Liga ao login da vendedora os avisos que ela já tinha enviado neste aparelho (só os sem conta e com o mesmo nome).
function vincularConta(linhasAtuais, ids, nome, login) {
  const linhas = normalizarLista({ linhas: linhasAtuais });
  const quero = new Set((Array.isArray(ids) ? ids : []).map((x) => texto(x, 40)).filter(Boolean).slice(0, 100)), n = texto(nome, 60).toLowerCase();
  let mudou = 0;
  for (const l of linhas) if (quero.has(l.id) && !l.conta && l.pedidoPor.toLowerCase() === n) { l.conta = login; mudou++; }
  return { linhas, mudou };
}

module.exports = { MAX_LINHAS, LIMITE_POR_DIA, TIPOS, STATUS, ATIVOS, normalizarLinha, normalizarLista, limpar, novoProtocolo, aplicar, historicoPublico, visaoMeu, vincularConta, ehDela, ehDonoPorNome };
