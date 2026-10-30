const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {freshness,priorityRows,filterRows,number}=require('../operation-live.js');
const now=Date.parse('2026-10-30T12:00:00Z');
test('consulta distingue carregamento, ausência de base, erro, atualização recente e vencida',()=>{
 assert.equal(freshness(null,'',now).tone,'loading');assert.equal(freshness({},'',now).tone,'empty');
 const data={savedAt:'2026-10-29',atualizadoEm:new Date(now-30000).toISOString()};
 assert.equal(freshness(data,'',now).tone,'current');assert.equal(freshness(data,'',now+1).tone,'stale');
 assert.equal(freshness({...data,atualizadoEm:new Date(now+1000).toISOString()},'',now).age,0);
 assert.match(freshness(data,'Falha',now).label,/mantendo a última consulta/);assert.equal(freshness(null,'Falha',now).tone,'error');
 for(const time of [null,'inválida',new Date(now+60000).toISOString()])assert.equal(freshness({...data,atualizadoEm:time},'',now).tone,'stale');
});
test('motivos sobrepostos não duplicam pedido e mantêm tempos de origens diferentes',()=>{
 const item=Object.freeze({pedido:'0012',etapa:'em_separacao',cliente:'João',transportadora:'Teste',horasParado:4.5});
 const data=Object.freeze({sla:{listaSeparar:[item],listaAtrasados:[{...item,horasParado:28}]}}),before=JSON.stringify(data),rows=priorityRows(data);
 assert.equal(rows.length,1);assert.deepEqual(rows[0].reasons,['separar','sc9']);assert.equal(rows[0].stageHours,4.5);assert.equal(rows[0].releaseHours,28);assert.equal(rows[0].pedido,'0012');assert.equal(JSON.stringify(data),before);
});
test('ordenação lida com tempos ausentes, negativos e duplicatas sem inventar espera',()=>{
 const row=(pedido,horasParado,etapa='a_conferir')=>({pedido,horasParado,etapa});
 const rows=priorityRows({sla:{listaConferir:[row('A',null),row('B',-1),row('C',2.25),row('C',3)],listaAtrasados:[row('A',undefined),row('D',10),row('C',1,'aguardando_coleta')]}});
 assert.equal(rows.length,5);assert.equal(rows[0].pedido,'D');assert.equal(rows[1].stageHours,3);assert.equal(rows.find(x=>x.pedido==='A').stageHours,null);assert.equal(rows.find(x=>x.pedido==='B').stageHours,null);assert.equal(rows.filter(x=>x.pedido==='C').length,2);
 assert.deepEqual(priorityRows({}),[]);assert.equal(number(-0.25),'-0,25');
});
test('busca combina motivo, pedido, cliente e transportadora sem alterar a lista',()=>{
 const rows=priorityRows({sla:{listaSeparar:[{pedido:'0012',etapa:'a_separar',cliente:'João Silva',transportadora:'Rápida',horasParado:5}],listaAtrasados:[{pedido:'0020',etapa:'a_conferir',cliente:'Outro'}]}});
 assert.equal(filterRows(rows,'separar','joao rapida 0012').length,1);assert.equal(filterRows(rows,'sc9','joao').length,0);assert.equal(filterRows(rows,'','0020').length,1);assert.equal(rows.length,2);
});
function setup(){let states=[],cursor=0;const R={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useMemo:fn=>fn(),useEffect:()=>{},useState:initial=>{const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];}};const root={React:R};vm.runInNewContext(fs.readFileSync(require.resolve('../operation-live.js'),'utf8'),{window:root});return {root,render:(name,props)=>{cursor=0;return root[name](props);}};}
function nodes(tree,predicate){const result=[];function visit(n){if(!n||typeof n!=='object')return;if(predicate(n))result.push(n);for(const child of [n.props?.children||[]].flat(Infinity))visit(child);}visit(tree);return result;}
test('estados de erro permitem tentar novamente sem dados e métricas mantêm o último retrato',()=>{
 const {render}=setup();let refreshed=0,tv=0;const props={error:'Erro fictício',now,onRefresh:()=>refreshed++,onTV:()=>tv++};
 const empty=render('SC9LiveState',props);nodes(empty,n=>n.type==='button')[0].props.onClick();assert.equal(refreshed,1);assert(nodes(empty,n=>n.props.role==='alert').length);
 const out=render('SC9LiveOverview',{...props,data:{savedAt:'2026-10-29',atualizadoEm:new Date(now).toISOString(),emProcesso:7,concluidosHoje:2}}),text=JSON.stringify(out);
 assert.match(text,/mantendo a última consulta/);assert.match(text,/Expedidos hoje com bipe/);assert.match(text,/não importa um novo SC9/);assert.match(text,/7/);
 nodes(out,n=>n.type==='button')[1].props.onClick();assert.equal(tv,1);
});
test('prioridades paginam, filtram e preservam seleção em consultas automáticas',()=>{
 const {render}=setup(),items=Array.from({length:23},(_,i)=>({pedido:String(100+i),etapa:'a_separar',horasParado:i+1}));
 const props={data:{sla:{listaSeparar:items,separarEstourado:200,separarHoras:2,listaAtrasados:[{...items[0],horasParado:60}]},atrasados:81,etapaLabel:{a_separar:'A separar'}}};
 let out=render('SC9LivePriorities',props);assert.equal(nodes(out,n=>n.type==='tbody')[0].props.children.flat(Infinity).length,10);assert.match(JSON.stringify(out),/200/);assert.match(JSON.stringify(out),/até 30 registros por motivo/);
 nodes(out,n=>n.type==='button'&&n.props.children.includes('Próxima'))[0].props.onClick();out=render('SC9LivePriorities',{data:{...props.data}});assert.match(JSON.stringify(out),/Página ",2/);
 const signal=nodes(out,n=>n.type==='button'&&n.props.className==='sc9-live-signal')[4];signal.props.onClick();out=render('SC9LivePriorities',props);assert.equal(nodes(out,n=>n.type==='tbody')[0].props.children.flat(Infinity).length,1);assert.match(JSON.stringify(out),/Desde o marco da etapa/);assert.match(JSON.stringify(out),/Desde a liberação/);
 const input=nodes(out,n=>n.type==='input')[0];input.props.onChange({target:{value:'não existe'}});out=render('SC9LivePriorities',props);assert.match(JSON.stringify(out),/Nenhum registro corresponde/);
});
test('ponte usa os dados e callbacks reais e mantém os controles do modo TV',()=>{
 const source=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),start=source.indexOf('function Zi('),end=source.indexOf('var mo=',start),s=source.slice(start,end);
 assert(s.includes('window.SC9LiveState,{data:a,error:o,busy:E,now:n,onRefresh:()=>b(!0)}'));assert(s.includes('window.SC9LivePriorities,{data:a}'));
 const a=s.indexOf('React.createElement(window.SC9LiveOverview,'),b=s.indexOf(',React.createElement(Yi,',a);let props,refresh,tv,slide;
 vm.runInNewContext(s.slice(a,b),{React:{createElement:(_,p)=>{props=p;}},window:{SC9LiveOverview:'overview'},a:{savedAt:'base'},o:'erro',E:false,n:now,b:value=>refresh=value,d:value=>tv=value,p:value=>slide=value});
 assert.equal(props.data.savedAt,'base');props.onRefresh();assert.equal(refresh,true);props.onTV();assert.equal(tv,true);assert.equal(slide,0);
 assert(s.includes('Jo(()=>b(!1),6e3)'));assert(s.includes('B.key==="Escape"&&d(!1)'));assert(s.includes('React.createElement(rc,{d:a,slide:m'));assert(!s.includes('title:"Pedidos parados — prioridade"'));
});
