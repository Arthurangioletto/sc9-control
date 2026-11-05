const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),M=require('../receiving-control.js'),crypto=require('node:crypto');
function nodes(tree,predicate){const found=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))found.push(node);for(const child of(node.children||[]).flat(Infinity))visit(child);}visit(tree);return found;}
function setup({failFirst=false,data={rows:[],excess:[],sd3:{coverage:[]}},now='2026-11-05T15:00:00Z',responseData}={}){
 const states=[],refs=[],requests=[];let cursor=0,refCursor=0;const R={createElement:(type,props,...children)=>({type,props:props||{},children}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:initial=>{const i=refCursor++;return refs[i]||(refs[i]={current:initial});},useEffect:()=>{}};
 const root={React:R,SC9Receiving:M,crypto:{randomUUID:crypto.randomUUID}},fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);if(failFirst&&requests.length===1)return{ok:false,status:500,json:async()=>({error:'Falha temporária'})};return{ok:true,json:async()=>responseData?responseData(body):data};};vm.runInNewContext(fs.readFileSync(require.resolve('../receiving-ui.js'),'utf8'),{window:root,fetch,Date:class extends Date{constructor(...args){super(...(args.length?args:[now]));}}});
 states[0]=data;return {states,requests,render:(props={})=>{cursor=refCursor=0;return root.SC9ReceiptControl({isAdmin:false,authInfo:{usuario:'pessoa'},parseLot:raw=>({lote:raw.replace('LOTE:','').trim()}),...props});}};
}
test('formulário registra diretamente lote e quantidade, mantém o identificador ao tentar novamente e preserva histórico antigo',async()=>{
 const env=setup({failFirst:true}),legacy=[{id:'antigo',lote:'ANT',qtdEnviada:4,qtdRecebida:4,status:'confirmado'}],before=structuredClone(legacy);let tree=env.render({legacyRecords:legacy});assert(!JSON.stringify(tree).includes('Registrar entrega'));assert(JSON.stringify(tree).includes('Histórico do processo anterior (1)'));assert(JSON.stringify(tree).includes('Importar SD3 completo'));
 const inputs=()=>nodes(tree,n=>n.type==='input');inputs().find(n=>n.props.placeholder==='Bipe ou digite o lote').props.onChange({target:{value:'LOTE: 123'}});tree=env.render();inputs().find(n=>n.props.type==='number').props.onChange({target:{value:'2.125'}});tree=env.render();await nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});tree=env.render();assert(JSON.stringify(tree).includes('Falha temporária'));assert.equal(inputs().find(n=>n.props.type==='number').props.value,'2.125');
 await nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});tree=env.render();assert.equal(env.requests.length,2);assert.equal(env.requests[0].id,env.requests[1].id);assert.equal(env.requests[0].acao,'receber');assert.equal(env.requests[0].quantidade,2.125);assert.equal(env.requests[0].lote,'123');assert.equal(env.requests[0].filial,'01');assert.equal(inputs().find(n=>n.props.type==='number').props.value,'');assert.deepEqual(legacy,before);
});
test('histórico novo é paginado e importação está disponível aos usuários do controle',()=>{
 const rows=Array.from({length:55},(_,i)=>({id:String(i),filial:'01',lote:'L'+i,quantidade:1,status:'aguardando_sd3',createdAt:'2026-11-05T12:00:00Z',createdBy:'pessoa',createdByName:'Pessoa',missing:1,allocated:0,docs:[],issues:[]})),env=setup({data:{rows,excess:[],sd3:{coverage:[]}}});let tree=env.render();assert.equal(nodes(tree,n=>n.type==='article').length,50);const pager=nodes(tree,n=>typeof n.type==='function'&&n.type.name==='Pager')[0];assert.equal(pager.props.total,2);pager.props.onPage(1);tree=env.render();assert.equal(nodes(tree,n=>n.type==='article').length,5);assert(JSON.stringify(env.render({isAdmin:false})).includes('Importar SD3 completo do período'));assert(JSON.stringify(env.render({isAdmin:true})).includes('Importar SD3 completo do período'));
});
test('exportação inclui todo o recorte, independente da página, e conserva o histórico antigo',()=>{
 const rows=Array.from({length:55},(_,i)=>({id:String(i),filial:'01',lote:'L'+i,quantidade:.125,status:'aguardando_sd3',createdAt:'2026-11-05T12:00:00Z',missing:.125,allocated:0,docs:[],issues:[]})),env=setup({data:{rows,excess:[],sd3:{coverage:[]}}});let exported;const legacy=[{id:'anterior',lote:'L0',validacao:{status:'preservado'}}],tree=env.render({legacyRecords:legacy,exportWorkbook:(sheets,name)=>exported={sheets,name}});
 nodes(tree,n=>n.type==='button'&&n.children.includes('Exportar recebimentos do recorte'))[0].props.onClick();assert.equal(exported.sheets[0].rows.length,55);assert.equal(exported.sheets[0].rows[0].Recebida,.125);
 nodes(tree,n=>n.type==='button'&&n.children.includes('Exportar histórico anterior'))[0].props.onClick();assert.equal(exported.sheets[0].rows.length,1);assert.equal(exported.sheets[0].rows[0].validacao,'{"status":"preservado"}');
});

