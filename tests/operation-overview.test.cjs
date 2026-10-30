const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {build,selectionRows}=require('../operation-overview.js');
const orders=[
 {key:'CB|1',pedido:'1',armazem:'Cambuci',status:'Enviado',qt:10,dayKey:'2026-10-28'},
 {key:'CB|2',pedido:'2',armazem:'Cambuci',status:'Atrasado',qt:20,dayKey:'2026-10-28'},
 {key:'CB|3',pedido:'3',armazem:'Cambuci',status:'Atrasado',qt:2.5,dayKey:'2026-10-29'},
 {key:'CB|4',pedido:'4',armazem:'Cambuci',status:'Pendente',qt:4,faturadoSemDespachoProntoFisico:true,dayKey:'2026-10-29'},
 {key:'RJ|1',pedido:'1',armazem:'RJ',status:'Pendente',qt:3,dayKey:'2026-10-29'},
 {key:'RJ|5',pedido:'5',armazem:'RJ',status:'Enviado',qt:8,dayKey:'2026-10-28'}
];
test('indicadores e comparação reconciliam pedidos e quantidades sem confundir pedido igual em unidades diferentes',()=>{
 const model=build(orders,[orders[2]],['Cambuci','RJ','DF']);
 assert.equal(model.total,6);assert.equal(model.open,4);assert.equal(model.sent,2);assert.equal(model.qt,47.5);
 assert.equal(model.warehouses.reduce((n,r)=>n+r.total,0),model.total);
 assert.equal(model.warehouses.reduce((n,r)=>n+r.qt,0),model.qt);
 assert.equal(model.warehouses.reduce((n,r)=>n+r.open,0),model.open);
 assert.equal(model.warehouses[2].rate,null);assert.equal(model.sentRate,2/6);
 assert.deepEqual(model.lists.late,[orders[1]]);assert.deepEqual(model.lists.billing,[orders[2]]);assert.deepEqual(model.lists.dispatch,[orders[3]]);
 assert.strictEqual(selectionRows(model,{warehouse:'RJ'})[0],orders[4]);
});
test('filtros de dia, status, produto e unidade limitam também prioridades, detalhe e comparação',()=>{
 const filtered=[orders[2],orders[3]],model=build(filtered,[orders[2],orders[5]],['Cambuci']);
 assert.equal(model.total,2);assert.equal(model.qt,6.5);assert.equal(model.sent,0);assert.equal(model.lists.billing.length,1);
 assert.deepEqual(model.warehouses.map(r=>r.code),['Cambuci']);
 assert.deepEqual(selectionRows(model,{kind:'open'}),filtered);
 const changed=build([orders[3]],[],['Cambuci']);
 assert.equal(selectionRows(changed,{kind:'billing'}).length,0);
 assert.deepEqual(selectionRows(changed,{kind:'open'}),[orders[3]]);
 assert.equal(selectionRows(changed,{warehouse:'RJ'}).length,0);
});
test('base vazia não produz percentual fictício e leitura não altera pedidos nem arrays',()=>{
 const frozen=Object.freeze(orders.map(order=>Object.freeze({...order}))),model=build(frozen,[],['Cambuci']);
 assert.equal(model.total,frozen.length);assert.strictEqual(model.lists.all,frozen);
 const empty=build([],[],['Cambuci']);assert.equal(empty.sentRate,null);assert.equal(empty.qt,0);assert.equal(empty.warehouses[0].rate,null);
 assert.deepEqual(selectionRows(empty,{kind:'late'}),[]);
});
test('resumo mantém totais da classificação real e respeita Entrega no Cambuci',()=>{
 const source=fs.readFileSync(require.resolve('../bundle.js'),'utf8');
 const classification=source.slice(source.indexOf('function Wc('),source.indexOf('function Tr('));
 const classify=vm.runInNewContext(classification+';as',{ze:date=>date.toISOString().slice(0,10)});
 const base=[
  {key:'A',pedido:'10',armazem:'Cambuci',nf:'100',qt:5,pickEnd:new Date(),confEnd:new Date()},
  {key:'B',pedido:'11',armazem:'Cambuci',nf:'101',qt:7},
  {key:'C',pedido:'12',armazem:'RJ',nf:'102',qt:8}
 ];
 const classified=classify(base,new Date('2026-10-29'),new Set(['11']));
 const model=build(classified);assert.equal(model.sent,2);assert.equal(model.open,1);assert.equal(model.lists.dispatch[0].pedido,'10');
 const withoutDelivery=build(classify(base,new Date('2026-10-29'),null));assert.equal(withoutDelivery.sent,3);assert.equal(withoutDelivery.lists.dispatch.length,0);
});
test('integração passa o recorte real ao resumo e usa a lista paginada/exportável existente',()=>{
 const bundle=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),html=fs.readFileSync(require.resolve('../index.html'),'utf8'),server=fs.readFileSync(require.resolve('../server.js'),'utf8');
 const i=bundle.indexOf('React.createElement(window.SC9OperationOverview,');assert(i>0);
 const end=bundle.indexOf(',F&&',i);assert(end>i);
 let props;const render=vm.runInNewContext(bundle.slice(i,end-1),{React:{createElement:(component,value)=>{props=value;}},window:{SC9OperationOverview:'overview'},ae:orders,_e:[orders[2]],f:'RJ',p:{warehousesPresent:['Cambuci','RJ'],entregaPresent:true},lo:{},ye:'Rio de Janeiro',r:'2026-10-29',x:{day:null,status:null,item:null},J:{savedAt:'2026-10-29T12:00:00Z'},mt:()=>{},Ce:new Date('2026-10-29'),Ol:'orders'});
 assert.strictEqual(props.orders,orders);assert.deepEqual(Array.from(props.warehouses),['RJ']);assert.strictEqual(props.billingOrders[0],orders[2]);
 props.renderOrders([orders[4]],()=>{});assert.strictEqual(props.orders[0],orders[4]);
 assert(html.indexOf('/operation-overview.js')<html.indexOf('/bundle.js'));assert(server.includes('"operation-overview.js"'));
});
test('observações automáticas aguardam a base e usam o mesmo recorte do resumo',()=>{
 const bundle=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),start=bundle.indexOf('nt=(0,g.useMemo)(()=>'),end=bundle.indexOf(',Xa=',start);assert(start>0&&end>start);
 const expression=bundle.slice(start+3,end);let observed;
 const context={g:{useMemo:fn=>fn()},p:null,ae:[],f:'__ALL__',T:null,P:[],vt:[],Fl:rows=>rows,jc:rows=>rows,Yc:({ordersAll})=>ordersAll,_c:options=>{observed=options;return[];}};
 assert.deepEqual(Array.from(vm.runInNewContext(expression,context)),[]);assert.equal(observed,undefined);
 context.p={warehousesPresent:['RJ']};context.ae=[orders[4]];context.T={total:1};vm.runInNewContext(expression,context);
 assert.strictEqual(observed.view,context.T);assert.strictEqual(observed.trend,context.ae);assert.strictEqual(observed.compareRows,context.ae);assert.strictEqual(observed.heatmap,context.ae);
});

