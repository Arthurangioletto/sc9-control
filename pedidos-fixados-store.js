/* Lista de pedidos fixados (acompanhamento no painel inicial). Compartilhada pela equipe; guardada em pedidos-fixados.json.
 * Cada item: { pedido, nota (observação opcional), por (login), em (ISO) }. Só validação e mesclagem, sem acesso a disco. */
'use strict';

const MAX_FIXADOS = 200;

// Número do pedido: só dígitos, sem zeros à esquerda, 4 a 10 dígitos (mesma regra do servidor para a Saída p/ Expedição).
function numeroDoPedido(x) {
  const d = String(x === null || x === undefined ? '' : x).replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 4 && d.length <= 10 ? d : null;
}

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const dataIso = (v) => { const s = texto(v, 30); return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : ''; };

function normalizarLista(dado) {
  const lista = [];
  const vistos = new Set();
  for (const it of (dado && Array.isArray(dado.itens) ? dado.itens : [])) {
    const pedido = numeroDoPedido(it && it.pedido);
    if (!pedido || vistos.has(pedido)) continue;
    vistos.add(pedido);
    lista.push({ pedido, nota: texto(it.nota, 120), por: texto(it.por, 60), em: dataIso(it.em) || new Date(0).toISOString() });
    if (lista.length >= MAX_FIXADOS) break;
  }
  return lista;
}

// Aplica uma ação e devolve { itens, erro? }. Ações: fixar (pedido, nota), remover (pedido), nota (pedido, nota).
function aplicar(itensAtuais, corpo, usuario, agora) {
  const itens = normalizarLista({ itens: itensAtuais });
  const acao = corpo && corpo.acao;
  const pedido = numeroDoPedido(corpo && corpo.pedido);
  if (!['fixar', 'remover', 'nota'].includes(acao)) return { itens, erro: 'ação inválida' };
  if (!pedido) return { itens, erro: 'Número de pedido inválido (use de 4 a 10 dígitos).' };
  const i = itens.findIndex((x) => x.pedido === pedido);
  if (acao === 'remover') {
    if (i >= 0) itens.splice(i, 1);
    return { itens };
  }
  const nota = texto(corpo.nota, 120);
  if (acao === 'nota') {
    if (i < 0) return { itens, erro: 'Esse pedido não está fixado.' };
    itens[i] = Object.assign({}, itens[i], { nota });
    return { itens };
  }
  if (i >= 0) { if (nota) itens[i] = Object.assign({}, itens[i], { nota }); return { itens }; }
  if (itens.length >= MAX_FIXADOS) return { itens, erro: 'Limite de ' + MAX_FIXADOS + ' pedidos fixados.' };
  itens.unshift({ pedido, nota, por: texto(usuario, 60), em: new Date(agora || Date.now()).toISOString() });
  return { itens };
}

module.exports = { MAX_FIXADOS, numeroDoPedido, normalizarLista, aplicar };
