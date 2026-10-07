// Servidor sem dependências externas (só Node puro) — mais rápido de instalar
// no Render e mais fácil de eu testar aqui antes de te entregar.
const http = require("http");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const util = require("util");

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
const MOV_ANALISE_OBJ = "movimentacao-analise.json"; // cópia COMPACTA da movimentação (só linhas com lote) pra análise de alteração
const CONTROLE_SD3_OBJ = "controle-sd3.json"; // { coberturaAte, desde, semRegistro, atualizadoEm, atualizadoPor }
const usingSupabase = Boolean(SB_URL && SB_KEY);
const saveSnapshot = (d) => objSave("latest.json", d); // mesmo arquivo/bucket de antes (era do storage.js)
const loadSnapshot = () => objLoad("latest.json");
const objUrl = (name) => `${SB_URL.replace(/\/$/, "")}/storage/v1/object/${SB_BUCKET}/${name}`;

// A Render cobra a banda que SAI do servidor — e cada gravação no Supabase é o arquivo
// INTEIRO (a cada bipe, o dia todo de bipes: ~113 KB por bipe com 500 no dia, mais de
// 55 MB por dia só nisso). Comprime antes de enviar (JSON encolhe ~10-15x). Na leitura,
// aceita os dois formatos (gzip novo e JSON puro antigo, pelo cabeçalho "1f 8b"), então
// os arquivos que já estão no Supabase continuam funcionando sem migração.
// SUPABASE_GZIP=0 volta a gravar JSON puro (a leitura continua aceitando os dois).
const SB_GZIP = process.env.SUPABASE_GZIP !== "0";
const gzipAsync = util.promisify(zlib.gzip), gunzipAsync = util.promisify(zlib.gunzip);
async function empacotarObj(obj) {
  const raw = Buffer.from(JSON.stringify(obj), "utf8");
  if (!SB_GZIP || raw.length < 1024) return raw;
  try { const gz = await gzipAsync(raw, { level: 6 }); return gz.length < raw.length ? gz : raw; } catch { return raw; }
}
async function desempacotarObj(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const ehGzip = b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
  return JSON.parse((ehGzip ? await gunzipAsync(b) : b).toString("utf8"));
}

async function objLoad(name) {
  if (SB_URL && SB_KEY) {
    const res = await fetch(objUrl(name), { headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY } });
    if (res.ok) return await desempacotarObj(Buffer.from(await res.arrayBuffer()));
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
  if (SB_URL && SB_KEY) {
    const body = await empacotarObj(obj);
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
  fs.writeFileSync(path.join(LOCAL_DIR, name), JSON.stringify(obj), "utf8");
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
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn("AVISO DE SEGURANÇA: SESSION_SECRET não configurada — usando uma chave gerada agora, que muda a cada reinício " +
    "(derruba sessões abertas). Configure SESSION_SECRET no Render (Environment) com um valor aleatório fixo pra evitar isso " +
    "e pra não depender de nada derivado da senha do administrador.");
}
const TTL_ADMIN_S = 60 * 60 * 24 * 30;
const TTL_OPERADOR_S = 60 * 60 * 24 * 7;
// perfis = quais telas o operador pode usar. Acessos criados antes disso só tinham o controle 02->01.
const PERFIS = ["geral", "controle0201", "saida", "alteracoes", "cadastro", "recebimento", "despacho"];
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
async function dashboardCarregar() {
  if (dashboardCache && Date.now() - dashboardCache.at < 15000) return dashboardCache.data;
  try { dashboardCache = { at: Date.now(), data: await objLoad(DASHBOARD_OBJ) }; }
  catch (e) { if (dashboardCache) return dashboardCache.data; throw e; }
  return dashboardCache.data;
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
function colocarCookie(req, res, sess, sv) {
  const https = req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production" || req.socket.encrypted;
  const secure = https ? "; Secure" : "";
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
      // o limite vale sobre o tamanho COMPRIMIDO recebido pela rede — gzip já
      // tolera um JSON bem maior do que isso antes de descomprimir.
      if (size > MAX_BODY_BYTES) { reject(new Error("corpo da requisição excede o limite")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve(null);
      const buf = Buffer.concat(chunks);
      const ehGzip = (req.headers["content-encoding"] || "").toLowerCase().includes("gzip");
      try {
        const texto = ehGzip ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
        resolve(JSON.parse(texto));
      } catch (e) { reject(new Error(ehGzip ? "não consegui descomprimir o corpo da requisição" : "JSON inválido no corpo da requisição")); }
    });
    req.on("error", reject);
  });
}

// Fila simples: dois salvamentos do controle ao mesmo tempo não se atropelam
// (cada um lê, junta e grava um de cada vez).
let movAnaliseCache = null; // { savedAt, total, por, json, gz }
let controleFila = Promise.resolve();
function comFilaControle(fn) {
  const run = controleFila.then(fn, fn);
  controleFila = run.catch(() => {});
  return run;
}

function erroPublico(e, mensagemGenerica) {
  console.error(mensagemGenerica + ":", e); // detalhe completo só no log do servidor
  return { error: mensagemGenerica };
}
// Respostas da API saem comprimidas (gzip) quando o navegador aceita — JSON comprime
// ~15x (a lista da Saída com 500 bipes vai de 225 KB pra ~13 KB). A Render cobra a banda
// de SAÍDA, e antes de comprimir isso era o que mais pesava. Respostas pequenas não
// compensam o custo de comprimir, então saem como sempre.
const GZIP_MIN_BYTES = 1024;
function aceitaGzip(req) { return Boolean(req) && /\bgzip\b/i.test(String(req.headers["accept-encoding"] || "")); }
function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const cabecalhos = { "Content-Type": "application/json; charset=utf-8", "Vary": "Accept-Encoding" };
  if (body.length >= GZIP_MIN_BYTES && aceitaGzip(res.req)) {
    return zlib.gzip(body, { level: 6 }, (err, gz) => {
      if (res.writableEnded || res.destroyed) return; // o cliente já foi embora
      if (err) { res.writeHead(status, { ...cabecalhos, "Content-Length": body.length }); return res.end(body); }
      res.writeHead(status, { ...cabecalhos, "Content-Encoding": "gzip", "Content-Length": gz.length });
      res.end(gz);
    });
  }
  res.writeHead(status, { ...cabecalhos, "Content-Length": body.length });
  res.end(body);
}

