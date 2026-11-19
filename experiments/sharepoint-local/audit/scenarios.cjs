const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parseDelivery} = require('../delivery.cjs');
const {applyDelivery} = require('./delivery-view.js');
const {project,bundle,between,realClassification,realFilter,tableSource} = require('./sc9-functions.cjs');
const {build,selectionRows} = require(path.join(project,'operation-overview.js'));
const ExcelJS = require(path.join(project,'vendor-exceljs.js'));
const XLSX = require(process.env.SC9_XLSX_LIBRARY || 'xlsx');
const header = ['Data','Transportadora','Cod/Cliente','CLIENTE','Pedidos','Nota Fiscal','Status'];

function workbook(numbers) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Controle de entregas 2026').addRows([
    header,...numbers.map(pedido=>['19/11/2026','Transportadora de teste','TESTE','Cliente de teste',pedido,'',''])
  ]);
  return book;
}
const snapshot = numbers => parseDelivery(workbook(numbers),'Controle de entregas 2026');
function base() {
  const row = (pedido,values={})=>({key:'Cambuci|'+pedido,pedido,armazem:'Cambuci',status:'Atrasado',
    dt:new Date('2026-11-18T12:00:00Z'),dayKey:'2026-11-18',nf:'',qt:2.5,itens:1,nome:'Cliente de teste',...values});
  return [
    row('311261'),row('311262'),row('311263',{status:'Pendente',nf:'10',faturadoSemDespacho:true,faturadoSemDespachoProntoFisico:true}),
    row('311264'),row('311261',{key:'RJ|311261',armazem:'RJ'}),
    row('311265',{status:'Enviado',nf:'11'})
  ];
}
const billing = rows=>rows.filter(row=>row.key==='Cambuci|311262');
function assertTotals(model) {
  assert.equal(model.sent+model.open,model.total);
  assert.equal(model.warehouses.reduce((sum,row)=>sum+row.sent,0),model.sent);
  assert.equal(model.warehouses.reduce((sum,row)=>sum+row.open,0),model.open);
}

test('pedido atrasado, aguardando faturamento e aguardando despacho saem de todas as pendências ao entrar na entrega',()=>{
  const original=base(),before=build(original,billing(original));
  assert.deepEqual([before.sent,before.open,before.lists.late.length,before.lists.billing.length,before.lists.dispatch.length],[1,5,3,1,1]);
  const orders=applyDelivery(original,snapshot(['311261','311262','311263']));
  const after=build(orders,billing(original));
  assert.deepEqual([after.sent,after.open,after.lists.late.length,after.lists.billing.length,after.lists.dispatch.length],[4,2,2,0,0]);
  assert.equal(after.qt,before.qt);
  assertTotals(after);
});

test('a classificação original sem NF é superada somente na projeção local do resumo',()=>{
  const classify=realClassification(),original=base();
  const classified=Array.from(classify(original,new Date('2026-11-19'),new Set()));
  assert.equal(classified[0].status,'Atrasado');
  const projected=applyDelivery(classified,snapshot(['311261']));
  assert.equal(projected[0].status,'Enviado');
  assert.equal(projected[0].nf,'');
  assert.equal(projected[0].pickEnd,undefined);
  assert.equal(projected[0].confEnd,undefined);
});

test('lançamento novo em uma segunda versão da cópia local da planilha atualiza os indicadores',()=>{
  const original=base(),first=applyDelivery(original,snapshot(['311261']));
  const second=applyDelivery(original,snapshot(['311261','311264']));
  assert.equal(build(second).sent,build(first).sent+1);
  assert.equal(build(second).open,build(first).open-1);
  assert.equal(original[3].status,'Atrasado');
});

test('linhas repetidas e zeros à esquerda não duplicam pedidos nem peças',()=>{
  const original=base(),once=applyDelivery(original,snapshot(['311261']));
  const repeated=applyDelivery(original,snapshot(['000311261',311261,'311261 / 311261']));
  assert.deepEqual(build(repeated),build(once));
});

test('pedido igual em RJ permanece com a classificação original',()=>{
  const original=base(),projected=applyDelivery(original,snapshot(['311261']));
  assert.equal(projected[0].status,'Enviado');
  assert.strictEqual(projected[4],original[4]);
  assert.equal(projected[4].status,'Atrasado');
});

test('reimportação da base antiga reaplica a confirmação da entrega sem gravar sobre a base',()=>{
  const original=base(),saved=JSON.stringify(original);
  Object.freeze(original);original.forEach(Object.freeze);
  const delivery=snapshot(['311261','311262']);
  const first=applyDelivery(original,delivery),second=applyDelivery(original.map(row=>({...row})),delivery);
  assert.deepEqual(second,first);
  assert.equal(JSON.stringify(original),saved);
});

