// Guarda e recupera JSONs do painel:
//  - "latest.json"        -> último snapshot do SC9 (pedidos, itens, etc.)
//  - "controle-0201.json" -> registros do Controle 02->01 (SEPARADO do SC9,
//                            pra atualizar o SC9 todo dia nunca apagar isso)
// - Se SUPABASE_URL + SUPABASE_SERVICE_KEY estiverem configurados, usa o
//   Supabase Storage (persiste de verdade, sobrevive a reinícios do Render).
// - Caso contrário, cai para arquivo local (bom pra testar, mas o Render
//   free apaga o disco quando o serviço "dorme" e acorda de novo).
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "sc9-data";

const LOCAL_DIR = path.join(__dirname, "data");
const usingSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

function objectUrl(name) {
  return `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${name}`;
}

async function saveObject(name, dataObj) {
  const body = JSON.stringify(dataObj);
  if (usingSupabase) {
    const res = await fetch(objectUrl(name) + "?upsert=true", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
        "x-upsert": "true",
      },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Supabase Storage upload falhou (${res.status}): ${txt}`);
    }
    return { backend: "supabase" };
  }
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_DIR, name), body, "utf8");
  return { backend: "local-file" };
}

async function loadObject(name) {
  if (usingSupabase) {
    const res = await fetch(objectUrl(name), {
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
    });
    if (res.status === 404 || res.status === 400) {
      // Supabase devolve 400/404 quando o objeto ainda não existe
      const txt = await res.text().catch(() => "");
      if (res.status === 404 || /not.?found|does not exist/i.test(txt)) return null;
      throw new Error(`Supabase Storage download falhou (${res.status}): ${txt}`);
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Supabase Storage download falhou (${res.status}): ${txt}`);
    }
    return await res.json();
  }
  const file = path.join(LOCAL_DIR, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const saveSnapshot = (d) => saveObject("latest.json", d);
const loadSnapshot = () => loadObject("latest.json");
const saveControle = (d) => saveObject("controle-0201.json", d);
const loadControle = () => loadObject("controle-0201.json");

module.exports = { saveSnapshot, loadSnapshot, saveControle, loadControle, usingSupabase };
