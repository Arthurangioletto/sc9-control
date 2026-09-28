// Servidor sem dependências externas (só Node puro) — mais rápido de instalar
// no Render e mais fácil de eu testar aqui antes de te entregar.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const util = require("util");
const { saveSnapshot, loadSnapshot, usingSupabase } = require("./storage");

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || ""; // vazio = sem senha (não recomendado em produção)
const COOKIE_NAME = "sc9_auth";
const PUBLIC_DIR = __dirname; // tudo solto na raiz do projeto agora — sem pasta "public"
// só estes dois arquivos podem ser servidos por HTTP — evita expor server.js/storage.js
// (que não têm segredo nenhum dentro, mas não custa não servir código-fonte à toa)
const SERVABLE = new Set(["index.html", "bundle.js"]);
// ---- Armazenamento AUTOSSUFICIENTE (não depende do storage.js) ----
// Arquivos próprios, separados do snapshot do SC9, pra atualizar o SC9 todo dia
// nunca apagar nada disso:
//   controle-0201.json   -> registros do Controle 02->01
//   usuarios-controle.json -> acessos (operadores) criados pelo administrador
//   saldo-lotes.json     -> só o saldo por lote (é o que o operador precisa pra
//                           conferir; ele NUNCA recebe pedidos/itens do SC9)
// Usa o mesmo Supabase do resto (mesmas variáveis de ambiente); sem Supabase,
// cai num arquivo local.
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_BUCKET = process.env.SUPABASE_BUCKET || "sc9-data";
const LOCAL_DIR = path.join(__dirname, "data");
const CONTROLE_OBJ = "controle-0201.json";
const USUARIOS_OBJ = "usuarios-controle.json";
const SALDO_OBJ = "saldo-lotes.json";
const objUrl = (name) => `${SB_URL.replace(/\/$/, "")}/storage/v1/object/${SB_BUCKET}/${name}`;

