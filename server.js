// Servidor sem dependências externas (só Node puro) — mais rápido de instalar
// no Render e mais fácil de eu testar aqui antes de te entregar.
const http = require("http");
const zlib = require("zlib");
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
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn("AVISO DE SEGURANÇA: SESSION_SECRET não configurada — usando uma chave gerada agora, que muda a cada reinício " +
    "(derruba sessões abertas). Configure SESSION_SECRET no Render (Environment) com um valor aleatório fixo pra evitar isso " +
    "e pra não depender de nada derivado da senha do administrador.");
}
const TTL_ADMIN_S = 60 * 60 * 24 * 30;
const TTL_OPERADOR_S = 60 * 60 * 24 * 7;
// perfis = quais telas o operador pode usar. Acessos criados antes disso só tinham o controle 02->01.
const PERFIS = ["geral", "controle0201", "saida"];
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
const DASHBOARD_OBJ = "dashboard-live.json";      // cache leve, recalculado sob demanda — não é mais a fonte de verdade
const DASHBOARD_ORDERS_OBJ = "dashboard-orders.json"; // só os pedidos do Cambuci (fonte de verdade pro dashboard)
const DASHBOARD_HIST_OBJ = "dashboard-historico.json"; // {dias: {"AAAA-MM-DD": {pedidosHoje, pecasHoje, atualizacoes}}}
const META_FATURAMENTO_OBJ = "meta-faturamento.json"; // {valor, mes: "AAAA-MM", atualizadoEm, atualizadoPor}
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
  const itensPorPed = new Map(), fimConf = new Map();
  for (const it of p.items || []) {
    const k = String(it.pedido);
    if (!itensPorPed.has(k)) itensPorPed.set(k, new Map());
    const m = itensPorPed.get(k);
    m.set(String(it.produto), (m.get(String(it.produto)) || 0) + Math.max(0, Number(it.qt) || 0));
    if (it.confEnd && (!fimConf.has(k) || it.confEnd > fimConf.get(k))) fimConf.set(k, it.confEnd);
  }
  const pedidos = {}, usados = new Set();
  const limpo = (v) => (v === null || v === undefined || String(v).trim() === "0" ? "" : String(v).trim());
  let semChaveValida = 0;
  for (const o of p.orders || []) {
    const k = normalizarPedido(o.pedido);
    if (!k) { semChaveValida++; continue; } // pedido sem número reconhecível (não deveria acontecer, mas não trava o índice)
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
    itens: (r.it || []).map(([prod, qt]) => ({ produto: prod, nome: (indice.nomes && indice.nomes[prod]) || "", qt })),
  };
}
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

const LOGIN_RE = /^[a-z0-9._-]{3,30}$/;
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
