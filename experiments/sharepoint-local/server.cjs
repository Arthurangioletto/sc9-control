const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {PublicClientApplication, CryptoProvider} = require('@azure/msal-node');
const ExcelJS = require('../../vendor-exceljs.js');
const {parseDelivery,consult} = require('./delivery.cjs');
const config = JSON.parse(fs.readFileSync(path.join(__dirname,'data','config.json'),'utf8'));
const PORT = 3003;
const origin = 'http://localhost:' + PORT;
const redirectUri = origin + '/auth/callback';
const scopes = ['https://graph.microsoft.com/Files.Read'];
const identity = new PublicClientApplication({auth:{
  clientId:config.clientId,
  authority:'https://login.microsoftonline.com/' + config.tenantId
}});
const proof = new CryptoProvider();
const flows = new Map();
const sessions = new Map();
const maxBytes = 60 * 1024 * 1024;
let account = null, cached = null, syncPromise = null, nextAttempt = 0, nextScheduled = 0, lastError = '';
let lastCheck = null, lastSuccess = null;

function sessionFor(req) {
  const token = /(?:^|;\s*)sc9_sp_local=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  return token && sessions.get(token);
}
function cookie(token) {
  return 'sc9_sp_local=' + token + '; Path=/; HttpOnly; SameSite=Lax';
}
function issueSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {csrf:crypto.randomBytes(32).toString('hex')};
  sessions.set(token,session);
  res.setHeader('Set-Cookie',cookie(token));
  return session;
}
function json(res,status,value) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(value));
}
function state() {
  return {connected:!!account,source:config.fileName,sheet:config.sheet,warehouse:config.warehouse,
    clientId:config.clientId,tenantId:config.tenantId,redirectUri,sourceUrl:config.sourceUrl,
    intervalSeconds:config.intervalSeconds,lastCheck,lastSuccess,lastError,
    fileModifiedAt:cached?.modifiedAt || null,uniqueOrders:cached?.orders.size || 0,
    ignoredRows:cached?.ignored || 0,account:account?.username || '',ready:!!cached};
}
async function graph(requestPath, token, options = {}) {
  const response = await fetch('https://graph.microsoft.com/v1.0' + requestPath, {
    ...options, headers:{Authorization:'Bearer ' + token,...options.headers},redirect:'manual',
    signal:AbortSignal.timeout(45000)
  });
  if (response.ok || response.status === 304 || response.status === 302) return response;
  if (response.status === 429 || response.status === 503) {
    const seconds = Number(response.headers.get('retry-after'));
    nextAttempt = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
    throw Error('A Microsoft pediu uma pausa nas consultas. A próxima tentativa será feita automaticamente.');
  }
  const data = await response.json().catch(()=>({}));
  const code = String(data.error?.code || response.status);
  if (response.status === 401) throw Error('A sessão Microsoft expirou. Conecte a conta novamente.');
  if (response.status === 403) throw Error('A conta ou o aplicativo ainda não tem a permissão de leitura necessária.');
  if (response.status === 404) throw Error('A planilha não foi encontrada na conta conectada. Use a conta de estoque proprietária do arquivo.');
  throw Error('A consulta ao Microsoft Graph falhou (' + code + ').');
}
async function readLimited(response) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw Error('A planilha ultrapassa o limite de 60 MB deste teste local.');
  }
  const parts = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw Error('A planilha ultrapassa o limite de 60 MB deste teste local.');
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}
async function synchronize({manual = false} = {}) {
  if (syncPromise) return syncPromise;
  if (!account) throw Error('Conecte a conta Microsoft para consultar a planilha.');
  if (Date.now() < nextAttempt) return;
  if (!manual && Date.now() < nextScheduled) return;
  nextScheduled = Date.now() + config.intervalSeconds * 1000;
  syncPromise = (async()=>{
    try {
      const auth = await identity.acquireTokenSilent({account,scopes});
      const resource = '/me/drive/items/' + encodeURIComponent(config.fileId);
      const metadataResponse = await graph(resource + '?$select=id,name,eTag,lastModifiedDateTime,webUrl,size',auth.accessToken);
      const metadata = await metadataResponse.json();
      const fileUrl = new URL(metadata.webUrl);
      if (fileUrl.hostname !== config.host || metadata.name !== config.fileName) {
        throw Error('O arquivo retornado não corresponde à planilha de entrega configurada.');
      }
      lastCheck = new Date().toISOString();
      if (cached?.etag === metadata.eTag) {
        lastSuccess = lastCheck;
        lastError = '';
        return;
      }
      const response = await graph(resource + '/content',auth.accessToken);
      let content = response;
      if (response.status === 302) {
        const download = new URL(response.headers.get('location'));
        if (download.protocol !== 'https:' || download.hostname !== config.host || download.username || download.password) {
          throw Error('A Microsoft retornou um endereço de download diferente do SharePoint configurado.');
        }
        content = await fetch(download,{redirect:'error',signal:AbortSignal.timeout(60000)});
        if (!content.ok) throw Error('Não foi possível baixar a planilha de entrega (' + content.status + ').');
      }
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await readLimited(content));
      const parsed = parseDelivery(workbook,config.sheet);
      cached = {...parsed,etag:metadata.eTag,modifiedAt:metadata.lastModifiedDateTime};
      lastSuccess = new Date().toISOString();
      lastError = '';
    } catch (error) {
      lastError = error instanceof Error && !error.errorCode ? error.message :
        'A autenticação Microsoft precisa ser renovada. Conecte a conta novamente.';
      throw Error(lastError);
    }
  })().finally(()=>{syncPromise=null;});
  return syncPromise;
}
async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const expectedHost = 'localhost:' + PORT;
  if (req.headers.host !== expectedHost || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
    return json(res,403,{error:'Este teste aceita somente acesso pelo localhost deste computador.'});
  }
  const url = new URL(req.url,origin);
  const staticFiles = {'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
  if (req.method === 'GET' && staticFiles[url.pathname]) {
    if (url.pathname === '/') issueSession(res);
    res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});
    return res.end(fs.readFileSync(path.join(__dirname,staticFiles[url.pathname])));
  }
  const session = sessionFor(req);
  if (!session) return json(res,401,{error:'Abra a página inicial do teste local para continuar.'});
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res,200,{...state(),csrf:session.csrf});
  if (req.method === 'POST') {
    if (req.headers.origin !== origin || req.headers['x-sc9-csrf'] !== session.csrf) return json(res,403,{error:'Reabra a página local e tente novamente.'});
    if (url.pathname === '/api/auth') {
      const codes = await proof.generatePkceCodes();
      const stateId = crypto.randomBytes(32).toString('hex');
      for (const [key,flow] of flows) if (flow.expires < Date.now()) flows.delete(key);
      flows.set(stateId,{session,verifier:codes.verifier,expires:Date.now()+10*60000});
      const authUrl = await identity.getAuthCodeUrl({scopes,redirectUri,responseMode:'query',
        codeChallenge:codes.challenge,codeChallengeMethod:'S256',state:stateId,
        loginHint:config.loginHint || undefined});
      return json(res,200,{url:authUrl});
    }
    if (url.pathname === '/api/sync') {
      await synchronize({manual:true});
      return json(res,200,state());
    }
  }
  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    const stateId = url.searchParams.get('state');
    const flow = flows.get(stateId);
    flows.delete(stateId);
    if (!flow || flow.expires < Date.now() || flow.session !== session) {
      return json(res,400,{error:'A autorização expirou ou pertence a outra sessão. Abra localhost:3003 e conecte novamente.'});
    }
    if (url.searchParams.has('error') || !url.searchParams.get('code')) {
      lastError = 'A Microsoft recusou a autorização. Confirme a liberação da permissão Files.Read na empresa.';
      res.writeHead(303,{Location:'/'});
      return res.end();
    }
    const result = await identity.acquireTokenByCode({code:url.searchParams.get('code'),codeVerifier:flow.verifier,scopes,redirectUri});
    if (!result.account || result.account.tenantId !== config.tenantId) throw Error('Entre com a conta Microsoft da empresa configurada.');
    account = result.account;
    lastError = '';
    nextAttempt = 0;
    res.writeHead(303,{Location:'/'});
    return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/api/order') {
    if (!cached) return json(res,409,{error:'Consulte a planilha antes de pesquisar um pedido.'});
    return json(res,200,{...consult(cached.orders,url.searchParams.get('pedido'),config.warehouse),lastSuccess,lastError});
  }
  return json(res,404,{error:'Endereço indisponível.'});
}
const server = http.createServer((req,res)=>{
  Promise.resolve(handler(req,res)).catch(error=>{
    const message = error.errorCode ? 'A autenticação Microsoft não foi concluída. Reabra o teste local e tente conectar novamente.' : error.message;
    if (!res.headersSent) json(res,400,{error:message});
    else res.end();
  });
});
const ticker = setInterval(()=>{if(account)void synchronize().catch(()=>{});},5000);
ticker.unref();
server.on('close',()=>clearInterval(ticker));
server.listen(PORT,'127.0.0.1',()=>console.log('Teste SharePoint disponível em ' + origin));
module.exports = {server,readLimited};