test('visão de gestão calcula conciliação por registro ativo da filial, sem misturar cancelamentos e filtros do histórico',()=>{
 const make=(id,status,filial='01',extra={})=>({id,filial,lote:'L'+id,quantidade:10,status,createdAt:'2026-11-05T12:00:00Z',docs:[],issues:[],...extra});
 const rows=[make('1','conferido'),make('2','conferido'),make('3','divergente'),make('4','aguardando_sd3'),make('5','produto_ambiguo','01',{candidates:['A','B']}),make('6','cancelado','01',{cancelledAt:'2026-11-05T13:00:00Z'}),make('7','conferido','02')],env=setup({data:{rows,excess:[],sd3:{coverage:[]}}});
 let tree=env.render();assert(JSON.stringify(nodes(tree,n=>n.props.className==='sc9-receiving-metric conferido')[0]).includes('40% dos recebimentos ativos'));
 assert(JSON.stringify(tree).includes('5 ativos no período'));
 const track=nodes(tree,n=>n.props.className==='sc9-receiving-track')[0];assert.equal(track.children.flat().reduce((sum,n)=>sum+parseFloat(n.props.style.width),0),100);
 const priorities=nodes(tree,n=>n.type==='button'&&n.props.className==='sc9-receiving-priority divergente');priorities[0].props.onClick();tree=env.render();assert.equal(nodes(tree,n=>n.type==='article').length,1);assert(JSON.stringify(nodes(tree,n=>n.props.className==='sc9-receiving-metric conferido')[0]).includes('40% dos recebimentos ativos'));
 const sections=tree.children.flat().filter(n=>n&&n.type==='section');assert(sections.findIndex(n=>n.props['aria-label']==='Visão de gestão dos recebimentos')<sections.findIndex(n=>n.props['aria-label']==='Registrar recebimento no armazém 01'));
});

test('visão de gestão sem registros ativos distingue ausência de dados de percentual zero',()=>{
 const env=setup();const tree=env.render();assert(JSON.stringify(tree).includes('Sem recebimentos ativos'));assert(!JSON.stringify(tree).includes('0% dos recebimentos ativos'));assert.equal(nodes(tree,n=>n.props.className==='sc9-receiving-track').length,0);assert(JSON.stringify(tree).includes('Sem recebimentos ativos neste período.'));
});

