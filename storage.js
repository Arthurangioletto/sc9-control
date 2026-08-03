// Guarda e recupera o "último snapshot" (JSON) do painel.
// - Se SUPABASE_URL + SUPABASE_SERVICE_KEY estiverem configurados, usa o
//   Supabase Storage (persiste de verdade, sobrevive a reinícios do Render).
// - Caso contrário, cai para um arquivo local (bom pra testar, mas o Render
//   free apaga o disco quando o serviço "dorme" e acorda de novo).
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "sc9-data";
const OBJECT_PATH = "latest.json";

const LOCAL_DIR = path.join(__dirname, "data");
const LOCAL_FILE = path.join(LOCAL_DIR, "latest.json");

const usingSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

function supabaseObjectUrl() {
  return `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`;
}

async function saveSnapshot(dataObj) {
  const body = JSON.stringify(dataObj);
  if (usingSupabase) {
    const res = await fetch(supabaseObjectUrl() + "?upsert=true", {
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
  fs.writeFileSync(LOCAL_FILE, body, "utf8");
  return { backend: "local-file" };
}

async function loadSnapshot() {
  if (usingSupabase) {
    const res = await fetch(supabaseObjectUrl(), {
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Supabase Storage download falhou (${res.status}): ${txt}`);
    }
    return await res.json();
  }
  if (!fs.existsSync(LOCAL_FILE)) return null;
  return JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
}

module.exports = { saveSnapshot, loadSnapshot, usingSupabase };
