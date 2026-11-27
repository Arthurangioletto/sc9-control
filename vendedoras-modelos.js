/* Modelos rápidos das vendedoras ("Cliente retira hoje", "Reposição 01 → 02", "Subir PV"): um formulário salvo para preencher de novo em um toque.
 * Quem tem acesso (login) guarda no servidor, e vale em qualquer aparelho; quem não tem guarda só no aparelho (localStorage, no front).
 * Puro (sem disco). O modelo NÃO guarda número de pedido nem data: só o jeito de preencher. Tudo é limpo de novo na leitura. */
'use strict';
const S = require('./solicitacoes-store.js');

const MAX_MODELOS = 20;
const MAX_CONTAS = 2000;
const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const PQ_SEM_DATA = ['hoje_coleta', 'hoje_16h', 'amanha'];

// Limpa um modelo. estrito: { erro } no primeiro problema (nome, assunto); senão devolve null para o que não presta.
function normalizarModelo(bruto, estrito) {
  const b = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  const nome = texto(b.nome, 40), tipo = typeof b.tipo === 'string' && S.TIPOS[b.tipo] ? b.tipo : '';
  if (nome.length < 2) return estrito ? { erro: 'Dê um nome ao modelo (mínimo 2 letras).' } : null;
  if (!tipo) return estrito ? { erro: 'Escolha o assunto do modelo.' } : null;
  const dados = S.dadosDoTipo(tipo, b.dados, false).dados;
  const pq = b.paraQuando && typeof b.paraQuando === 'object' && PQ_SEM_DATA.includes(b.paraQuando.tipo) ? { tipo: b.paraQuando.tipo } : null;
  const modelo = { id: texto(b.id, 40), nome, tipo, dados, texto: texto(b.texto, 500), paraQuando: pq, criadoEm: '' };
  return estrito ? { modelo } : modelo;
}
const idNovo = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// Arquivo: { contas: [{ login, modelos: [...] }] } (lista, não objeto com o login como chave: "__proto__" não vira problema).
function normalizarArquivo(dado) {
  const contas = [], vistos = new Set();
  for (const c of (dado && Array.isArray(dado.contas) ? dado.contas : []).slice(0, MAX_CONTAS)) {
    const login = texto(c && c.login, 24).toLowerCase();
    if (!login || vistos.has(login)) continue;
    vistos.add(login);
    const modelos = [], ids = new Set();
    for (const m of (Array.isArray(c.modelos) ? c.modelos : []).slice(0, MAX_MODELOS)) {
      const n = normalizarModelo(m, false);
      if (!n || !n.id || ids.has(n.id)) continue;
      n.criadoEm = typeof m.criadoEm === 'string' && !Number.isNaN(Date.parse(m.criadoEm)) ? new Date(m.criadoEm).toISOString() : '';
      ids.add(n.id); modelos.push(n);
    }
    contas.push({ login, modelos });
  }
  return { contas };
}
const doLogin = (arq, login) => { const c = arq.contas.find((x) => x.login === String(login || '').toLowerCase()); return c ? c.modelos : []; };
// Guarda (ou troca, se o id já existe) um modelo do login. Devolve { arquivo, modelo } ou { erro }.
function salvar(arq, login, bruto, agora) {
  const n = normalizarModelo(bruto, true);
  if (n.erro) return n;
  const lg = String(login || '').toLowerCase();
  if (!lg) return { erro: 'Entre com o seu acesso para guardar modelos.' };
  const contas = arq.contas.map((c) => ({ login: c.login, modelos: c.modelos.slice() }));
  let c = contas.find((x) => x.login === lg);
  if (!c) { if (contas.length >= MAX_CONTAS) return { erro: 'Limite de contas com modelos atingido.' }; c = { login: lg, modelos: [] }; contas.push(c); }
  const modelo = Object.assign(n.modelo, { id: n.modelo.id && c.modelos.some((m) => m.id === n.modelo.id) ? n.modelo.id : idNovo(), criadoEm: new Date(Number.isFinite(agora) ? agora : Date.now()).toISOString() });
  const i = c.modelos.findIndex((m) => m.id === modelo.id);
  if (i >= 0) c.modelos[i] = modelo;
  else {
    if (c.modelos.some((m) => m.nome.toLowerCase() === modelo.nome.toLowerCase())) return { erro: 'Já existe um modelo com este nome. Escolha outro nome.' };
    if (c.modelos.length >= MAX_MODELOS) return { erro: 'Você já tem ' + MAX_MODELOS + ' modelos. Apague algum para guardar outro.' };
    c.modelos.push(modelo);
  }
  return { arquivo: { contas }, modelo };
}
function apagar(arq, login, id) {
  const lg = String(login || '').toLowerCase(), alvo = texto(id, 40);
  return { contas: arq.contas.map((c) => (c.login === lg ? { login: c.login, modelos: c.modelos.filter((m) => m.id !== alvo) } : c)) };
}
module.exports = { MAX_MODELOS, normalizarModelo, normalizarArquivo, doLogin, salvar, apagar };
