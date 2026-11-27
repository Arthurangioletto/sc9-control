/* "Para quando?": prazo estruturado e opcional que a vendedora informa em Prioridade e em Solicitar (hoje antes da coleta, hoje até 16h, amanhã ou uma data).
 * Puro (sem disco). Guardado como { tipo, data }: `data` é sempre o dia já resolvido em São Paulo (AAAA-MM-DD), para a logística ver o dia certo mesmo depois.
 * Só aceita valores da lista; qualquer outra coisa (inclusive "constructor" ou "__proto__") é recusada. */
'use strict';

const FUSO = 'America/Sao_Paulo';
const TIPOS = ['hoje_coleta', 'hoje_16h', 'amanha', 'data'];
const ROTULO = { hoje_coleta: 'Hoje, antes da coleta', hoje_16h: 'Hoje, até as 16h', amanha: 'Amanhã', data: 'Em uma data' };
Object.setPrototypeOf(ROTULO, null);
const MAX_DIAS_A_FRENTE = 366;

const diaSP = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: FUSO });
const somaDias = (dia, n) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function dataValida(v) {
  const s = typeof v === 'string' ? v.trim().slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : '';
}
const vazio = (v) => v == null || v === '' || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

// Criação (estrito): devolve { valor } (null se não informou) ou { erro }.
function validar(bruto, agora) {
  if (vazio(bruto)) return { valor: null };
  const hoje = diaSP(Number.isFinite(agora) ? agora : Date.now());
  const o = typeof bruto === 'string' ? { tipo: bruto } : bruto;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { erro: 'Escolha uma opção válida em "Para quando".' };
  const tipo = typeof o.tipo === 'string' ? o.tipo : '';
  if (!TIPOS.includes(tipo)) return { erro: 'Escolha uma opção válida em "Para quando".' };
  if (tipo === 'hoje_coleta' || tipo === 'hoje_16h') return { valor: { tipo, data: hoje } };
  if (tipo === 'amanha') return { valor: { tipo, data: somaDias(hoje, 1) } };
  const data = dataValida(o.data);
  if (!data) return { erro: 'Escolha uma data válida em "Para quando" (use o calendário).' };
  if (data < hoje) return { erro: 'A data de "Para quando" não pode ser no passado.' };
  if (data > somaDias(hoje, MAX_DIAS_A_FRENTE)) return { erro: 'A data de "Para quando" está muito distante (no máximo 1 ano).' };
  return { valor: { tipo, data } };
}
// Leitura do arquivo: só limpa, nunca reclama. Devolve { tipo, data } ou null.
function normalizar(bruto) {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const tipo = typeof bruto.tipo === 'string' && TIPOS.includes(bruto.tipo) ? bruto.tipo : '';
  if (!tipo) return null;
  return { tipo, data: dataValida(bruto.data) };
}
const dataBR = (iso) => (iso ? iso.slice(8) + '/' + iso.slice(5, 7) : '');
// Texto curto para listas e planilhas.
function rotulo(pq) {
  const v = normalizar(pq);
  if (!v) return '';
  if (v.tipo === 'data') return 'Até ' + (v.data ? dataBR(v.data) + '/' + v.data.slice(0, 4) : 'data não informada');
  return ROTULO[v.tipo] + (v.data ? ' (' + dataBR(v.data) + ')' : '');
}
// Vence hoje (ou antes)? Usado para subir a prioridade inicial.
const ehHoje = (pq, agora) => { const v = normalizar(pq); return Boolean(v && v.data && v.data <= diaSP(Number.isFinite(agora) ? agora : Date.now())); };

module.exports = { TIPOS, ROTULO, validar, normalizar, rotulo, ehHoje, diaSP, somaDias, dataValida };
