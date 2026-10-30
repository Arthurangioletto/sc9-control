const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../bundle.js'),'utf8');
const h=(type,props,...children)=>({type,props:{...props,children}});
function nodes(tree,predicate){const result=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))result.push(node);for(const child of [node.props?.children||[]].flat(Infinity))visit(child);}visit(tree);return result;}
test('número do pedido abre o registro original uma vez e a tabela conserva 50 linhas por página',()=>{
 const a=source.indexOf('function Ol('),b=source.indexOf('function ',a+12),context={React:{createElement:h},g:{useState:value=>[value,()=>{}],useMemo:fn=>fn()},W:'panel',Zt:'export',Fd:[],e:{},k:String,ea:()=>'',zt:()=>'',Yl:{}};
 vm.runInNewContext(source.slice(a,b),context);const orders=Array.from({length:55},(_,i)=>({key:'CB|'+i,pedido:String(900000+i),armazem:'Cambuci',qt:2.125,itens:1})),seen=[];
 const tree=context.Ol({orders,title:'Pedidos',onOpenOrder:order=>seen.push(order)}),buttons=nodes(tree,node=>node.props.className==='sc9-order-link');assert.equal(buttons.length,50);
 assert.equal(buttons[0].type,'button');assert.equal(buttons[0].props.type,'button');assert.equal(buttons[0].props['aria-label'],'Ver detalhes do pedido 900000 em Cambuci');let stopped=0;buttons[0].props.onClick({stopPropagation(){stopped++;}});assert.equal(stopped,1);assert.equal(seen.length,1);assert.strictEqual(seen[0],orders[0]);
 const readonly=context.Ol({orders:[orders[0]],title:'Somente leitura'});assert.equal(nodes(readonly,node=>node.props.className==='sc9-order-link').length,0);
});
test('timeline original usa detalhes na página, com foco, rolagem, Escape e retorno ao pedido',()=>{
 const a=source.indexOf('F.type==="timeline"&&React.createElement(window.SC9UI.InlineDetails,'),b=source.indexOf(',F.type===',a+1);assert(a>0&&b>a);const order={key:'CB|900001',pedido:'900001',armazem:'Cambuci',nome:'Cliente teste'};let closed=0;
 const tree=vm.runInNewContext(source.slice(a,b),{F:{type:'timeline',order},React:{createElement:h},window:{SC9UI:{InlineDetails:'inline'}},ft:()=>closed++,Od:'original-timeline'});assert.equal(tree.type,'inline');assert.equal(tree.props.showListHelp,false);assert.equal(tree.props.closeLabel,'Voltar à lista de pedidos');assert.strictEqual(tree.props.children[0].props.order,order);tree.props.onClose();assert.equal(closed,1);
 let effect,scrolled=0,focused=0,restored=0;const trigger={isConnected:true,focus(){restored++;}},document={activeElement:trigger,body:{style:{overflow:'auto'}}},section={scrollIntoView(){scrolled++;},focus(){focused++;document.activeElement=section;},contains:node=>node===section};
 const root={document,React:{createElement:h,useRef:()=>({current:section}),useId:()=> 'order-detail',useEffect:fn=>effect=fn}};vm.runInNewContext(fs.readFileSync(require.resolve('../navigation.js'),'utf8'),{window:root});const rendered=root.SC9UI.InlineDetails(tree.props),cleanup=effect();assert.equal(scrolled,1);assert.equal(focused,1);assert.equal(document.body.style.overflow,'auto');assert.equal(nodes(rendered,node=>node.props.className==='sc9-inline-details-help').length,0);
 rendered.props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(closed,2);cleanup();assert.equal(restored,1);
});
