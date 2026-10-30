const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {outgoing}=require('../operation-handoff.js');
function view(){const root={React:{createElement:(type,props,...children)=>({type,props:props||{},children})}};vm.runInNewContext(fs.readFileSync(require.resolve('../operation-handoff.js'),'utf8'),{window:root});return root;}
function nodes(tree,predicate){const found=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))found.push(node);for(const child of(node.children||[]).flat(Infinity))visit(child);}visit(tree);return found;}
test('saída conta registros e alterações sem multiplicar os grupos que se sobrepõem',()=>{
 const entries=Object.freeze([Object.freeze({pedido:'1',semDadoSC9:true,alteracao:{status:'pendente'}}),Object.freeze({pedido:'1',reenvio:true}),Object.freeze({pedido:'2',alteracao:{status:'resolvido'}})]);
 assert.deepEqual(outgoing(entries),{total:3,regular:2,alterations:1,missingSource:1});assert.deepEqual(outgoing([]),{total:0,regular:0,alterations:0,missingSource:0});
});
test('contexto não anuncia atualização ativa quando está carregando, em histórico ou com erro',()=>{
 const root=view(),context=props=>JSON.stringify(root.SC9HandoffContext(props));
 assert.match(context({kind:'saida',ready:true,live:true,day:'2026-10-30'}),/atualização automática ativa/);
 assert.doesNotMatch(context({kind:'saida',ready:false,live:true}),/atualização automática ativa/);
 assert.match(context({kind:'saida',ready:true,live:false}),/Bipagens continuam sendo registradas no dia atual/);
 assert.match(context({kind:'recebimento',ready:true,live:false}),/modo de consulta/);
 assert.match(context({kind:'recebimento',ready:true,live:true,error:'offline'}),/Não foi possível atualizar/);
});
test('indicadores de recebimento usam as contagens existentes e acionam apenas a seleção de filtro',()=>{
 const root=view(),calls=[],counts={recebidos:6,semSaida:2,faltando:3,naoSaiHoje:1,semConfirmar:4,saiu:1};
 const tree=root.SC9ReceivingMetrics({counts,active:'sem_saida',onSelect:id=>calls.push(id),day:'2026-10-30',overdue:2,threshold:'2 h'}),buttons=nodes(tree,node=>node.type==='button');
 assert.equal(buttons.length,5);assert.equal(buttons[1].props['aria-label'],'Sem saída registrada: 2');assert.equal(buttons[1].props['aria-pressed'],true);
 buttons[1].props.onClick();buttons[4].props.onClick();assert.deepEqual(calls,['sem_saida','saiu']);
 const missing=nodes(tree,node=>node.type==='article')[0];assert.equal(missing.props['aria-label'],'Saída sem recebimento: 3');assert.equal(missing.props.onClick,undefined);
});
test('ponte de recebimento mantém seleção e remoção do filtro com os identificadores originais',()=>{
 const bundle=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),a=bundle.indexOf('React.createElement(window.SC9ReceivingMetrics,'),b=bundle.indexOf('),React.createElement(W,{title:"Pesquisar pedido"',a);assert(a>0&&b>a);
 let props,selected='sem_saida';const counts={recebidos:1};vm.runInNewContext(bundle.slice(a,b+1),{React:{createElement:(type,value)=>{props=value;}},window:{SC9ReceivingMetrics:'metrics'},lt:counts,$:selected,S:fn=>{selected=fn(selected);},Ot:'2026-10-30',St:[],zr:()=> '2 h',Pt:2});
 assert.strictEqual(props.counts,counts);props.onSelect('sem_saida');assert.equal(selected,'');props.onSelect('saiu');assert.equal(selected,'saiu');
});
test('módulo é carregado antes do aplicativo e resumos não acrescentam acesso à rede',()=>{
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8'),moduleSource=fs.readFileSync(require.resolve('../operation-handoff.js'),'utf8');
 assert(html.indexOf('/operation-handoff.js')<html.indexOf('/bundle.js'));assert.doesNotMatch(moduleSource,/\bfetch\s*\(/);
 const root=view(),summary=root.SC9OutgoingSummary({entries:[{pedido:'1'}]});assert.equal(nodes(summary,node=>node.type==='button').length,0);
});