test('período compartilha o recorte dos indicadores, lista e exportação com limites de São Paulo',()=>{
 const make=(id,createdAt,filial='01')=>({id,lote:id,filial,createdAt,status:'conferido',quantidade:2,allocated:2,missing:0,docs:[],issues:[]});
 const rows=[make('limite','2026-10-30T03:00:00Z'),make('anterior','2026-10-30T02:59:59Z'),make('ontem','2026-11-05T02:59:59Z'),make('hoje','2026-11-05T03:00:00Z'),make('outra','2026-11-05T03:00:00Z','02')];let exported;
 const env=setup({data:{rows,excess:[],sd3:{coverage:[]}}}),props={exportWorkbook:sheets=>exported=sheets};let tree=env.render(props);
 const period=()=>nodes(tree,n=>n.type==='label'&&n.children.includes('Período dos recebimentos'))[0].children.find(n=>n?.type==='select');
 assert.equal(nodes(tree,n=>n.type==='article').length,3);nodes(tree,n=>n.type==='button'&&n.children.includes('Exportar recebimentos do recorte'))[0].props.onClick();assert.deepEqual(exported[0].rows.map(r=>r.Lote),['limite','ontem','hoje']);
 period().props.onChange({target:{value:'today'}});tree=env.render(props);assert.equal(nodes(tree,n=>n.type==='article').length,1);assert(JSON.stringify(tree).includes('1 ativo no período'));assert.equal(nodes(tree,n=>n.type==='article')[0].props.key,'hoje');
 period().props.onChange({target:{value:'custom'}});tree=env.render(props);assert.equal(nodes(tree,n=>n.type==='article').length,0);assert(nodes(tree,n=>n.props.role==='alert').length);
 for(const [label,value]of [['Recebidos de','2026-10-29'],['Recebidos até','2026-10-30']]){nodes(tree,n=>n.type==='label'&&n.children.includes(label))[0].children.find(n=>n?.type==='input').props.onChange({target:{value}});tree=env.render(props);}
 assert.equal(nodes(tree,n=>n.type==='article').length,2);nodes(tree,n=>n.type==='button'&&n.children.includes('Exportar recebimentos do recorte'))[0].props.onClick();assert.deepEqual(exported[0].rows.map(r=>r.Lote),['limite','anterior']);
 nodes(tree,n=>n.type==='label'&&n.children.includes('Recebidos até'))[0].children.find(n=>n?.type==='input').props.onChange({target:{value:'2026-10-28'}});tree=env.render(props);assert(nodes(tree,n=>n.props.role==='alert').length);assert.equal(nodes(tree,n=>n.type==='article').length,0);
 period().props.onChange({target:{value:'all'}});tree=env.render(props);assert.equal(nodes(tree,n=>n.type==='article').length,4);
});

test('tela enxuta limita prioridades a três lotes, esconde aviso vazio e mantém correção dentro dos detalhes',()=>{
 const rows=Array.from({length:6},(_,i)=>({id:String(i),filial:'01',lote:'L'+i,quantidade:3,status:'divergente',createdAt:'2026-11-05T12:00:00Z',createdBy:'pessoa',createdByName:'Pessoa',missing:2,allocated:1,message:'Entrada registrada no armazém 18, diferente do 01.',docs:[],issues:[]}));
 const env=setup({data:{rows,excess:[],sd3:{coverage:[]}}});let tree=env.render();assert.equal(nodes(tree,n=>n.props.className?.startsWith('sc9-receiving-metric ')).length,3);assert.equal(nodes(tree,n=>n.props.className==='sc9-receiving-priority divergente').length,3);assert.equal(nodes(tree,n=>n.props.className==='sc9-receiving-identify').length,0);
 const article=nodes(tree,n=>n.type==='article')[0];assert(nodes(article,n=>n.props.className==='sc9-receiving-reason').length);assert.equal(nodes(article.children.find(n=>n?.type==='details'),n=>n.type==='button'&&n.children.includes('Corrigir lançamento')).length,1);
 nodes(tree,n=>n.props.className==='sc9-receiving-priority divergente')[0].props.onClick();tree=env.render();assert.equal(nodes(tree,n=>n.type==='article').length,1);assert.equal(nodes(tree,n=>n.type==='input'&&n.props.type==='search')[0].props.value,'L0');
});

