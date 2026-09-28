// Servidor sem dependências externas (só Node puro) — mais rápido de instalar
// no Render e mais fácil de eu testar aqui antes de te entregar.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { saveSnapshot, loadSnapshot, saveControle, loadControle, usingSupabase } = require("./storage");

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || ""; // vazio = sem senha (não recomendado em produção)
const COOKIE_NAME = "sc9_auth";
const PUBLIC_DIR = __dirname; // tudo solto na raiz do projeto agora — sem pasta "public"
// só estes dois arquivos podem ser servidos por HTTP — evita expor server.js/storage.js
// (que não têm segredo nenhum dentro, mas não custa não servir código-fonte à toa)
const SERVABLE = new Set(["index.html", "bundle.js"]);
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

function isAuthed(req) {
  if (!APP_PASSWORD) return true;
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[COOKIE_NAME] && timingSafeEqualStr(cookies[COOKIE_NAME], APP_PASSWORD)) return true;
  const header = req.headers["x-app-password"];
  if (header && timingSafeEqualStr(header, APP_PASSWORD)) return true;
  return false;
}

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

async function handleApi(req, res, pathname) {
  if (pathname === "/api/debug-fs" && req.method === "GET") {
    let listing = [];
    try { listing = fs.readdirSync(PUBLIC_DIR); } catch (e) { listing = ["ERRO ao listar: " + e.message]; }
    return sendJson(res, 200, {
      __dirname,
      PUBLIC_DIR,
      arquivosEncontrados: listing,
      indexExiste: fs.existsSync(path.join(PUBLIC_DIR, "index.html")),
      bundleExiste: fs.existsSync(path.join(PUBLIC_DIR, "bundle.js")),
      cwd: process.cwd(),
    });
  }

  if (pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, storage: usingSupabase ? "supabase" : "local-file", time: new Date().toISOString() });
  }

  if (pathname === "/api/session" && req.method === "GET") {
    return sendJson(res, 200, { needsPassword: Boolean(APP_PASSWORD), authed: isAuthed(req) });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    if (!APP_PASSWORD) return sendJson(res, 200, { ok: true, note: "sem senha configurada" });
    const password = body && body.password;
    if (!password || !timingSafeEqualStr(password, APP_PASSWORD)) {
      return sendJson(res, 401, { ok: false, error: "senha incorreta" });
    }
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(APP_PASSWORD)}; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}; Path=/`);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/api/save" && req.method === "POST") {
    if (!isAuthed(req)) return sendJson(res, 401, { error: "não autenticado" });
    let payload;
    try { payload = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (!payload || !Array.isArray(payload.orders)) {
      return sendJson(res, 400, { error: "payload inválido — esperado { orders, items, itemNames, warehousesPresent, cutoff }" });
    }
    payload.savedAt = new Date().toISOString();
    try {
      const info = await saveSnapshot(payload);
      return sendJson(res, 200, { ok: true, ...info, orders: payload.orders.length });
    } catch (e) {
      console.error("Erro ao salvar snapshot:", e);
      return sendJson(res, 500, { error: e.message || "erro ao salvar" });
    }
  }

  // Controle 02->01: guardado À PARTE do snapshot do SC9. Atualizar o SC9
  // (/api/save) nunca toca nisso. O POST recebe só a diferença e junta com o
  // que já existe: { upserts: [...], removeIds: [...], reset: bool, seedIfEmpty: [...] }
  if (pathname === "/api/controle" && req.method === "GET") {
    if (!isAuthed(req)) return sendJson(res, 401, { error: "não autenticado" });
    try {
      const data = await loadControle();
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, { entries: (data && Array.isArray(data.entries)) ? data.entries : [], savedAt: data ? data.savedAt || null : null });
    } catch (e) {
      console.error("Erro ao carregar controle:", e);
      return sendJson(res, 500, { error: e.message || "erro ao carregar controle" });
    }
  }

  if (pathname === "/api/controle" && req.method === "POST") {
    if (!isAuthed(req)) return sendJson(res, 401, { error: "não autenticado" });
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    body = body || {};
    try {
      const entries = await comFilaControle(async () => {
        const atual = await loadControle();
        let lista = (atual && Array.isArray(atual.entries)) ? atual.entries : [];
        if (!lista.length && Array.isArray(body.seedIfEmpty)) lista = body.seedIfEmpty.filter((x) => x && typeof x.id === "string");
        if (body.reset === true) lista = [];
        if (Array.isArray(body.removeIds) && body.removeIds.length) {
          const rm = new Set(body.removeIds);
          lista = lista.filter((x) => !rm.has(x.id));
        }
        if (Array.isArray(body.upserts)) {
          const novos = [];
          for (const u of body.upserts) {
            if (!u || typeof u.id !== "string") continue;
            const i = lista.findIndex((x) => x.id === u.id);
            if (i >= 0) lista[i] = u; else novos.push(u);
          }
          lista = [...novos, ...lista]; // mais novo na frente
        }
        await saveControle({ entries: lista, savedAt: new Date().toISOString() });
        return lista;
      });
      return sendJson(res, 200, { ok: true, entries });
    } catch (e) {
      console.error("Erro ao salvar controle:", e);
      return sendJson(res, 500, { error: e.message || "erro ao salvar controle" });
    }
  }

  if (pathname === "/api/load" && req.method === "GET") {
    if (!isAuthed(req)) return sendJson(res, 401, { error: "não autenticado" });
    try {
      const data = await loadSnapshot();
      if (!data) return sendJson(res, 404, { error: "nenhum snapshot salvo ainda" });
      return sendJson(res, 200, data);
    } catch (e) {
      console.error("Erro ao carregar snapshot:", e);
      return sendJson(res, 500, { error: e.message || "erro ao carregar" });
    }
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
