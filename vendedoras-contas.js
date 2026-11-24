/* Acesso opcional das vendedoras (login + código), por cima do link com código. Serve para a vendedora ver as próprias solicitações
 * em qualquer aparelho e para a logística saber quem pediu. Guardado em vendedoras-contas.json.
 * Cada conta: { id, login, nome, salt, hash, sv, ativo, criadoEm, ultimoAcesso }. O código nunca é guardado: só hash (scrypt) com sal.
 * A sessão é um token assinado (HMAC), sem estado; trocar/redefinir o código muda "sv" e derruba as sessões antigas.
 * Só validação e criptografia, sem acesso a disco nem rede. */
'use strict';
const crypto = require('crypto');

const MAX_CONTAS = 500;
const TTL_SESSAO_S = 60 * 60 * 24 * 30;
const ALFABETO_TEMP = 'abcdefghjkmnpqrstuvwxyz23456789'; // sem letras/números que se confundem (0 o 1 l i)

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const dataHora = (v) => { const s = texto(v, 30); return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : ''; };

// login: 3 a 24 caracteres, só letras minúsculas, números, ponto, hífen e sublinhado (maiúsculas viram minúsculas)
function normalizarLogin(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^[a-z0-9._-]{3,24}$/.test(s) ? s : '';
}
function validarCodigo(codigo, login) {
  const c = String(codigo == null ? '' : codigo);
  if (c.length < 6) return 'O código precisa ter pelo menos 6 caracteres.';
  if (c.length > 40) return 'O código pode ter no máximo 40 caracteres.';
  if (login && c.toLowerCase() === String(login).toLowerCase()) return 'O código não pode ser igual ao login.';
  if (/^(.)\1+$/.test(c) || ['123456', '1234567', '12345678', 'senha123', 'abc123', '654321'].includes(c.toLowerCase())) return 'Esse código é fácil demais de adivinhar. Escolha outro.';
  return '';
}

function scrypt(codigo, salt) {
  return new Promise((ok, erro) => crypto.scrypt(String(codigo), salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? erro(e) : ok(k.toString('hex')))));
}
async function criarHash(codigo) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: await scrypt(codigo, salt) };
}
async function conferirCodigo(conta, codigo) {
  if (!conta || !conta.salt || !conta.hash) { await scrypt(String(codigo), 'sem-conta'); return false; } // gasta o mesmo tempo mesmo sem conta
  const a = Buffer.from(await scrypt(codigo, conta.salt), 'hex'), b = Buffer.from(String(conta.hash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const codigoTemporario = () => Array.from(crypto.randomBytes(8), (b) => ALFABETO_TEMP[b % ALFABETO_TEMP.length]).join('');

// E-mail corporativo: só vale quem tem "implacil" no domínio (depois do @), por exemplo nome@implacil.com.br.
// O SC9 não confirma que a pessoa é dona do e-mail (não manda mensagem): é uma barreira de cadastro, não uma verificação.
function normalizarEmail(v) { return String(v == null ? '' : v).trim().toLowerCase().slice(0, 120); }
function validarEmailCorporativo(v) {
  const e = normalizarEmail(v);
  if (!e) return 'Informe seu e-mail corporativo da Implacil (ex.: nome@implacil.com.br).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Esse e-mail não parece válido. Use o e-mail corporativo da Implacil (ex.: nome@implacil.com.br).';
  if (!e.slice(e.indexOf('@') + 1).includes('implacil')) return 'Só e-mail corporativo da Implacil libera o acesso (o endereço precisa ter "implacil", ex.: nome@implacil.com.br).';
  return '';
}
function normalizarConta(x) {
  if (!x || typeof x !== 'object') return null;
  const login = normalizarLogin(x.login), id = texto(x.id, 40);
  if (!login || !id || !x.salt || !x.hash) return null;
  return { id, login, nome: texto(x.nome, 60) || login, salt: texto(x.salt, 64), hash: texto(x.hash, 128), sv: Number.isFinite(Number(x.sv)) ? Number(x.sv) : 0, ativo: x.ativo !== false, email: normalizarEmail(x.email), criadoEm: dataHora(x.criadoEm), ultimoAcesso: dataHora(x.ultimoAcesso) };
}
function normalizarLista(dado) {
  const lista = [], logins = new Set();
  for (const it of (dado && Array.isArray(dado.contas) ? dado.contas : [])) {
    const c = normalizarConta(it);
    if (!c || logins.has(c.login)) continue;
    logins.add(c.login); lista.push(c);
    if (lista.length >= MAX_CONTAS) break;
  }
  return lista;
}

// O que sai da conta para a própria vendedora e para a logística: nunca sal nem hash.
const visaoPublica = (c) => ({ id: c.id, login: c.login, nome: c.nome, email: c.email || '' });
const visaoAdmin = (c) => ({ id: c.id, login: c.login, nome: c.nome, email: c.email || '', ativo: c.ativo, criadoEm: c.criadoEm, ultimoAcesso: c.ultimoAcesso });

// Sessão: v1.<id>.<sv>.<expira>.<assinatura>
const assinar = (segredo, corpo) => crypto.createHmac('sha256', segredo + '|vendedoras').update(corpo).digest('base64url');
function emitirSessao(segredo, conta, agora) {
  const exp = Math.floor((agora || Date.now()) / 1000) + TTL_SESSAO_S;
  const corpo = ['v1', conta.id, conta.sv, exp].join('.');
  return corpo + '.' + assinar(segredo, corpo);
}
// Devolve { id, sv } se a assinatura e a validade estiverem certas; a conta (ativa, mesma "sv") é conferida por quem chama.
function lerSessao(segredo, token, agora) {
  const p = String(token || '').split('.');
  if (p.length !== 5 || p[0] !== 'v1') return null;
  const corpo = p.slice(0, 4).join('.'), esperado = assinar(segredo, corpo), recebido = p[4];
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido))) return null;
  if (!(Number(p[3]) > Math.floor((agora || Date.now()) / 1000))) return null;
  return { id: p[1], sv: Number(p[2]) };
}
const contaDaSessao = (contas, sessao) => (sessao ? contas.find((c) => c.id === sessao.id && c.ativo && c.sv === sessao.sv) || null : null);

module.exports = { normalizarEmail, validarEmailCorporativo, MAX_CONTAS, TTL_SESSAO_S, normalizarLogin, validarCodigo, criarHash, conferirCodigo, codigoTemporario, normalizarConta, normalizarLista, visaoPublica, visaoAdmin, emitirSessao, lerSessao, contaDaSessao };
