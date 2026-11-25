const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

test('painel da expedição: página, script, estilo e exportação em Excel são servidos, com CSP restritiva e sem recurso externo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-expui-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..'))) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const f of ['expedicao.html', 'expedicao-ui.js', 'expedicao.css', 'expedicao-xlsx.js']) {
      const r = await fetch(base + '/' + f);
      assert.equal(r.status, 200, f);
      assert.ok(!/text\/html/.test(r.headers.get('content-type') || '') || f.endsWith('.html'), f + ' não cai no index.html');
    }
    const html = await fetch(base + '/expedicao.html');
    const csp = html.headers.get('content-security-policy') || '';
    assert.match(csp, /script-src 'self'/); assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'self'/); assert.equal(html.headers.get('x-frame-options'), 'SAMEORIGIN');
    const frameJs = await fetch(base + '/recebimento-expedicao-frame.js'); assert.equal(frameJs.status, 200);
    const texto = await html.text();
    assert.ok(!/(src|href)="https?:\/\//i.test(texto), 'sem recurso externo');
    const js = await (await fetch(base + '/expedicao-ui.js')).text();
    assert.match(js, /\/api\/expedicao\/painel/); assert.match(js, /\/api\/recebimento\/bipar/);
    // sem login as rotas do painel não abrem
    assert.equal((await fetch(base + '/api/expedicao/painel', { headers: { 'X-Sc9-App': '1' } })).status, 401);
  } finally { await new Promise((r) => server.close(r)); }
});

test('aba Recebimento Expedição do SC9 abre o painel em moldura da mesma origem e a tela antiga continua no bundle', async () => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'bundle.js'), 'utf8');
  assert.match(bundle, /window\.SC9RecebimentoFrame\?window\.SC9RecebimentoFrame\.Panel:ds,\{Antiga:ds,isAdmin:!1,authInfo:Me\}/);
  assert.match(bundle, /window\.SC9RecebimentoFrame\?window\.SC9RecebimentoFrame\.Panel:ds,\{Antiga:ds,isAdmin:!0,authInfo:Me\}/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), /\/recebimento-expedicao-frame\.js/);
  const frame = fs.readFileSync(path.join(__dirname, '..', 'recebimento-expedicao-frame.js'), 'utf8');
  assert.match(frame, /\/expedicao\.html\?embed=1/); assert.match(frame, /Tela antiga/);
});
