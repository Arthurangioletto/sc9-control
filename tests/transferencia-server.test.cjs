const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('documentos da Transferência pertencem à conta e somente o administrador consulta o conjunto', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-transferencia-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js']) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  }
  const password = 'admin-ficticio-transferencia';
  Object.assign(process.env, { SUPABASE_URL:'', SUPABASE_SERVICE_KEY:'', PORT:'0', APP_PASSWORD:password, SESSION_SECRET:password, NODE_ENV:'test' });
  const start = async () => {
    const file = path.join(dir, 'server.js');
    delete require.cache[file];
    const server = require(file);
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    return server;
  };
  let server = await start();
  const endpoint = '/api/transferencia-documentos';
  async function api(route, cookie, body) {
    const response = await fetch('http://127.0.0.1:'+server.address().port+route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type':'application/json', 'X-SC9-App':'1', ...(cookie ? { Cookie:cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status:response.status, data:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    assert.equal((await api(endpoint)).status, 401);
    const { cookie:admin } = await api('/api/login', null, { password });
    for (const [usuario,perfil] of [['ana','transferencia'],['pedro','transferencia'],['sem-perfil','saida']]) {
      assert.equal((await api('/api/usuarios', admin, { acao:'criar', usuario, nome:usuario, senha:'teste-123', perfis:[perfil] })).status, 200);
    }
    const login = async usuario => (await api('/api/login', null, { usuario, password:'teste-123' })).cookie;
    const ana = await login('ana'), pedro = await login('pedro'), denied = await login('sem-perfil');
    assert.equal((await api(endpoint, denied)).status, 403);
    const created = await Promise.all([api(endpoint, ana, { acao:'criar', autor:'admin' }), api(endpoint, pedro, { acao:'criar' })]);
    const [first,second] = created.map(result=>result.data.documento);
    assert.notEqual(first.id, second.id);
    assert.equal(first.autor, 'ana');
    assert.deepEqual((await api(endpoint, ana)).data.documentos.map(doc=>doc.id), [first.id]);
    assert.deepEqual((await api(endpoint, pedro)).data.documentos.map(doc=>doc.id), [second.id]);
    assert.equal((await api(endpoint, admin)).data.administrador, true);
    assert.equal((await api(endpoint, admin)).data.documentos.length, 2);
    assert((await api(endpoint, admin)).data.documentos.every(doc=>!doc.editavel));
    const record = { sku:'P1', lote:'L1', filial:'01', arm:'59', esperado:8, conferido:8, avaria:0 };
    const update = { acao:'atualizar', id:first.id, versao:first.versao, registros:[record], status:'pausado',
      base:{arquivo:'SB8.xlsx',items:[record]} };
    for (const user of [pedro,admin]) {
      assert.equal((await api(endpoint, user, update)).status, 404);
      assert.equal((await api(endpoint, user, { acao:'excluir', id:first.id, versao:first.versao })).status, 404);
      assert.equal((await api(endpoint+'/'+first.id+'/base', user)).status, 404);
    }
    const paused = await api(endpoint, ana, update);
    assert.equal(paused.status, 200);
    assert.equal((await api(endpoint, ana, update)).status, 409);
    assert.equal((await api(endpoint+'/'+first.id+'/base', ana)).data.base.arquivo, 'SB8.xlsx');
    const finished = await api(endpoint, ana, {
      ...update, base:undefined, versao:paused.data.documento.versao, status:'finalizado', armazens:{destino:'01'}
    });
    assert.equal(finished.status, 200);
    await new Promise(resolve=>server.close(resolve));
    server = await start();
    const saved = (await api(endpoint, admin)).data.documentos.find(doc=>doc.id===first.id);
    assert.equal(saved.status, 'finalizado');
    assert.equal(saved.registros[0].conferido, 8);
    assert.equal(saved.baseObject, undefined);
    const legacy = {
      acao:'importarLegado', base:update.base,
      documento:{ id:'TRF-000001', baseKey:'base:96a57733-ec7a-437d-95d2-dd4217114c79', criadoEm:'2026-11-13T10:00:00Z',
        status:'finalizado', finalizadoEm:'2026-11-13T12:00:00Z', armazens:{destino:'01'}, operador:'ana', registros:[record] }
    };
    assert.equal((await api(endpoint, ana, legacy)).status, 403);
    const imported = await api(endpoint, admin, legacy);
    assert.equal(imported.status, 200);
    assert.equal(imported.data.documento.operador, 'Legado · autor não identificado');
    assert.equal(imported.data.documento.idLegado, legacy.documento.id);
    assert.equal(imported.data.documento.finalizadoEm, legacy.documento.finalizadoEm);
    assert.equal((await api(endpoint, admin, legacy)).data.documento.id, imported.data.documento.id);
    assert.equal((await api(endpoint, ana)).data.documentos.length, 1);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir, { recursive:true, force:true });
  }
});
