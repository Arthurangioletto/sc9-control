const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('painel lateral abre como modal, trata Escape e restaura foco e rolagem ao fechar',()=>{
 let effect,closed=0,restored=0,prevented=0;
 const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
 const h=(type,props,...children)=>({type,props:{...props,children}}),body={style:{overflow:'auto'}};
 const root={React:{createElement:h,useRef:()=>({current:dialog}),useId:()=> 'sheet-test',useEffect:fn=>effect=fn},document:{body,activeElement:{isConnected:true,focus(){restored++;}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','navigation.js'),'utf8'),{window:root,React:root.React});
 const output=root.SC9UI.Sheet({title:'Produto',subtitle:'Ficha do produto 23693',children:'Dados preservados',onClose:()=>closed++});
 assert.equal(output.type,'dialog');assert.equal(output.props['aria-labelledby'],'sheet-test');
 const cleanup=effect();assert.equal(dialog.open,true);assert.equal(body.style.overflow,'hidden');
 const first={getClientRects:()=>[1],closest:()=>null,focus(){root.document.activeElement=this;}},last={getClientRects:()=>[1],closest:()=>null,focus(){root.document.activeElement=this;}};
 dialog.querySelectorAll=()=>[first,last];root.document.activeElement=first;
 output.props.onKeyDown({key:'Tab',shiftKey:true,currentTarget:dialog,preventDefault(){prevented++;}});assert.strictEqual(root.document.activeElement,last);
 output.props.onKeyDown({key:'Tab',shiftKey:false,currentTarget:dialog,preventDefault(){prevented++;}});assert.strictEqual(root.document.activeElement,first);
 output.props.onClick({target:{tagName:'BUTTON'},currentTarget:dialog,clientX:0,clientY:0});assert.equal(closed,0);
 output.props.onCancel({preventDefault(){prevented++;}});assert.equal(closed,1);assert.equal(prevented,3);
 cleanup();assert.equal(dialog.open,false);assert.equal(body.style.overflow,'auto');assert.equal(restored,1);
});
test('ficha lateral usa os registros atuais e as ações do lote, sem criar cópias para editar',()=>{
 const h=(type,props,...children)=>({type,props:{...props,children}}),root={React:{createElement:h},SC9UI:{Sheet:()=>{}},SC9Paging:{List:()=>{}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','expiry-panel.js'),'utf8'),{window:root});
 const items=[{produto:'23693',lote:'L',filial:'1',armazem:'RJ',saldo:2,expiredDays:5,dtValidade:'2026-10-24'}],snapshot=JSON.stringify(items),actions=h('input',{value:'Nota original'});
 const output=root.SC9Expiry.ProductDrawer({product:'23693',description:'FRESA',items,target:'L',filters:['RJ + RT'],position:null,onClose:()=>{},renderActions:()=>actions});
 const section=output.props.children[2],list=section.props.children[1];assert.strictEqual(list.props.items,items);assert.equal(list.props.target,'L');
 const rendered=list.props.renderItem(items[0],0);assert.strictEqual(rendered.props.children[3].props.children[0],actions);assert.equal(rendered.props['data-sc9lote'],'L');assert.equal(JSON.stringify(items),snapshot);
});

test('consulta operacional permanece na página, permite Escape e restaura foco sem bloquear a rolagem',()=>{
 let effect,closed=0,focused=0,scrolled=0,restored=0,stopped=0;const previous={isConnected:true,focus(){restored++;}},body={style:{overflow:'auto'}},document={body,activeElement:previous};
 const section={contains:node=>node===section,focus(){focused++;document.activeElement=section;},scrollIntoView(){scrolled++;}};
 const R={createElement:(type,props,...children)=>({type,props:{...props,children}}),useRef:()=>({current:section}),useId:()=> 'inline-id',useEffect:fn=>effect=fn};const root={React:R,document};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','navigation.js'),'utf8'),{window:root});const tree=root.SC9UI.InlineDetails({title:'Fila de pedidos',subtitle:'Recorte atual',children:'Tabela original',onClose:()=>closed++});
 assert.equal(tree.type,'section');assert.equal(tree.props.className,'sc9-inline-details');assert.equal(tree.props['aria-labelledby'],'inline-id');const cleanup=effect();assert.equal(scrolled,1);assert.equal(focused,1);assert.equal(body.style.overflow,'auto');
 tree.props.onKeyDown({key:'Tab'});assert.equal(closed,0);tree.props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){stopped++;}});assert.equal(closed,1);assert.equal(stopped,1);cleanup();assert.equal(restored,1);assert.equal(body.style.overflow,'auto');
 document.activeElement=previous;const cleanupAgain=effect();document.activeElement={outside:true};cleanupAgain();assert.equal(restored,1);
});

test('Fluxo e Expedição usam consulta na página com registros originais, chave de paginação e timeline',()=>{
 const orders=[{key:'CB|1',pedido:'1',armazem:'Cambuci',qt:2.5,status:'Pendente',pickEnd:new Date('2026-10-29T10:00:00Z'),confEnd:new Date('2026-10-29T11:00:00Z')},{key:'RJ|1',pedido:'1',armazem:'RJ',qt:4,status:'Enviado',pickEnd:new Date('2026-10-29T10:00:00Z'),confEnd:new Date('2026-10-29T11:00:00Z')}];
 function nodes(tree,predicate){const result=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))result.push(node);for(const child of [node.props?.children||[]].flat(Infinity))visit(child);}visit(tree);return result;}
 for(const [file,name,cardClass] of [['operation-flow.js','SC9OperationFlow','sc9-flow-milestone'],['operation-shipping.js','SC9OperationShipping','sc9-overview-metric']]){
  let selection=null,received,open,metadata,opened;const R={createElement:(type,props,...children)=>({type,props:{...props,children}}),useMemo:fn=>fn(),useState:()=>[selection,value=>selection=value]};const root={React:R,SC9UI:{InlineDetails:'inline',Sheet:'sheet'},SC9FlowModel:{duration:()=> '0 min'}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{window:root});
  const props={orders,billingOrders:[],comparison:{rows:orders.map(order=>({...order,confParaFatMin:0,despachado:false})),present:true,totalDespachados:0,mediaMin:0},scope:'Todos',warehouse:'__ALL__',warehouses:[],labels:{},cutoff:'2026-10-29',filters:{},onOpenOrder:row=>opened=row,renderOrders:(rows,callback,details)=>{received=rows;open=callback;metadata=details;return 'Tabela original';}};
  let tree=root[name](props),cards=nodes(tree,node=>node.type==='button'&&node.props.className?.includes(cardClass));cards[0].props.onClick();tree=root[name](props);
  assert.equal(nodes(tree,node=>node.type==='sheet').length,0);assert.equal(nodes(tree,node=>node.type==='inline').length,1);assert.strictEqual(received[0],orders[0]);assert.strictEqual(received[1],orders[1]);const key=metadata.key;
  cards=nodes(tree,node=>node.type==='button'&&node.props.className?.includes(cardClass));cards[1].props.onClick();tree=root[name](props);assert.notEqual(metadata.key,key);const filteredKey=metadata.key;
  root[name]({...props,scope:'RJ',orders:[orders[1]]});assert.notEqual(metadata.key,filteredKey);assert.strictEqual(received[0],orders[1]);open(orders[1]);assert.strictEqual(opened,orders[1]);assert.equal(selection,null);
  tree=root[name](props);cards=nodes(tree,node=>node.type==='button'&&node.props.className?.includes(cardClass));cards[0].props.onClick();tree=root[name](props);nodes(tree,node=>node.type==='button'&&node.props.className?.includes(cardClass))[0].props.onClick();assert.equal(selection,null);
 }
});

test('somente a ficha do produto conserva o painel lateral e as tabelas operacionais mantêm a paginação original',()=>{
 const root=path.resolve(__dirname,'..');for(const file of fs.readdirSync(root).filter(file=>file.endsWith('.js')&&!['navigation.js','expiry-panel.js'].includes(file)))assert(!fs.readFileSync(path.join(root,file),'utf8').includes('SC9UI.Sheet'),file);
 const s=fs.readFileSync(path.join(root,'bundle.js'),'utf8');for(const component of ['SC9OperationFlow','SC9OperationShipping']){const a=s.indexOf('React.createElement(window.'+component+','),b=s.indexOf('onOpenOrder:sc9Open})',a),part=s.slice(a,b);assert(part.includes('renderOrders:(sc9Rows,sc9Open,sc9Details)=>React.createElement(Ol,{key:sc9Details?.key,orders:sc9Rows,'));}
 assert(s.includes('p=50,E=(0,g.useMemo)'));assert(fs.readFileSync(path.join(root,'expiry-panel.js'),'utf8').includes('h(root.SC9UI.Sheet,'));
});