test('todos os cards de pedidos abrem uma única lista na página e Peças mantém seu atalho',()=>{
 let refs=[],refCursor=0,state=null,inlineRows,inlineSelection,opened,focused=0,items=0;const R={createElement:(type,props,...children)=>({type,props:{...props,children}}),useMemo:fn=>fn(),useState:()=>[state,value=>state=value],useRef:()=>{const index=refCursor++;return refs[index]||(refs[index]={current:null});},useEffect:()=>{}};
 const root={React:R,SC9UI:{Sheet:'sheet'}};vm.runInNewContext(fs.readFileSync(require.resolve('../operation-overview.js'),'utf8'),{window:root});
 function nodes(tree,predicate){const result=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))result.push(node);for(const child of [node.props?.children||[]].flat(Infinity))visit(child);}visit(tree);return result;}
 const props={orders,billingOrders:[orders[2]],warehouses:['Cambuci','RJ'],labels:{},scope:'Todos',cutoff:'2026-10-29',filters:[],onItems:()=>items++,onOpenOrder:order=>opened=order,renderOrders:(value,open,selection)=>{inlineRows=value;inlineSelection=selection;return R.createElement('button',{onClick:()=>open(value[0])},'Consultar timeline');}};
 const render=(overrides={})=>{refCursor=0;return root.SC9OperationOverview({...props,...overrides});},event={currentTarget:{focus(){focused++;}}},model=build(orders,[orders[2]],['Cambuci','RJ']);
 let out=render();assert.equal(nodes(out,node=>node.props.id==='sc9-overview-orders').length,0);
 for(const [prefix,kind] of [['Pedidos no recorte:','all'],['Atrasados:','late'],['Em aberto:','open'],['Enviados:','sent'],['Aguardando faturamento:','billing'],['Confirmar despacho:','dispatch']]){
  const card=nodes(out,node=>node.type==='button'&&node.props['aria-label']?.startsWith(prefix))[0];assert(card,prefix);card.props.onClick(event);out=render();
  assert.equal(inlineSelection.kind,kind);assert.deepEqual(Array.from(inlineRows),model.lists[kind]);assert.equal(nodes(out,node=>node.type==='sheet').length,0);assert.equal(nodes(out,node=>node.props.id==='sc9-overview-orders').length,1);
 }
 nodes(out,node=>node.type==='button'&&node.props.children.includes('Consultar timeline'))[0].props.onClick();assert.strictEqual(opened,orders[3]);
 nodes(out,node=>node.type==='button'&&node.props['aria-label']?.startsWith('Peças liberadas:'))[0].props.onClick(event);assert.equal(items,1);assert.equal(state.kind,'dispatch');
 nodes(out,node=>node.type==='button'&&node.props['aria-label']==='Consultar pedidos de RJ')[0].props.onClick(event);out=render();assert.deepEqual(Array.from(inlineRows),[orders[4],orders[5]]);assert.equal(inlineSelection.warehouse,'RJ');assert.equal(nodes(out,node=>node.type==='sheet').length,0);
 nodes(out,node=>node.type==='button'&&node.props.children.includes('Recolher lista'))[0].props.onClick();assert.equal(focused,1);assert.equal(state,null);
 out=render();const late=nodes(out,node=>node.type==='button'&&node.props['aria-label']?.startsWith('Atrasados:'))[0];assert.match(late.props['aria-label'],/^Atrasados: 1\./);late.props.onClick(event);out=render({orders:[orders[3]],billingOrders:[]});assert.match(JSON.stringify(out),/Nenhum pedido atrasado em separação/);
 out=render();nodes(out,node=>node.type==='button'&&node.props['aria-label']?.startsWith('Atrasados:'))[0].props.onClick(event);assert.equal(state,null);
});

