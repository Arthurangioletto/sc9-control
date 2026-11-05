const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),M=require('../receiving-control.js'),crypto=require('node:crypto');
function nodes(tree,predicate){const found=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))found.push(node);for(const child of(node.children||[]).flat(Infinity))visit(child);}visit(tree);return found;}
function setup({failFirst=false,data={rows:[],excess:[],sd3:{coverage:[]}}}={}){
 const states=[],refs=[],requests=[];let cursor=0,refCursor=0;const R={createElement:(type,props,...children)=>({type,props:props||{},children}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:initial=>{const i=refCursor++;return refs[i]||(refs[i]={current:initial});},useEffect:()=>{}};
 const root={React:R,SC9Receiving:M,crypto:{randomUUID:crypto.randomUUID}},fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);if(failFirst&&requests.length===1)return{ok:false,status:500,json:async()=>({error:'Falha temporária'})};return{ok:true,json:async()=>data};};vm.runInNewContext(fs.readFileSync(require.resolve('../receiving-ui.js'),'utf8'),{window:root,fetch});
 states[0]=data;return {states,requests,render:(props={})=>{cursor=refCursor=0;return root.SC9ReceiptControl({isAdmin:false,authInfo:{usuario:'pessoa'},parseLot:raw=>({lote:raw.replace('LOTE:','').trim()}),...props});}};
}
test('formulário registra diretamente lote e quantidade, mantém o identificador ao tentar novamente e preserva histórico antigo',async()=>{
 const env=setup({failFirst:true}),legacy=[{id:'antigo',lote:'ANT',qtdEnviada:4,qtdRecebida:4,status:'confirmado'}],before=structuredClone(legacy);let tree=env.render({legacyRecords:legacy});assert(!JSON.stringify(tree).includes('Registrar entrega'));assert(JSON.stringify(tree).includes('Histórico do processo anterior (1)'));assert(!JSON.stringify(tree).includes('Importar SD3 completo'));
 const inputs=()=>nodes(tree,n=>n.type==='input');inputs().find(n=>n.props.placeholder==='Bipe ou digite o lote').props.onChange({target:{value:'LOTE: 123'}});tree=env.render();inputs().find(n=>n.props.type==='number').props.onChange({target:{value:'2.125'}});tree=env.render();await nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});tree=env.render();assert(JSON.stringify(tree).includes('Falha temporária'));assert.equal(inputs().find(n=>n.props.type==='number').props.value,'2.125');
 await nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});tree=env.render();assert.equal(env.requests.length,2);assert.equal(env.requests[0].id,env.requests[1].id);assert.equal(env.requests[0].acao,'receber');assert.equal(env.requests[0].quantidade,2.125);assert.equal(env.requests[0].lote,'123');assert.equal(env.requests[0].filial,'01');assert.equal(inputs().find(n=>n.props.type==='number').props.value,'');assert.deepEqual(legacy,before);
});
test('histórico novo é paginado e importação fica somente no administrador',()=>{
 const rows=Array.from({length:55},(_,i)=>({id:String(i),filial:'01',lote:'L'+i,quantidade:1,status:'aguardando_sd3',createdAt:'2026-11-05T12:00:00Z',createdBy:'pessoa',createdByName:'Pessoa',missing:1,allocated:0,docs:[],issues:[]})),env=setup({data:{rows,excess:[],sd3:{coverage:[]}}});let tree=env.render();assert.equal(nodes(tree,n=>n.type==='article').length,50);const pager=nodes(tree,n=>typeof n.type==='function'&&n.type.name==='Pager')[0];assert.equal(pager.props.total,2);pager.props.onPage(1);tree=env.render();assert.equal(nodes(tree,n=>n.type==='article').length,5);assert(JSON.stringify(env.render({isAdmin:true})).includes('Importar SD3 completo do período'));
});
test('exportação inclui todo o recorte, independente da página, e conserva o histórico antigo',()=>{
 const rows=Array.from({length:55},(_,i)=>({id:String(i),filial:'01',lote:'L'+i,quantidade:.125,status:'aguardando_sd3',createdAt:'2026-11-05T12:00:00Z',missing:.125,allocated:0,docs:[],issues:[]})),env=setup({data:{rows,excess:[],sd3:{coverage:[]}}});let exported;const legacy=[{id:'anterior',lote:'L0',validacao:{status:'preservado'}}],tree=env.render({legacyRecords:legacy,exportWorkbook:(sheets,name)=>exported={sheets,name}});
 nodes(tree,n=>n.type==='button'&&n.children.includes('Exportar recebimentos do recorte'))[0].props.onClick();assert.equal(exported.sheets[0].rows.length,55);assert.equal(exported.sheets[0].rows[0].Recebida,.125);
 nodes(tree,n=>n.type==='button'&&n.children.includes('Exportar histórico anterior'))[0].props.onClick();assert.equal(exported.sheets[0].rows.length,1);assert.equal(exported.sheets[0].rows[0].validacao,'{"status":"preservado"}');
});

test('visão de gestão calcula conciliação por registro ativo da filial, sem misturar cancelamentos e filtros do histórico',()=>{
 const make=(id,status,filial='01',extra={})=>({id,filial,lote:'L'+id,quantidade:10,status,createdAt:'2026-11-05T12:00:00Z',docs:[],issues:[],...extra});
 const rows=[make('1','conferido'),make('2','conferido'),make('3','divergente'),make('4','aguardando_sd3'),make('5','produto_ambiguo','01',{candidates:['A','B']}),make('6','cancelado','01',{cancelledAt:'2026-11-05T13:00:00Z'}),make('7','conferido','02')],env=setup({data:{rows,excess:[],sd3:{coverage:[]}}});
 let tree=env.render();assert.equal(nodes(tree,n=>n.props.className==='sc9-receiving-rate')[0].children[0],'40%');
 assert(JSON.stringify(tree).includes('2 de 5 recebimentos ativos conferidos'));
 const track=nodes(tree,n=>n.props.className==='sc9-receiving-track')[0];assert.equal(track.children.flat().reduce((sum,n)=>sum+parseFloat(n.props.style.width),0),100);
 const priorities=nodes(tree,n=>n.type==='button'&&n.props.className==='sc9-receiving-priority divergente');priorities[0].props.onClick();tree=env.render();assert.equal(nodes(tree,n=>n.type==='article').length,1);assert.equal(nodes(tree,n=>n.props.className==='sc9-receiving-rate')[0].children[0],'40%');
 const sections=tree.children.flat().filter(n=>n&&n.type==='section');assert(sections.findIndex(n=>n.props['aria-label']==='Visão de gestão dos recebimentos')<sections.findIndex(n=>n.props['aria-label']==='Registrar recebimento no armazém 01'));
});

test('visão de gestão sem registros ativos não divide por zero',()=>{
 const env=setup();const tree=env.render();assert.equal(nodes(tree,n=>n.props.className==='sc9-receiving-rate')[0].children[0],'0%');assert.equal(nodes(tree,n=>n.props.className==='sc9-receiving-track').length,0);assert(JSON.stringify(tree).includes('Sem recebimentos ativos nesta filial.'));
});
