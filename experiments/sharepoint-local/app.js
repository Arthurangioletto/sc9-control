let current = null, timer = null;
let queriedOrder = '', queryVersion = 0;
const $ = id => document.getElementById(id);
const formatDate = value => value ? new Date(value).toLocaleString('pt-BR') : 'Aguardando consulta';
async function request(url, method = 'GET') {
  const response = await fetch(url,{method,cache:'no-store',headers:method==='POST'?{'X-SC9-CSRF':current.csrf}:{}});
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Não foi possível concluir a consulta.');
  return data;
}
function alert(message) {
  $('error').textContent = message || '';
  $('error').hidden = !message;
}
function render(state) {
  current = {...current,...state};
  $('file').textContent = state.source;
  $('source').textContent = state.sheet + ' · ' + state.warehouse;
  $('badge').textContent = state.lastError ? 'Consulta requer atenção' : state.ready ? 'Planilha conectada' : state.connected ? 'Conta conectada' : 'Aguardando autorização';
  $('badge').className = 'badge' + (state.lastError ? ' warning' : state.ready ? ' success' : '');
  $('open-source').href = state.sourceUrl;
  $('account').textContent = state.account ? 'Conta conectada · ' + state.account : 'Entre com a conta de estoque que tem acesso à planilha.';
  $('connect').textContent = state.connected ? 'Reconectar conta Microsoft' : 'Conectar conta Microsoft';
  $('sync').disabled = !state.connected;
  $('search').disabled = !state.ready;
  $('count').textContent = state.ready ? state.uniqueOrders.toLocaleString('pt-BR') : '—';
  $('last').textContent = formatDate(state.lastSuccess);
  $('modified').textContent = formatDate(state.fileModifiedAt);
  const pairs = [['Aplicativo',state.clientId],['Empresa',state.tenantId],['Retorno de autenticação',state.redirectUri],['Permissão solicitada','Files.Read · Leitura dos arquivos da conta conectada'],['Unidade da planilha',state.warehouse]];
  $('configuration').replaceChildren(...pairs.flatMap(([label,value])=>{
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    return [dt,dd];
  }));
  alert(state.lastError);
}
async function refresh() {
  try {
    const state = await request('/api/state');
    const changed = state.lastSuccess !== current?.lastSuccess;
    render(state);
    if (queriedOrder && state.ready && changed) await lookup(queriedOrder);
  } catch(error) {alert(error.message);}
}
$('connect').addEventListener('click',async()=>{
  try {
    const {url} = await request('/api/auth','POST');
    window.location.assign(url);
  } catch(error) {alert(error.message);}
});
$('sync').addEventListener('click',async()=>{
  $('sync').disabled = true;
  $('sync').textContent = 'Lendo planilha…';
  try {
    await request('/api/sync','POST');
  } catch(error) {alert(error.message);}
  finally {
    await refresh();
    $('sync').textContent = 'Consultar planilha agora';
  }
});
async function lookup(pedido) {
  const version = ++queryVersion;
  try {
    const data = await request('/api/order?pedido=' + encodeURIComponent(pedido));
    if (version !== queryVersion) return;
    $('answer').replaceChildren();
    const badge = document.createElement('strong'), info = document.createElement('p');
    badge.className = data.encontrado ? 'result-status sent' : 'result-status';
    badge.textContent = 'Pedido ' + data.pedido + ' · ' + data.status;
    info.textContent = data.encontrado
      ? 'Presente na planilha de entrega de Cambuci. A presença confirma a saída mesmo com informações anteriores incompletas no SC9.'
      : 'Pedido ausente na última leitura da planilha de entrega. Consulte a situação anterior na base SC9.';
    $('answer').append(badge,info);
    $('rows').replaceChildren(...data.ocorrencias.map(row=>{
      const tr = document.createElement('tr');
      [row.linha,row.data,row.cliente,row.nota,row.transportadora,row.statusPlanilha].forEach(value=>{
        const td = document.createElement('td'); td.textContent = String(value || '—'); tr.append(td);
      });
      return tr;
    }));
    $('results').hidden = !data.encontrado;
    alert(data.lastError);
  } catch(error) {if(version === queryVersion) alert(error.message);}
}
$('query').addEventListener('submit',async event=>{
  event.preventDefault();
  queriedOrder = $('pedido').value.trim();
  await lookup(queriedOrder);
});
refresh().then(()=>{
  if (current?.connected) $('sync').click();
  timer = setInterval(refresh,10000);
});
window.addEventListener('pagehide',()=>clearInterval(timer));