test('motivo obrigatório é enviado, fica visível após salvar e sai na exportação com autor e data',async()=>{
 const row={id:'R',filial:'01',lote:'123',produtoResolvido:'P',quantidade:204,allocated:203,missing:1,status:'divergente',createdAt:'2026-11-05T12:00:00Z',createdBy:'pessoa',createdByName:'Pessoa',docs:[],issues:[],message:'203 de 204 recebidas'};
 const data={rows:[row],excess:[],sd3:{coverage:[]}},corrected={...row,status:'cancelado',allocated:0,cancelledAt:'2026-11-05T15:00:00Z',cancelledBy:'pessoa',cancelReason:'Quantidade correta: 203; digitado 204.'};let exported;
 const env=setup({data,responseData:()=>({...data,rows:[corrected]})}),props={exportWorkbook:sheets=>exported=sheets};let tree=env.render(props);
 nodes(tree,n=>n.type==='select'&&n.children.some(v=>v?.props?.value==='divergente'))[0].props.onChange({target:{value:'divergente'}});tree=env.render(props);
 nodes(tree,n=>n.type==='button'&&n.children.includes('Corrigir lançamento'))[0].props.onClick();tree=env.render(props);
 const save=()=>nodes(tree,n=>n.type==='button'&&n.children.includes('Salvar motivo e cancelar registro'))[0];assert(save().props.disabled);
 nodes(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'  '}});tree=env.render(props);assert(save().props.disabled);
 nodes(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:corrected.cancelReason}});tree=env.render(props);assert(!save().props.disabled);await save().props.onClick();tree=env.render(props);
 assert.equal(env.requests[0].acao,'cancelarRecebimento');assert.equal(env.requests[0].motivo,corrected.cancelReason);assert(JSON.stringify(tree).includes('Correção salva com motivo'));assert(JSON.stringify(tree).includes('Motivo da correção: '+corrected.cancelReason));assert.equal(nodes(tree,n=>n.type==='select'&&n.children.some(v=>v?.props?.value==='divergente'))[0].props.value,'');
 nodes(tree,n=>n.type==='button'&&n.children.includes('Exportar recebimentos do recorte'))[0].props.onClick();assert.equal(exported[0].rows[0]['Motivo da correção'],corrected.cancelReason);assert.equal(exported.find(s=>s.name==='Correções').rows[0]['Corrigido por'],'pessoa');assert(exported.find(s=>s.name==='Correções').rows[0]['Correção em']);
 // A status filter can hide the cancelled record, but the audit remains available in the workbook.
 nodes(tree,n=>n.type==='select'&&n.children.some(v=>v?.props?.value==='divergente'))[0].props.onChange({target:{value:'conferido'}});tree=env.render(props);const button=nodes(tree,n=>n.type==='button'&&n.children.includes('Exportar recebimentos do recorte'))[0];assert(!button.props.disabled);button.props.onClick();assert.equal(exported[0].rows.length,0);assert.equal(exported.find(s=>s.name==='Correções').rows[0]['Motivo da correção'],corrected.cancelReason);
});

test('saldo parcial aparece nos pendentes; ao completar, ambas as bipagens ficam vinculadas e exportáveis',()=>{
 const movement=more=>({filial:'01',armazem:'02',produto:'P',lote:'L1',doc:'D1',tp:999,qt:245,dt:'2026-11-05',cf:'RE4',...more}),sd3=M.replacePeriod(null,[movement({}),movement({armazem:'01',tp:499,cf:'DE4'})],{filial:'01',desde:'2026-11-05',ate:'2026-11-05',now:'2026-11-06T12:00:00Z'}).sd3;
 const a={id:'A',filial:'01',lote:'L1',quantidade:135,createdAt:'2026-11-05T12:00:00Z',createdBy:'pessoa'},b={...a,id:'B',quantidade:110,createdAt:'2026-11-12T12:00:00Z'};
 const partialEnv=setup({data:{...M.reconcile([a],sd3),sd3:{coverage:[]}}});let tree=partialEnv.render();assert(JSON.stringify(tree).includes('Saldo parcial'));assert(JSON.stringify(tree).includes('Faltam receber 110'));assert.equal(nodes(tree,n=>n.props.className==='sc9-receiving-metric pendentes')[0].children[1].children[0],'1');
 nodes(tree,n=>n.props.className==='sc9-receiving-metric pendentes')[0].props.onClick();tree=partialEnv.render();assert.equal(nodes(tree,n=>n.type==='article').length,1);
 let exported;const env=setup({now:'2026-11-12T15:00:00Z',data:{...M.reconcile([a,b],sd3),sd3:{coverage:[]}}}),props={exportWorkbook:sheets=>exported=sheets};tree=env.render(props);assert.equal(nodes(tree,n=>n.type==='article').length,1);assert(JSON.stringify(tree).includes('Conferido por bipagens parciais'));assert(JSON.stringify(tree).includes('esta bipagem'));
 nodes(tree,n=>n.type==='button'&&n.children.includes('Exportar recebimentos do recorte'))[0].props.onClick();assert.equal(exported[0].rows.length,1);assert.equal(exported[0].rows[0]['Grupo de bipagens'],'A');const links=exported.find(s=>s.name==='Bipagens parciais').rows;assert.equal(links.length,2);assert.deepEqual(Array.from(links,r=>r['Quantidade desta bipagem']),[135,110]);assert(links.every(r=>r['Grupo completo']==='Sim'));
});