async function objLoad(name) {
  if (SB_URL && SB_KEY) {
    const res = await fetch(objUrl(name), { headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY } });
    if (res.ok) return await res.json();
    const txt = await res.text().catch(() => "");
    let code = "";
    try { code = String(JSON.parse(txt).statusCode || ""); } catch { /* corpo não é JSON */ }
    // objeto ainda não existe (o Supabase responde 404, ou 400 com statusCode 404 no corpo)
    if (res.status === 404 || code === "404" || /not.?found|does not exist|no such/i.test(txt)) return null;
    throw new Error(`Supabase Storage (leitura de ${name}) falhou (${res.status}): ${txt}`);
  }
  const file = path.join(LOCAL_DIR, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function objSave(name, obj) {
  const body = JSON.stringify(obj);
  if (SB_URL && SB_KEY) {
    const res = await fetch(objUrl(name) + "?upsert=true", {
      method: "POST",
      headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY, "Content-Type": "application/json", "x-upsert": "true" },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Supabase Storage (gravação de ${name}) falhou (${res.status}): ${txt}`);
    }
    return;
  }
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_DIR, name), body, "utf8");
}
const loadControle = () => objLoad(CONTROLE_OBJ);
const saveControle = (o) => objSave(CONTROLE_OBJ, o);

const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20MB — dá folga pro JSON de um mês inteiro de pedidos

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// ---------------------------------------------------------------------------
// ACESSOS: "admin" (senha APP_PASSWORD, vê tudo) e "operador" (login+senha
// criados pelo admin; só usa o Controle 02->01). A permissão é aplicada AQUI no
// servidor — esconder aba no navegador não protegeria nada.
// A sessão é um token assinado (HMAC) no cookie; o navegador não consegue
// forjar nem trocar de pessoa.
// ---------------------------------------------------------------------------
const SESSION_COOKIE = "sc9_sess";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash("sha256").update("sc9-sessao|" + APP_PASSWORD).digest("hex");
const TTL_ADMIN_S = 60 * 60 * 24 * 30;
const TTL_OPERADOR_S = 60 * 60 * 24 * 7;
// perfis = quais telas o operador pode usar. Acessos criados antes disso só tinham o controle 02->01.
const PERFIS = ["controle0201", "saida"];
const perfisDe = (u) => { const p = Array.isArray(u.perfis) ? u.perfis.filter((x) => PERFIS.includes(x)) : []; return p.length ? p : ["controle0201"]; };
const ADMIN = () => ({ usuario: "admin", nome: "Administrador", role: "admin", perfis: PERFIS });

function assinarToken(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(b).digest("base64url");
  return `${b}.${sig}`;
}
function verificarToken(token) {
  const [b, sig] = String(token || "").split(".");
  if (!b || !sig) return null;
  const esperado = crypto.createHmac("sha256", SESSION_SECRET).update(b).digest("base64url");
  if (!timingSafeEqualStr(sig, esperado)) return null;
  try {
    const p = JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
    if (!p || typeof p.exp !== "number" || p.exp * 1000 < Date.now()) return null;
    return p;
  } catch { return null; }
}

// ---- usuários (operadores) ----
const scrypt = util.promisify(crypto.scrypt);
async function hashSenha(senha, saltHex) {
  const buf = await scrypt(String(senha), Buffer.from(saltHex, "hex"), 32);
  return buf.toString("hex");
}
async function verificaSenha(senha, u) {
  return timingSafeEqualStr(await hashSenha(senha, u.salt), u.hash);
}
const filas = new Map();
function comFila(chave, fn) {
  const anterior = filas.get(chave) || Promise.resolve();
  const run = anterior.then(fn, fn);
  filas.set(chave, run.catch(() => {}));
  return run;
}
let usuariosCache = { at: 0, lista: null };
async function carregarUsuarios(force) {
  if (!force && usuariosCache.lista && Date.now() - usuariosCache.at < 10000) return usuariosCache.lista;
  try {
    const data = await objLoad(USUARIOS_OBJ);
    usuariosCache = { at: Date.now(), lista: data && Array.isArray(data.users) ? data.users : [] };
  } catch (e) {
    if (usuariosCache.lista) return usuariosCache.lista; // storage oscilou: usa a última lista conhecida
    throw e;
  }
  return usuariosCache.lista;
}
async function achaUsuario(login) {
  try { return (await carregarUsuarios(false)).find((u) => u.usuario === login) || null; } catch { return null; }
}
function alterarUsuarios(fn) {
  return comFila("usuarios", async () => {
    const atual = await carregarUsuarios(true);
    const nova = await fn(JSON.parse(JSON.stringify(atual)));
    await objSave(USUARIOS_OBJ, { users: nova, savedAt: new Date().toISOString() });
    usuariosCache = { at: Date.now(), lista: nova };
    return nova;
  });
}
const usuarioPublico = (u) => ({ usuario: u.usuario, nome: u.nome, ativo: u.ativo !== false, criadoEm: u.criadoEm || null, perfis: perfisDe(u) });
class ErroHttp extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function getSession(req) {
  if (!APP_PASSWORD) return ADMIN(); // sem senha configurada: todo mundo é administrador
  const cookies = parseCookies(req.headers.cookie);
  const p = verificarToken(cookies[SESSION_COOKIE]);
  if (p) {
    if (p.r === "admin") return ADMIN();
    const u = await achaUsuario(p.u);
    // desativar o acesso ou trocar a senha (sv) derruba a sessão na hora
    if (u && u.ativo !== false && (u.sv || 0) === (p.sv || 0)) return { usuario: u.usuario, nome: u.nome, role: "operador", perfis: perfisDe(u) };
    return null;
  }
  // compatibilidade: cookie antigo (senha do administrador) e cabeçalho x-app-password
  if (cookies["sc9_auth"] && timingSafeEqualStr(cookies["sc9_auth"], APP_PASSWORD)) return ADMIN();
  const header = req.headers["x-app-password"];
  if (header && timingSafeEqualStr(header, APP_PASSWORD)) return ADMIN();
  return null;
}
async function exigir(req, res, papeis, perfil) {
  const sess = await getSession(req);
  if (!sess) { sendJson(res, 401, { error: "não autenticado" }); return null; }
  if (papeis && !papeis.includes(sess.role)) { sendJson(res, 403, { error: "seu acesso não permite isso" }); return null; }
  if (perfil && sess.role !== "admin" && !(sess.perfis || []).includes(perfil)) { sendJson(res, 403, { error: "seu acesso não permite isso" }); return null; }
  return sess;
}
function colocarCookie(res, sess, sv) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const ttl = sess.role === "admin" ? TTL_ADMIN_S : TTL_OPERADOR_S;
  const token = assinarToken({ u: sess.usuario, r: sess.role, sv: sv || 0, exp: Math.floor(Date.now() / 1000) + ttl });
  res.setHeader("Set-Cookie", [
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Max-Age=${ttl}${secure}; Path=/`,
    `sc9_auth=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`, // apaga o cookie antigo que guardava a senha
  ]);
}
// trava de tentativas erradas (por IP + usuário)
const falhas = new Map();
const ipDe = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const bloqueado = (k) => { const f = falhas.get(k); return Boolean(f && f.n >= 8 && Date.now() - f.t < 10 * 60 * 1000); };
const registraFalha = (k) => { const f = falhas.get(k); const agora = Date.now(); falhas.set(k, !f || agora - f.t > 10 * 60 * 1000 ? { n: 1, t: agora } : { n: f.n + 1, t: f.t }); };

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error("corpo da requisição excede o limite")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(new Error("JSON inválido no corpo da requisição")); }
    });
    req.on("error", reject);
  });
}

