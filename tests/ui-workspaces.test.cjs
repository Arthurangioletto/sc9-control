const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const model=require('../ui-workspaces.js'),source=fs.readFileSync(require.resolve('../bundle.js'),'utf8');
const orders=[{key:'CB|1',pedido:'1',armazem:'Cambuci',nome:' João Ltda ',qt:2.25,status:'Atrasado',dayKey:'2026-10-29',pickStart:new Date('2026-10-29T10:00:00Z'),pickEnd:new Date('2026-10-29T10:30:00Z'),durationMin:30},{key:'RJ|1',pedido:'1',armazem:'RJ',nome:'João Ltda',qt:.5,status:'Enviado',dayKey:'2026-10-30'},{key:'CB|2',pedido:'2',armazem:'Cambuci',nome:'0',qt:1,status:'Pendente',pickStart:'inválida'}];
function setup(){let states=[],refs=[],cursor=0,refCursor=0;const R={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useMemo:fn=>fn(),useEffect:()=>{},useState:initial=>{const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],value=>states[index]=value];},useRef:()=>refs[refCursor++]||{current:null}};const root={React:R,SC9UI:{InlineDetails:'inline'}};vm.runInNewContext(fs.readFileSync(require.resolve('../ui-workspaces.js'),'utf8'),{window:root});return {root,render:(fn,props)=>{cursor=0;refCursor=0;return fn(props);}};}
function nodes(tree,predicate){const found=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))found.push(node);for(const child of [node.props?.children||[]].flat(Infinity))visit(child);}visit(tree);return found;}
test('resumo usa o recorte e datas válidas sem alterar pedidos ou confundir armazéns',()=>{
 const snapshot=JSON.stringify(orders),stats=model.orderStats(orders);assert.equal(stats.total,3);assert.equal(stats.quantity,3.75);assert.equal(stats.units,2);assert.equal(stats.days,2);assert.equal(stats.sent,1);assert.equal(stats.starts,1);assert.equal(stats.ends,1);assert.equal(stats.firstStart,orders[0].pickStart.getTime());assert.equal(JSON.stringify(orders),snapshot);assert.equal(model.dateTime('inválida'),'Não informado');assert.equal(model.number(.125),'0,125');
});
test('clientes preservam os totais do agrupamento nativo e não limitam a dez resultados',()=>{
 const rows=model.clients(orders);assert.equal(rows.length,1);assert.equal(rows[0].qt,2.75);assert.equal(rows[0].pedidos,2);assert.equal(rows[0].atrasados,1);assert.strictEqual(rows[0].orders[0],orders[0]);assert.strictEqual(rows[0].orders[1],orders[1]);
 const a=source.indexOf('function Gc('),b=source.indexOf('function Pr(',a),native=vm.runInNewContext('('+source.slice(a,b)+')');const nativeRow=native(orders).porVolume[0];assert.equal(nativeRow.qt,rows[0].qt);assert.equal(nativeRow.pedidos,rows[0].pedidos);assert.equal(nativeRow.atrasados,rows[0].atrasados);
 assert.equal(model.clients(Array.from({length:71},(_,index)=>({...orders[0],nome:'Cliente '+index}))).length,71);
});
test('movimentação combina armazém, tipo, datas e busca sem alterar registros ou misturar períodos',()=>{
 const records=[{armazem:'59',tp:999,dt:'2026-10-29T00:00:00Z',lote:'L1',produto:'P1',usuario:'João',qt:.25},{armazem:'01',tp:499,dt:'2026-10-30T00:00:00Z',lote:'L1',produto:'P1',qt:2},{armazem:'59',tp:999,dt:null,lote:'L1',qt:1}];const snapshot=JSON.stringify(records);
 assert.deepEqual(model.filterMovement(records,{warehouse:'59',type:'999',from:'2026-10-29',to:'2026-10-29',query:'l1 joao'}),[records[0]]);assert.equal(model.filterMovement(records,{warehouse:'01',query:'l1'}).length,1);assert.equal(model.filterMovement(records,{from:'2026-10-30',to:'2026-10-29'}).length,0);assert.equal(model.filterMovement(records,{}).length,3);assert.equal(JSON.stringify(records),snapshot);
});
test('paginação mantém cinquenta registros e ajusta a página quando o recorte diminui',()=>{
 const rows=Array.from({length:101},(_,index)=>({index}));assert.strictEqual(model.pageWindow(rows,2).rows[0],rows[50]);assert.equal(model.pageWindow(rows,3).rows.length,1);assert.equal(model.pageWindow(rows.slice(0,12),3).current,1);assert.equal(model.pageWindow([],1).rows.length,0);
});
test('adaptador de tabela preserva as ações e não lê valores de campos sensíveis para a busca',()=>{
 const {root,render}=setup();let invoked=0;const action={type:'button',props:{children:'Ação original',onClick:()=>invoked++}},sensitive={type:'input',props:{type:'password',get value(){throw Error('Não ler campos de senha');}}};
 const rows=Array.from({length:57},(_,index)=>({type:'tr',key:'r'+index,props:{children:[{type:'td',props:{children:'Pessoa '+index}},{type:'td',props:{children:[action,sensitive]}}]}})),head={type:'thead',props:{children:[]}},body={type:'tbody',props:{children:rows}},props={children:[head,body],caption:'Operadores',className:'original'};
 let tree=render(root.SC9View.NativeTable,props);assert.equal(nodes(tree,node=>node.type==='tr').length,50);assert.strictEqual(nodes(tree,node=>node===action)[0],action);nodes(tree,node=>node===action)[0].props.onClick();assert.equal(invoked,1);
 nodes(tree,node=>node.type==='input'&&node.props.type==='search')[0].props.onChange({target:{value:'Pessoa 56'}});tree=render(root.SC9View.NativeTable,props);assert.equal(nodes(tree,node=>node.type==='tr').length,1);assert.strictEqual(nodes(tree,node=>node.type==='tr')[0],rows[56]);assert.equal(nodes(tree,node=>node===sensitive).length,1);
});
test('produtos usam todas as páginas e preservam a classificação ABC recebida durante a busca',()=>{
 const {root,render}=setup(),rows=Array.from({length:73},(_,index)=>({produto:'P'+index,qt:index+.25,pedidos:1,giro:.5,classe:index%2?'A':'C'})),snapshot=JSON.stringify(rows);
 let tree=render(root.SC9ProductAnalysis,{rows,allRows:rows,query:'',onQuery:()=>{},itemName:code=>'Produto '+code});let table=nodes(tree,node=>node.type===root.SC9View.Table)[0];assert.equal(table.props.items.length,73);
 nodes(tree,node=>node.type==='select')[0].props.onChange({target:{value:'A'}});tree=render(root.SC9ProductAnalysis,{rows:rows.slice(1,2),allRows:rows,query:'P1',onQuery:()=>{},itemName:code=>code});table=nodes(tree,node=>node.type===root.SC9View.Table)[0];assert.strictEqual(table.props.items[0],rows[1]);assert.equal(table.props.items[0].classe,'A');assert.equal(JSON.stringify(rows),snapshot);
});
test('cliente abre seus pedidos originais na própria página e permite recolher a consulta',()=>{
 const {root,render}=setup();let received;const props={orders,renderOrders:(rows,options)=>{received={rows,options};return 'Tabela';}};
 let tree=render(root.SC9ClientAnalysis,props),table=nodes(tree,node=>node.type===root.SC9View.Table)[0],button=table.props.columns[0].render(table.props.items[0]);button.props.onClick();tree=render(root.SC9ClientAnalysis,props);assert.strictEqual(received.rows[0],orders[0]);assert.equal(nodes(tree,node=>node.type==='inline').length,1);assert(received.options.key.includes('João Ltda'));nodes(tree,node=>node.type==='inline')[0].props.onClose();tree=render(root.SC9ClientAnalysis,props);assert.equal(nodes(tree,node=>node.type==='inline').length,0);
});
test('performance distingue ausência de dados de taxa zero e não duplica Atendimento como Expedição',()=>{
 const {root,render}=setup(),metrics={atendimento:0,eficienciaMedia:0,romaneioRate:0,mediaDur:null};let tree=render(root.SC9PerformanceAnalysis,{orders:[],team:[],metrics});const text=JSON.stringify(tree);assert(text.includes('—'));assert(!text.includes('NaN'));assert(!text.includes('"Expedição"'));
 tree=render(root.SC9PerformanceAnalysis,{orders:[orders[2]],team:[{aproveitamento:null}],metrics});assert(JSON.stringify(tree).includes('0%'));assert(JSON.stringify(tree).includes('Tempo médio de separação'));
});
function propsExpression(page){const a=source.indexOf('!F&&D==="'+page+'"'),b=source.indexOf('React.createElement(window.SC9AnalysisWorkspace,',a),start=b+'React.createElement(window.SC9AnalysisWorkspace,'.length,end=source.indexOf('el(),Q(null)}}',start)+'el(),Q(null)}}'.length;assert(a>0&&b>a&&end>start);return source.slice(start,end);}
test('cinco análises encaminham os filtros reais sem apagar seleções independentes',()=>{
 for(const page of ['clientes','itens','performance','horarios','tendencias']){let warehouse,detail='aberto',cutoff,state={day:'2026-10-29',item:'P1',status:'Pendente'};const context={ae:orders,ye:'Todos',f:'__ALL__',p:{warehousesPresent:['RJ']},lo:{},r:'2026-10-30',x:state,J:{savedAt:'data'},ys:()=> 'Produto',b:value=>warehouse=value,Q:value=>detail=value,o:value=>cutoff=value,R:fn=>state=fn(state),el:()=>state={}};
  const props=vm.runInNewContext('('+propsExpression(page)+')',context);assert.strictEqual(props.orders,orders);props.onWarehouse('RJ');assert.equal(warehouse,'RJ');assert.equal(detail,null);assert.equal(state.item,'P1');props.onFilter('status','');assert.equal(state.status,null);assert.equal(state.day,'2026-10-29');props.onCutoff('2026-10-29');assert.equal(cutoff,'2026-10-29');props.onClear();assert.equal(warehouse,'__ALL__');assert.deepEqual(state,{});
 }
 const a=source.indexOf('!F&&D==="performance"'),b=source.indexOf(',!F&&D===',a+10),block=source.slice(a,b);assert(block.includes('React.createElement(po,{unlocked:jt'));assert(block.indexOf('React.createElement(po,')<block.indexOf('window.SC9AnalysisWorkspace'));
});
test('histórico geral fica separado dos recortes de dia, status e produto',()=>{
 const a=source.indexOf('wa=(0,g.useMemo)',410000),b=source.indexOf(',ut=',a),expr=source.slice(a+3,b);assert(a>0&&b>a);
 const context={g:{useMemo:fn=>fn()},f:'__ALL__',x:{},p:{trendHistory:['antigo']},Wa:['atual'],Qn:(history,current)=>[...history,...current]};assert.deepEqual(Array.from(vm.runInNewContext(expr,context)),['antigo','atual']);
 for(const key of ['day','status','item']){context.x={[key]:'filtro'};assert.deepEqual(Array.from(vm.runInNewContext(expr,context)),['atual']);}context.x={};context.f='RJ';assert.deepEqual(Array.from(vm.runInNewContext(expr,context)),['atual']);
 for(const expression of ['jc(ae),[ae]','Xs(ae),[ae]','ei(ae,p?.sc5PorPedido),[ae,p]','Fl(ae,$),[ae,$]','Xn(ae,wt,$,lt),[ae,wt,$,lt]'])assert(source.includes(expression),expression);
});
test('Acessos e Revisão mantêm os callbacks, perfis e componentes originais',()=>{
 const a=source.indexOf('am=()=>'),b=source.indexOf(',hs=()=>',a),access=source.slice(a,b);for(const text of ['onClick:Ud','onClick:()=>Kd(c,w)','window.prompt','window.confirm','perfis:Xt.perfis','page:"acessos",users:qa,activity:Xr']){if(text==='perfis:Xt.perfis')continue;assert(access.includes(text),text);}
 const c=source.indexOf('function hn('),d=source.indexOf('function ',c+12),review=source.slice(c,d);assert(review.includes('page:"alteracoes",canReview:a'));assert(review.includes('React.createElement(Fi,{isAdmin:t,temAlteracoes:a,authInfo:r'));assert(review.includes('a?React.createElement(Mi,'));assert(review.includes('a&&React.createElement(W,{id:"sc9-review-export"'));assert(!fs.readFileSync(require.resolve('../ui-workspaces.js'),'utf8').includes('fetch('));
});
test('resumo de acessos não apresenta usuários sem registros como pessoas com atividade',()=>{
 const {root,render}=setup(),tree=render(root.SC9AdminWorkspace,{page:'acessos',users:[{ativo:true},{ativo:false}],activity:[{criados:0,confirmados:0},{criados:1,confirmados:0}],children:'Formulário original'});
 const metrics=nodes(tree,node=>node.props?.className==='sc9-view-metric');assert.equal(metrics.length,4);assert.equal(metrics[3].props.children[1].props.children[0],'1');assert.match(JSON.stringify(tree),/Pessoas com registros no Controle/);
});
