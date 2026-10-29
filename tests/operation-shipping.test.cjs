const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {build}=require('../operation-shipping.js');
const source=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),start=source.indexOf('function Vc('),end=source.indexOf('function Hc(',start);
const compare=vm.runInNewContext(source.slice(start,end)+';Vc',{so:60000,Le:value=>String(value).trim(),an:()=>null});
const date=hour=>new Date('2026-10-29T'+hour+':00:00Z');
const orders=[
 {pedido:'1',armazem:'Cambuci',confEnd:date('10'),nf:'N1',qt:2.5},
 {pedido:'1',armazem:'RJ',confEnd:date('10'),nf:'N2',qt:4},
 {pedido:'2',armazem:'Cambuci',confEnd:date('10'),nf:'N3',qt:7},
 {pedido:'3',armazem:'Cambuci',confEnd:date('10'),nf:'',qt:3},
 {pedido:'4',armazem:'Cambuci',confEnd:null,nf:'N4',qt:8}
];
const billing=new Map([['N1',date('11')],['N2',date('09')],['N3',date('12')]]),delivery=new Map([['1',1]]);
test('indicadores preservam os critérios reais e associam o detalhe ao pedido e armazém corretos',()=>{
 const comparison=compare(orders,billing,delivery),model=build(comparison,orders);
 assert.equal(model.lists.conferred.length,comparison.totalConferidos);assert.equal(model.lists.invoiced.length,comparison.totalFaturados);assert.equal(model.lists.delivered.length,comparison.totalDespachados);
 assert.equal(model.quantity('conferred'),16.5);assert.equal(model.lists.invoiced.length,3);assert.equal(model.lists.delivered.length,2);
 assert.strictEqual(model.lists.delivered[0],orders[0]);assert.strictEqual(model.lists.delivered[1],orders[1]);
 assert.strictEqual(model.lists.awaiting[0],orders[2]);assert.equal(model.lists.awaiting.length,1);assert.equal(model.meanMinutes,60);
 assert.deepEqual(model.lists.earlier,[orders[1]]);
});
test('fonte ausente permanece indisponível enquanto fonte disponível sem correspondência conta zero',()=>{
 const noBilling=build(compare(orders,null,delivery),orders);assert.equal(noBilling.lists.invoiced,null);assert.equal(noBilling.lists.awaiting,null);assert.equal(noBilling.quantity('invoiced'),null);assert.equal(noBilling.lists.conferred.length,4);assert.equal(noBilling.lists.delivered.length,2);
 const noDelivery=build(compare(orders,billing,null),orders);assert.equal(noDelivery.lists.delivered,null);assert.equal(noDelivery.lists.awaiting,null);assert.equal(noDelivery.lists.invoiced.length,3);
 const empty=build(compare(orders,new Map(),new Map()),orders);assert.equal(empty.lists.invoiced.length,0);assert.equal(empty.lists.delivered.length,0);assert.equal(empty.meanMinutes,null);
});
test('recorte limita todos os grupos e preserva os registros originais sem mutação',()=>{
 const frozen=Object.freeze(orders.map(order=>Object.freeze({...order}))),filtered=[frozen[1]],model=build(compare(filtered,billing,delivery),filtered);
 assert.deepEqual(model.lists.conferred,filtered);assert.strictEqual(model.lists.delivered[0],frozen[1]);assert.equal(model.quantity('conferred'),4);assert.equal(model.lists.awaiting.length,0);
 const stale=build(compare(orders,billing,delivery),filtered);assert.deepEqual(stale.lists.conferred,filtered);
 const zero=build(compare([],billing,delivery),[]);assert.equal(zero.lists.conferred.length,0);assert.equal(zero.meanMinutes,null);
});
test('tela passa os filtros reais e reutiliza a lista com exportação e quantidades decimais',()=>{
 const a=source.indexOf('React.createElement(window.SC9OperationShipping,'),b=source.indexOf(',qe.present?',a);assert(a>0&&b>a);
 let props,selected,state={day:null,status:'Atrasado',item:'P1'};
 vm.runInNewContext(source.slice(a,b),{React:{createElement:(type,value)=>{props=value;}},window:{SC9OperationShipping:'shipping'},qe:compare(orders,billing,delivery),ae:orders,ye:'Rio de Janeiro',f:'RJ',p:{warehousesPresent:['Cambuci','RJ']},lo:{},r:'2026-10-29',x:state,ys:()=> 'Produto teste',J:{savedAt:'2026-10-29T12:00:00Z'},b:value=>{selected=value;},Q:()=>{},o:()=>{},R:fn=>{state=fn(state);},el:()=>{},mt:()=>{},Ol:'table',Ce:date('12')});
 assert.strictEqual(props.orders,orders);assert.equal(props.filters.status,'Atrasado');props.onWarehouse('Cambuci');assert.equal(selected,'Cambuci');assert.equal(state.item,'P1');
 props.onFilter('status','');assert.equal(state.status,null);assert.equal(state.item,'P1');props.renderOrders([orders[0]],()=>{});assert.strictEqual(props.orders[0],orders[0]);assert.equal(props.quantityFmt(2.5),'2,5');
});
test('comparação, gráficos e ativos da Expedição usam a mesma base filtrada',()=>{
 const a=source.indexOf('qe=(0,g.useMemo)'),b=source.indexOf(',Dt=',a);assert(a>0&&b>a);let received;
 const result=vm.runInNewContext(source.slice(a+3,b),{g:{useMemo:fn=>fn()},Vc:(rows)=>{received=rows;return 'comparison';},ae:[orders[2]],p:{}});assert.equal(result,'comparison');assert.strictEqual(received[0],orders[2]);
 const block=source.slice(source.indexOf('!F&&D==="expedicao"'),source.indexOf('!F&&D==="movimentacao"'));assert(block.includes('data:Uc(ae,p?.valores,p?.faturamento)'));
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8');assert(html.indexOf('/operation-flow.js')<html.indexOf('/operation-shipping.js'));assert(html.indexOf('/operation-shipping.js')<html.indexOf('/bundle.js'));
});
test('sem SF2 e Entrega a interface mantém conferidos e desabilita os indicadores indisponíveis',()=>{
 const root={React:{createElement:(type,props,...children)=>({type,props:props||{},children}),useMemo:fn=>fn(),useState:()=>[null,()=>{}]}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../operation-shipping.js'),'utf8'),{window:root});
 const tree=root.SC9OperationShipping({comparison:compare(orders,null,null),orders,scope:'Todos',warehouse:'__ALL__',warehouses:[],labels:{},cutoff:'2026-10-29',filters:{}}),cards=[];
 function visit(node){if(!node||typeof node!=='object')return;if(node.props?.className?.includes('sc9-overview-metric')&&node.type==='button')cards.push(node);for(const child of(node.children||[]).flat(Infinity))visit(child);}visit(tree);
 assert.equal(cards.length,4);assert.equal(cards[0].props.disabled,false);assert.equal(cards[0].props['aria-label'],'Conferência finalizada: 4 pedidos');
 for(const card of cards.slice(1)){assert.equal(card.props.disabled,true);assert.match(card.props['aria-label'],/dado indisponível/);}
});
test('timeline distingue nota existente sem confirmação de despacho de pedido ainda sem nota',()=>{
 const a=source.indexOf('function Od('),b=source.indexOf('function ',a+10);assert(a>0&&b>a);
 const timeline=vm.runInNewContext(source.slice(a,b)+';Od',{React:{createElement:(tag,props,...children)=>({tag,children})},e:{},ea:()=>'',zt:()=>''});
 const invoiced=JSON.stringify(timeline({order:{status:'Pendente',nf:'N1',faturadoSemDespacho:true}}));assert.match(invoiced,/com nota fiscal/);assert.match(invoiced,/Sem confirmação na Entrega/);assert.doesNotMatch(invoiced,/sem nota fiscal ainda/);
 const pending=JSON.stringify(timeline({order:{status:'Pendente',nf:null}}));assert.match(pending,/sem nota fiscal ainda/);assert.doesNotMatch(pending,/Sem confirmação na Entrega/);
});
