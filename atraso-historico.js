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

// Dados extras do pedido (nome do cliente, NF, valor, etapa...): só as chaves conhecidas, com tamanho e tipo limitados.
const ETAPAS = new Set(['S', 'C', 'F', 'D']);
const dataIso = (v) => { const s = texto(v, 30); return s && !Number.isNaN(Date.parse(s)) ? s : ''; };
function extrasDoItem(x) {
  const saida = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return saida;
  for (const [k, max] of [['n', 60], ['c', 20], ['nf', 20], ['sp', 40], ['cf', 40]]) { const v = texto(x[k], max); if (v) saida[k] = v; }
  for (const k of ['pe', 'ce', 'fa', 'h']) { const v = dataIso(x[k]); if (v) saida[k] = v; }
  if (numero(x.v) > 0) saida.v = numero(x.v);
  if (inteiro(x.l) > 0) saida.l = inteiro(x.l);
  if (ETAPAS.has(x.e)) saida.e = x.e;
  return saida;
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
    itens.push([pedido, arm, lib, numero(it[3]), tipo, it[5] === 'P' ? 'P' : 'A', inteiro(it[6]), texto(it[7], 40), extrasDoItem(it[8])]);
  }
  const registro = { dia, total, pecas: numero(corpo.pecas), atualizadoEm: new Date().toISOString(), itens };
  const tpa = totalPorArmazemLimpo(corpo.totalPorArmazem);
  if (tpa) registro.totalPorArmazem = tpa; // campo opcional: só entra quando a exportação o envia
  return registro;
}

// { armazém: pedidos da base } — nomes curtos, no máximo 30 armazéns; lixo é ignorado. Devolve null se não sobrar nada.
function totalPorArmazemLimpo(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null;
  const saida = {};
  for (const arm of Object.keys(corpo).slice(0, 30)) {
    const nome = texto(arm, 20), n = inteiro(corpo[arm]);
    if (nome && n > 0) saida[nome] = n;
  }
  return Object.keys(saida).length ? saida : null;
}

// { armazém: { pedidos, pecas } } do despacho/faturamento de um dia; null se não houver.
function porArmazemLimpo(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null;
  const saida = {};
  for (const arm of Object.keys(corpo).slice(0, 30)) {
    const v = corpo[arm], nome = texto(arm, 20);
    if (!nome || !v || typeof v !== 'object') continue;
    const pedidos = inteiro(v.pedidos);
    if (pedidos > 0) saida[nome] = { pedidos, pecas: numero(v.pecas) };
  }
  return Object.keys(saida).length ? saida : null;
}

// Troca (ou inclui) só o dia do registro; os demais dias do mês ficam como estão.
function mesclarDia(mesAtual, registro) {
  const dias = Object.assign({}, (mesAtual && mesAtual.dias) || {});
  const antes = dias[registro.dia];
  // uma foto sem o total por armazém (cliente antigo) não apaga o que já estava gravado no dia
  dias[registro.dia] = (!registro.totalPorArmazem && antes && antes.totalPorArmazem) ? Object.assign({}, registro, { totalPorArmazem: antes.totalPorArmazem }) : registro;
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
    const por = porArmazemLimpo(v.por);
    if (por) saida[dia].por = por;
  }
  return saida;
}

// Junta os dias novos aos guardados do mês. Um dia só cresce: vale o maior número de pedidos (a ponta da planilha de Entrega pode vir cortada).
function mesclarDespachados(guardado, novos) {
  const dias = Object.assign({}, guardado || {});
  for (const [dia, v] of Object.entries(novos || {})) {
    // um dado antigo (sem o detalhe por armazém) não apaga o detalhe que já estava gravado para o mesmo dia
    if (!dias[dia] || v.pedidos >= dias[dia].pedidos) dias[dia] = (!v.por && dias[dia] && dias[dia].por) ? Object.assign({}, v, { por: dias[dia].por }) : v;
  }
  const ordenado = {};
  for (const k of Object.keys(dias).sort()) ordenado[k] = dias[k];
  return ordenado;
}

// { pedido: 'AAAA-MM-DD' } com a data em que o pedido foi despachado (planilha de Entrega); lixo é ignorado.
function normalizarEntregues(corpo) {
  const saida = {};
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return saida;
  let n = 0;
  for (const pedido of Object.keys(corpo)) {
    if (n >= MAX_ITENS) break;
    const dia = corpo[pedido], chave = texto(pedido, 30);
    if (!chave || !validarDia(dia)) continue;
    saida[chave] = dia;
    n++;
  }
  return saida;
}

// Junta os novos aos guardados e descarta quem foi despachado há mais de 120 dias (hoje = 'AAAA-MM-DD').
function mesclarEntregues(guardado, novos, hoje) {
  const todos = Object.assign({}, guardado || {}, novos || {});
  const limite = new Date(new Date(hoje + 'T12:00:00Z').getTime() - 120 * 864e5).toISOString().slice(0, 10);
  const saida = {};
  for (const [pedido, dia] of Object.entries(todos)) if (dia >= limite) saida[pedido] = dia;
  return saida;
}

module.exports = { MAX_ITENS, nomeDoMes, mesDoDia, validarDia, normalizarRegistro, mesclarDia, ultimosMeses, normalizarDespachados, mesclarDespachados, normalizarFaturados: normalizarDespachados, normalizarEntregues, mesclarEntregues };
