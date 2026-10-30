const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {build,selectRows,number}=require('../operation-productivity.js');
const rows=[{name:'João Teste',pedidos:3,qt:2.25,elegivel:true,fixo:true},{name:'Ana Teste',pedidos:1,qt:0.5,elegivel:false,fixo:true},{name:'Rotativo Teste',pedidos:1,qt:7,elegivel:false,fixo:false}];
test('resumo preserva volumes decimais e distingue elegíveis, responsáveis e pedidos sem nome',()=>{
 const orders=[{separador:' João Teste ',durationMin:0},{separador:'João Teste',durationMin:10},{separador:'João Teste',durationMin:-1},{separador:'Ana Teste',durationMin:NaN},{separador:'Rotativo Teste',durationMin:null},{separador:'0'},{separador:''}];
 const before=JSON.stringify(rows),model=build(rows,orders,'separador');
 assert.deepEqual(model,{people:3,eligible:1,orders:5,quantity:9.75,assigned:5,unassigned:2,real:2,proxy:0,missing:3});assert.equal(JSON.stringify(rows),before);assert.equal(number(0.25),'0,25');
});
test('cobertura de conferência separa o par de horários, proxy e ausência sem inferir duração',()=>{
 const person={name:'Conferente Teste',pedidos:4,qt:2,elegivel:true};
 const orders=[{conferente:person.name,confStart:'inicio',confEnd:'fim',confDurationMin:null},{conferente:person.name,confStart:'inicio',pickEnd:'pick'},{conferente:person.name,confEnd:'fim'},{conferente:person.name,confStart:'inicio',confEnd:'fim',pickEnd:'pick'},{conferente:'0'}];
 const model=build([person],orders,'conferente');assert.equal(model.real,2);assert.equal(model.proxy,1);assert.equal(model.missing,1);assert.equal(model.unassigned,1);assert.equal(model.real+model.proxy+model.missing,model.assigned);
 assert.deepEqual(build([],[],'conferente'),{people:0,eligible:0,orders:0,quantity:0,assigned:0,unassigned:0,real:0,proxy:0,missing:0});
});
test('seleção da tabela combina nome, participação e ordenação sem mudar agregados',()=>{
 const frozen=Object.freeze(rows.map(row=>Object.freeze({...row})));
 assert.equal(selectRows(frozen,'joao teste','eligible','name')[0].name,'João Teste');assert.equal(selectRows(frozen,'','rotating','original')[0].name,'Rotativo Teste');assert.equal(selectRows(frozen,'','insufficient','original')[0].name,'Ana Teste');
 assert.deepEqual(selectRows(frozen,'','', 'quantity').map(row=>row.name),['Rotativo Teste','João Teste','Ana Teste']);assert.equal(selectRows(frozen,'não existe','','original').length,0);assert.equal(frozen[0].name,'João Teste');
});
function setup(){let states=[],cursor=0;const R={createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect:()=>{},useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>states[i]=value];}};const root={React:R};vm.runInNewContext(fs.readFileSync(require.resolve('../operation-productivity.js'),'utf8'),{window:root});return {root,render:(name,props)=>{cursor=0;return root[name](props);}};}
function nodes(tree,predicate){const result=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))result.push(node);for(const child of [node.props?.children||[]].flat(Infinity))visit(child);}visit(tree);return result;}
test('filtros do contexto encaminham valores e não aplicam corte vazio',()=>{
 const {render}=setup(),changes=[],props={role:'separador',rows,orders:[],scope:'Rio de Janeiro',warehouse:'RJ',warehouses:['RJ'],labels:{RJ:{label:'Rio de Janeiro'}},cutoff:'2026-10-30',filters:{day:'2026-10-29',status:'Pendente',item:'P1'},itemLabel:'Produto teste',onWarehouse:value=>changes.push(['warehouse',value]),onCutoff:value=>changes.push(['cutoff',value]),onFilter:(...args)=>changes.push(args),onClear:()=>changes.push(['clear'])};
 const out=render('SC9ProductivityOverview',props),inputs=nodes(out,node=>node.type==='input'),selects=nodes(out,node=>node.type==='select');
 assert.strictEqual(inputs[0].props.onInput,inputs[0].props.onChange);assert.strictEqual(inputs[1].props.onInput,inputs[1].props.onChange);
 inputs[0].props.onChange({target:{value:''}});assert.equal(changes.length,0);inputs[0].props.onChange({target:{value:'2026-10-29'}});inputs[1].props.onChange({target:{value:''}});selects[0].props.onChange({target:{value:'__ALL__'}});selects[1].props.onChange({target:{value:'Atrasado'}});nodes(out,node=>node.type==='button')[0].props.onClick();
 assert.deepEqual(changes,[['cutoff','2026-10-29'],['day',''],['warehouse','__ALL__'],['status','Atrasado'],['clear']]);assert.match(JSON.stringify(out),/Produto teste/);assert.match(JSON.stringify(out),/dias de liberação/);
});
test('tabela pagina e mantém objetos originais para abrir a pessoa na função correta',()=>{
 const {render}=setup(),people=Array.from({length:22},(_,i)=>({...rows[0],name:'Pessoa '+i}));let selected;
 const props={rows:people,role:'separador',renderRows:value=>{selected=value;return 'Tabela original';}};
 let out=render('SC9ProductivityRoster',props);assert.equal(selected.length,10);assert.strictEqual(selected[0],people[0]);nodes(out,node=>node.type==='button'&&node.props.children.includes('Próxima'))[0].props.onClick();out=render('SC9ProductivityRoster',{...props,rows:[...people]});assert.strictEqual(selected[0],people[10]);
 nodes(out,node=>node.type==='input')[0].props.onChange({target:{value:'Pessoa 21'}});out=render('SC9ProductivityRoster',props);assert.equal(selected.length,1);assert.strictEqual(selected[0],people[21]);assert.match(JSON.stringify(out),/somente esta tabela/);
});
test('as duas telas mantêm o bloqueio e encaminham os filtros e abertura existentes',()=>{
 const s=fs.readFileSync(require.resolve('../bundle.js'),'utf8');
 for(const [id,role,stats] of [['separadores','separador','P'],['conferencia','conferente','Ze']]){
  const start=s.indexOf('!F&&D==="'+id+'"'),end=s.indexOf(',!F&&D===',start+10),part=s.slice(start,end);assert(part.startsWith('!F&&D==="'+id+'"&&React.createElement(po,{unlocked:jt'));
  const a=part.indexOf('React.createElement(window.SC9ProductivityOverview,'),b=part.indexOf('}}),',a);let props,warehouse,cutoff,filters={day:'antigo',status:'Pendente'},detail='aberto';
  vm.runInNewContext(part.slice(a,b+3),{React:{createElement:(_,value)=>props=value},window:{SC9ProductivityOverview:'overview'},P:rows,Ze:rows,ae:[],ye:'Todos',f:'__ALL__',p:{warehousesPresent:['Cambuci']},lo:{},r:'2026-10-30',x:{item:'P1'},ys:()=> 'Produto',J:{savedAt:'data'},b:value=>warehouse=value,Q:value=>detail=value,o:value=>cutoff=value,R:fn=>filters=fn(filters),el:()=>filters={}});
  assert.strictEqual(props.rows,rows);assert.equal(props.role,role);props.onWarehouse('RJ');assert.equal(warehouse,'RJ');assert.equal(detail,null);props.onCutoff('2026-10-29');assert.equal(cutoff,'2026-10-29');props.onFilter('status','');assert.deepEqual(JSON.parse(JSON.stringify(filters)),{day:'antigo',status:null});props.onClear();assert.equal(warehouse,'__ALL__');assert.deepEqual(filters,{});
  const bridge='React.createElement(window.SC9ProductivityRoster,{rows:'+stats+',role:"'+role+'",renderRows:sc9Rows=>React.createElement(us,{rows:sc9Rows,role:"'+role+'",onPerson:Pe("'+role+'")})})';assert(part.includes(bridge));let roster,person;
  vm.runInNewContext(bridge,{React:{createElement:(type,value)=>{if(type==='roster')roster=value;else{assert.strictEqual(value.rows,rows);value.onPerson('Nome teste');}}},window:{SC9ProductivityRoster:'roster'},P:rows,Ze:rows,us:'table',Pe:receivedRole=>name=>person=[receivedRole,name]});roster.renderRows(rows);assert.deepEqual(person,[role,'Nome teste']);
 }
 assert(!s.includes('title:`Carga dos Conferentes'));assert(s.includes('window.SC9ProductivityModel.number(d)'));
});
test('descrições do índice correspondem aos volumes e pesos usados na função original',()=>{
 const s=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),a=s.indexOf('function qc('),b=s.indexOf('function zc(',a);const qc=vm.runInNewContext('('+s.slice(a,b)+')',{xr:(values,initial)=>Math.max(initial,...values),Tc:value=>value>=70?'Alto':value>=40?'Médio':'Baixo',Oc:{}});
 const input=[{pedidos:100,linhas:100,qt:100,elegivel:true,pecasPorHora:1},{pedidos:50,linhas:0,qt:50,elegivel:true,pecasPorHora:1000}],result=qc(input);
 assert.equal(result[0].indice,100);assert.equal(result[1].indice,25);assert.equal(input[1].indice,undefined);assert(s.includes('pedidos 20%, linhas 50% e peças 30%'));assert(!s.includes('linhas 45%'));assert(s.includes('label:"Pedidos",peso:"20%"'));assert(s.includes('label:"Linhas",peso:"50%"'));
});