// Fila simples: dois salvamentos do controle ao mesmo tempo não se atropelam
// (cada um lê, junta e grava um de cada vez).
let controleFila = Promise.resolve();
function comFilaControle(fn) {
  const run = controleFila.then(fn, fn);
  controleFila = run.catch(() => {});
  return run;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  const name = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  if (!SERVABLE.has(name)) {
    // qualquer coisa fora da lista (inclusive rotas de navegação tipo /alguma-coisa)
    // cai no index.html — é o comportamento normal de uma SPA
    return fs.readFile(path.join(PUBLIC_DIR, "index.html"), (err, data) => {
      if (err) { res.writeHead(404); return res.end("não encontrado"); }
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache, no-store, must-revalidate" });
      res.end(data);
    });
  }
  fs.readFile(path.join(PUBLIC_DIR, name), (err, data) => {
    if (err) { res.writeHead(404); return res.end("não encontrado"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(name)] || "application/octet-stream", "Cache-Control": "no-cache, no-store, must-revalidate" });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// SAÍDA PARA EXPEDIÇÃO: o conferente BIPA o número do pedido; o servidor devolve
// as informações completas do pedido e, no mesmo passo, registra ele como
// "na expedição". Tudo acontece numa fila única no servidor, então 4 pessoas
// bipando ao mesmo tempo não se atropelam, e o mesmo pedido nunca entra 2 vezes
// sem querer (o 2º recebe "já bipado por Fulano às hh:mm").
// ---------------------------------------------------------------------------
const INDICE_OBJ = "pedidos-indice.json";
const TRANSP_NOMES = { "2": "Brasil", "4": "Retira 01", "5": "Retira 02", "6": "Retira 03", "7": "Retira 04", "10057": "Emergência", "10023": "São Paulo" };
const DESFAZER_MS = Number(process.env.SAIDA_DESFAZER_MS) || 5 * 60 * 1000;
const SAIDA_DIAS_DUP = 3;

// Só o que o conferente precisa pra conferir o bipe. Pedidos/itens completos do SC9
// continuam só com o administrador.
function montarIndicePedidos(p) {
  const nomes = new Map((p.itemNames || []).map(([k, v]) => [String(k), String(v)]));
  const sc5 = new Map((p.sc5PorPedido || []).map(([k, v]) => [String(k), String(v).replace(/\.0$/, "")]));
  const itensPorPed = new Map(), fimConf = new Map();
  for (const it of p.items || []) {
    const k = String(it.pedido);
    if (!itensPorPed.has(k)) itensPorPed.set(k, new Map());
    const m = itensPorPed.get(k);
    m.set(String(it.produto), (m.get(String(it.produto)) || 0) + (Number(it.qt) || 0));
    if (it.confEnd && (!fimConf.has(k) || it.confEnd > fimConf.get(k))) fimConf.set(k, it.confEnd);
  }
  const pedidos = {}, usados = new Set();
  const limpo = (v) => (v === null || v === undefined || String(v).trim() === "0" ? "" : String(v).trim());
  for (const o of p.orders || []) {
    const k = String(o.pedido);
    const itens = Array.from((itensPorPed.get(k) || new Map()).entries());
    itens.forEach(([prod]) => usados.add(prod));
    const cod = sc5.get(k);
    pedidos[k] = {
      a: o.armazem, c: limpo(o.nome), cc: limpo(o.cliente), dt: o.dt || null, l: o.itens || itens.length, q: o.qt || 0,
      cf: limpo(o.conferente), sp: limpo(o.separador), fc: fimConf.get(k) || null, nf: limpo(o.nf),
      tr: cod ? (TRANSP_NOMES[cod] || `Código ${cod}`) : limpo(o.transportadora), it: itens,
    };
  }
  const nomesUsados = {};
  for (const pr of usados) if (nomes.has(pr)) nomesUsados[pr] = nomes.get(pr);
  return { savedAt: p.savedAt, pedidos, nomes: nomesUsados };
}
let indiceCache = null;
async function indiceCarregar() {
  if (indiceCache && Date.now() - indiceCache.at < 60000) return indiceCache.data;
  try { indiceCache = { at: Date.now(), data: await objLoad(INDICE_OBJ) }; }
  catch (e) { if (indiceCache) return indiceCache.data; throw e; }
  return indiceCache.data;
}
function infoDoPedido(indice, ped) {
  const r = indice && indice.pedidos ? indice.pedidos[ped] : null;
  if (!r) return null;
  return {
    pedido: ped, armazem: r.a, cliente: r.c, codCliente: r.cc, liberadoEm: r.dt, linhas: r.l, pecas: r.q, conferente: r.cf, separador: r.sp,
    fimConferencia: r.fc, nf: r.nf, transportadora: r.tr,
    itens: (r.it || []).map(([prod, qt]) => ({ produto: prod, nome: (indice.nomes && indice.nomes[prod]) || "", qt })),
  };
}
const resumoInfo = (i) => (i ? { armazem: i.armazem, cliente: i.cliente, transportadora: i.transportadora, linhas: i.linhas, pecas: i.pecas, conferente: i.conferente, nf: i.nf, liberadoEm: i.liberadoEm, fimConferencia: i.fimConferencia } : null);
function normalizarPedido(x) {
  const d = String(x === null || x === undefined ? "" : x).replace(/\D/g, "").replace(/^0+/, "");
  return d.length >= 4 && d.length <= 10 ? d : null;
}

// um arquivo por dia (fica pequeno e rápido); o dia é o do Brasil, não o do servidor
const diaSP = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(d);
const diaAnterior = (dia, n) => { const d = new Date(`${dia}T12:00:00-03:00`); d.setUTCDate(d.getUTCDate() - n); return diaSP(d); };
const saidaObj = (dia) => `saida-pv-${dia}.json`;
const saidaCache = new Map();
async function saidaCarregar(dia) {
  if (saidaCache.has(dia)) return saidaCache.get(dia);
  const data = await objLoad(saidaObj(dia));
  const v = data && Array.isArray(data.entries) ? data : { dia, versao: 0, entries: [], removidos: [] };
  if (!Array.isArray(v.removidos)) v.removidos = [];
  saidaCache.set(dia, v);
  return v;
}
// grava numa cópia; só troca a memória DEPOIS de gravar (se falhar, nada fica pela metade)
async function saidaGravar(dia, novo) {
  novo.versao = (novo.versao || 0) + 1;
  await objSave(saidaObj(dia), novo);
  saidaCache.set(dia, novo);
}

const LOGIN_RE = /^[a-z0-9._-]{3,30}$/;
const CAMPOS_IDENTIDADE = ["criadoPorUsuario", "criadoPorNome", "criadoEm", "confirmadoPorUsuario", "confirmadoPorNome", "confirmadoEm"];

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (pathname === "/api/health" && method === "GET") {
    return sendJson(res, 200, { ok: true, storage: usingSupabase ? "supabase" : "local-file", controle: "autossuficiente-v2", acessos: "v2", saida: "v1", time: new Date().toISOString() });
  }

  if (pathname === "/api/debug-fs" && method === "GET") {
    if (!(await exigir(req, res, ["admin"]))) return;
    let listing = [];
    try { listing = fs.readdirSync(PUBLIC_DIR); } catch (e) { listing = ["ERRO ao listar: " + e.message]; }
    return sendJson(res, 200, { __dirname, PUBLIC_DIR, arquivosEncontrados: listing, indexExiste: fs.existsSync(path.join(PUBLIC_DIR, "index.html")), bundleExiste: fs.existsSync(path.join(PUBLIC_DIR, "bundle.js")), cwd: process.cwd() });
  }

  if (pathname === "/api/session" && method === "GET") {
    const s = await getSession(req);
    return sendJson(res, 200, { needsPassword: Boolean(APP_PASSWORD), authed: Boolean(s), role: s ? s.role : null, usuario: s ? s.usuario : "", nome: s ? s.nome : "", perfis: s ? (s.perfis || []) : [] });
  }

  if (pathname === "/api/login" && method === "POST") {
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    if (!APP_PASSWORD) return sendJson(res, 200, { ok: true, role: "admin", usuario: "admin", nome: "Administrador", note: "sem senha configurada" });
    const usuario = String((body && body.usuario) || "").trim().toLowerCase();
    const password = String((body && body.password) || "");
    const chave = `${ipDe(req)}|${usuario || "admin"}`;
    if (bloqueado(chave)) return sendJson(res, 429, { ok: false, error: "Muitas tentativas erradas. Aguarde alguns minutos e tente de novo." });
    let sess = null, sv = 0;
    if (password) {
      if (!usuario || usuario === "admin") {
        if (timingSafeEqualStr(password, APP_PASSWORD)) sess = ADMIN();
      } else {
        const u = await achaUsuario(usuario);
        if (u && u.ativo !== false) { if (await verificaSenha(password, u)) { sess = { usuario: u.usuario, nome: u.nome, role: "operador", perfis: perfisDe(u) }; sv = u.sv || 0; } }
        else await hashSenha(password, "00".repeat(16)); // gasta o mesmo tempo, não revela se o usuário existe
      }
    }
    if (!sess) { registraFalha(chave); return sendJson(res, 401, { ok: false, error: "Usuário ou senha incorretos." }); }
    falhas.delete(chave);
    colocarCookie(res, sess, sv);
    return sendJson(res, 200, { ok: true, role: sess.role, usuario: sess.usuario, nome: sess.nome, perfis: sess.perfis || [] });
  }

  if (pathname === "/api/logout" && method === "POST") {
    res.setHeader("Set-Cookie", [`${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`, `sc9_auth=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`]);
    return sendJson(res, 200, { ok: true });
  }

  // ---- gestão de acessos (só administrador) ----
  if (pathname === "/api/usuarios" && method === "GET") {
    if (!(await exigir(req, res, ["admin"]))) return;
    try { return sendJson(res, 200, { usuarios: (await carregarUsuarios(true)).map(usuarioPublico) }); }
    catch (e) { return sendJson(res, 500, { error: e.message }); }
  }
  if (pathname === "/api/usuarios" && method === "POST") {
    const sess = await exigir(req, res, ["admin"]); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    body = body || {};
    const login = String(body.usuario || "").trim().toLowerCase();
    const senha = String(body.senha || "");
    try {
      const lista = await alterarUsuarios(async (users) => {
        const idx = users.findIndex((u) => u.usuario === login);
        const novaSenha = async (u) => {
          if (senha.length < 6 || senha.length > 100) throw new ErroHttp(400, "A senha precisa ter pelo menos 6 caracteres.");
          u.salt = crypto.randomBytes(16).toString("hex");
          u.hash = await hashSenha(senha, u.salt);
          u.sv = (u.sv || 0) + 1; // derruba sessões abertas com a senha antiga
        };
        if (body.acao === "criar") {
          if (!LOGIN_RE.test(login) || login === "admin") throw new ErroHttp(400, "Usuário inválido: use de 3 a 30 letras minúsculas, números, ponto, traço ou _ (e não pode ser \"admin\").");
          const nome = String(body.nome || "").trim();
          if (nome.length < 2 || nome.length > 60) throw new ErroHttp(400, "Informe o nome da pessoa (2 a 60 letras).");
          if (idx >= 0) throw new ErroHttp(409, "Já existe um acesso com esse usuário.");
          const perfis = Array.isArray(body.perfis) ? body.perfis.filter((x) => PERFIS.includes(x)) : ["controle0201"];
          if (!perfis.length) throw new ErroHttp(400, "Escolha pelo menos uma tela para essa pessoa usar.");
          const u = { usuario: login, nome, perfis, ativo: true, sv: 0, criadoEm: new Date().toISOString() };
          await novaSenha(u); u.sv = 0;
          users.push(u);
          return users;
        }
        if (idx < 0) throw new ErroHttp(404, "Usuário não encontrado.");
        if (body.acao === "senha") { await novaSenha(users[idx]); return users; }
        if (body.acao === "perfis") {
          const perfis = Array.isArray(body.perfis) ? body.perfis.filter((x) => PERFIS.includes(x)) : [];
          if (!perfis.length) throw new ErroHttp(400, "Escolha pelo menos uma tela para essa pessoa usar.");
          users[idx].perfis = perfis; return users;
        }
        if (body.acao === "desativar") { users[idx].ativo = false; users[idx].sv = (users[idx].sv || 0) + 1; return users; }
        if (body.acao === "ativar") { users[idx].ativo = true; return users; }
        if (body.acao === "apagar") { users.splice(idx, 1); return users; }
        throw new ErroHttp(400, "Ação inválida.");
      });
      return sendJson(res, 200, { ok: true, usuarios: lista.map(usuarioPublico) });
    } catch (e) {
      if (e instanceof ErroHttp) return sendJson(res, e.status, { error: e.message });
      console.error("Erro em /api/usuarios:", e);
      return sendJson(res, 500, { error: e.message || "erro ao salvar usuários" });
    }
  }

  // ---- snapshot do SC9 (só administrador) ----
  if (pathname === "/api/save" && method === "POST") {
    if (!(await exigir(req, res, ["admin"]))) return;
    let payload;
    try { payload = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (!payload || !Array.isArray(payload.orders)) {
      return sendJson(res, 400, { error: "payload inválido — esperado { orders, items, itemNames, warehousesPresent, cutoff }" });
    }
    payload.savedAt = new Date().toISOString();
    try {
      const info = await saveSnapshot(payload);
      // guarda À PARTE só o saldo por lote: é tudo que o operador do controle recebe
      if (Array.isArray(payload.saldoPorLote)) {
        try { await objSave(SALDO_OBJ, { saldoPorLote: payload.saldoPorLote, savedAt: payload.savedAt }); }
        catch (e) { console.error("Erro ao salvar saldo por lote:", e); }
      }
      try { // índice de pedidos (é o que o conferente consulta ao bipar)
        const idx = montarIndicePedidos(payload);
        await objSave(INDICE_OBJ, idx);
        indiceCache = { at: Date.now(), data: idx };
      } catch (e) { console.error("Erro ao montar índice de pedidos:", e); }
      return sendJson(res, 200, { ok: true, ...info, orders: payload.orders.length });
    } catch (e) {
      console.error("Erro ao salvar snapshot:", e);
      return sendJson(res, 500, { error: e.message || "erro ao salvar" });
    }
  }
  if (pathname === "/api/load" && method === "GET") {
    if (!(await exigir(req, res, ["admin"]))) return;
    try {
      const data = await loadSnapshot();
      if (!data) return sendJson(res, 404, { error: "nenhum snapshot salvo ainda" });
      return sendJson(res, 200, data);
    } catch (e) {
      console.error("Erro ao carregar snapshot:", e);
      return sendJson(res, 500, { error: e.message || "erro ao carregar" });
    }
  }

  // ---- saldo por lote (administrador e operador) ----
  if (pathname === "/api/saldo" && method === "GET") {
    if (!(await exigir(req, res, ["admin", "operador"], "controle0201"))) return;
    try {
      const data = await objLoad(SALDO_OBJ);
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, { saldoPorLote: data ? data.saldoPorLote : null, savedAt: data ? data.savedAt || null : null });
    } catch (e) { return sendJson(res, 500, { error: e.message || "erro ao carregar saldo" }); }
  }

  // ---- Controle 02->01 (administrador e operador) ----
  // GUARDADO À PARTE do snapshot do SC9. O POST recebe só a diferença e junta com o
  // que já existe: { upserts, removeIds, reset, seedIfEmpty }. Quem fez cada coisa
  // é carimbado AQUI, a partir da sessão (o navegador não consegue assinar por outro).
  if (pathname === "/api/controle" && method === "GET") {
    if (!(await exigir(req, res, ["admin", "operador"], "controle0201"))) return;
    try {
      const data = await loadControle();
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, { entries: (data && Array.isArray(data.entries)) ? data.entries : [], savedAt: data ? data.savedAt || null : null });
    } catch (e) {
      console.error("Erro ao carregar controle:", e);
      return sendJson(res, 500, { error: e.message || "erro ao carregar controle" });
    }
  }

  if (pathname === "/api/controle" && method === "POST") {
    const sess = await exigir(req, res, ["admin", "operador"], "controle0201"); if (!sess) return;
    const ehAdmin = sess.role === "admin";
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    body = body || {};
    if (!ehAdmin && (body.reset === true || (Array.isArray(body.removeIds) && body.removeIds.length) || Array.isArray(body.seedIfEmpty))) {
      return sendJson(res, 403, { error: "Seu acesso não permite apagar nem limpar registros." });
    }
    try {
      let ignorados = 0;
      const entries = await comFilaControle(async () => {
        const atual = await loadControle();
        let lista = (atual && Array.isArray(atual.entries)) ? atual.entries : [];
        const agora = new Date().toISOString();
        if (!lista.length && Array.isArray(body.seedIfEmpty)) lista = body.seedIfEmpty.filter((x) => x && typeof x.id === "string");
        if (body.reset === true) lista = [];
        if (Array.isArray(body.removeIds) && body.removeIds.length) {
          const rm = new Set(body.removeIds);
          lista = lista.filter((x) => !rm.has(x.id));
        }
        if (Array.isArray(body.upserts)) {
          const novos = [];
          for (const u0 of body.upserts) {
            if (!u0 || typeof u0.id !== "string") continue;
            const i = lista.findIndex((x) => x.id === u0.id);
            const existente = i >= 0 ? lista[i] : null;
            const existenteConfirmado = Boolean(existente) && existente.qtdRecebida !== null && existente.qtdRecebida !== undefined;
            // operador não mexe no que já foi confirmado
            if (!ehAdmin && existenteConfirmado) { ignorados++; continue; }
            const u = { ...u0 };
            for (const k of CAMPOS_IDENTIDADE) delete u[k]; // identidade nunca vem do navegador
            if (existente) {
              for (const k of CAMPOS_IDENTIDADE) if (existente[k] !== undefined) u[k] = existente[k];
            } else {
              u.criadoPorUsuario = sess.usuario; u.criadoPorNome = sess.nome; u.criadoEm = agora;
              if (!ehAdmin) { // operador só cria registro "aguardando", em nome dele
                u.entreguePor = sess.nome; u.status = "aguardando"; u.qtdRecebida = null;
                u.confirmadoPor = null; u.dataConfirmacao = null; u.validacao = null;
              }
            }
            const confirmando = u.qtdRecebida !== null && u.qtdRecebida !== undefined;
            if (confirmando && !existenteConfirmado && !u.confirmadoPorUsuario) {
              u.confirmadoPorUsuario = sess.usuario; u.confirmadoPorNome = sess.nome; u.confirmadoEm = agora;
              if (!ehAdmin) u.confirmadoPor = sess.nome;
            }
            if (existente) lista[i] = u; else novos.push(u);
          }
          lista = [...novos, ...lista]; // mais novo na frente
        }
        await saveControle({ entries: lista, savedAt: agora });
        return lista;
      });
      return sendJson(res, 200, { ok: true, entries, ignorados });
    } catch (e) {
      console.error("Erro ao salvar controle:", e);
      return sendJson(res, 500, { error: e.message || "erro ao salvar controle" });
    }
  }

  // ---- Saída para expedição (administrador e operador com o perfil "saida") ----
  if (pathname === "/api/saida/bipar" && method === "POST") {
    const sess = await exigir(req, res, ["admin", "operador"], "saida"); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    body = body || {};
    const ped = normalizarPedido(body.pedido);
    if (!ped) return sendJson(res, 400, { error: "Código inválido: leia só o número do pedido." });
    let indice = null;
    try { indice = await indiceCarregar(); } catch { /* sem índice: registra mesmo assim, sinalizado */ }
    const info = infoDoPedido(indice, ped);
    const hoje = diaSP();
    try {
      const r = await comFila("saida", async () => {
        let existente = null;
        for (let n = 0; n < SAIDA_DIAS_DUP && !existente; n++) {
          const d = await saidaCarregar(n === 0 ? hoje : diaAnterior(hoje, n));
          existente = d.entries.find((e) => e.pedido === ped) || null; // mais novo primeiro
        }
        if (existente && body.reenvio !== true) return { duplicado: existente };
        const atual = await saidaCarregar(hoje);
        const novo = JSON.parse(JSON.stringify(atual));
        const entry = {
          id: `sp_${ped}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`, pedido: ped,
          registradoPorUsuario: sess.usuario, registradoPorNome: sess.nome, registradoEm: new Date().toISOString(),
          semDadoSC9: !info, baseSavedAt: indice ? indice.savedAt || null : null,
          reenvio: Boolean(existente), reenvioDe: existente ? existente.id : null, info: resumoInfo(info),
        };
        novo.entries.unshift(entry);
        await saidaGravar(hoje, novo);
        return { entry, total: novo.entries.length };
      });
      if (r.duplicado) return sendJson(res, 409, { error: "duplicado", duplicado: r.duplicado, info });
      return sendJson(res, 200, { ok: true, entry: r.entry, info, totalHoje: r.total, baseSavedAt: indice ? indice.savedAt || null : null });
    } catch (e) {
      console.error("Erro ao bipar:", e);
      return sendJson(res, 500, { error: e.message || "erro ao registrar o pedido" });
    }
  }

  if (pathname === "/api/saida" && method === "GET") {
    const sess = await exigir(req, res, ["admin", "operador"], "saida"); if (!sess) return;
    const q = new URL(req.url, "http://localhost").searchParams;
    const hoje = diaSP();
    const dia = q.get("dia") || hoje;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return sendJson(res, 400, { error: "dia inválido" });
    if (sess.role !== "admin" && dia !== hoje && dia !== diaAnterior(hoje, 1)) return sendJson(res, 403, { error: "seu acesso só mostra hoje e ontem" });
    try {
      const d = await saidaCarregar(dia);
      res.setHeader("Cache-Control", "no-store");
      if (q.get("v") !== null && Number(q.get("v")) === (d.versao || 0)) return sendJson(res, 200, { igual: true, versao: d.versao || 0, hoje });
      let baseSavedAt = null;
      try { const ix = await indiceCarregar(); baseSavedAt = ix ? ix.savedAt || null : null; } catch { /* sem índice */ }
      return sendJson(res, 200, { dia, hoje, versao: d.versao || 0, entries: d.entries, removidos: sess.role === "admin" ? d.removidos : d.removidos.length, baseSavedAt });
    } catch (e) { return sendJson(res, 500, { error: e.message || "erro ao carregar a saída" }); }
  }

  if (pathname === "/api/saida/desfazer" && method === "POST") {
    const sess = await exigir(req, res, ["admin", "operador"], "saida"); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = body && typeof body.id === "string" ? body.id : "";
    const hoje = diaSP();
    try {
      const r = await comFila("saida", async () => {
        for (const dia of [hoje, diaAnterior(hoje, 1)]) {
          const atual = await saidaCarregar(dia);
          const e = atual.entries.find((x) => x.id === id);
          if (!e) continue;
          if (sess.role !== "admin") {
            if (e.registradoPorUsuario !== sess.usuario) return { erro: 403, msg: "Só quem bipou consegue desfazer o próprio bipe." };
            if (Date.now() - new Date(e.registradoEm).getTime() > DESFAZER_MS) return { erro: 403, msg: "O prazo pra desfazer acabou. Fale com o administrador." };
          }
          const novo = JSON.parse(JSON.stringify(atual));
          novo.entries = novo.entries.filter((x) => x.id !== id);
          novo.removidos.push({ id: e.id, pedido: e.pedido, removidoPorUsuario: sess.usuario, removidoPorNome: sess.nome, removidoEm: new Date().toISOString(), registradoPorUsuario: e.registradoPorUsuario, registradoEm: e.registradoEm });
          await saidaGravar(dia, novo);
          return { ok: true, versao: novo.versao };
        }
        return { erro: 404, msg: "Registro não encontrado (talvez já tenha sido desfeito)." };
      });
      if (r.erro) return sendJson(res, r.erro, { error: r.msg });
      return sendJson(res, 200, r);
    } catch (e) { return sendJson(res, 500, { error: e.message || "erro ao desfazer" }); }
  }

  return sendJson(res, 404, { error: "rota não encontrada" });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname).catch((e) => {
      console.error("Erro inesperado:", e);
      sendJson(res, 500, { error: "erro interno" });
    });
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`SC9 Control rodando na porta ${PORT} | storage: ${usingSupabase ? "Supabase" : "arquivo local"} | senha: ${APP_PASSWORD ? "ativada" : "DESATIVADA"}`);
});

module.exports = server;