test('filtros reais de situação, dia, produto e unidade são aplicados após a confirmação da entrega',()=>{
  const projected=applyDelivery(base(),snapshot(['311261','311262']));
  const filtered=realFilter(projected,{warehouse:'Cambuci',status:'Enviado',day:'2026-11-18',itemKeys:new Set(['Cambuci|311261'])});
  assert.deepEqual(filtered.map(row=>row.pedido),['311261']);
  const model=build(filtered,billing(base()));
  assert.deepEqual(selectionRows(model,{kind:'sent'}),filtered);
  assert.equal(model.open,0);
  assertTotals(model);
});

function table(rows,page=0) {
  const downloads=[],states=['dt',page];
  let cursor=0;
  const xlsx={...XLSX,writeFile:book=>{
    const bytes=Buffer.from(XLSX.write(book,{bookType:'xlsx',type:'array'}));
    downloads.push({bytes,book:XLSX.read(bytes,{type:'buffer'})});
  }};
  const h=(type,props,...children)=>({type,props:{...props,children}});
  const context={window:{SC9Exports:require(path.join(project,'export-workbook.js'))},Qe:xlsx,React:{createElement:h},
    g:{useState:()=>[states[cursor++],()=>{}],useMemo:fn=>fn(),useEffect:()=>{}},e:{},Fd:[['dt','Data']],W:'panel',Zt:'icon',k:String,b:String,
    uo:value=>value instanceof Date?value.toISOString().slice(0,10):'',$l:(value,fallback)=>value||fallback,
    ze:value=>value.toISOString().slice(0,10),ea:()=>'',zt:()=>'',Yl:{},me:'empty'};
  vm.createContext(context);
  vm.runInContext(between('function kc(','function Sc(')+';'+tableSource(),context);
  return {tree:context.Ol({orders:rows,title:'Pedidos enviados',onOpenOrder:()=>{}}),downloads};
}
function nodes(tree, predicate) {
  const found=[];
  function visit(node) {
    if (!node || typeof node!=='object') return;
    if (predicate(node)) found.push(node);
    for (const child of (node.props?.children||[]).flat(Infinity)) visit(child);
  }
  visit(tree);return found;
}
function many(count) {
  return Array.from({length:count},(_,index)=>({...base()[0],key:'Cambuci|'+(500000+index),pedido:String(500000+index),qt:1.125}));
}

test('a tabela real pagina 63 pedidos e o Excel contém os 63 com a mesma situação',()=>{
  const original=many(63),all=applyDelivery(original,snapshot(original.map(row=>row.pedido)));
  const {tree,downloads}=table(all,1);
  assert.equal(nodes(tree,node=>node.type==='tr'&&node.props.onClick).length,13);
  const excel=nodes(tree.props.right,node=>node.type==='button'&&node.props.title==='Baixar essa lista em Excel')[0];
  excel.props.onClick();
  const book=downloads[0].book,rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
  assert.equal(rows.length,63);
  assert(rows.every(row=>row.Status==='Enviado'&&row.Peças===1.125));
  assert.equal(new Set(rows.map(row=>row.Pedido)).size,63);
  const output=path.join(__dirname,'../data');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'exportacao-simulada-63-pedidos.xlsx'),downloads[0].bytes);
});

test('a última página permanece acessível quando as pendências caem de 51 para 50',()=>{
  const original=many(51),pending=build(applyDelivery(original,snapshot([original[0].pedido]))).lists.open;
  assert.equal(pending.length,50);
  const start=bundle.indexOf('React.createElement(window.SC9OperationOverview,');
  const end=bundle.indexOf(',F&&',start);
  let props,listProps;
  const context={React:{createElement:(component,value)=>{
    if(component==='overview')props=value;
    else listProps=value;
  }},window:{SC9OperationOverview:'overview'},ae:original,_e:[],f:'__ALL__',
    p:{warehousesPresent:['Cambuci'],entregaPresent:true},lo:{},ye:'Todos',r:'2026-11-19',
    x:{day:null,status:null,item:null},J:{savedAt:'2026-11-19'},mt:()=>{},Ce:new Date('2026-11-19'),
    Ol:'table',Q:()=>{},H:()=>{}};
  vm.runInNewContext(bundle.slice(start,end-1),context);
  props.renderOrders(original,()=>{},{kind:'open',title:'Pedidos em aberto'});
  const previousKey=listProps.key;
  assert.equal(nodes(table(original,1).tree,node=>node.type==='tr'&&node.props.onClick).length,1);
  props.renderOrders(pending,()=>{},{kind:'open',title:'Pedidos em aberto'});
  assert.notEqual(listProps.key,previousKey,'O resumo deve criar uma nova instância da tabela quando a lista encolhe.');
  const {tree}=table(listProps.orders);
  assert.equal(nodes(tree,node=>node.type==='tr'&&node.props.onClick).length,50);
});