// index.html e bundle.js: antes saíam inteiros (384 KB o bundle), sem compressão e com
// "no-store", a CADA abertura de página. Agora: comprimidos uma vez só (guardados em
// memória), com ETag — se o arquivo não mudou, o navegador recebe um "304 não mudou"
// de poucos bytes em vez do arquivo de novo. Continua sempre atualizado: depois de um
// deploy o ETag muda e todo mundo recebe o bundle novo na próxima abertura.
const estaticoCache = new Map(); // nome -> { mtimeMs, size, buf, gz, etag }
function carregarEstatico(name, cb) {
  const arquivo = path.join(PUBLIC_DIR, name);
  fs.stat(arquivo, (errStat, st) => {
    if (errStat) return cb(errStat);
    const c = estaticoCache.get(name);
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return cb(null, c);
    fs.readFile(arquivo, (err, buf) => {
      if (err) return cb(err);
      zlib.gzip(buf, { level: 9 }, (errGz, gz) => {
        const novo = { mtimeMs: st.mtimeMs, size: st.size, buf, gz: errGz || gz.length >= buf.length ? null : gz, etag: `"${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 20)}"` };
        estaticoCache.set(name, novo);
        cb(null, novo);
      });
    });
  });
}
function serveStatic(req, res, urlPath) {
  // qualquer coisa fora da lista (inclusive rotas de navegação tipo /alguma-coisa)
  // cai no index.html — é o comportamento normal de uma SPA
  const pedido = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const name = SERVABLE.has(pedido) ? pedido : "index.html";
  carregarEstatico(name, (err, e) => {
    if (err) { res.writeHead(404); return res.end("não encontrado"); }
    const cabecalhos = { "Content-Type": MIME[path.extname(name)] || "application/octet-stream", "Cache-Control": "no-cache", "ETag": e.etag, "Vary": "Accept-Encoding" };
    if (String(req.headers["if-none-match"] || "").split(",").map((x) => x.trim()).includes(e.etag)) {
      res.writeHead(304, { "ETag": e.etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding" });
      return res.end();
    }
    if (e.gz && aceitaGzip(req)) { res.writeHead(200, { ...cabecalhos, "Content-Encoding": "gzip", "Content-Length": e.gz.length }); return res.end(e.gz); }
    res.writeHead(200, { ...cabecalhos, "Content-Length": e.buf.length });
    res.end(e.buf);
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
const DASHBOARD_OBJ = "dashboard-live.json";      // cache leve, recalculado sob demanda — não é mais a fonte de verdade
const DASHBOARD_ORDERS_OBJ = "dashboard-orders.json"; // só os pedidos do Cambuci (fonte de verdade pro dashboard)
const DASHBOARD_HIST_OBJ = "dashboard-historico.json"; // {dias: {"AAAA-MM-DD": {pedidosHoje, pecasHoje, atualizacoes}}}
const META_FATURAMENTO_OBJ = "meta-faturamento.json"; // {valor, mes: "AAAA-MM", atualizadoEm, atualizadoPor}
// Alteração do TIPO 2 — na separação, ANTES da conferência (não existe NF
// ainda, não precisa de pedido de complemento, é só troca de lote/item). Fica
// numa estrutura própria, nada a ver com os bipes da Saída p/ Expedição —
// o pedido nem chegou lá ainda nesse ponto do processo.
const ALTERACAO_SEPARACAO_OBJ = "alteracoes-separacao.json"; // { registros: [...] }
const MOTIVOS_ALTERACAO = ["Peça não encontrada", "Erro sistêmico", "Lote vencido/bloqueado", "Divergência de estoque", "Outro"];
let alteracaoSeparacaoCache = null;
async function alteracaoSeparacaoCarregar() {
  if (alteracaoSeparacaoCache) return alteracaoSeparacaoCache;
  try { const d = await objLoad(ALTERACAO_SEPARACAO_OBJ); alteracaoSeparacaoCache = { registros: Array.isArray(d && d.registros) ? d.registros : [] }; }
  catch { alteracaoSeparacaoCache = { registros: [] }; }
  return alteracaoSeparacaoCache;
}
async function alteracaoSeparacaoSalvar(dados) { await objSave(ALTERACAO_SEPARACAO_OBJ, dados); alteracaoSeparacaoCache = dados; }

// Cadastro de Lotes (SB8) — o arquivo SB8 (pesado, pode ter todo o histórico
// desde a implantação) é processado só no navegador e NUNCA chega aqui. Só
// fica salvo um lembrete pequeno por achado (lote duplicado ou validade
// vencida) — uma nota/status que a pessoa deixa pra lembrar o que já tratou,
// já que o arquivo gigante não fica guardado entre uma sessão e outra.
const CADASTRO_LEMBRETES_OBJ = "cadastro-lembretes.json"; // { lembretes: [...] }
let cadastroLembretesCache = null;
async function cadastroLembretesCarregar() {
  if (cadastroLembretesCache) return cadastroLembretesCache;
  try { const d = await objLoad(CADASTRO_LEMBRETES_OBJ); cadastroLembretesCache = { lembretes: Array.isArray(d && d.lembretes) ? d.lembretes : [] }; }
  catch { cadastroLembretesCache = { lembretes: [] }; }
  return cadastroLembretesCache;
}
async function cadastroLembretesSalvar(dados) { await objSave(CADASTRO_LEMBRETES_OBJ, dados); cadastroLembretesCache = dados; }

// Achados do Cadastro SB8 (duplicidade/validade/vencimento) persistidos até a
// pessoa apagar — o arquivo SB8 em si nunca é salvo, só o resultado já
// identificado. Cada achado também guarda um pequeno histórico de saldo por
// produto (snapshot a cada vez que o arquivo é recarregado), pra responder
// "esse lote tinha saldo e zerou — saiu do produto certo?".
const CADASTRO_ACHADOS_OBJ = "cadastro-achados.json"; // { achados: [...] }
const HISTORICO_SALDO_MAX = 60; // snapshots guardados por achado (uns 2 meses se recarregar 1x/dia)
let cadastroAchadosCache = null;
async function cadastroAchadosCarregar() {
  if (cadastroAchadosCache) return cadastroAchadosCache;
  try { const d = await objLoad(CADASTRO_ACHADOS_OBJ); cadastroAchadosCache = { achados: Array.isArray(d && d.achados) ? d.achados : [] }; }
  catch { cadastroAchadosCache = { achados: [] }; }
  return cadastroAchadosCache;
}
async function cadastroAchadosSalvar(dados) { await objSave(CADASTRO_ACHADOS_OBJ, dados); cadastroAchadosCache = dados; }
const VALOR_GERAL_OBJ = "valor-faturado-geral.json"; // valor faturado do mês, TODOS os armazéns (não só Cambuci)
// armazéns reconhecidos pra essa conta geral — o mesmo conjunto que o painel
// já usa (ES nunca entra em lugar nenhum, nem chega a existir como opção).
const ARMAZENS_GERAL = new Set(["Cambuci", "Tambore", "DF", "RJ", "BH", "CE"]);
// mês corrente no fuso de São Paulo, no formato "AAAA-MM"
const mesSP = (d = new Date()) => diaSP(d).slice(0, 7);

async function metaFaturamentoCarregar() {
  try { return (await objLoad(META_FATURAMENTO_OBJ)) || { valor: null, mes: null }; }
  catch { return { valor: null, mes: null }; }
}
async function metaFaturamentoSalvar(valor, usuario, mes) {
  const registro = { valor, mes: mes || mesSP(), atualizadoEm: new Date().toISOString(), atualizadoPor: usuario };
  await objSave(META_FATURAMENTO_OBJ, registro);
  return registro;
}

async function valorGeralCarregar() {
  try { return await objLoad(VALOR_GERAL_OBJ); } catch { return null; }
}

async function dashboardHistCarregar() {
  try { const d = await objLoad(DASHBOARD_HIST_OBJ); return d && d.dias ? d.dias : {}; } catch { return {}; }
}
// Atualiza os NÚMEROS do dia (pedidosHoje/pecasHoje/pecasExpedidasHoje) com o
// que acabou de ser calculado. Roda a cada consulta ao dashboard — é assim
// que a produtividade do dia fica sempre atual sem depender de subir o SC9 de
// novo. NÃO mexe no contador de sincronizações (isso é outra coisa, ver
// dashboardRegistrarSincronizacao).
async function dashboardHistAtualizar(dash) {
  const dias = await dashboardHistCarregar();
  const hoje = diaSP();
  const atualizacoes = (dias[hoje] && dias[hoje].atualizacoes) || 0;
  dias[hoje] = { pedidosHoje: dash.pedidosHoje, pecasHoje: dash.pecasHoje, pecasExpedidasHoje: dash.pecasExpedidasHoje, atualizacoes, ultimaEm: dash.atualizadoEm };
  const chaves = Object.keys(dias).sort();
  for (const k of chaves.slice(0, Math.max(0, chaves.length - 14))) delete dias[k];
  await objSave(DASHBOARD_HIST_OBJ, { dias });
  return dias;
}
// Essa sim conta "quantas vezes sincronizamos o SC9 hoje" — chamada só no
// /api/save, nunca no recálculo automático do dashboard.
async function dashboardRegistrarSincronizacao() {
  const dias = await dashboardHistCarregar();
  const hoje = diaSP();
  const atual = dias[hoje] || { pedidosHoje: 0, pecasHoje: 0, pecasExpedidasHoje: 0 };
  dias[hoje] = { ...atual, atualizacoes: (atual.atualizacoes || 0) + 1 };
  await objSave(DASHBOARD_HIST_OBJ, { dias });
}
const TRANSP_NOMES = { "2": "Brasil", "4": "Retira 01", "5": "Retira 02", "6": "Retira 03", "7": "Retira 04", "10057": "Emergência", "10023": "São Paulo" };
const DESFAZER_MS = Number(process.env.SAIDA_DESFAZER_MS) || 5 * 60 * 1000;
const SAIDA_RETENCAO_DIAS = Number(process.env.SAIDA_RETENCAO_DIAS) || 30; // passou disso: o administrador exporta e apaga
const SAIDA_AVISO_DIAS = 5; // o administrador é avisado quando faltam até 5 dias pra completar 30
// SLA do galpão: quantas horas um pedido pode ficar esperando pra separar, e depois pra conferir,
// antes de contar como estourado no dashboard. Ajustável por variável de ambiente sem precisar mexer no código.
const SLA_SEPARAR_H = Number(process.env.SLA_SEPARAR_HORAS) || 4;
const SLA_CONFERIR_H = Number(process.env.SLA_CONFERIR_HORAS) || 2;
const SLA_EXPEDICAO_H = Number(process.env.SLA_EXPEDICAO_HORAS) || 1;
const SLA_FATURAR_H = Number(process.env.SLA_FATURAR_HORAS) || 3;

// Só o que o conferente precisa pra conferir o bipe. Pedidos/itens completos do SC9
// continuam só com o administrador.
// MESMA normalização usada ao bipar (remove tudo que não é dígito e zeros à
// esquerda) — assim, um pedido do SC9 guardado com zero à esquerda como texto
// ("0099999") ou com espaço bate certinho com o que o leitor bipa.
function montarIndicePedidos(p) {
  const nomes = new Map((p.itemNames || []).map(([k, v]) => [String(k), String(v)]));
  const sc5 = new Map((p.sc5PorPedido || []).map(([k, v]) => [String(k), String(v).replace(/\.0$/, "")]));
  // agrupa por produto+lote (não só produto) — um pedido pode ter o mesmo
  // item vindo de lotes diferentes (atendimento parcial), e pra travar a
  // alteração "com nota" pelo lote de verdade, precisa saber QUAL lote tem
  // QUAL quantidade, não só o total do produto somado.
  const itensPorPed = new Map(), fimConf = new Map();
  for (const it of p.items || []) {
    const k = String(it.pedido);
    if (!itensPorPed.has(k)) itensPorPed.set(k, new Map());
    const m = itensPorPed.get(k);
    const lote = it.lote ? String(it.lote).trim() : "";
    const chave = String(it.produto) + "|" + lote;
    if (!m.has(chave)) m.set(chave, { produto: String(it.produto), lote, qt: 0 });
    m.get(chave).qt += Math.max(0, Number(it.qt) || 0);
    if (it.confEnd && (!fimConf.has(k) || it.confEnd > fimConf.get(k))) fimConf.set(k, it.confEnd);
  }
  const pedidos = {}, usados = new Set();
  const limpo = (v) => (v === null || v === undefined || String(v).trim() === "0" ? "" : String(v).trim());
  let semChaveValida = 0;
  for (const o of p.orders || []) {
    const k = normalizarPedido(o.pedido);
    if (!k) { semChaveValida++; continue; } // pedido sem número reconhecível (não deveria acontecer, mas não trava o índice)
    const itens = Array.from((itensPorPed.get(k) || new Map()).values());
    itens.forEach((i) => usados.add(i.produto));
    const cod = sc5.get(k);
    pedidos[k] = {
      a: o.armazem, c: limpo(o.nome), cc: limpo(o.cliente), dt: o.dt || null, l: o.itens || itens.length, q: o.qt || 0,
      cf: limpo(o.conferente), sp: limpo(o.separador), fc: fimConf.get(k) || null, nf: limpo(o.nf),
      tr: cod ? (TRANSP_NOMES[cod] || `Código ${cod}`) : limpo(o.transportadora), it: itens,
    };
  }
  const nomesUsados = {};
  for (const pr of usados) if (nomes.has(pr)) nomesUsados[pr] = nomes.get(pr);
  if (semChaveValida) console.warn(`Índice de pedidos: ${semChaveValida} pedido(s) do SC9 com código não reconhecível, ficaram fora do índice.`);
  return { savedAt: p.savedAt, pedidos, nomes: nomesUsados, totalOrders: (p.orders || []).length };
}
// Dashboard ao vivo: só contadores e agregados (por armazém, por transportadora,
// por hora, pedidos parados). NUNCA leva nome de separador/conferente — é isso
// que todo mundo com o perfil "geral" enxerga, sem virar ranking de pessoas.
// As 6 etapas são construídas só com dado que o SC9 realmente entrega (nunca
// inventado): liberação, fim de separação, fim de conferência, NF, o próprio
// bipe da Saída p/ Expedição (que é o "entrou na expedição, aguardando
// faturar" que o usuário descreveu) e a confirmação na aba Entrega.
// Hoje o dashboard ao vivo olha SÓ o Cambuci — é onde a separação/conferência/
// expedição acontece de fato; as filiais ficam de fora daqui por enquanto.
const ETAPA_ORDEM = ["a_separar", "em_separacao", "a_conferir", "aguardando_expedicao", "aguardando_faturamento", "aguardando_coleta", "expedido"];
const ETAPA_LABEL = {
  a_separar: "A separar", em_separacao: "Em separação", a_conferir: "A conferir", aguardando_expedicao: "Conferido, aguardando ir p/ expedição",
  aguardando_faturamento: "Na expedição, aguardando faturar", aguardando_coleta: "Faturado, aguardando coleta", expedido: "Expedido",
};

function classificarEtapa(o, bipadoEm) {
  // a Entrega (ou NF confirmada, nas filiais) é a confirmação DEFINITIVA de
  // que saiu — vale mesmo sem ter passado pelo bipe do app (pedido antigo, de
  // antes dessa função existir, ou bipado por outra pessoa/sistema).
  if (o.status === "Enviado") return "expedido";
  if (!o.pickEnd) return o.pickStart ? "em_separacao" : "a_separar";
  if (!o.confEnd) return "a_conferir";
  // ter Nota Fiscal já PROVA que passou pela expedição e foi faturado — não dá
  // pra faturar sem isso. Não pode depender só do bipe do app pra reconhecer
  // isso, senão todo pedido de ANTES da função de bipar existir (ou faturado
  // sem passar pelo app) fica preso pra sempre em "aguardando expedição",
  // mesmo já tendo NF há semanas.
  if (o.nf) return "aguardando_coleta";
  if (!bipadoEm) return "aguardando_expedicao";
  return "aguardando_faturamento"; // bipado, ainda sem NF
}

function montarDashboardLive(p, bipadosHoje) {
  const agora = Date.now();
  const hojeStr = diaSP();
  const porTransp = {}, porHora = {}, porHoraPecas = {}, porHoraLiberados = {}, porHoraExpedidos = {};
  const porTurno = { manha: { pedidos: 0, pecas: 0 }, tarde: { pedidos: 0, pecas: 0 }, noite: { pedidos: 0, pecas: 0 } };
  const porEtapa = {}; for (const e of ETAPA_ORDEM) porEtapa[e] = 0;
  // ATENÇÃO: totalPedidos é o histórico BRUTO do que veio no SC9 (pode incluir
  // semanas de pedidos já concluídos há muito tempo) — nunca mostrar isso como
  // "pedidos de hoje". O que importa pra operação são os três de baixo:
  //   emProcesso        = ainda não expedido, de QUALQUER dia (a fila real de trabalho)
  //   liberadosHoje     = chegaram hoje (novos, independente de já terem andado ou não)
  //   pendenciasAntigas = ainda não expedido E liberado ANTES de hoje (fila acumulada)
  //   concluidosHoje    = terminaram (conferência ou expedição) hoje
  let totalPedidos = 0, emProcesso = 0, liberadosHoje = 0, pendenciasAntigas = 0, concluidosHoje = 0;
  let semNf = 0, atrasados = 0, pecasHoje = 0, pedidosHoje = 0, pecasExpedidasHoje = 0;
  let valorFaturadoHoje = 0, valorFaturadoTotal = 0, pedidosComValor = 0;
  const sc5 = new Map((p.sc5PorPedido || []).map(([k, v]) => [String(k), String(v).replace(/\.0$/, "")]));
  // valor e data de emissão de cada Nota Fiscal, vindos da aba SF2 do SC9 —
  // sem isso (arquivo sem SF2), o valor simplesmente fica de fora, sem inventar nada.
  const valoresPorNF = new Map((p.valoresPorNF || []).map(([k, v]) => [String(k), v]));
  const faturamentoPorNF = new Map((p.faturamentoPorNF || []).map(([k, v]) => [String(k), v]));
  const paradosSeparar = [], paradosConferir = [], paradosExpedicao = [], paradosFaturamento = [];
  const listaAtrasados = [];
  const slaSepEstourado = [], slaConfEstourado = [], slaExpEstourado = [], slaFatEstourado = [];
  const turnoDe = (h) => (h < 6 ? "noite" : h < 14 ? "manha" : h < 22 ? "tarde" : "noite");
  const ordersCambuci = p.orders || []; // já vem só com Cambuci (filtrado na hora de salvar)
  const novoTransp = () => ({ total: 0, liberadosHoje: 0, aSeparar: 0, emSeparacaoOuConferencia: 0, aguardandoFaturamento: 0, aguardandoColeta: 0, expedidoHoje: 0, atrasados: 0, pecasPendentes: 0, pecasExpedidas: 0, etapas: {} });
  for (const o of ordersCambuci) {
    totalPedidos++;
    const bipe = bipadosHoje ? bipadosHoje.get(o.pedido) : null;
    const etapa = classificarEtapa(o, bipe);
    const cod = sc5.get(String(o.pedido));
    const tr = cod ? (TRANSP_NOMES[cod] || `Código ${cod}`) : (o.transportadora || "Sem transportadora definida");
    const cliente = o.nome || "";
    const dtLib = o.dt ? new Date(o.dt) : null;
    const ehDeHoje = dtLib && diaSP(dtLib) === hojeStr;
    const naoExpedido = etapa !== "expedido";
    if (naoExpedido) { emProcesso++; if (!ehDeHoje) pendenciasAntigas++; }
    if (ehDeHoje) liberadosHoje++;
    porEtapa[etapa]++;
    if (o.dtLiberacaoHora) { const hl = new Date(o.dtLiberacaoHora); if (diaSP(hl) === hojeStr) porHoraLiberados[hl.getHours()] = (porHoraLiberados[hl.getHours()] || 0) + 1; }
    if (etapa === "expedido" && bipe) { const he = new Date(bipe); if (diaSP(he) === hojeStr) { porHoraExpedidos[he.getHours()] = (porHoraExpedidos[he.getHours()] || 0) + 1; concluidosHoje++; } }
    if (etapa === "a_separar" && o.dtLiberacaoHora) {
      const ms = agora - new Date(o.dtLiberacaoHora).getTime();
      paradosSeparar.push(ms);
      if (ms > SLA_SEPARAR_H * 3600000) slaSepEstourado.push({ pedido: o.pedido, cliente, transportadora: tr, horasParado: r1(ms), liberadoEm: o.dtLiberacaoHora, etapa });
    } else if (etapa === "em_separacao" && o.pickStart) {
      const ms = agora - new Date(o.pickStart).getTime();
      paradosSeparar.push(ms);
      if (ms > SLA_SEPARAR_H * 3600000) slaSepEstourado.push({ pedido: o.pedido, cliente, transportadora: tr, horasParado: r1(ms), liberadoEm: o.pickStart, etapa });
    } else if (etapa === "a_conferir" && o.pickEnd) {
      const ms = agora - new Date(o.pickEnd).getTime();
      paradosConferir.push(ms);
      if (ms > SLA_CONFERIR_H * 3600000) slaConfEstourado.push({ pedido: o.pedido, cliente, transportadora: tr, horasParado: r1(ms), separadoEm: o.pickEnd, etapa });
    } else if (etapa === "aguardando_expedicao" && o.confEnd) {
      const ms = agora - new Date(o.confEnd).getTime();
      paradosExpedicao.push(ms);
      if (ms > SLA_EXPEDICAO_H * 3600000) slaExpEstourado.push({ pedido: o.pedido, cliente, transportadora: tr, horasParado: r1(ms), conferidoEm: o.confEnd, etapa });
    } else if (etapa === "aguardando_faturamento" && bipe) {
      // "espera" desde que ENTROU na expedição (bipe) — o SC9 não diz quando a
      // NF foi emitida, só SE ela existe; então isso mede "tempo na fila de
      // faturamento", não a duração do faturamento em si.
      const ms = agora - new Date(bipe).getTime();
      paradosFaturamento.push(ms);
      if (ms > SLA_FATURAR_H * 3600000) slaFatEstourado.push({ pedido: o.pedido, cliente, transportadora: tr, horasParado: r1(ms), entrouExpedicaoEm: bipe, etapa });
    }
    if (!o.nf) semNf++;
    else {
      const v = valoresPorNF.get(String(o.nf));
      const valor = v ? (v.fatura ?? v.mercad) : null;
      if (typeof valor === "number" && !isNaN(valor)) {
        valorFaturadoTotal += valor; pedidosComValor++;
        const emissao = faturamentoPorNF.get(String(o.nf));
        if (emissao && diaSP(new Date(emissao)) === hojeStr) valorFaturadoHoje += valor;
      }
    }
    const estaAtrasado = o.status === "Atrasado" && naoExpedido;
    if (estaAtrasado) {
      atrasados++;
      // esse é o "atrasado" que já vinha do próprio SC9 (regra de NF/Entrega/corte),
      // diferente do "estourou o tempo na etapa" acima — critério diferente, então
      // precisa da sua PRÓPRIA lista, senão o número do KPI nunca bate com o que
      // aparece na tela de "pedidos parados"/Modo TV.
      const idadeMs = o.dt ? agora - new Date(o.dt).getTime() : null;
      listaAtrasados.push({ pedido: o.pedido, cliente, transportadora: tr, horasParado: idadeMs !== null ? r1(idadeMs) : null, etapa, atrasoSC9: true });
    }
    porTransp[tr] = porTransp[tr] || novoTransp();
    const pt = porTransp[tr];
    pt.total++;
    pt.etapas[etapa] = (pt.etapas[etapa] || 0) + 1;
    if (ehDeHoje) pt.liberadosHoje++;
    if (estaAtrasado) pt.atrasados++;
    if (etapa === "a_separar") pt.aSeparar++;
    else if (etapa === "em_separacao" || etapa === "a_conferir") pt.emSeparacaoOuConferencia++;
    else if (etapa === "aguardando_expedicao" || etapa === "aguardando_faturamento") pt.aguardandoFaturamento++;
    else if (etapa === "aguardando_coleta") pt.aguardandoColeta++;
    if (naoExpedido) pt.pecasPendentes += o.qt || 0;
    if (etapa === "expedido" && bipe && diaSP(new Date(bipe)) === hojeStr) { pt.expedidoHoje++; pt.pecasExpedidas += o.qt || 0; }
    if (o.confEnd) {
      const h = new Date(o.confEnd);
      if (diaSP(h) === hojeStr) {
        const hh = h.getHours(), pc = o.qt || 0;
        porHora[hh] = (porHora[hh] || 0) + 1; porHoraPecas[hh] = (porHoraPecas[hh] || 0) + pc;
        pecasHoje += pc; pedidosHoje++;
        const t = porTurno[turnoDe(hh)]; t.pedidos++; t.pecas += pc;
      }
    }
    if (etapa === "expedido" && bipe && diaSP(new Date(bipe)) === hojeStr) pecasExpedidasHoje += o.qt || 0;
  }
  const maiorEspera = (arr) => (arr.length ? Math.max(...arr) : null);
  const medianaEspera = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const ordenaPior = (arr) => arr.sort((a, b) => b.horasParado - a.horasParado).slice(0, 30);
  const rankingEtapas = [
    { etapa: "a_separar", label: ETAPA_LABEL.a_separar, medioMs: medianaEspera(paradosSeparar), pedidos: porEtapa.a_separar + porEtapa.em_separacao },
    { etapa: "a_conferir", label: ETAPA_LABEL.a_conferir, medioMs: medianaEspera(paradosConferir), pedidos: porEtapa.a_conferir },
    { etapa: "aguardando_expedicao", label: ETAPA_LABEL.aguardando_expedicao, medioMs: medianaEspera(paradosExpedicao), pedidos: porEtapa.aguardando_expedicao },
    { etapa: "aguardando_faturamento", label: ETAPA_LABEL.aguardando_faturamento, medioMs: medianaEspera(paradosFaturamento), pedidos: porEtapa.aguardando_faturamento },
  ].filter((x) => x.medioMs !== null).sort((a, b) => b.medioMs - a.medioMs);
  // transportadoras ordenadas por prioridade operacional: quem tem mais atraso primeiro, depois maior fila pendente
  const transpOrdenado = Object.entries(porTransp)
    .map(([nome, v]) => ({ nome, ...v, pendentes: v.total - (v.etapas.expedido || 0) }))
    .sort((a, b) => b.atrasados - a.atrasados || b.pendentes - a.pendentes);
  return {
    savedAt: p.savedAt, atualizadoEm: new Date().toISOString(), armazem: "Cambuci", topItens: p.topItens || [],
    totalPedidos, emProcesso, liberadosHoje, pendenciasAntigas, concluidosHoje,
    porEtapa, etapaOrdem: ETAPA_ORDEM, etapaLabel: ETAPA_LABEL,
    semNf, atrasados, pecasHoje, pedidosHoje, pecasExpedidasHoje,
    valorFaturadoHoje: pedidosComValor > 0 ? valorFaturadoHoje : null, valorFaturadoTotal: pedidosComValor > 0 ? valorFaturadoTotal : null,
    porTransp: transpOrdenado, porHora, porHoraPecas, porHoraLiberados, porHoraExpedidos, porTurno,
    maiorEsperaSeparar: maiorEspera(paradosSeparar), maiorEsperaConferir: maiorEspera(paradosConferir),
    maiorEsperaExpedicao: maiorEspera(paradosExpedicao), maiorEsperaFaturamento: maiorEspera(paradosFaturamento),
    rankingEtapas,
    sla: {
      separarHoras: SLA_SEPARAR_H, conferirHoras: SLA_CONFERIR_H, expedicaoHoras: SLA_EXPEDICAO_H, faturarHoras: SLA_FATURAR_H,
      separarEstourado: slaSepEstourado.length, conferirEstourado: slaConfEstourado.length, expedicaoEstourado: slaExpEstourado.length, faturarEstourado: slaFatEstourado.length,
      listaSeparar: ordenaPior(slaSepEstourado), listaConferir: ordenaPior(slaConfEstourado), listaExpedicao: ordenaPior(slaExpEstourado), listaFaturar: ordenaPior(slaFatEstourado),
      listaAtrasados: ordenaPior(listaAtrasados),
    },
  };
}
function r1(ms) { return Math.round(ms / 3600000 * 10) / 10; }

let dashboardCache = null;
let dashboardOrdersCache = null;
async function dashboardOrdersCarregar() {
  if (dashboardOrdersCache && Date.now() - dashboardOrdersCache.at < 5000) return dashboardOrdersCache.data;
  try { dashboardOrdersCache = { at: Date.now(), data: await objLoad(DASHBOARD_ORDERS_OBJ) }; }
  catch (e) { if (dashboardOrdersCache) return dashboardOrdersCache.data; throw e; }
  return dashboardOrdersCache.data;
}
// Monta o dashboard NA HORA, cruzando o último SC9 salvo com os bipes de HOJE
// (lidos ao vivo — não um retrato do momento do save). Cacheado por poucos
// segundos só pra não bater no storage a cada poll de cada usuário; qualquer
// bipe novo aparece pra todo mundo em, no máximo, esses poucos segundos —
// sem precisar subir um SC9 de novo.
async function dashboardAoVivo() {
  if (dashboardCache && Date.now() - dashboardCache.at < 4000) return dashboardCache.data;
  const base = await dashboardOrdersCarregar();
  if (!base) return null;
  const bipadosHoje = new Map();
  try {
    // "bipadosHoje" é o nome histórico, mas pra CLASSIFICAR a etapa certo, um
    // pedido bipado há dias/semanas continua contando como "já foi pra
    // expedição" — só as métricas de HOJE (concluidosHoje, porHoraExpedidos)
    // é que filtram por data depois, dentro de montarDashboardLive.
    for (const dia of await saidaDiasCarregar()) {
      const dSaida = await saidaCarregar(dia);
      for (const e of dSaida.entries) if (!bipadosHoje.has(e.pedido)) bipadosHoje.set(e.pedido, e.registradoEm);
    }
  } catch { /* segue sem cruzar, só com o que o SC9 já mostra */ }
  const dash = montarDashboardLive(base, bipadosHoje);
  try {
    const dias = await dashboardHistAtualizar(dash);
    dash.historico = dias;
    dash.ontem = dias[diaAnterior(diaSP(), 1)] || null;
    // mesma coisa, mas em lista ordenada por data — pronta pra virar gráfico
    // de tendência diária, sem o front precisar reordenar chave de objeto.
    dash.tendenciaDiaria = Object.entries(dias).sort(([a], [b]) => a.localeCompare(b))
      .map(([dia, v]) => ({ dia, pedidos: v.pedidosHoje || 0, pecas: v.pecasHoje || 0 }));
  } catch (e) { console.error("Erro ao atualizar o histórico do dashboard:", e); dash.historico = {}; dash.ontem = null; dash.tendenciaDiaria = []; }
  dashboardCache = { at: Date.now(), data: dash };
  return dash;
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
    itens: (r.it || []).map((i) => ({ produto: i.produto, nome: (indice.nomes && indice.nomes[i.produto]) || "", qt: i.qt, lote: i.lote || "" })),
  };
}
// NÃO inclui "itens" aqui de propósito — isso é guardado em TODO bipe (um
// pedido normal pode ter vários itens, cada um com produto/nome/quantidade),
// e cada bipe REGRAVA o arquivo do dia inteiro. Num dia movimentado, com
// centenas de bipes, isso engordava o arquivo rapidamente e pesava a cada
// gravação. Quem precisa dos itens (a tela de marcar alteração) busca sob
// demanda via /api/pedido-info, só pro pedido específico, na hora que precisa.
const resumoInfo = (i) => (i ? { armazem: i.armazem, cliente: i.cliente, transportadora: i.transportadora, linhas: i.linhas, pecas: i.pecas, conferente: i.conferente, nf: i.nf, liberadoEm: i.liberadoEm, fimConferencia: i.fimConferencia } : null);
function normalizarPedido(x) {
  const d = String(x === null || x === undefined ? "" : x).replace(/\D/g, "").replace(/^0+/, "");
  return d.length >= 4 && d.length <= 10 ? d : null;
}

// um arquivo por dia (fica pequeno e rápido); o dia é o do Brasil, não o do servidor
// Criar um Intl.DateTimeFormat novo a cada chamada é caro (~60x mais lento que
// reaproveitar) — com milhares de pedidos processados por salvamento, isso
// sozinho já somava segundos e contribuía pros 502 (tempo esgotado no Render).
const FORMATADOR_DIA_SP = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" });
const diaSP = (d = new Date()) => FORMATADOR_DIA_SP.format(d);
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
// um pedido "pendente" é aquele que a reconciliação ainda pode precisar tocar
// (ainda sem info do SC9, ou já tem info mas ainda sem NF — pode ganhar NF a
// qualquer momento). Uma vez com NF, o pedido nunca mais muda.
const entradaPendente = (e) => e.semDadoSC9 || !(e.info && e.info.nf);
// grava numa cópia; só troca a memória DEPOIS de gravar (se falhar, nada fica pela metade)
async function saidaGravar(dia, novo) {
  novo.versao = (novo.versao || 0) + 1;
  await objSave(saidaObj(dia), novo);
  saidaCache.set(dia, novo);
  // marca no ÍNDICE COMPARTILHADO (arquivo pequeno) se esse dia ainda tem
  // pendente — é essa marca que deixa a reconciliação pular um dia inteiro
  // SEM BAIXAR NADA do Supabase, em vez de precisar abrir o dia só pra
  // descobrir que já está tudo resolvido.
  try {
    const idx = await saidaIdxCarregar();
    const temPendente = novo.entries.some(entradaPendente);
    // atenção: "undefined" (nunca verificado) e "false" (já resolvido) são
    // ESTADOS DIFERENTES, mesmo os dois sendo "falsy" — por isso a comparação
    // é direta (!==), não via Boolean(), senão a primeira marcação nunca era
    // gravada de verdade e todo dia continuava sendo baixado pra sempre.
    if (idx.pendentes[dia] !== temPendente) {
      const pendentes = { ...idx.pendentes, [dia]: temPendente };
      await saidaIdxSalvar({ ...idx, pendentes });
    }
  } catch (e) { console.error(`Erro ao atualizar o índice de pendentes (dia ${dia}):`, e); }
}

async function objDelete(name) {
  if (SB_URL && SB_KEY) {
    const res = await fetch(objUrl(name), { method: "DELETE", headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY } });
    if (!res.ok && res.status !== 404 && res.status !== 400) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Supabase Storage (apagar ${name}) falhou (${res.status}): ${txt}`);
    }
    return;
  }
  const file = path.join(LOCAL_DIR, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// Índice dos dias que têm bipe guardado (a gente mesmo mantém) + quais já foram EXPORTADOS.
// Regra combinada: passou de 30 dias -> o administrador EXPORTA e só então APAGA. Nada é apagado sozinho,
// e o servidor só apaga um dia que já foi exportado (e que não mudou depois da exportação).
const SAIDA_DIAS_OBJ = "saida-dias.json";
let saidaIdx = null; // { dias: [...], exportados: { "AAAA-MM-DD": { em, por, versao, pedidos } } }
async function saidaIdxCarregar() {
  if (saidaIdx) return saidaIdx;
  const d = await objLoad(SAIDA_DIAS_OBJ);
  saidaIdx = {
    dias: Array.isArray(d && d.dias) ? d.dias.slice() : [],
    exportados: d && d.exportados && typeof d.exportados === "object" ? { ...d.exportados } : {},
    pendentes: d && d.pendentes && typeof d.pendentes === "object" ? { ...d.pendentes } : {},
  };
  return saidaIdx;
}
async function saidaIdxSalvar(novo) { await objSave(SAIDA_DIAS_OBJ, novo); saidaIdx = novo; }
const saidaDiasCarregar = async () => (await saidaIdxCarregar()).dias;
async function saidaDiasAdicionar(dia) {
  const i = await saidaIdxCarregar();
  if (i.dias.includes(dia)) return;
  await saidaIdxSalvar({ ...i, dias: [...i.dias, dia].sort() });
}
const diasRecentesPrimeiro = async (hoje) => [...new Set([hoje, ...[...(await saidaDiasCarregar())].sort().reverse()])];

// exporta (e, se pedido, MARCA como exportado) — o que vai pro Excel é exatamente o que ficou marcado
async function saidaExportar(de, ate, marcar, sess) {
  return comFila("saida", async () => {
    const idx = await saidaIdxCarregar();
    const lista = idx.dias.slice().sort().filter((d) => d >= de && d <= ate);
    const dias = [], exportados = { ...idx.exportados };
    for (const dia of lista) {
      const d = await saidaCarregar(dia);
      dias.push({ dia, entries: d.entries });
      if (marcar) exportados[dia] = { em: new Date().toISOString(), por: sess.usuario, versao: d.versao || 0, pedidos: d.entries.length };
    }
    if (marcar && lista.length) await saidaIdxSalvar({ ...idx, exportados });
    return dias;
  });
}
// apaga os dias pedidos — tudo ou nada: se algum não foi exportado (ou mudou depois), não apaga NENHUM
async function saidaApagar(diasPedidos) {
  return comFila("saida", async () => {
    const idx = await saidaIdxCarregar();
    const hoje = diaSP();
    const pendentes = [];
    for (const dia of diasPedidos) {
      if (dia === hoje) { pendentes.push({ dia, motivo: "hoje" }); continue; }
      if (!idx.dias.includes(dia)) { pendentes.push({ dia, motivo: "nao_existe" }); continue; }
      const mk = idx.exportados[dia];
      if (!mk) { pendentes.push({ dia, motivo: "nao_exportado" }); continue; }
      const d = await saidaCarregar(dia);
      if ((d.versao || 0) !== mk.versao) pendentes.push({ dia, motivo: "mudou_depois" });
    }
    if (pendentes.length) return { pendentes };
    let pedidos = 0;
    for (const dia of diasPedidos) {
      pedidos += (await saidaCarregar(dia)).entries.length;
      await objDelete(saidaObj(dia));
      saidaCache.delete(dia);
    }
    const restantes = idx.dias.filter((d) => !diasPedidos.includes(d));
    const exportados = { ...idx.exportados };
    for (const dia of diasPedidos) delete exportados[dia];
    await saidaIdxSalvar({ dias: restantes, exportados });
    console.log(`Saída: administrador apagou ${diasPedidos.length} dia(s) já exportado(s): ${diasPedidos.join(", ")}`);
    return { apagados: diasPedidos, pedidos };
  });
}

// Quando o administrador sobe um SC9 novo: rever TODOS os bipes guardados com o que o SC9 mostra agora.
// Pedido que "não existia no SC9" e agora existe é resolvido; NF, conferente e fim da conferência
// que apareceram depois também são atualizados. Bipe cujo pedido não está no SC9 novo fica como estava.
async function saidaReconciliar(indice) {
  return comFila("saida", async () => {
    const idx = await saidaIdxCarregar();
    // só baixa do Supabase os dias marcados como pendentes — os já resolvidos
    // (NF emitida) nunca mais mudam, então nem precisam ser abertos de novo.
    // Dia sem marca ainda (`undefined`, de antes dessa otimização existir, ou
    // recém criado) é tratado como pendente por segurança — só até a primeira
    // verificação, que já deixa ele marcado certinho daí pra frente.
    const paraChecar = idx.dias.filter((dia) => idx.pendentes[dia] !== false);
    let resolvidos = 0, atualizados = 0;
    for (const dia of paraChecar) {
      const atual = await saidaCarregar(dia);
      const novo = JSON.parse(JSON.stringify(atual));
      let mudou = false;
      for (const e of novo.entries) {
        if (!entradaPendente(e)) continue; // já resolvido, não muda mais
        const info = infoDoPedido(indice, e.pedido);
        if (!info) continue;
        const resumo = resumoInfo(info);
        if (JSON.stringify(resumo) === JSON.stringify(e.info)) continue;
        if (e.semDadoSC9) { e.semDadoSC9 = false; e.resolvidoEm = new Date().toISOString(); resolvidos++; } else atualizados++;
        e.info = resumo; e.infoAtualizadaEm = indice.savedAt || null; mudou = true;
      }
      // só grava se mudou algo de verdade, OU se esse dia acabou de ficar 100%
      // resolvido agora (pra marcar como tal e nunca mais precisar baixá-lo) —
      // nunca grava (nem sobe a versão) à toa, senão atrapalha a regra de
      // "só apaga o que já foi exportado e não mudou depois".
      const aindaPendente = novo.entries.some(entradaPendente);
      if (mudou || (idx.pendentes[dia] !== false && !aindaPendente)) await saidaGravar(dia, novo);
    }
    return { resolvidos, atualizados };
  });
}


// ---------------------------------------------------------------------------
// Recebimento na expedição: a expedição BIPA o pedido que "desceu" do estoque.
// Cada bipe é conferido com a aba "Saída p/ Expedição" (o que o estoque disse que
// desceu). Também guarda volumes, o motivo de um pedido não sair hoje e, quando
// o usuário de despacho sobe a planilha de Entrega do SC9, quais saíram de fato.
// Guardado por dia (igual à Saída); a leitura de rotina vem da memória, sem
// baixar nada do Supabase a cada atualização da tela.
// ---------------------------------------------------------------------------
const RECEB_DIAS_DUP = 3;      // um pedido já recebido nesses últimos dias não entra de novo
const RECEB_DIAS_ENTREGA = 10; // a planilha de Entrega confirma recebimentos desses últimos dias
const RECEB_MOTIVOS = ["Sem transportadora/coleta hoje", "Aguardando liberação ou pagamento do cliente", "Pedido incompleto (falta item)", "Alteração de pedido pendente", "Problema de endereço ou cadastro", "Cliente pediu para segurar", "Pedido cancelado ou retirado", "Outro"];
const RECEB_PESQ_DIAS = 30;      // a pesquisa olha até 30 dias para trás
const RECEB_PESQ_MAX = 200;      // máximo de recebimentos devolvidos de uma vez
const RECEB_PESQ_MAX_SC9 = 40;   // máximo de "ainda não chegou / só no SC9"
const semAcento = (s) => String(s === null || s === undefined ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// palavras da busca (sem acento, minúsculas); número solto com menos de 3 dígitos é ignorado (casaria com tudo)
const recebPalavras = (q) => semAcento(q).split(/[\s,;]+/).filter((p) => p && !(/^\d+$/.test(p) && p.length < 3)).slice(0, 6);
const recebPalheiro = (pedido, info, quem) => semAcento([pedido, info && info.nf, info && info.cliente, info && info.codCliente, info && info.transportadora, quem].filter((x) => x !== null && x !== undefined).join(" "));
const recebObj = (dia) => `recebimento-exp-${dia}.json`;
const recebCache = new Map();
async function recebCarregar(dia) {
  if (recebCache.has(dia)) return recebCache.get(dia);
  const data = await objLoad(recebObj(dia));
  const v = data && Array.isArray(data.entries) ? data : { dia, versao: 0, entries: [], removidos: [] };
  if (!Array.isArray(v.removidos)) v.removidos = [];
  recebCache.set(dia, v);
  return v;
}
async function recebGravar(dia, novo) {
  novo.versao = (novo.versao || 0) + 1;
  await objSave(recebObj(dia), novo);
  recebCache.set(dia, novo);
}
// Configuração do recebimento (compartilhada): depois de quantas horas um pedido que "desceu" e não chegou vira alerta
const RECEB_CONFIG_OBJ = "recebimento-config.json";
const RECEB_ALERTA_PADRAO_H = 2;
let recebConfig = null;
async function recebConfigCarregar() {
  if (recebConfig) return recebConfig;
  let d = null; try { d = await objLoad(RECEB_CONFIG_OBJ); } catch { /* usa o padrão */ }
  const h = d && Number.isFinite(Number(d.alertaHoras)) ? Number(d.alertaHoras) : RECEB_ALERTA_PADRAO_H;
  recebConfig = { alertaHoras: h, por: (d && d.por) || null, em: (d && d.em) || null };
  return recebConfig;
}
const RECEB_ENTREGAS_OBJ = "recebimento-entregas.json";
let recebEntregas = null;
async function recebEntregasCarregar() {
  if (recebEntregas) return recebEntregas;
  const d = await objLoad(RECEB_ENTREGAS_OBJ);
  recebEntregas = { uploads: Array.isArray(d && d.uploads) ? d.uploads : [] };
  return recebEntregas;
}
const recebDiasJanela = (hoje, n) => Array.from({ length: n }, (_, i) => diaAnterior(hoje, i));
// pedido -> { entry, dia } entre as saídas dos últimos dias (a mais nova vale)
async function saidaMapaRecente(hoje, n) {
  const mapa = new Map(); const versoes = [];
  for (const dia of recebDiasJanela(hoje, n)) {
    const d = await saidaCarregar(dia);
    versoes.push(d.versao || 0);
    for (const e of d.entries) if (!mapa.has(e.pedido)) mapa.set(e.pedido, { entry: e, dia });
  }
  return { mapa, versoes };
}
const descerResumo = (achado) => (achado
  ? { status: "ok", saidaEm: achado.entry.registradoEm, saidaPor: achado.entry.registradoPorNome || achado.entry.registradoPorUsuario, saidaDia: achado.dia, emAlteracao: Boolean(achado.entry.alteracao && achado.entry.alteracao.status === "pendente") }
  : { status: "sem_saida" });
async function exigirRecebimento(req, res, { despacho = false, leitura = false } = {}) {
  const sess = await getSession(req);
  if (!sess) { sendJson(res, 401, { error: "não autenticado" }); return null; }
  if (sess.role !== "admin" && sess.role !== "operador") { sendJson(res, 403, { error: "seu acesso não permite isso" }); return null; }
  const perfis = sess.perfis || [];
  const pode = sess.role === "admin"
    || (despacho ? perfis.includes("despacho") : leitura ? (perfis.includes("recebimento") || perfis.includes("despacho")) : perfis.includes("recebimento"));
  if (!pode) { sendJson(res, 403, { error: despacho ? "só o usuário de despacho pode confirmar a saída com a planilha de Entrega" : "seu acesso não permite isso" }); return null; }
  return sess;
}

const LOGIN_RE = /^[a-z0-9._-]{3,30}$/;
const SD3_STATUS_VALIDOS = ["ok", "atencao", "divergente", "sem_dado"];
const SD3_TRANSF_VALIDOS = ["completa", "so_saida", "destino_diferente"];
const sd3Txt = (v, max) => String(v === null || v === undefined ? "" : v).slice(0, max);
const sd3Iso = (v) => { if (!v) return null; const t = new Date(v); return isNaN(t.getTime()) ? null : t.toISOString(); };
const sd3Num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function sanitizarConferenciaSD3(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  return {
    verificadoEm: sd3Iso(c.verificadoEm), coberturaAte: sd3Iso(c.coberturaAte),
    status: SD3_STATUS_VALIDOS.includes(c.status) ? c.status : "sem_dado",
    totalEntrada: sd3Num(c.totalEntrada),
    docs: (Array.isArray(c.docs) ? c.docs : []).slice(0, 8).map((d) => ({
      doc: sd3Txt(d && d.doc, 40), dt: sd3Iso(d && d.dt), qtd: sd3Num(d && d.qtd), usuario: sd3Txt(d && d.usuario, 60),
      status: SD3_TRANSF_VALIDOS.includes(d && d.status) ? d.status : "completa",
    })),
    flags: (Array.isArray(c.flags) ? c.flags : []).slice(0, 8).map((f) => ({
      nivel: ["erro", "aviso", "info"].includes(f && f.nivel) ? f.nivel : "aviso", titulo: sd3Txt(f && f.titulo, 300),
      hipoteses: (Array.isArray(f && f.hipoteses) ? f.hipoteses : []).slice(0, 5).map((h) => sd3Txt(h, 200)),
    })),
  };
}
function sanitizarExtraSD3(x) {
  x = x && typeof x === "object" ? x : {};
  return {
    coberturaAte: sd3Iso(x.coberturaAte), desde: sd3Iso(x.desde),
    semRegistro: (Array.isArray(x.semRegistro) ? x.semRegistro : []).slice(0, 200).map((t) => ({
      doc: sd3Txt(t && t.doc, 40), lote: sd3Txt(t && t.lote, 60), produto: sd3Txt(t && t.produto, 60), qtd: sd3Num(t && t.qtd),
      dt: sd3Iso(t && t.dt), usuario: sd3Txt(t && t.usuario, 60),
      status: SD3_TRANSF_VALIDOS.includes(t && t.status) ? t.status : "completa",
      armazemEntradaErrado: t && t.armazemEntradaErrado ? sd3Txt(t.armazemEntradaErrado, 10) : null,
    })),
  };
}
const CAMPOS_IDENTIDADE = ["criadoPorUsuario", "criadoPorNome", "criadoEm", "confirmadoPorUsuario", "confirmadoPorNome", "confirmadoEm"];

// Rate limit geral: além do bloqueio específico do login (mais rígido), toda a
// API tem um teto por IP — evita um script (ou uma conta comprometida) martelar
// o servidor sem limite. Generoso o bastante pra uso normal (vários navegadores
// no mesmo IP da empresa, polling do dashboard a cada poucos segundos).
const RATE_LIMIT_JANELA_MS = 60 * 1000;
const RATE_LIMIT_MAX = 240; // por IP, por minuto — ampla margem pra várias pessoas atrás do mesmo IP
const rateLimitPorIp = new Map();
function rateLimitExcedido(ip) {
  const agora = Date.now();
  const reg = rateLimitPorIp.get(ip);
  if (!reg || agora - reg.inicio > RATE_LIMIT_JANELA_MS) { rateLimitPorIp.set(ip, { inicio: agora, n: 1 }); return false; }
  reg.n++;
  return reg.n > RATE_LIMIT_MAX;
}
setInterval(() => { // limpeza periódica, senão o mapa cresce pra sempre
  const agora = Date.now();
  for (const [ip, reg] of rateLimitPorIp) if (agora - reg.inicio > RATE_LIMIT_JANELA_MS * 2) rateLimitPorIp.delete(ip);
}, 5 * 60 * 1000).unref();

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (pathname !== "/api/health" && rateLimitExcedido(ipDe(req))) {
    return sendJson(res, 429, { error: "Muitas requisições em pouco tempo. Aguarde um instante." });
  }

  if (method === "POST" && req.headers["x-sc9-app"] !== "1") {
    // reforço contra CSRF: um <form> ou <img> de outro site não consegue
    // mandar esse cabeçalho customizado, e um fetch() de outra origem cairia
    // no bloqueio de CORS antes mesmo de chegar aqui (o servidor não libera
    // Access-Control-Allow-Origin pra ninguém). Cookie SameSite=Lax já ajuda
    // bastante; isso é uma segunda camada.
    return sendJson(res, 403, { error: "requisição rejeitada (cabeçalho esperado ausente)" });
  }

  if (pathname === "/api/health" && method === "GET") {
    return sendJson(res, 200, { ok: true, storage: usingSupabase ? "supabase" : "local-file", controle: "autossuficiente-v2", acessos: "v3", saida: "v3", dashboard: "v6", time: new Date().toISOString() });
  }

  // DIAGNÓSTICO TEMPORÁRIO: mostra exatamente o que está guardado no servidor
  // pra um pedido específico, em cada etapa do caminho — só administrador.
  if (pathname === "/api/debug-pedido" && method === "GET") {
    if (!(await exigir(req, res, ["admin"]))) return;
    const ped = new URL(req.url, "http://localhost").searchParams.get("pedido");
    if (!ped) return sendJson(res, 400, { error: "informe ?pedido=NUMERO" });
    try {
      const base = await dashboardOrdersCarregar();
      const noBanco = base ? (base.orders || []).find((o) => String(o.pedido) === String(ped)) : null;
      const idx = await indiceCarregar().catch(() => null);
      const noIndice = idx && idx.pedidos ? idx.pedidos[String(ped).replace(/\D/g, "").replace(/^0+/, "")] : null;
      return sendJson(res, 200, {
        pedidoBuscado: ped,
        baseTemDados: Boolean(base), baseSavedAt: base ? base.savedAt : null, totalPedidosNaBase: base ? (base.orders || []).length : 0,
        encontradoNaBaseDoDashboard: Boolean(noBanco), noBanco,
        encontradoNoIndiceDeBipar: Boolean(noIndice), noIndice,
      });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro no diagnóstico")); }
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
    colocarCookie(req, res, sess, sv);
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
    catch (e) { return sendJson(res, 500, erroPublico(e, "erro interno")); }
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
      return sendJson(res, 500, erroPublico(e, "erro ao salvar usuários"));
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
      let saida = null;
      try { // índice de pedidos (é o que o conferente consulta ao bipar)
        const idx = montarIndicePedidos(payload);
        await objSave(INDICE_OBJ, idx);
        indiceCache = { at: Date.now(), data: idx };
        saida = await saidaReconciliar(idx); // e revê os bipes já guardados com o SC9 novo
      } catch (e) { console.error("Erro ao montar índice / reconciliar a saída:", e); }
      try {
        // Só os pedidos do Cambuci, com o que o dashboard precisa (liberação,
        // pickEnd, confEnd, nf, status, transportadora, peças). Guardado à
        // parte do resto — é a base que o /api/dashboard usa, recalculando NA
        // HORA a cada consulta (não só quando alguém sobe um SC9 novo). Assim,
        // quem bipa um pedido na Saída p/ Expedição vê o dashboard reagir
        // na hora, mesmo sem um SC9 novo — sobe o SC9 de novo só quando o
        // pedido em si mudar de verdade (separou, conferiu, saiu NF).
        // "IMPLACIL" no nome do cliente é transferência interna entre unidades
        // da própria empresa, não venda de verdade — mesma regra já usada nos
        // consolidados em Excel. Fica de fora de todo o dashboard/TV.
        const ehTransferenciaInterna = (nome) => /IMPLACIL/i.test(String(nome || ""));
        const pedidosExcluidos = new Set(
          (payload.orders || []).filter((o) => o.armazem === "Cambuci" && ehTransferenciaInterna(o.nome)).map((o) => String(o.pedido))
        );
        // pedido já expedido (status "Enviado") e liberado há mais de 7 dias
        // nunca mais muda e não aparece em NADA do dashboard ao vivo (nem
        // pendência, nem "hoje", nem gargalo) — só pesa a chamada de rede pro
        // Supabase à toa, carregando/salvando o mesmo histórico morto a cada
        // SC9 novo. Um SC9 real acumula meses de pedidos já resolvidos; sem
        // esse corte, o objeto salvo cresce sem parar.
        const SETE_DIAS_MS = 7 * 86400000;
        const corteAntigo = Date.now() - SETE_DIAS_MS;
        const relevante = (o) => o.status !== "Enviado" || !o.dt || new Date(o.dt).getTime() >= corteAntigo;
        const ordersCambuci = (payload.orders || [])
          .filter((o) => o.armazem === "Cambuci" && !ehTransferenciaInterna(o.nome) && relevante(o))
          .map((o) => ({ pedido: o.pedido, dt: o.dt, dtLiberacaoHora: o.dtLiberacaoHora, pickStart: o.pickStart, pickEnd: o.pickEnd, confEnd: o.confEnd, nf: o.nf, status: o.status, qt: (typeof o.qt === "number" && !isNaN(o.qt) && o.qt > 0) ? o.qt : 0, transportadora: o.transportadora, nome: o.nome }));
        // top itens do Cambuci por quantidade liberada — só o suficiente pro
        // ranking (top 10, guarda uma folga além do top 5 mostrado na tela),
        // não a lista de itens inteira (isso pesaria o payload à toa).
        const qtdPorProduto = new Map();
        for (const it of payload.items || []) {
          if (it.armazem !== "Cambuci" || pedidosExcluidos.has(String(it.pedido))) continue;
          qtdPorProduto.set(it.produto, (qtdPorProduto.get(it.produto) || 0) + Math.max(0, Number(it.qt) || 0));
        }
        const nomesItem = new Map((payload.itemNames || []).map(([k, v]) => [String(k), String(v)]));
        const topItens = [...qtdPorProduto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([produto, qtd]) => ({ produto, nome: nomesItem.get(String(produto)) || "", qtd }));
        // só os valores/datas de NF dos pedidos que sobraram acima — guardar
        // o histórico inteiro de notas (que pode ter milhares) à toa, pra
        // pedidos que nem aparecem mais no dashboard, só pesava o objeto salvo.
        const nfsRelevantes = new Set(ordersCambuci.filter((o) => o.nf).map((o) => String(o.nf)));
        const valoresPorNFSlim = (payload.valores || []).filter(([k]) => nfsRelevantes.has(String(k)));
        const faturamentoPorNFSlim = (payload.faturamento || []).filter(([k]) => nfsRelevantes.has(String(k)));
        await objSave(DASHBOARD_ORDERS_OBJ, { savedAt: payload.savedAt, sc5PorPedido: payload.sc5PorPedido || [], orders: ordersCambuci, topItens, valoresPorNF: valoresPorNFSlim, faturamentoPorNF: faturamentoPorNFSlim });
        dashboardOrdersCache = null; // força reler na próxima consulta
        dashboardCache = null; // força recalcular o dashboard já com a base nova
        await dashboardRegistrarSincronizacao();
      } catch (e) { console.error("Erro ao salvar a base do dashboard:", e); }
      try {
        // Valor faturado GERAL do mês — TODOS os armazéns juntos (Cambuci,
        // Tamboré, BH, RJ, DF, CE), não só Cambuci, e não só hoje: é o mês
        // inteiro, pra comparar com a meta mensal. Mesma exclusão da
        // transferência interna (Implacil) aplicada aqui também.
        const valoresPorNF = new Map((payload.valores || []).map(([k, v]) => [String(k), v]));
        const faturamentoPorNF = new Map((payload.faturamento || []).map(([k, v]) => [String(k), v]));
        // mês de REFERÊNCIA: o mês com mais notas emitidas nesse SC9, não
        // necessariamente o mês do calendário de hoje. Sem isso, no primeiro
        // dia de um mês novo — antes do primeiro SC9 daquele mês ser subido —
        // o valor faturado ficava vazio mesmo tendo dado real e válido do mês
        // anterior, só porque "hoje" já virou a página do calendário.
        const contagemPorMes = new Map();
        for (const ts of faturamentoPorNF.values()) {
          const mes = mesSP(new Date(ts));
          contagemPorMes.set(mes, (contagemPorMes.get(mes) || 0) + 1);
        }
        let mesReferencia = mesSP();
        let maiorContagem = 0;
        for (const [mes, n] of contagemPorMes) if (n > maiorContagem) { maiorContagem = n; mesReferencia = mes; }
        let valorMes = 0, pedidosComValorMes = 0;
        const vistos = new Set(); // uma NF só conta uma vez, mesmo com várias linhas/itens do mesmo pedido
        for (const o of payload.orders || []) {
          if (!ARMAZENS_GERAL.has(o.armazem)) continue;
          if (/IMPLACIL/i.test(String(o.nome || ""))) continue;
          if (!o.nf || vistos.has(String(o.nf))) continue;
          const emissao = faturamentoPorNF.get(String(o.nf));
          if (!emissao || mesSP(new Date(emissao)) !== mesReferencia) continue;
          const v = valoresPorNF.get(String(o.nf));
          const valor = v ? (v.fatura ?? v.mercad) : null;
          if (typeof valor !== "number" || isNaN(valor)) continue;
          vistos.add(String(o.nf));
          valorMes += valor; pedidosComValorMes++;
        }
        await objSave(VALOR_GERAL_OBJ, { mes: mesReferencia, valorMes: pedidosComValorMes > 0 ? valorMes : null, notasContadas: pedidosComValorMes, atualizadoEm: new Date().toISOString() });
      } catch (e) { console.error("Erro ao calcular o valor faturado geral:", e); }
      return sendJson(res, 200, { ok: true, ...info, orders: payload.orders.length, saida });
    } catch (e) {
      console.error("Erro ao salvar snapshot:", e);
      return sendJson(res, 500, erroPublico(e, "erro ao salvar"));
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
      return sendJson(res, 500, erroPublico(e, "erro ao carregar"));
    }
  }

  // ---- Conferência do Controle 02->01 com o SD3 (Protheus) ----
  // O arquivo do SD3 NUNCA fica salvo aqui. O administrador carrega no navegador, o
  // navegador cruza com o controle e manda só o RESULTADO de cada entrega (compacto).
  // Assim o operador também vê a conferência, sem a movimentação inteira ir pro servidor.
  // Endpoint próprio (e não o upsert do controle) pra gravar SÓ esse campo: um upsert
  // substitui a entrega inteira e poderia desfazer um recebimento que o operador
  // acabou de confirmar.
  if (pathname === "/api/controle-sd3" && method === "GET") {
    if (!(await exigir(req, res, ["admin", "operador"], "controle0201"))) return;
    try {
      const data = await objLoad(CONTROLE_SD3_OBJ);
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, { extra: data || null });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao carregar a conferência com o SD3")); }
  }
  if (pathname === "/api/controle-sd3" && method === "POST") {
    const sess = await exigir(req, res, ["admin"]); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    body = body || {};
    const resultados = Array.isArray(body.resultados) ? body.resultados : [];
    if (resultados.length > 3000) return sendJson(res, 400, { error: "resultados demais de uma vez (máximo 3000)" });
    try {
      const mapa = new Map();
      for (const r of resultados) {
        if (!r || typeof r.id !== "string") continue;
        const c = sanitizarConferenciaSD3(r.conferenciaSD3);
        if (c) mapa.set(r.id, c);
      }
      const extra = sanitizarExtraSD3(body.extra);
      const saida = await comFilaControle(async () => {
        const atual = await loadControle();
        const lista = (atual && Array.isArray(atual.entries)) ? atual.entries : [];
        let atualizados = 0;
        const nova = lista.map((e) => { const c = mapa.get(e.id); if (!c) return e; atualizados++; return { ...e, conferenciaSD3: c }; });
        const agora = new Date().toISOString();
        if (atualizados) await saveControle({ ...(atual || {}), entries: nova, savedAt: agora });
        await objSave(CONTROLE_SD3_OBJ, { ...extra, atualizadoEm: agora, atualizadoPor: sess.nome || sess.usuario || "administrador" });
        return { ok: true, atualizados, semRegistro: extra.semRegistro.length };
      });
      return sendJson(res, 200, saida);
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao salvar a conferência com o SD3")); }
  }

  // ---- saldo por lote (administrador e operador) ----
  if (pathname === "/api/saldo" && method === "GET") {
    if (!(await exigir(req, res, ["admin", "operador"], "controle0201"))) return;
    try {
      const data = await objLoad(SALDO_OBJ);
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, { saldoPorLote: data ? data.saldoPorLote : null, savedAt: data ? data.savedAt || null : null });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao carregar saldo")); }
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
      return sendJson(res, 500, erroPublico(e, "erro ao carregar controle"));
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
            // uma cópia velha (de um navegador que ficou sem salvar) nunca "desconfirma" uma entrega já confirmada
            if (existenteConfirmado && (u0.qtdRecebida === null || u0.qtdRecebida === undefined)) { ignorados++; continue; }
            const u = { ...u0 };
            for (const k of CAMPOS_IDENTIDADE) delete u[k]; // identidade nunca vem do navegador
            delete u.conferenciaSD3; // resultado do SD3 só entra por /api/controle-sd3 (admin) — nunca por aqui
            if (existente) {
              for (const k of CAMPOS_IDENTIDADE) if (existente[k] !== undefined) u[k] = existente[k];
              if (existente.conferenciaSD3 !== undefined) u.conferenciaSD3 = existente.conferenciaSD3; // reenviar uma entrega antiga não apaga a conferência
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
      return sendJson(res, 500, erroPublico(e, "erro ao salvar controle"));
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
        for (const dia of await diasRecentesPrimeiro(hoje)) {
          const d = await saidaCarregar(dia);
          existente = d.entries.find((e) => e.pedido === ped) || null; // mais novo primeiro
          if (existente) break;
        }
        if (existente && body.reenvio !== true) return { duplicado: existente };
        const atual = await saidaCarregar(hoje);
        // cópia RASA (não JSON.parse(JSON.stringify(...)) do dia inteiro) — só
        // estamos adicionando 1 registro no topo, não precisamos clonar em
        // profundidade os que já existem. Com vários bipes seguidos, a
        // clonagem funda do dia inteiro pesava memória à toa.
        const novo = { ...atual, entries: [...atual.entries], removidos: atual.removidos };
        const entry = {
          id: `sp_${ped}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`, pedido: ped,
          registradoPorUsuario: sess.usuario, registradoPorNome: sess.nome, registradoEm: new Date().toISOString(),
          semDadoSC9: !info, baseSavedAt: indice ? indice.savedAt || null : null,
          reenvio: Boolean(existente), reenvioDe: existente ? existente.id : null, info: resumoInfo(info),
        };
        novo.entries.unshift(entry);
        await saidaDiasAdicionar(hoje);
        await saidaGravar(hoje, novo);
        return { entry, total: novo.entries.length };
      });
      if (r.duplicado) return sendJson(res, 409, { error: "duplicado", duplicado: r.duplicado, info });
      return sendJson(res, 200, { ok: true, entry: r.entry, info, totalHoje: r.total, baseSavedAt: indice ? indice.savedAt || null : null });
    } catch (e) {
      console.error("Erro ao bipar:", e);
      return sendJson(res, 500, erroPublico(e, "erro ao registrar o pedido"));
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
      let retencao = null;
      if (sess.role === "admin") {
        const idx = await saidaIdxCarregar();
        const corte = diaAnterior(hoje, SAIDA_RETENCAO_DIAS), limite = diaAnterior(hoje, SAIDA_RETENCAO_DIAS - SAIDA_AVISO_DIAS);
        const lista = idx.dias.slice().sort();
        retencao = {
          dias: SAIDA_RETENCAO_DIAS, diasGuardados: lista.length,
          vencidos: lista.filter((x) => x < corte), venceEmBreve: lista.filter((x) => x >= corte && x <= limite),
          exportados: Object.fromEntries(Object.entries(idx.exportados).map(([k, v]) => [k, { em: v.em, pedidos: v.pedidos }])),
        };
      }
      return sendJson(res, 200, { dia, hoje, versao: d.versao || 0, entries: d.entries, removidos: sess.role === "admin" ? d.removidos : d.removidos.length, baseSavedAt, retencao });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao carregar a saída")); }
  }

  if (pathname === "/api/saida/desfazer" && method === "POST") {
    const sess = await exigir(req, res, ["admin", "operador"], "saida"); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = body && typeof body.id === "string" ? body.id : "";
    const hoje = diaSP();
    try {
      const r = await comFila("saida", async () => {
        const diasBusca = sess.role === "admin" ? await diasRecentesPrimeiro(hoje) : [hoje, diaAnterior(hoje, 1)];
        for (const dia of diasBusca) {
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
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao desfazer")); }
  }

  // Pedido de ALTERAÇÃO: no fechamento, quando falta lote/produto no pedido
  // principal, a diferença sai num "pedido de complemento" à parte. Marcar um
  // bipe como alteração tira ele da lista normal (fica pendente, à espera do
  // número do complemento); confirmar com os dados do complemento devolve ele
  // pra lista normal, já vinculado. Segue o MESMO padrão seguro do desfazer:
  // localiza o registro exato por id, clona só aquele dia, muta só aquele
  // registro — nunca mexe em nenhum outro bipe, de nenhum outro dia.
  if (pathname === "/api/saida/alteracao" && method === "POST") {
    const sess = await exigir(req, res, ["admin", "operador"], "saida"); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = body && typeof body.id === "string" ? body.id : "";
    const acao = body && body.acao;
    if (!id) return sendJson(res, 400, { error: "informe o id do registro" });
    if (!["marcar", "confirmar", "cancelar"].includes(acao)) return sendJson(res, 400, { error: "ação inválida (use marcar, confirmar ou cancelar)" });
    const hoje = diaSP();
    try {
      const r = await comFila("saida", async () => {
        const dias = await diasRecentesPrimeiro(hoje);
        for (const dia of dias) {
          const atual = await saidaCarregar(dia);
          const idx = atual.entries.findIndex((x) => x.id === id);
          if (idx === -1) continue;
          // clona TUDO antes de mudar qualquer coisa — se der erro de
          // validação no meio (ex.: campo faltando), nada foi salvo ainda.
          const novo = JSON.parse(JSON.stringify(atual));
          const e = novo.entries[idx];
          if (acao === "marcar") {
            // quem bipa só avisa "isso precisa de alteração" — um clique, sem
            // preencher nada. Item, quantidade, lote e o pedido de complemento
            // ficam todos pra quem for de fato tratar a alteração depois
            // (normalmente é essa pessoa quem cria o pedido de complemento,
            // então só ela sabe o número dele).
            e.alteracao = { status: "pendente", marcadoEm: new Date().toISOString(), marcadoPorUsuario: sess.usuario, marcadoPorNome: sess.nome };
          } else if (acao === "cancelar") {
            e.alteracao = null;
          } else {
            const pedidoComplemento = normalizarPedido(body.pedidoComplemento || "");
            const motivo = String(body.motivo || "").trim();
            // aceita tanto a lista nova (itens: [...]) quanto o formato antigo
            // de item único, convertendo pro novo formato — um pedido pode
            // precisar alterar mais de um item/lote de uma vez.
            const itensEntrada = Array.isArray(body.itens) ? body.itens : (body.item ? [{ item: body.item, quantidade: body.quantidade, lote: body.lote }] : []);
            if (!pedidoComplemento) return { erro: 400, msg: "informe o número do pedido de complemento" };
            if (!motivo) return { erro: 400, msg: "informe o motivo da alteração" };
            if (!itensEntrada.length) return { erro: 400, msg: "informe ao menos um item alterado" };
            for (const it of itensEntrada) {
              if (!it || !String(it.item || "").trim()) return { erro: 400, msg: "cada item precisa de um produto/código" };
              if (isNaN(Number(it.quantidade)) || Number(it.quantidade) <= 0) return { erro: 400, msg: "cada item precisa de uma quantidade válida (maior que zero)" };
              if (!String(it.lote || "").trim()) return { erro: 400, msg: "cada item precisa de um lote" };
            }
            const itens = itensEntrada.map((it) => ({ item: String(it.item).trim(), quantidade: Number(it.quantidade), lote: String(it.lote).trim() }));
            // TRAVA DE VERDADE: alteração "com nota" já foi faturada, então o
            // lote informado TEM que ser um lote real daquele pedido no SC9 —
            // não dá pra aceitar um lote que não existe ali. Só valida quando
            // o índice está disponível E o pedido foi encontrado nele (se não
            // achar o pedido no índice carregado agora, não trava — pode ser
            // só uma base desatualizada no momento, não um erro de verdade).
            const indiceAgora = await indiceCarregar().catch(() => null);
            const infoReal = infoDoPedido(indiceAgora, e.pedido);
            if (infoReal && infoReal.itens && infoReal.itens.length) {
              const reaisValidos = new Set(infoReal.itens.map((i) => `${i.produto}|${i.lote || ""}`));
              for (const it of itens) {
                if (!reaisValidos.has(`${it.item}|${it.lote}`)) {
                  return { erro: 400, msg: `o produto "${it.item}" com o lote "${it.lote}" não está nesse pedido, segundo o SC9 carregado — confira o lote certo antes de confirmar` };
                }
              }
            }
            e.alteracao = {
              status: "confirmada",
              marcadoEm: (e.alteracao && e.alteracao.marcadoEm) || new Date().toISOString(),
              marcadoPorUsuario: (e.alteracao && e.alteracao.marcadoPorUsuario) || sess.usuario,
              marcadoPorNome: (e.alteracao && e.alteracao.marcadoPorNome) || sess.nome,
              pedidoComplemento, itens, motivo,
              confirmadoEm: new Date().toISOString(), confirmadoPorUsuario: sess.usuario, confirmadoPorNome: sess.nome,
            };
          }
          await saidaGravar(dia, novo);
          return { ok: true, entry: e, dia };
        }
        return { erro: 404, msg: "registro não encontrado (talvez tenha saído da retenção)" };
      });
      if (r.erro) return sendJson(res, r.erro, { error: r.msg });
      return sendJson(res, 200, r);
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao atualizar a alteração")); }
  }

  // lista, de TODOS os dias guardados, os bipes marcados "de alteração" ainda
  // pendentes (esperando o número do pedido de complemento) — pra montar a
  // aba separada, sem precisar o operador adivinhar em qual dia foi bipado.
  if (pathname === "/api/saida/alteracoes" && method === "GET") {
    const sess = await exigir(req, res, ["admin", "operador"], "saida"); if (!sess) return;
    try {
      const somenteConfirmadas = new URL(req.url, "http://localhost").searchParams.get("confirmadas") === "1";
      const dias = await diasRecentesPrimeiro(diaSP());
      const resultado = [];
      for (const dia of dias) {
        const d = await saidaCarregar(dia);
        for (const e of d.entries) {
          if (!e.alteracao) continue;
          if (somenteConfirmadas ? e.alteracao.status === "confirmada" : e.alteracao.status === "pendente") {
            resultado.push({ dia, ...e });
          }
        }
      }
      return sendJson(res, 200, { itens: resultado });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao listar alterações")); }
  }

  // Alteração do TIPO 2 — na separação, antes da conferência. O separador só
  // avisa "esse pedido precisa de alteração" (pedido + 1 clique, sem detalhe
  // nenhum); quem tem o perfil "alteracoes" é quem vê, analisa e preenche o
  // resto (itens, lotes, quantidades e o motivo). Não tem nada a ver com os
  // bipes da Saída p/ Expedição — o pedido nem chegou lá ainda.
  if (pathname === "/api/alteracao-separacao" && method === "POST") {
    const sess = await exigir(req, res, ["admin", "operador"]); if (!sess) return; // qualquer um logado pode avisar
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const acao = body && body.acao;
    if (!["marcar", "confirmar", "cancelar"].includes(acao)) return sendJson(res, 400, { error: "ação inválida (use marcar, confirmar ou cancelar)" });

    if (acao === "marcar") {
      const pedido = normalizarPedido(body.pedido || "");
      if (!pedido) return sendJson(res, 400, { error: "informe o número do pedido" });
      try {
        const registro = await comFila("alteracao-separacao", async () => {
          const dados = await alteracaoSeparacaoCarregar();
          const r = {
            id: `altsep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            pedido, status: "pendente",
            marcadoEm: new Date().toISOString(), marcadoPorUsuario: sess.usuario, marcadoPorNome: sess.nome,
          };
          await alteracaoSeparacaoSalvar({ registros: [r, ...dados.registros] });
          return r;
        });
        return sendJson(res, 200, { ok: true, registro });
      } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao marcar a alteração")); }
    }

    // confirmar/cancelar: só quem tem o perfil "alteracoes" (ou admin) pode
    // tratar — é a pessoa específica que faz essa análise.
    if (sess.role !== "admin" && !(sess.perfis || []).includes("alteracoes")) return sendJson(res, 403, { error: "seu acesso não permite isso" });
    const id = body && typeof body.id === "string" ? body.id : "";
    if (!id) return sendJson(res, 400, { error: "informe o id do registro" });
    try {
      const resultado = await comFila("alteracao-separacao", async () => {
        const dados = await alteracaoSeparacaoCarregar();
        const idx = dados.registros.findIndex((r) => r.id === id);
        if (idx === -1) return { erro: 404, msg: "registro não encontrado" };
        const registros = dados.registros.map((r) => ({ ...r })); // cópia rasa: só o registro mutado abaixo troca de referência
        const r = registros[idx];
        if (acao === "cancelar") {
          registros[idx] = { ...r, status: "cancelada", canceladoEm: new Date().toISOString(), canceladoPorUsuario: sess.usuario, canceladoPorNome: sess.nome };
        } else {
          if (r.status !== "pendente") return { erro: 409, msg: "esse registro não está pendente de confirmação" };
          const motivo = String(body.motivo || "").trim();
          const itens = Array.isArray(body.itens) ? body.itens : [];
          if (!motivo) return { erro: 400, msg: "informe o motivo da alteração" };
          if (!itens.length) return { erro: 400, msg: "informe ao menos um item alterado" };
          for (const it of itens) {
            if (!it || !String(it.item || "").trim()) return { erro: 400, msg: "cada item precisa de um produto/código" };
            if (isNaN(Number(it.quantidade)) || Number(it.quantidade) <= 0) return { erro: 400, msg: "cada item precisa de uma quantidade válida (maior que zero)" };
            if (!String(it.lote || "").trim()) return { erro: 400, msg: "cada item precisa de um lote" };
          }
          // achadoMovimentacao é opcional: um texto curto (gerado no navegador,
          // a partir da movimentação que SÓ existe ali) com a hipótese
          // encontrada pra esse lote. A movimentação inteira nunca chega até
          // aqui — só esse resumo, quando existir.
          const itensLimpos = itens.map((it) => ({ item: String(it.item).trim(), quantidade: Number(it.quantidade), lote: String(it.lote).trim(), achadoMovimentacao: it.achadoMovimentacao ? String(it.achadoMovimentacao).slice(0, 2000) : null }));
          registros[idx] = { ...r, status: "confirmada", motivo, itens: itensLimpos, confirmadoEm: new Date().toISOString(), confirmadoPorUsuario: sess.usuario, confirmadoPorNome: sess.nome };
        }
        await alteracaoSeparacaoSalvar({ registros });
        return { ok: true, registro: registros[idx] };
      });
      if (resultado.erro) return sendJson(res, resultado.erro, { error: resultado.msg });
      return sendJson(res, 200, resultado);
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao atualizar a alteração")); }
  }

  // Lembretes do Cadastro de Lotes (SB8) — anotação curta por achado
  // (lote duplicado entre produtos, ou validade vencida). O arquivo SB8 em
  // si nunca passa por aqui.
  if (pathname === "/api/cadastro-lembretes" && method === "POST") {
    const sess = await exigir(req, res, ["admin", "operador"], "cadastro"); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const acao = body && body.acao;
    if (!["salvar", "remover"].includes(acao)) return sendJson(res, 400, { error: "ação inválida (use salvar ou remover)" });
    try {
      const resultado = await comFila("cadastro-lembretes", async () => {
        const dados = await cadastroLembretesCarregar();
        if (acao === "remover") {
          const id = body && typeof body.id === "string" ? body.id : "";
          if (!id) return { erro: 400, msg: "informe o id do lembrete" };
          const lembretes = dados.lembretes.filter((l) => l.id !== id);
          await cadastroLembretesSalvar({ lembretes });
          return { ok: true };
        }
        const chave = String(body.chave || "").trim();
        const tipo = String(body.tipo || "").trim();
        const nota = String(body.nota || "").trim();
        const status = String(body.status || "pendente").trim();
        const CORES_VALIDAS = ["vermelho", "amarelo", "verde", "azul", ""];
        const idxPrev = dados.lembretes.findIndex((l) => l.chave === chave && l.tipo === tipo);
        const anterior = idxPrev === -1 ? null : dados.lembretes[idxPrev];
        // cor: se o navegador não mandou o campo, mantém a que já estava (não apaga a marcação sem querer)
        const cor = body.cor === undefined ? ((anterior && anterior.cor) || "") : (CORES_VALIDAS.includes(String(body.cor || "").trim()) ? String(body.cor || "").trim() : "");
        // lote correto (só duplicados): identidade do registro marcado (filial|produto|armazém|validade). Ausente = mantém.
        const correto = body.correto === undefined ? ((anterior && anterior.correto) || "") : String(body.correto || "").trim().slice(0, 300);
        if (!chave) return { erro: 400, msg: "informe a chave do achado (lote/produto)" };
        if (!tipo) return { erro: 400, msg: "informe o tipo (duplicado ou validade)" };
        const idx = dados.lembretes.findIndex((l) => l.chave === chave && l.tipo === tipo);
        const lembretes = dados.lembretes.map((l) => ({ ...l }));
        const agora = new Date().toISOString();
        // "finalizado" = status resolvido: guarda QUANDO foi finalizado (não muda em edições seguintes; some se reabrir)
        const finalizadoEm = status === "resolvido" ? ((idx !== -1 && lembretes[idx].status === "resolvido" && lembretes[idx].finalizadoEm) || agora) : null;
        if (idx === -1) {
          const novo = { id: `lemb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, chave, tipo, nota, status, cor, correto, finalizadoEm, criadoEm: agora, criadoPorUsuario: sess.usuario, criadoPorNome: sess.nome, atualizadoEm: agora };
          lembretes.push(novo);
        } else {
          lembretes[idx] = { ...lembretes[idx], nota, status, cor, correto, finalizadoEm, atualizadoEm: agora };
        }
        await cadastroLembretesSalvar({ lembretes });
        return { ok: true, lembrete: lembretes.find((l) => l.chave === chave && l.tipo === tipo) };
      });
      if (resultado.erro) return sendJson(res, resultado.erro, { error: resultado.msg });
      return sendJson(res, 200, resultado);
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao salvar o lembrete")); }
  }

  if (pathname === "/api/cadastro-lembretes" && method === "GET") {
    const sess = await exigir(req, res, ["admin", "operador"], "cadastro"); if (!sess) return;
    try {
      const dados = await cadastroLembretesCarregar();
      return sendJson(res, 200, { lembretes: dados.lembretes });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao listar lembretes")); }
  }

  // Achados do Cadastro SB8 — persistem até a pessoa apagar. Cada vez que o
  // arquivo é recarregado, o navegador manda só os achados (compactos, sem o
  // arquivo inteiro); aqui a gente funde com o que já tinha, atualizando o
  // histórico de saldo quando o valor mudou desde a última vez.
  if (pathname === "/api/cadastro-achados" && method === "POST") {
    const sess = await exigir(req, res, ["admin", "operador"], "cadastro"); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const acao = body && body.acao;
    if (!["sincronizar", "apagarTudo", "apagarUm"].includes(acao)) return sendJson(res, 400, { error: "ação inválida (use sincronizar, apagarUm ou apagarTudo)" });

    if (acao === "apagarTudo") {
      try { await comFila("cadastro-achados", async () => { await cadastroAchadosSalvar({ achados: [] }); }); return sendJson(res, 200, { ok: true }); }
      catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao apagar os achados")); }
    }

    if (acao === "apagarUm") {
      const chave = String(body.chave || "").trim(), tipo = String(body.tipo || "").trim();
      if (!chave || !tipo) return sendJson(res, 400, { error: "informe chave e tipo" });
      try {
        await comFila("cadastro-achados", async () => {
          const dados = await cadastroAchadosCarregar();
          await cadastroAchadosSalvar({ achados: dados.achados.filter((a) => !(a.chave === chave && a.tipo === tipo)) });
        });
        return sendJson(res, 200, { ok: true });
      } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao apagar o achado")); }
    }

    // sincronizar: recebe uma LISTA compacta de achados vistos agora (cada um
    // com {chave, tipo, dados, saldoPorProduto}) e funde com o que já existe.
    const entrada = Array.isArray(body.achados) ? body.achados : [];
    if (!entrada.length) return sendJson(res, 400, { error: "informe ao menos um achado pra sincronizar" });
    if (entrada.length > 5000) return sendJson(res, 400, { error: "muitos achados de uma vez (máximo 5000 por sincronização)" });
    try {
      const resultado = await comFila("cadastro-achados", async () => {
        const atual = await cadastroAchadosCarregar();
        const porChaveTipo = new Map(atual.achados.map((a) => [`${a.chave}|${a.tipo}`, a]));
        const agora = new Date().toISOString();
        for (const nova of entrada) {
          const chave = String(nova.chave || "").trim(), tipo = String(nova.tipo || "").trim();
          if (!chave || !tipo) continue;
          const k = `${chave}|${tipo}`;
          const existente = porChaveTipo.get(k);
          const saldoPorProduto = nova.saldoPorProduto && typeof nova.saldoPorProduto === "object" ? nova.saldoPorProduto : {};
          let historicoSaldo = (existente && existente.historicoSaldo) || [];
          const ultimoSnapshot = historicoSaldo[historicoSaldo.length - 1];
          const mudou = !ultimoSnapshot || JSON.stringify(ultimoSnapshot.porProduto) !== JSON.stringify(saldoPorProduto);
          if (mudou) {
            historicoSaldo = [...historicoSaldo, { data: agora, porProduto: saldoPorProduto }].slice(-HISTORICO_SALDO_MAX);
          }
          porChaveTipo.set(k, {
            chave, tipo, dados: nova.dados || (existente && existente.dados) || {},
            historicoSaldo,
            primeiraVezEm: (existente && existente.primeiraVezEm) || agora,
            ultimaVezEm: agora,
          });
        }
        const achados = Array.from(porChaveTipo.values());
        await cadastroAchadosSalvar({ achados });
        return { ok: true, total: achados.length };
      });
      return sendJson(res, 200, resultado);
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao sincronizar achados")); }
  }

  if (pathname === "/api/cadastro-achados" && method === "GET") {
    const sess = await exigir(req, res, ["admin", "operador"], "cadastro"); if (!sess) return;
    try {
      const dados = await cadastroAchadosCarregar();
      return sendJson(res, 200, { achados: dados.achados });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao listar achados")); }
  }

  // info de um pedido direto do índice do SC9 (cliente, itens/lotes/quantidade)
  // — usado na tela de alteração na separação, ANTES do pedido ser bipado
  // (por isso não dá pra usar a busca da Saída, que só olha bipe já feito).
  if (pathname === "/api/pedido-info" && method === "GET") {
    const sess = await exigir(req, res, ["admin", "operador"]); if (!sess) return;
    const ped = normalizarPedido(new URL(req.url, "http://localhost").searchParams.get("pedido"));
    if (!ped) return sendJson(res, 400, { error: "informe o número do pedido" });
    try {
      const indice = await indiceCarregar().catch(() => null);
      const info = infoDoPedido(indice, ped);
      // aqui SIM inclui os itens — essa rota é consultada sob demanda, um
      // pedido de cada vez, nunca guardada em massa (diferente do resumo que
      // vai dentro de cada bipe, que fica salvo pra sempre no arquivo do dia).
      return sendJson(res, 200, { pedido: ped, info: info ? { ...resumoInfo(info), itens: info.itens || [] } : null });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao buscar o pedido")); }
  }

  // ---- Movimentação (SD3) compacta para a análise automática da Alteração ----
  // A movimentação bruta continua fora do servidor (pode ter 100 mil+ linhas). Aqui fica só o
  // necessário pra análise por lote: apenas as linhas COM lote, em formato compacto (sem custos,
  // sem descrição). O admin envia ao subir a planilha; o revisor (perfil "alteracoes") baixa
  // ao abrir a tela — com ETag, então só baixa de novo quando o admin subir outra.
  if (pathname === "/api/movimentacao-analise" && method === "POST") {
    if (!(await exigir(req, res, ["admin"]))) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (!body || !Array.isArray(body.rows) || !Array.isArray(body.usuarios) || !Array.isArray(body.cfs)) return sendJson(res, 400, { error: "payload inválido — esperado { rows, usuarios, cfs }" });
    if (body.rows.length > 600000) return sendJson(res, 400, { error: "movimentação grande demais" });
    const rowsOk = body.rows.every((r) => Array.isArray(r) && r.length >= 11 && Number.isFinite(Number(r[0])));
    if (!rowsOk) return sendJson(res, 400, { error: "linhas inválidas na movimentação" });
    try {
      const sess = await getSession(req);
      const obj = { v: 1, savedAt: new Date().toISOString(), por: (sess && sess.usuario) || "admin", total: body.rows.length, totalOriginal: Number(body.totalOriginal) || body.rows.length, usuarios: body.usuarios.map(String), cfs: body.cfs.map(String), rows: body.rows };
      await objSave(MOV_ANALISE_OBJ, obj);
      movAnaliseCache = null;
      return sendJson(res, 200, { ok: true, savedAt: obj.savedAt, total: obj.total });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao salvar a movimentação")); }
  }
  if (pathname === "/api/movimentacao-analise" && method === "GET") {
    const sess = await exigir(req, res, ["admin", "operador"]); if (!sess) return;
    if (sess.role !== "admin" && !(sess.perfis || []).includes("alteracoes")) return sendJson(res, 403, { error: "seu acesso não permite isso" });
    try {
      if (!movAnaliseCache) {
        const d = await objLoad(MOV_ANALISE_OBJ);
        if (!d) return sendJson(res, 404, { error: "nenhuma movimentação salva ainda" });
        const json = Buffer.from(JSON.stringify(d), "utf8");
        movAnaliseCache = { savedAt: d.savedAt, total: d.total, por: d.por, json, gz: await gzipAsync(json, { level: 6 }) };
      }
      const c = movAnaliseCache; const etag = `"${c.savedAt}"`;
      const meta = new URL(req.url, "http://localhost").searchParams.get("meta");
      if (meta) return sendJson(res, 200, { savedAt: c.savedAt, total: c.total, por: c.por });
      const base = { "Content-Type": "application/json; charset=utf-8", "Vary": "Accept-Encoding", "ETag": etag, "Cache-Control": "private, no-cache" };
      if (String(req.headers["if-none-match"] || "") === etag) { res.writeHead(304, base); return res.end(); }
      if (aceitaGzip(req)) { res.writeHead(200, { ...base, "Content-Encoding": "gzip", "Content-Length": c.gz.length }); return res.end(c.gz); }
      res.writeHead(200, { ...base, "Content-Length": c.json.length }); return res.end(c.json);
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao carregar a movimentação")); }
  }

  if (pathname === "/api/alteracao-separacao" && method === "GET") {
    const sess = await exigir(req, res, ["admin", "operador"]); if (!sess) return;
    const podeVerTudo = sess.role === "admin" || (sess.perfis || []).includes("alteracoes");
    try {
      const dados = await alteracaoSeparacaoCarregar();
      // quem não é da equipe de alteração só vê o que ELA MESMA marcou (pra
      // acompanhar o próprio pedido), nunca a fila inteira de todo mundo.
      const registros = podeVerTudo ? dados.registros : dados.registros.filter((r) => r.marcadoPorUsuario === sess.usuario);
      return sendJson(res, 200, { registros, motivos: MOTIVOS_ALTERACAO });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao listar alterações de separação")); }
  }

  // ---- Recebimento na expedição (perfil "recebimento"; planilha de Entrega só com o perfil "despacho") ----
  if (pathname === "/api/recebimento" && method === "GET") {
    const sess = await exigirRecebimento(req, res, { leitura: true }); if (!sess) return;
    const q = new URL(req.url, "http://localhost").searchParams;
    const hoje = diaSP();
    const dia = q.get("dia") || hoje;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return sendJson(res, 400, { error: "dia inválido" });
    if (sess.role !== "admin" && dia !== hoje && dia !== diaAnterior(hoje, 1)) return sendJson(res, 403, { error: "seu acesso só mostra hoje e ontem" });
    try {
      res.setHeader("Cache-Control", "no-store");
      const d = await recebCarregar(dia);
      const { mapa, versoes } = await saidaMapaRecente(hoje, RECEB_DIAS_DUP);
      const log = await recebEntregasCarregar();
      const ultima = log.uploads.length ? log.uploads[log.uploads.length - 1] : null;
      const cfg = await recebConfigCarregar();
      const ver = [dia, d.versao || 0, ...versoes, log.uploads.length, ultima ? ultima.em : "", cfg.alertaHoras].join("|");
      if (q.get("v") !== null && q.get("v") === ver) return sendJson(res, 200, { igual: true, versao: ver, hoje });
      const entries = d.entries.map((e) => ({ ...e, desceu: descerResumo(mapa.get(e.pedido)) }));
      // "desceu" (Saída) nos últimos 2 dias que ainda NÃO foi recebido (em nenhum dos últimos dias)
      let faltando = [];
      if (dia === hoje) {
        const recebidos = new Set();
        for (const dd of recebDiasJanela(hoje, RECEB_DIAS_DUP)) for (const e of (await recebCarregar(dd)).entries) recebidos.add(e.pedido);
        for (const [ped, a] of mapa) {
          if (a.dia !== hoje && a.dia !== diaAnterior(hoje, 1)) continue;
          if (recebidos.has(ped)) continue;
          faltando.push({ pedido: ped, saidaEm: a.entry.registradoEm, saidaPor: a.entry.registradoPorNome || a.entry.registradoPorUsuario, saidaDia: a.dia, info: a.entry.info || null, emAlteracao: Boolean(a.entry.alteracao && a.entry.alteracao.status === "pendente") });
        }
        faltando.sort((x, y) => String(x.saidaEm).localeCompare(String(y.saidaEm)));
      }
      const perfis = sess.perfis || [];
      return sendJson(res, 200, {
        dia, hoje, versao: ver, entries, faltando, motivos: RECEB_MOTIVOS,
        podeReceber: sess.role === "admin" || perfis.includes("recebimento"), podeDespacho: sess.role === "admin" || perfis.includes("despacho"),
        ultimaEntrega: ultima, usuario: sess.usuario, alertaHoras: cfg.alertaHoras,
      });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao carregar o recebimento")); }
  }

  // Pesquisa em todos os dias guardados: "quando esse pedido foi bipado, por quem, de qual cliente/transportadora, já saiu?"
  // Aceita pedido (parte do número), NF, cliente, transportadora ou quem bipou — várias palavras juntas (todas precisam bater).
  if (pathname === "/api/recebimento/pesquisar" && method === "GET") {
    const sess = await exigirRecebimento(req, res, { leitura: true }); if (!sess) return;
    const q = new URL(req.url, "http://localhost").searchParams;
    const hoje = diaSP();
    const diaValido = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? v : null);
    const maisAntigo = diaAnterior(hoje, RECEB_PESQ_DIAS - 1);
    let ate = diaValido(q.get("ate")) || hoje, de = diaValido(q.get("de")) || maisAntigo;
    if (ate > hoje) ate = hoje;
    if (de < maisAntigo) de = maisAntigo;
    if (de > ate) return sendJson(res, 400, { error: "a data inicial é depois da final" });
    const textoQ = String(q.get("q") || "").slice(0, 120);
    const palavras = recebPalavras(textoQ);
    if (textoQ.trim() && !palavras.length) return sendJson(res, 400, { error: "Digite pelo menos 3 números ou uma palavra." });
    const transp = semAcento(q.get("transp") || "").trim();
    const status = ["sem_saida", "nao_sai", "sem_confirmar", "saiu"].includes(q.get("status")) ? q.get("status") : "";
    try {
      res.setHeader("Cache-Control", "no-store");
      const dias = []; for (let d = ate; d >= de; d = diaAnterior(d, 1)) dias.push(d);
      // Saída desde 1 dia antes do período (o pedido pode ter descido na véspera do recebimento)
      const mapa = new Map();
      for (const d of [...dias, diaAnterior(de, 1)]) for (const e of (await saidaCarregar(d)).entries) if (!mapa.has(e.pedido)) mapa.set(e.pedido, { entry: e, dia: d });
      const casa = (txt) => palavras.every((p) => txt.includes(p));
      const resultados = []; const recebidos = new Set(); let total = 0;
      for (const d of dias) {
        const lista = (await recebCarregar(d)).entries;
        for (const e of lista) { // já vem da mais nova para a mais antiga
          recebidos.add(e.pedido);
          const info = e.info || {};
          if (transp && !semAcento(info.transportadora || "").includes(transp)) continue;
          if (!casa(recebPalheiro(e.pedido, info, `${e.recebidoPorNome || ""} ${e.recebidoPorUsuario || ""}`))) continue;
          const desceu = descerResumo(mapa.get(e.pedido));
          const sit = e.saiuEntrega ? "saiu" : e.naoSaiHoje ? "nao_sai" : "sem_confirmar";
          if (status === "sem_saida" ? desceu.status === "ok" : (status && sit !== status)) continue;
          total++;
          if (resultados.length < RECEB_PESQ_MAX) resultados.push({ dia: d, entry: { ...e, desceu } });
        }
      }
      // pedidos que desceram (Saída) no período e ainda não foram recebidos; e, se pesquisou algo, pedidos só do SC9
      const naoRecebidos = [];
      if (!status && (palavras.length || transp)) {
        for (const [ped, a] of mapa) {
          if (a.dia < de || a.dia > ate || recebidos.has(ped)) continue;
          const info = a.entry.info || {};
          if (transp && !semAcento(info.transportadora || "").includes(transp)) continue;
          if (!casa(recebPalheiro(ped, info, `${a.entry.registradoPorNome || ""} ${a.entry.registradoPorUsuario || ""}`))) continue;
          naoRecebidos.push({ tipo: "desceu_nao_recebido", pedido: ped, info: a.entry.info || null, saidaEm: a.entry.registradoEm, saidaPor: a.entry.registradoPorNome || a.entry.registradoPorUsuario, saidaDia: a.dia, emAlteracao: Boolean(a.entry.alteracao && a.entry.alteracao.status === "pendente") });
        }
        naoRecebidos.sort((x, y) => String(y.saidaEm).localeCompare(String(x.saidaEm)));
        naoRecebidos.length = Math.min(naoRecebidos.length, RECEB_PESQ_MAX_SC9);
        if (palavras.length && naoRecebidos.length < RECEB_PESQ_MAX_SC9) {
          try {
            const indice = await indiceCarregar();
            for (const [ped, r] of Object.entries((indice && indice.pedidos) || {})) {
              if (recebidos.has(ped) || mapa.has(ped)) continue;
              if (transp && !semAcento(r.tr || "").includes(transp)) continue;
              if (!casa(recebPalheiro(ped, { nf: r.nf, cliente: r.c, transportadora: r.tr, codCliente: r.cc }, ""))) continue;
              naoRecebidos.push({ tipo: "so_sc9", pedido: ped, info: { armazem: r.a, cliente: r.c, transportadora: r.tr, nf: r.nf, pecas: r.q, linhas: r.l, liberadoEm: r.dt, fimConferencia: r.fc } });
              if (naoRecebidos.length >= RECEB_PESQ_MAX_SC9 * 2) break;
            }
          } catch { /* sem o índice do SC9, mostra só o que a Saída e o recebimento têm */ }
        }
      }
      return sendJson(res, 200, { q: textoQ, de, ate, diasPesquisados: dias.length, total, resultados, truncado: total > resultados.length, naoRecebidos, retencaoDias: RECEB_PESQ_DIAS });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao pesquisar")); }
  }

  if (pathname === "/api/recebimento/bipar" && method === "POST") {
    const sess = await exigirRecebimento(req, res); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const ped = normalizarPedido(body && body.pedido);
    if (!ped) return sendJson(res, 400, { error: "Código inválido: leia só o número do pedido." });
    let indice = null;
    try { indice = await indiceCarregar(); } catch { /* sem índice: registra mesmo assim, sinalizado */ }
    const info = infoDoPedido(indice, ped);
    const hoje = diaSP();
    try {
      const r = await comFila("recebimento", async () => {
        for (const dia of recebDiasJanela(hoje, RECEB_DIAS_DUP)) {
          const ex = (await recebCarregar(dia)).entries.find((e) => e.pedido === ped);
          if (ex) return { duplicado: ex };
        }
        const { mapa } = await saidaMapaRecente(hoje, RECEB_DIAS_DUP);
        const desceu = descerResumo(mapa.get(ped));
        const atual = await recebCarregar(hoje);
        const novo = { ...atual, entries: [...atual.entries], removidos: atual.removidos };
        const entry = {
          id: `rx_${ped}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`, pedido: ped,
          recebidoPorUsuario: sess.usuario, recebidoPorNome: sess.nome, recebidoEm: new Date().toISOString(),
          semDadoSC9: !info, info: resumoInfo(info), desceuNaHora: desceu.status,
          volumes: null, naoSaiHoje: null, saiuEntrega: null,
        };
        novo.entries.unshift(entry);
        await recebGravar(hoje, novo);
        return { entry: { ...entry, desceu }, total: novo.entries.length, desceu };
      });
      if (r.duplicado) return sendJson(res, 409, { error: "duplicado", duplicado: r.duplicado, info });
      return sendJson(res, 200, { ok: true, entry: r.entry, desceu: r.desceu, info, totalHoje: r.total });
    } catch (e) {
      console.error("Erro ao receber na expedição:", e);
      return sendJson(res, 500, erroPublico(e, "erro ao registrar o recebimento"));
    }
  }

  // volumes e/ou motivo de "não sai hoje" de um pedido já recebido
  // depois de quantas horas "desceu e não chegou" vira alerta (0 = desligado). Só despacho/administrador mexe; vale para todo mundo.
  if (pathname === "/api/recebimento/config" && method === "POST") {
    const sess = await exigirRecebimento(req, res, { despacho: true }); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const bruto = body ? body.alertaHoras : null;
    const h = (typeof bruto === "number" || (typeof bruto === "string" && bruto.trim() !== "")) ? Number(bruto) : NaN;
    if (!Number.isFinite(h) || h < 0 || h > 72) return sendJson(res, 400, { error: "Informe as horas entre 0 (desligado) e 72." });
    try {
      const nova = await comFila("recebimento-config", async () => {
        const c = { alertaHoras: Math.round(h * 4) / 4, por: sess.nome || sess.usuario, em: new Date().toISOString() };
        await objSave(RECEB_CONFIG_OBJ, c); recebConfig = c; return c;
      });
      return sendJson(res, 200, { ok: true, ...nova });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao salvar o alerta")); }
  }

  if (pathname === "/api/recebimento/atualizar" && method === "POST") {
    const sess = await exigirRecebimento(req, res); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = body && typeof body.id === "string" ? body.id : "";
    if (!id) return sendJson(res, 400, { error: "informe o id do registro" });
    const temVol = body && Object.prototype.hasOwnProperty.call(body, "volumes");
    const temMot = body && Object.prototype.hasOwnProperty.call(body, "naoSaiHoje");
    if (!temVol && !temMot) return sendJson(res, 400, { error: "nada pra atualizar" });
    let volumes = null;
    if (temVol && body.volumes !== null && body.volumes !== "") {
      volumes = Number(body.volumes);
      if (!Number.isInteger(volumes) || volumes < 1 || volumes > 999) return sendJson(res, 400, { error: "Volumes: digite um número inteiro de 1 a 999." });
    }
    let mot = null;
    if (temMot && body.naoSaiHoje) {
      const m = String(body.naoSaiHoje.motivo || "").trim().slice(0, 80);
      const obs = String(body.naoSaiHoje.obs || "").trim().slice(0, 200);
      if (!m) return sendJson(res, 400, { error: "Escolha o motivo." });
      if (m === "Outro" && !obs) return sendJson(res, 400, { error: "Em \"Outro\", escreva qual é o motivo." });
      mot = { motivo: m, obs };
    }
    const hoje = diaSP();
    try {
      const r = await comFila("recebimento", async () => {
        const dias = sess.role === "admin" ? recebDiasJanela(hoje, 30) : [hoje, diaAnterior(hoje, 1)];
        for (const dia of dias) {
          const atual = await recebCarregar(dia);
          const e = atual.entries.find((x) => x.id === id);
          if (!e) continue;
          if (e.saiuEntrega && temMot && mot) return { erro: 409, msg: "Esse pedido já saiu para entrega — não dá mais pra marcar que não sai hoje." };
          const agora = new Date().toISOString();
          const novo = { ...atual, entries: atual.entries.map((x) => {
            if (x.id !== id) return x;
            const y = { ...x };
            if (temVol) y.volumes = volumes === null ? null : volumes;
            if (temMot) y.naoSaiHoje = mot ? { ...mot, por: sess.usuario, nome: sess.nome, em: agora } : null;
            y.atualizadoPorUsuario = sess.usuario; y.atualizadoEm = agora;
            return y;
          }) };
          await recebGravar(dia, novo);
          return { ok: true, entry: novo.entries.find((x) => x.id === id) };
        }
        return { erro: 404, msg: "Registro não encontrado." };
      });
      if (r.erro) return sendJson(res, r.erro, { error: r.msg });
      return sendJson(res, 200, r);
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao atualizar o recebimento")); }
  }

  if (pathname === "/api/recebimento/desfazer" && method === "POST") {
    const sess = await exigirRecebimento(req, res); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = body && typeof body.id === "string" ? body.id : "";
    const hoje = diaSP();
    try {
      const r = await comFila("recebimento", async () => {
        const dias = sess.role === "admin" ? recebDiasJanela(hoje, 30) : [hoje, diaAnterior(hoje, 1)];
        for (const dia of dias) {
          const atual = await recebCarregar(dia);
          const e = atual.entries.find((x) => x.id === id);
          if (!e) continue;
          if (sess.role !== "admin") {
            if (e.recebidoPorUsuario !== sess.usuario) return { erro: 403, msg: "Só quem bipou consegue desfazer o próprio bipe." };
            if (Date.now() - new Date(e.recebidoEm).getTime() > DESFAZER_MS) return { erro: 403, msg: "O prazo pra desfazer acabou. Fale com o administrador." };
          }
          if (e.saiuEntrega) return { erro: 409, msg: "Esse pedido já foi confirmado como saído para entrega." };
          const novo = { ...atual, entries: atual.entries.filter((x) => x.id !== id), removidos: [...atual.removidos, { id: e.id, pedido: e.pedido, removidoPorUsuario: sess.usuario, removidoPorNome: sess.nome, removidoEm: new Date().toISOString(), recebidoPorUsuario: e.recebidoPorUsuario, recebidoEm: e.recebidoEm }] };
          await recebGravar(dia, novo);
          return { ok: true };
        }
        return { erro: 404, msg: "Registro não encontrado (talvez já tenha sido desfeito)." };
      });
      if (r.erro) return sendJson(res, r.erro, { error: r.msg });
      return sendJson(res, 200, r);
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao desfazer")); }
  }

  // A planilha de Entrega (aba do SC9) CONFIRMA que o que foi recebido saiu para entrega.
  // Só o usuário com o perfil "despacho" (ou o administrador).
  if (pathname === "/api/recebimento/entrega" && method === "POST") {
    const sess = await exigirRecebimento(req, res, { despacho: true }); if (!sess) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const linhas = body && Array.isArray(body.linhas) ? body.linhas : null;
    if (!linhas || !linhas.length) return sendJson(res, 400, { error: "A planilha de Entrega veio vazia ou sem a coluna de pedidos." });
    if (linhas.length > 100000) return sendJson(res, 400, { error: "Planilha grande demais." });
    const doArquivo = new Map();
    for (const l of linhas) {
      if (!Array.isArray(l)) continue;
      const ped = normalizarPedido(l[0]); if (!ped) continue;
      const data = typeof l[1] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l[1]) ? l[1] : null;
      const transp = l[2] ? String(l[2]).trim().slice(0, 60) : null;
      const ant = doArquivo.get(ped);
      if (!ant || (data && (!ant.data || data > ant.data))) doArquivo.set(ped, { data, transp });
    }
    if (!doArquivo.size) return sendJson(res, 400, { error: "Não achei nenhum número de pedido válido na planilha." });
    const nomeArq = String((body && body.nome) || "").slice(0, 120);
    const hoje = diaSP();
    try {
      const r = await comFila("recebimento", async () => {
        const agora = new Date().toISOString();
        let confirmados = 0, jaConfirmados = 0, anteriores = 0; const naoSairam = [];
        for (const dia of recebDiasJanela(hoje, RECEB_DIAS_ENTREGA)) {
          const atual = await recebCarregar(dia);
          let mudou = false;
          const novos = atual.entries.map((e) => {
            const f = doArquivo.get(e.pedido);
            if (e.saiuEntrega) { if (f) jaConfirmados++; return e; }
            if (!f) { if (dia >= diaAnterior(hoje, RECEB_DIAS_DUP - 1)) naoSairam.push({ pedido: e.pedido, dia, cliente: e.info && e.info.cliente, transportadora: e.info && e.info.transportadora, motivo: e.naoSaiHoje ? e.naoSaiHoje.motivo : null }); return e; }
            if (f.data && f.data < dia) { // consta com saída ANTES de ter sido recebido: não confirma, só avisa
              anteriores++;
              naoSairam.push({ pedido: e.pedido, dia, cliente: e.info && e.info.cliente, transportadora: e.info && e.info.transportadora, motivo: e.naoSaiHoje ? e.naoSaiHoje.motivo : null, aviso: `consta na Entrega com data ${f.data}, antes de ser recebido (${dia})` });
              return e;
            }
            confirmados++; mudou = true;
            return { ...e, saiuEntrega: { em: agora, por: sess.usuario, nome: sess.nome, dataEntrega: f.data, transportadora: f.transp, arquivo: nomeArq } };
          });
          if (mudou) await recebGravar(dia, { ...atual, entries: novos });
        }
        const log = await recebEntregasCarregar();
        const registro = { em: agora, por: sess.usuario, nome: sess.nome, arquivo: nomeArq, pedidosNoArquivo: doArquivo.size, confirmados, jaConfirmados, anteriores };
        const novoLog = { uploads: [...log.uploads, registro].slice(-30) };
        await objSave(RECEB_ENTREGAS_OBJ, novoLog);
        recebEntregas = novoLog;
        return { ok: true, ...registro, naoSairam: naoSairam.slice(0, 500), totalNaoSairam: naoSairam.length };
      });
      return sendJson(res, 200, r);
    } catch (e) {
      console.error("Erro ao confirmar a Entrega:", e);
      return sendJson(res, 500, erroPublico(e, "erro ao confirmar a saída com a planilha de Entrega"));
    }
  }

  // buscar um pedido em todos os dias guardados: "esse pedido já saiu? quem bipou e quando?"
  if (pathname === "/api/saida/buscar" && method === "GET") {
    const sess = await exigir(req, res, ["admin", "operador"], "saida"); if (!sess) return;
    const ped = normalizarPedido(new URL(req.url, "http://localhost").searchParams.get("pedido"));
    if (!ped) return sendJson(res, 400, { error: "Digite só o número do pedido." });
    try {
      const dias = await diasRecentesPrimeiro(diaSP());
      const resultados = [];
      for (const dia of dias) {
        const d = await saidaCarregar(dia);
        for (const e of d.entries) if (e.pedido === ped) resultados.push({ dia, entry: e });
      }
      return sendJson(res, 200, { pedido: ped, resultados, diasPesquisados: dias.length, retencaoDias: SAIDA_RETENCAO_DIAS });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao buscar")); }
  }

  // exportar vários dias (só administrador). Com marcar=1 o servidor anota que esses dias foram exportados.
  if (pathname === "/api/saida/periodo" && method === "GET") {
    const sess = await exigir(req, res, ["admin"]); if (!sess) return;
    const q = new URL(req.url, "http://localhost").searchParams;
    try { return sendJson(res, 200, { dias: await saidaExportar(q.get("de") || "0000-00-00", q.get("ate") || "9999-99-99", q.get("marcar") === "1", sess) }); }
    catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao exportar")); }
  }

  // apagar dias JÁ EXPORTADOS (só administrador)
  if (pathname === "/api/saida/apagar" && method === "POST") {
    if (!(await exigir(req, res, ["admin"]))) return;
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const dias = Array.isArray(body && body.dias) ? [...new Set(body.dias.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))))] : [];
    if (!dias.length) return sendJson(res, 400, { error: "Nenhum dia informado." });
    try {
      const r = await saidaApagar(dias);
      if (r.pendentes) {
        const msg = r.pendentes.some((p) => p.motivo === "hoje") ? "Não dá pra apagar o dia de hoje."
          : r.pendentes.some((p) => p.motivo === "mudou_depois") ? "Esse dia mudou depois de exportado: exporte de novo antes de apagar."
          : "Exporte antes de apagar: o servidor só apaga o que já foi exportado.";
        return sendJson(res, r.pendentes.some((p) => p.motivo === "hoje") ? 400 : 409, { error: msg, pendentes: r.pendentes });
      }
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao apagar")); }
  }

  // Dashboard ao vivo: quem tem QUALQUER acesso vê (é o "geral" — sem separador/conferente)
  if (pathname === "/api/dashboard" && method === "GET") {
    if (!(await exigir(req, res, ["admin", "operador"]))) return;
    try {
      const d = await dashboardAoVivo();
      const base = d || { totalPedidos: 0, emProcesso: 0, liberadosHoje: 0, pendenciasAntigas: 0, concluidosHoje: 0, valorFaturadoHoje: null, valorFaturadoTotal: null, armazem: "Cambuci", topItens: [], porEtapa: {}, etapaOrdem: ETAPA_ORDEM, etapaLabel: ETAPA_LABEL, porTransp: [], porHora: {}, porHoraPecas: {}, porHoraLiberados: {}, porHoraExpedidos: {}, porTurno: {}, rankingEtapas: [], sla: null, historico: {}, tendenciaDiaria: [], ontem: null, savedAt: null };
      // meta mensal de faturamento — geral, somando todos os armazéns (não é
      // por armazém). Só vale pro mês corrente; se o mês virou, a meta antiga
      // não se aplica mais (fica null até alguém definir a do mês novo).
      const [meta, geral] = await Promise.all([metaFaturamentoCarregar(), valorGeralCarregar()]);
      // "mesReferencia" é o mês predominante nos dados REAIS do último SC9
      // salvo (calculado no /api/save) — não necessariamente o mês do
      // calendário de hoje. Isso evita o painel ficar vazio logo no início de
      // um mês novo, antes do primeiro SC9 daquele mês ser subido: continua
      // mostrando o último mês com dado de verdade, com a data deixada clara.
      const mesReferencia = geral ? geral.mes : null;
      const metaValida = meta && mesReferencia && meta.mes === mesReferencia ? meta.valor : null;
      const valorMesGeral = geral ? geral.valorMes : null;
      base.mesReferenciaFaturamento = mesReferencia;
      base.metaFaturamentoMensal = metaValida;
      base.valorFaturadoMesGeral = valorMesGeral;
      base.faltaFaturar = (metaValida !== null && valorMesGeral !== null) ? Math.max(0, metaValida - valorMesGeral) : null;
      base.pctMeta = (metaValida !== null && metaValida > 0 && valorMesGeral !== null) ? Math.min(100, Math.round((valorMesGeral / metaValida) * 100)) : null;
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, base);
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao carregar o dashboard")); }
  }

  if (pathname === "/api/meta-faturamento" && method === "POST") {
    const sess = await exigir(req, res, ["admin"]);
    if (!sess) return;
    try {
      const body = await readJsonBody(req);
      const valor = Number(body.valor);
      if (!body || isNaN(valor) || valor < 0) return sendJson(res, 400, { error: "informe um valor de meta válido (número, maior ou igual a zero)" });
      // a meta vale pro mesmo mês de referência que os dados reais mostram —
      // não "hoje" fixo, pelo mesmo motivo do cálculo do valor (ver /api/save).
      const geralAtual = await valorGeralCarregar();
      const registro = await metaFaturamentoSalvar(valor, sess.usuario || "admin", geralAtual ? geralAtual.mes : mesSP());
      dashboardCache = null; // já reflete a meta nova na próxima consulta
      return sendJson(res, 200, { ok: true, meta: registro });
    } catch (e) { return sendJson(res, 500, erroPublico(e, "erro ao salvar a meta")); }
  }

  return sendJson(res, 404, { error: "rota não encontrada" });
}

// Rede de segurança: sem isso, QUALQUER exceção não tratada em qualquer lugar
// (um bug meu, uma resposta inesperada do Supabase, o que for) derruba o
// processo Node inteiro — tirando o site do ar pra TODO MUNDO até o Render
// reiniciar sozinho. É exatamente o "fica caindo, tem que apertar F5" quando
// várias pessoas usam ao mesmo tempo (mais chance de bater numa borda rara).
// Agora: loga o erro e o servidor continua de pé pras outras pessoas.
process.on("uncaughtException", (err) => {
  console.error("ERRO NÃO TRATADO (o servidor continua no ar):", err);
});
process.on("unhandledRejection", (err) => {
  console.error("PROMISE REJEITADA SEM CATCH (o servidor continua no ar):", err);
});

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    res.writeHead(400); res.end("URL inválida"); return;
  }
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

// na subida: já carrega os dias guardados na memória (NADA é apagado sozinho — quem apaga é o administrador, depois de exportar)
saidaDiasCarregar().then(async (l) => { for (const d of l) await saidaCarregar(d); }).catch(() => {});

module.exports = server;
