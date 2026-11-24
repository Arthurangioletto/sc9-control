const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

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
    for (const [usuario,perfil] of [['ana','transferencia'],['pedro','transferencia'],['sem-perfil','saida'],['retem-ana','controle0201'],['retem-pedro','controle0201']]) {
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
    }
    assert.equal((await api(endpoint+'/'+first.id+'/base', pedro)).status, 404, 'outro usuário não lê a base');
    assert.equal((await api(endpoint, ana, {...update, registros:[{...record,arm:'ES'}]})).status, 400);
    assert.equal((await api(endpoint, ana, {...update, base:{...update.base, items:[record,{...record,arm:'ES'}]}})).status, 400);
    const paused = await api(endpoint, ana, update);
    assert.equal(paused.status, 200);
    assert.equal((await api(endpoint, ana, update)).status, 409);
    assert.equal((await api(endpoint+'/'+first.id+'/base', ana)).data.base.arquivo, 'SB8.xlsx');
    assert.equal((await api(endpoint+'/'+first.id+'/base', admin)).data.base.arquivo, 'SB8.xlsx', 'o administrador lê a base (só leitura)');
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
    const consolidate = { acao:'consolidar', ids:[first.id,second.id] };
    assert.equal((await api(endpoint, ana, consolidate)).status, 403);
    assert.equal((await api(endpoint, admin, consolidate)).status, 400);
    assert.equal((await api(endpoint, pedro, { acao:'atualizar', id:second.id, versao:second.versao,
      status:'finalizado', registros:[{ ...record, conferido:4 }], armazens:{destino:'01'} })).status, 200);
    const consolidated = await api(endpoint, admin, consolidate);
    assert.equal(consolidated.status, 200);
    assert.equal(consolidated.data.documento.consolidado, true);
    assert.deepEqual(new Set(consolidated.data.documento.registros.map(row=>row.documentoOrigem)), new Set(consolidate.ids));
    assert.equal(consolidated.data.documento.registros.reduce((total,row)=>total+row.conferido,0), 12);
    assert.equal((await api(endpoint, admin)).data.documentos.length, 2);
    assert.equal((await api(endpoint, admin, { ...consolidate, ids:[first.id,first.id] })).status, 400);
    const incompatible = (await api(endpoint, pedro, { acao:'criar' })).data.documento;
    assert.equal((await api(endpoint, pedro, { acao:'atualizar', id:incompatible.id, versao:incompatible.versao,
      status:'finalizado', registros:[{ ...record, filial:'02' }], armazens:{destino:'01'} })).status, 200);
    assert.equal((await api(endpoint, admin, { ...consolidate, ids:[first.id,incompatible.id] })).status, 400);
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

    const retem = '/api/retem-documentos';
    const retemAna = await login('retem-ana'), retemPedro = await login('retem-pedro');
    assert.equal((await api(retem, ana)).status, 403);
    assert.equal((await api(endpoint, retemAna)).status, 403);
    const retDoc = (await api(retem, retemAna, { acao:'criar' })).data.documento;
    assert.match(retDoc.id, /^DOC-/);
    const retRecord = { ...record, arm:undefined };
    const retFinal = await api(retem, retemAna, { acao:'atualizar', id:retDoc.id, versao:retDoc.versao,
      status:'finalizado', registros:[retRecord], armazens:{origem:'26',destino:'01'} });
    assert.equal(retFinal.status, 200);
    assert.deepEqual(retFinal.data.documento.armazens, {origem:'26',destino:'01'});
    assert.equal((await api(retem, retemPedro)).data.documentos.length, 0);
    assert.equal((await api(retem, retemAna)).data.documentos.length, 1);
    assert.equal((await api(retem, admin)).data.documentos[0].autor, 'retem-ana');
    assert.equal((await api(retem, admin)).data.documentos[0].editavel, false);
    assert.equal((await api(endpoint, admin)).data.documentos.length, 4);
    const oldRetem = { ...legacy, documento:{ ...legacy.documento, id:'DOC-000001', registros:[retRecord],
      armazens:{origem:'26',destino:'01'} } };
    assert.equal((await api(retem, retemAna, oldRetem)).status, 403);
    const recovered = (await api(retem, admin, oldRetem)).data.documento;
    assert.equal(recovered.idLegado, 'DOC-000001');
    assert.equal((await api(retem, retemAna, { acao:'consolidar', ids:[retDoc.id,recovered.id] })).status, 403);
    assert.equal((await api(retem, admin, { acao:'consolidar', ids:[retDoc.id,recovered.id] })).status, 200);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

