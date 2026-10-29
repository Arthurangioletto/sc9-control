const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {build,elapsed,selectionRows}=require('../operation-flow.js');
const reference='2026-10-29T12:00:00Z';
const orders=[
 {key:'Cambuci|1',pedido:'1',armazem:'Cambuci',qt:10,status:'Pendente',dtLiberacaoHora:'2026-10-29T10:00:00Z'},
 {key:'Cambuci|2',pedido:'2',armazem:'Cambuci',qt:2.5,status:'Atrasado',pickEnd:'2026-10-29T09:00:00Z'},
 {key:'Cambuci|3',pedido:'3',armazem:'Cambuci',qt:4,status:'Atrasado',pickEnd:'2026-10-29T08:00:00Z',confEnd:'2026-10-29T11:00:00Z',conferente:'Ana'},
 {key:'Cambuci|4',pedido:'4',armazem:'Cambuci',qt:7,status:'Pendente',nf:'100',faturadoSemDespachoProntoFisico:true,pickEnd:'2026-10-29T08:00:00Z',confEnd:'2026-10-29T10:00:00Z',conferente:'Ana'},
 {key:'RJ|1',pedido:'1',armazem:'RJ',qt:6,status:'Enviado',nf:'101',conferente:'0'},
 {key:'RJ|5',pedido:'5',armazem:'RJ',qt:3,status:'Pendente',dt:'2026-10-28T00:00:00Z'}
];
test('filas reconciliam todos os abertos uma vez e preservam identidade, quantidade decimal e armazém',()=>{
 const model=build(orders,[orders[2]],reference),pending=model.queues.flatMap(queue=>queue.rows);
 assert.equal(model.total,6);assert.equal(model.sent,1);assert.equal(model.open,5);assert.equal(pending.length,5);
 assert.equal(new Set(pending.map(order=>order.key)).size,5);assert.equal(model.queues.reduce((sum,q)=>sum+q.qt,0),26.5);
 assert.deepEqual(model.largest,['separation']);assert.equal(selectionRows(model,'conference')[0].qt,2.5);
 assert.strictEqual(selectionRows(model,'billing')[0],orders[2]);assert(!pending.includes(orders[4]));
});
test('etapas independentes mantêm os critérios reais do fluxo anterior, mesmo sem sequência completa',()=>{
 const bundle=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),start=bundle.indexOf('function Kc('),end=bundle.indexOf('function Gc(',start);
 const original=vm.runInNewContext(bundle.slice(start,end)+';Kc')(orders),model=build(orders,[],reference);
 assert.deepEqual(model.milestones.map(stage=>stage.rows.length),Array.from(original.stages,stage=>stage.count));
 assert.equal(model.milestones[3].rows.length,2);assert(model.milestones[3].rows.includes(orders[4]));assert(!model.milestones[1].rows.includes(orders[4]));
 assert.equal(model.milestones[2].rows.length,2);assert.equal(model.milestones[0].qt,32.5);
});
test('tempos usam registro válido até a data da base e excluem dias sem hora, ausências e datas futuras',()=>{
 assert.equal(elapsed(orders[0],'separation',reference),120);assert.equal(elapsed(orders[1],'conference',reference),180);
 assert.equal(elapsed(orders[2],'billing',reference),60);assert.equal(elapsed(orders[3],'dispatch',reference),120);
 assert.equal(elapsed(orders[5],'separation',reference),null);
 assert.equal(elapsed({pickStart:'inválido'},'separation',reference),null);
 assert.equal(elapsed({pickStart:'2026-10-30T00:00:00Z'},'separation',reference),null);
 assert.equal(elapsed(orders[0],'separation',null),null);
 const queue=build(orders,[orders[2]],reference).queues[0];assert.equal(queue.timed,1);assert.equal(queue.rows.length,2);assert.equal(queue.meanMinutes,120);assert.equal(queue.maxMinutes,120);
});
test('recorte atualizado limita etapas, filas e detalhe sem copiar ou alterar registros',()=>{
 const frozen=Object.freeze(orders.map(order=>Object.freeze({...order}))),model=build([frozen[4],frozen[5]],[frozen[2]],reference);
 assert.equal(model.total,2);assert.equal(model.open,1);assert.equal(selectionRows(model,'billing').length,0);
 assert.strictEqual(selectionRows(model,'separation')[0],frozen[5]);assert.equal(selectionRows(build([],[],reference),'separation').length,0);
 assert.equal(build([],[],reference).largest.length,0);assert.equal(build(orders,[],null).queues.every(q=>q.meanMinutes===null),true);
 const tied=build(orders.slice(0,4),[orders[2]],reference);assert.equal(tied.largest.length,4);
});
test('ponte da tela usa os pedidos filtrados, preserva os filtros e reutiliza tabela com exportação',()=>{
 const bundle=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),start=bundle.indexOf('React.createElement(window.SC9OperationFlow,'),end=bundle.indexOf(',!F&&D==="expedicao"',start);assert(start>0&&end>start);
 let props,navigated,state={day:'2026-10-29',status:'Pendente',item:'P1'};
 vm.runInNewContext(bundle.slice(start,end),{React:{createElement:(type,value)=>{props=value;}},window:{SC9OperationFlow:'flow'},ae:orders,_e:[orders[2]],J:{savedAt:reference},ye:'Rio de Janeiro',f:'RJ',p:{warehousesPresent:['Cambuci','RJ']},lo:{},r:'2026-10-29',x:state,ys:()=> 'Produto teste',b:code=>{navigated=code;},Q:()=>{},o:()=>{},R:fn=>{state=fn(state);},el:()=>{},mt:()=>{},Ol:'table',Ce:new Date(reference)});
 assert.strictEqual(props.orders,orders);assert.equal(props.reference,reference);assert.equal(props.warehouse,'RJ');
 props.onWarehouse('Cambuci');assert.equal(navigated,'Cambuci');assert.equal(state.item,'P1');
 props.onFilter('day','');assert.equal(state.day,null);assert.equal(state.status,'Pendente');assert.equal(state.item,'P1');
 props.renderOrders([orders[1]],()=>{});assert.strictEqual(props.orders[0],orders[1]);assert.equal(props.quantityFmt(2.5),'2,5');
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8');assert(html.indexOf('/operation-flow.js')<html.indexOf('/bundle.js'));
});
test('campos de data aplicam a edição imediatamente e corte vazio não altera a classificação',()=>{
 const changes=[],root={React:{createElement:(type,props,...children)=>({type,props:props||{},children}),useMemo:fn=>fn(),useState:()=>[null,()=>{}]}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../operation-flow.js'),'utf8'),{window:root});
 const tree=root.SC9OperationFlow({orders:[],billingOrders:[],reference:null,scope:'Todos',warehouse:'__ALL__',warehouses:[],labels:{},cutoff:'2026-10-29',filters:{},onCutoff:value=>changes.push(['cutoff',value]),onFilter:(key,value)=>changes.push([key,value])});
 const inputs=[];function visit(node){if(!node||typeof node!=='object')return;if(node.type==='input')inputs.push(node);for(const child of(node.children||[]).flat(Infinity))visit(child);}visit(tree);
 const cutoff=inputs.find(node=>node.props['aria-label']==='Data de corte'),day=inputs.find(node=>node.props['aria-label']==='Dia de liberação');
 cutoff.props.onInput({target:{value:''}});cutoff.props.onChange({target:{value:''}});assert.equal(changes.length,0);
 cutoff.props.onInput({target:{value:'2026-10-30'}});day.props.onInput({target:{value:'2026-10-28'}});day.props.onChange({target:{value:''}});
 assert.deepEqual(changes,[['cutoff','2026-10-30'],['day','2026-10-28'],['day','']]);
});