test('listas dos indicadores usam tabela original paginada, seleção correta e chave que reinicia o recorte',()=>{
 const s=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),a=s.indexOf('React.createElement(window.SC9OperationOverview,'),b=s.indexOf(',F&&',a);let captured,tableProps,items=0,detail='aberto';
 const h=(component,props)=>{if(component==='overview')captured=props;else tableProps=props;};
 vm.runInNewContext(s.slice(a,b-1),{React:{createElement:h},window:{SC9OperationOverview:'overview'},ae:orders,_e:[orders[2]],f:'RJ',p:{warehousesPresent:['Cambuci','RJ'],entregaPresent:true},lo:{},ye:'Rio de Janeiro',r:'2026-10-29',x:{day:'2026-10-28',status:'Atrasado',item:null},J:{savedAt:'data'},mt:()=>{},Ce:new Date('2026-10-29'),Ol:'original-table',Q:value=>detail=value,H:value=>items=value});
 const open=()=>{};captured.renderOrders([orders[1]],open,{kind:'late',title:'Atrasados'});assert.strictEqual(tableProps.orders[0],orders[1]);assert.strictEqual(tableProps.onOpenOrder,open);assert.equal(tableProps.showDelay,true);assert.equal(tableProps.quantityFmt(2.125),'2,125');const lateKey=tableProps.key;
 captured.renderOrders([orders[0]],open,{kind:'sent',title:'Enviados'});assert.equal(tableProps.title,'Enviados');assert.equal(tableProps.showDelay,false);assert.notEqual(tableProps.key,lateKey);const sentKey=tableProps.key;
 captured.renderOrders([orders[0],orders[5]],open,{kind:'sent',title:'Enviados'});assert.notEqual(tableProps.key,sentKey);captured.onItems();assert.equal(items,'itens');assert.equal(detail,null);
 const table=s.slice(s.indexOf('function Ol('),s.indexOf('function ',s.indexOf('function Ol(')+12));assert(table.includes('onClick:()=>Fr(E,a,o)'));assert(table.includes('p=50'));assert(table.includes('f=E.slice(d*p,(d+1)*p)'));
});