test('Transferência e Retem abrem e salvam bases de documentos novos mesmo com uma cópia antiga no cache', async () => {
  const objects = new Map(), cached = new Map();
  const storage = http.createServer(async (req,res) => {
    const url = new URL(req.url, 'http://localhost');
    const key = url.pathname;
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200).end('{}');
      return;
    }
    if (!cached.has(key)) cached.set(key, objects.get(key));
    const object = url.searchParams.has('cacheNonce') ? objects.get(key) : cached.get(key);
    res.writeHead(object ? 200 : 404).end(object || '{"statusCode":404}');
  });
  await new Promise(resolve => storage.listen(0,'127.0.0.1',resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'sc9-transferencia-cache-'));
  let server;
  try {
    for (const name of ['server.js','stock-position.js','inventory-integrity.js']) {
      fs.copyFileSync(path.join(__dirname,'..',name),path.join(dir,name));
    }
    const password = 'admin-ficticio-transferencia-cache';
    Object.assign(process.env,{ SUPABASE_URL:'http://127.0.0.1:'+storage.address().port,
      SUPABASE_SERVICE_KEY:'storage-ficticio',PORT:'0',APP_PASSWORD:password,SESSION_SECRET:password });
    server=require(path.join(dir,'server.js'));
    if (!server.listening) await new Promise(resolve=>server.once('listening',resolve));
    for (const scope of ['transferencia','retem']) {
      const endpoint='http://127.0.0.1:'+server.address().port+'/api/'+scope+'-documentos';
      const api=(suffix='',body)=>fetch(endpoint+suffix,{
        method:body?'POST':'GET',headers:{'X-App-Password':password,'X-SC9-App':'1','Content-Type':'application/json'},
        body:body?JSON.stringify(body):undefined
      });
      assert.deepEqual((await (await api()).json()).documentos,[]);
      const { documento }=await (await api('',{acao:'criar'})).json();
      const basePath='/'+documento.id+'/base';
      assert.deepEqual(await (await api(basePath)).json(),{base:null});
      const item={sku:'P1',lote:'L1',filial:'01',conferido:0,avaria:0,esperado:1};
      if(scope==='transferencia')item.arm='59';
      const base={arquivo:'SB8.xlsx',items:[item]};
      const saved=await api('',{acao:'atualizar',id:documento.id,versao:documento.versao,status:'andamento',registros:[],base});
      assert.equal(saved.status,200);
      assert.deepEqual(await (await api(basePath)).json(),{base});
    }
  } finally {
    if (server) await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>storage.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('Transferência salva documento grande (milhares de itens, mais de 1 MB) sem perder item', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-transferencia-grande-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js']) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  }
  const password = 'admin-ficticio-grande';
  Object.assign(process.env, { SUPABASE_URL:'', SUPABASE_SERVICE_KEY:'', PORT:'0', APP_PASSWORD:password, SESSION_SECRET:password, NODE_ENV:'test' });
  const file = path.join(dir, 'server.js');
  delete require.cache[file];
  const server = require(file);
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
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
    const { cookie:admin } = await api('/api/login', null, { password });
    const doc = (await api(endpoint, admin, { acao:'criar' })).data.documento;
    const itens = Array.from({ length:3000 }, (_, i) => ({ id:'i'+i, itemId:'it'+i, loteId:'l'+i, loteProduto:'LP'+i, sku:'SKU'+i, lote:'L'+i, filial:'01', arm:'59',
      descricao:'PRODUTO DE TESTE COM DESCRIÇÃO LONGA NÚMERO '+i, ean:'789000'+i, validade:'2027-01-01', unidade:'UN', endereco:'A-01-'+i, fornecedor:'FORNECEDOR TESTE LTDA',
      nf:'12345', doca:'1', placa:'ABC1D23', chegada:'2026-11-24', esperado:5, conferido:0, avaria:0 }));
    const corpo = { acao:'atualizar', id:doc.id, versao:doc.versao, status:'andamento', registros:itens, base:{ arquivo:'SB8.xlsx', items:itens } };
    assert.ok(JSON.stringify(corpo).length > 2 * 1024 * 1024, 'o teste precisa passar de 2 MB');
    const salvo = await api(endpoint, admin, corpo);
    assert.equal(salvo.status, 200, JSON.stringify(salvo.data).slice(0, 200));
    assert.equal(salvo.data.documento.registros.length, 3000);
    const lista = (await api(endpoint, admin)).data.documentos.find(d => d.id === doc.id);
    assert.equal(lista.registros.length, 3000, 'nenhum item perdido ao recarregar');
    const base = (await api(endpoint + '/' + doc.id + '/base', admin)).data.base;
    assert.equal(base.items.length, 3000, 'a base também volta completa');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('páginas que abrem dentro do SC9 (Transferência e Retem) não são bloqueadas por X-Frame-Options, e a câmera segue liberada para a Gaveta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-moldura-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'transferencia-de-lotes.html', 'conferencia-de-lotes.html', 'index.html']) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  }
  const password = 'admin-ficticio-moldura';
  Object.assign(process.env, { SUPABASE_URL:'', SUPABASE_SERVICE_KEY:'', PORT:'0', APP_PASSWORD:password, SESSION_SECRET:password, NODE_ENV:'test' });
  const file = path.join(dir, 'server.js');
  delete require.cache[file];
  const server = require(file);
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const pagina of ['/transferencia-de-lotes.html', '/conferencia-de-lotes.html']) {
      const r = await fetch(base + pagina);
      assert.equal(r.status, 200, pagina);
      assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN', pagina + ': a moldura da mesma origem precisa abrir');
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/, pagina);
    }
    // 2ª abertura (revalidação com ETag, resposta 304): precisa manter o CSP da moldura, senão valem os cabeçalhos globais (frame-ancestors 'none')
    for (const pagina of ['/transferencia-de-lotes.html', '/conferencia-de-lotes.html']) {
      const etag = (await fetch(base + pagina)).headers.get('etag');
      const r = await fetch(base + pagina, { headers: { 'If-None-Match': etag } });
      assert.equal(r.status, 304, pagina);
      assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN', pagina + ' (304)');
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/, pagina + ' (304)');
    }
    const inicio = await fetch(base + '/');
    assert.equal(inicio.headers.get('x-frame-options'), 'DENY', 'o resto continua protegido contra clickjacking');
    assert.match(inicio.headers.get('permissions-policy'), /camera=\(self\)/, 'a câmera da Gaveta não pode ser bloqueada');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
