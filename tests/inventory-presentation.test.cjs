const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {number,measure}=require('../inventory-presentation.js');
function setup(){const R={createElement:(type,props,...children)=>({type,props:{...props,children:children.length===1?children[0]:children}}),Children:{toArray:value=>(Array.isArray(value)?value:[value]).flat(Infinity).filter(value=>value!==null&&value!==undefined&&value!==false)}};const root={React:R};vm.runInNewContext(fs.readFileSync(require.resolve('../inventory-presentation.js'),'utf8'),{window:root});return {api:root.SC9InventoryPresentation,h:R.createElement};}
function nodes(tree,predicate){const found=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))found.push(node);for(const child of[node.props?.children||[]].flat(Infinity))visit(child);}visit(tree);return found;}
test('contagem distingue grupos e linhas sem somar saldos ou alterar o recorte',()=>{
 const rows=Object.freeze([Object.freeze({registros:[{saldo:10},{saldo:-2}]}),Object.freeze({registros:[{saldo:5}]})]);assert.deepEqual(measure(rows),{items:2,lines:3});assert.deepEqual(measure([{saldo:-1}]),{items:1,lines:1});assert.deepEqual(measure([]),{items:0,lines:0});assert.equal(rows[0].registros[0].saldo,10);
 assert.equal(number(-0.25),'-0,25');assert.equal(number(2.125),'2,125');assert.equal(number(0),'0');
});
test('cards preservam células, marcação e rascunho originais e identificam filial ausente',()=>{
 const {api,h}=setup(),action=h('input',{value:'Nota ainda não salva',onChange:()=>{}}),head=h('thead',null,h('tr',null,['Lote','Filial','Produto','Descrição','Armazém','Endereço','Saldo',''].map(label=>h('th',null,label)))),row=h('tr',{'data-sc9lote':'L1',style:{background:'yellow'}},['L1','—','P1','Produto de teste','RJ','A1','-0,25',action].map(value=>h('td',{style:{color:'red'}},value))),body=h('tbody',null,row),out=api.RecordCards({children:[head,body]});
 const article=nodes(out,node=>node.type==='article')[0];assert.equal(article.props['data-sc9lote'],'L1');assert.equal(article.props.style.background,'yellow');assert.equal(article.props['aria-label'],'Produto P1 · lote L1');
 assert(nodes(out,node=>node===action).length);assert.match(JSON.stringify(out),/Não informada/);assert.match(JSON.stringify(out),/-0,25/);assert.equal(action.props.value,'Nota ainda não salva');
});
test('células de validade e armazém continuam no produto do lote correspondente',()=>{
 const {api,h}=setup(),head=h('thead',null,h('tr',null,['Filial','Produto','Descrição','Armazém','Saldo','Validade'].map(label=>h('th',null,label)))),body=h('tbody',null,h('tr',null,['01','A','Teste','01','3,5','10/11/2026'].map(value=>h('td',null,value))));
 const out=api.RecordCards({lot:'LOTE',children:[head,body]});assert.equal(nodes(out,node=>node.type==='article')[0].props['aria-label'],'Produto A · lote LOTE');assert.match(JSON.stringify(out),/10\/11\/2026/);assert.match(JSON.stringify(out),/3,5/);
});
test('contexto distingue prioridade de filtro, origem e quantidade de linhas',()=>{
 const {api}=setup(),out=api.AnalysisContext({analysis:'validadeVariavel',items:[{registros:[{},{}]}],filial:'01',warehouse:'RJ',prioritized:'RT',priorityFilial:'01',onlyPriority:false,showWorked:true,ready:true,source:'Origem: achados salvos'}),text=JSON.stringify(out);
 assert.match(text,/Cambuci · 01/);assert.match(text,/Armazém RJ/);assert.match(text,/Prioridade de ordenação no armazém RT/);assert.match(text,/1 grupo · 2 linhas/);assert.match(text,/finalizados e ignorados/);
 assert.match(JSON.stringify(api.AnalysisContext({analysis:'saldoNegativo',items:[],ready:false})),/Carregando os achados/);
});
test('ponte da análise usa as listas reais filtradas e limpa os seletores sem gravar dados',()=>{
 const s=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),a=s.indexOf('React.createElement(window.SC9InventoryPresentation.AnalysisContext,'),b=s.indexOf(',x==="duplicado"&&React.createElement(W',a);assert(a>0&&b>a);
 const records=[{lote:'L',saldo:-0.25}],changes=[];let props;
 vm.runInNewContext(s.slice(a,b),{React:{createElement:(type,value)=>{props=value;}},window:{SC9InventoryPresentation:{AnalysisContext:'context'}},x:'saldoNegativo',$e:records,sc9Filial:'01',q:'RJ',Ie:'RT',T:'01',Z:false,F:false,nt:false,G:[],sc9SetFilial:value=>changes.push(['filial',value]),z:value=>changes.push(['warehouse',value]),N:value=>changes.push(['priority',value]),pe:value=>changes.push(['priorityFilial',value]),ae:value=>changes.push(['onlyPriority',value]),Q:value=>changes.push(['worked',value])});
 assert.strictEqual(props.items,records);props.onClear();assert.deepEqual(changes,[['filial',''],['warehouse','__TODOS__'],['priority',''],['priorityFilial',''],['onlyPriority',false],['worked',false]]);
});
test('grupos de validade e filiais preservam a busca e usam chaves estáveis por grupo',()=>{
 const s=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),record={lote:'L',produtoBase:'A'};
 for(const [name,renderer,key]of [['jt','$a','val|L'],['Da','Ur','fil|L|A']]){const marker='items:'+name+',renderItem:',a=s.indexOf(marker),b=s.indexOf('),target:Ja',a);assert(a>0&&b>a);const ctx={React:{createElement:(type,props,child)=>({type,props,child})},window:{SC9DuplicatePanel:'panel'},Ja:'L',ve:value=>value,[renderer]:value=>value};const render=vm.runInNewContext('('+s.slice(a+marker.length,b+1)+')',ctx),out=render(record);assert.equal(out.props.key,key);assert.equal(out.props.target,'L');assert.strictEqual(out.child,record);}
});
