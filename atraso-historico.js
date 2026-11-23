/* Histórico de atraso do Relatório Geral: uma foto por dia (pedidos em atraso de estoque e de faturamento),
 * guardada por mês. Gravar um dia troca só aquele dia; os outros dias do mês ficam como estavam.
 * Registro: { dia:'AAAA-MM-DD', total, pecas, atualizadoEm, itens:[[pedido, armazém, liberadoEm, peças, 'E'|'F', 'A'|'P', diasDeAtraso, transportadora]] }
 * E = atraso de estoque (separação/conferência), F = atraso de faturamento (já conferido, só falta a nota);
 * A = Atrasado (passou do prazo), P = ainda em processo. */
'use strict';

const MAX_ITENS = 20000;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

const nomeDoMes = (mes) => 'atraso-historico-' + mes + '.json';
const mesDoDia = (dia) => dia.slice(0, 7);
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const inteiro = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };
const numero = (v) => { const n = Math.round(Number(v) * 100) / 100; return Number.isFinite(n) && n >= 0 ? n : 0; };

function validarDia(dia) {
  if (!DIA.test(String(dia || ''))) return false;
  const d = new Date(dia + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === dia;
}

// Devolve o registro limpo ou lança Error com a mensagem para o usuário.
function normalizarRegistro(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('Registro de atraso inválido.');
  const dia = String(corpo.dia || '');
  if (!validarDia(dia)) throw new Error('Dia inválido (use AAAA-MM-DD).');
  if (!Array.isArray(corpo.itens)) throw new Error('Faltou a lista de pedidos em atraso.');
  if (corpo.itens.length > MAX_ITENS) throw new Error('Lista de pedidos grande demais.');
  const total = inteiro(corpo.total);
  if (!total) throw new Error('A base não tem pedidos; nada para gravar.');
  const visto = new Set();
  const itens = [];
  for (const it of corpo.itens) {
    if (!Array.isArray(it)) continue;
    const pedido = texto(it[0], 30), arm = texto(it[1], 20);
    const tipo = it[4] === 'F' ? 'F' : it[4] === 'E' ? 'E' : '';
    if (!pedido || !tipo) continue;
    const chave = arm + '|' + pedido + '|' + tipo;
    if (visto.has(chave)) continue;
    visto.add(chave);
    const lib = DIA.test(String(it[2] || '')) ? String(it[2]) : '';
    itens.push([pedido, arm, lib, numero(it[3]), tipo, it[5] === 'P' ? 'P' : 'A', inteiro(it[6]), texto(it[7], 40)]);
  }
  return { dia, total, pecas: numero(corpo.pecas), atualizadoEm: new Date().toISOString(), itens };
}

// Troca (ou inclui) só o dia do registro; os demais dias do mês ficam como estão.
function mesclarDia(mesAtual, registro) {
  const dias = Object.assign({}, (mesAtual && mesAtual.dias) || {});
  dias[registro.dia] = registro;
  const ordenado = {};
  for (const k of Object.keys(dias).sort()) ordenado[k] = dias[k];
  return { mes: mesDoDia(registro.dia), dias: ordenado };
}

// "2026-11" → ["2026-11", "2026-10", ...] (n meses para trás, o mês dado primeiro)
function ultimosMeses(mesBase, n) {
  const [a, m] = mesBase.split('-').map(Number);
  const lista = [];
  for (let i = 0; i < n; i++) {
    const t = a * 12 + (m - 1) - i;
    lista.push(Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0'));
  }
  return lista;
}

// Pedidos e peças despachados por dia (pedidos que aparecem na planilha de Entrega). Chega junto da foto, quando o atraso é exportado.
// → { 'AAAA-MM-DD': { pedidos, pecas } } com valores limpos; lixo é ignorado.
function normalizarDespachados(corpo) {
  const saida = {};
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return saida;
  for (const dia of Object.keys(corpo).slice(0, 400)) {
    const v = corpo[dia];
    if (!validarDia(dia) || !v || typeof v !== 'object') continue;
    const pedidos = inteiro(v.pedidos);
    if (!pedidos) continue;
    saida[dia] = { pedidos, pecas: numero(v.pecas) };
  }
  return saida;
}

// Junta os dias novos aos guardados do mês. Um dia só cresce: vale o maior número de pedidos (a ponta da planilha de Entrega pode vir cortada).
function mesclarDespachados(guardado, novos) {
  const dias = Object.assign({}, guardado || {});
  for (const [dia, v] of Object.entries(novos || {})) {
    if (!dias[dia] || v.pedidos >= dias[dia].pedidos) dias[dia] = v;
  }
  const ordenado = {};
  for (const k of Object.keys(dias).sort()) ordenado[k] = dias[k];
  return ordenado;
}

module.exports = { MAX_ITENS, nomeDoMes, mesDoDia, validarDia, normalizarRegistro, mesclarDia, ultimosMeses, normalizarDespachados, mesclarDespachados };