async function mockConnection() {
  const config=require('../config.example.json');
  let now=Date.UTC(2026,10,19,12,0),revision=1,fail='',downloads=0,metadataCalls=0;
  const buffers=new Map();
  for(const [version,numbers]of [[1,['311261']],[2,['311261','311264']]]){
    buffers.set(version,Buffer.from(await workbook(numbers).xlsx.writeBuffer()));
  }
  class Clock extends Date {
    constructor(...args){super(...(args.length?args:[now]));}
    static now(){return now;}
  }
  const fakeFetch=async url=>{
    if (fail==='network') throw Error('Conexão indisponível no teste local.');
    if (fail==='429') return new Response('{}',{status:429,headers:{'retry-after':'60'}});
    if(url.endsWith('/content')){
      downloads++;
      return new Response(buffers.get(revision));
    }
    metadataCalls++;
    return new Response(JSON.stringify({id:config.fileId,name:config.fileName,eTag:'v'+revision,
      lastModifiedDateTime:new Date(now).toISOString(),webUrl:'https://'+config.host+'/entrega.xlsx'}));
  };
  const context={require:name=>{
    if(name==='node:http')return {createServer:()=>({on(){},listen(){}})};
    if(name==='@azure/msal-node')return {PublicClientApplication:class{async acquireTokenSilent(){return{accessToken:'TOKEN-FICTICIO-SOMENTE-TESTE'};}},CryptoProvider:class{}};
    if(name==='./delivery.cjs')return {parseDelivery,consult:require('../delivery.cjs').consult};
    if(name==='../../vendor-exceljs.js')return ExcelJS;
    if(name==='node:fs')return {...fs,readFileSync:(file,...args)=>String(file)===path.join(path.resolve(__dirname,'..'),'data','config.json')?JSON.stringify(config):fs.readFileSync(file,...args)};
    return require(name);
  },__dirname:path.resolve(__dirname,'..'),module:{exports:{}},Date:Clock,fetch:fakeFetch,
    URL,URLSearchParams,AbortSignal,Buffer,Error,console:{log(){}},
    setInterval:()=>({unref(){}}),clearInterval(){}};
  vm.createContext(context);
  const source=fs.readFileSync(path.join(__dirname,'../server.cjs'),'utf8');
  vm.runInContext(source+';globalThis.audit={synchronize,state,orders:()=>cached?.orders,login:()=>{account={username:"conta-ficticia"};}}',context);
  context.audit.login();
  return {...context.audit,setFailure:value=>{fail=value;},advance:()=>{now+=65000;},setVersion:value=>{revision=value;},
    counts:()=>({downloads,metadataCalls})};
}

test('a sincronização real detecta a nova versão, mantém a anterior durante falha e retoma a atualização',async()=>{
  const api=await mockConnection();
  await api.synchronize();
  const initial=api.state();
  assert.equal(initial.uniqueOrders,1);
  assert.equal(api.orders().has('311264'),false);
  api.advance();api.setFailure('network');
  await assert.rejects(api.synchronize(),/indisponível/);
  assert.equal(api.state().lastSuccess,initial.lastSuccess);
  assert.equal(api.state().uniqueOrders,1);
  assert.match(api.state().lastError,/indisponível/);
  api.advance();api.setFailure('');api.setVersion(2);
  await api.synchronize();
  assert.equal(api.state().uniqueOrders,2);
  assert.equal(api.orders().has('311264'),true);
  assert.equal(api.state().lastError,'');
});

test('arquivo inalterado não é baixado novamente e chamadas simultâneas compartilham uma consulta',async()=>{
  const api=await mockConnection();
  await Promise.all([api.synchronize(),api.synchronize(),api.synchronize()]);
  assert.deepEqual(api.counts(),{metadataCalls:1,downloads:1});
  api.advance();
  await api.synchronize();
  assert.deepEqual(api.counts(),{metadataCalls:2,downloads:1});
});

test('o intervalo automático respeita 60 segundos e a atualização manual consulta imediatamente',async()=>{
  const api=await mockConnection();
  await api.synchronize();
  await api.synchronize();
  assert.equal(api.counts().metadataCalls,1);
  await api.synchronize({manual:true});
  assert.equal(api.counts().metadataCalls,2);
});

test('a pausa solicitada pela Microsoft é respeitada inclusive no botão de atualização manual',async()=>{
  const api=await mockConnection();
  await api.synchronize();
  api.advance();api.setFailure('429');
  await assert.rejects(api.synchronize(),/pausa/);
  const before=api.counts();
  await api.synchronize({manual:true});
  assert.deepEqual(api.counts(),before);
  api.advance();api.setFailure('');
  await api.synchronize();
  assert.equal(api.state().lastError,'');
});
