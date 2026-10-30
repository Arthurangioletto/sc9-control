const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {pendingInfo}=require('../operation-transfers.js');
const records=[{id:'new',lote:'N',status:'aguardando',qtdEnviada:2.5,dataEntrega:new Date('2026-10-30T10:00:00Z')},{id:'old',lote:'A',status:'aguardando',qtdEnviada:3,dataEntrega:new Date('2026-10-29T10:00:00Z')},{id:'confirmed',status:'confirmado',dataEntrega:new Date('2020-01-01')},{id:'missing',status:'aguardando',dataEntrega:null},{id:'future',status:'aguardando',dataEntrega:new Date('2030-01-01')}];
function setup(){const root={React:{createElement:(type,props,...children)=>({type,props:props||{},children})}};vm.runInNewContext(fs.readFileSync(require.resolve('../operation-transfers.js'),'utf8'),{window:root});return root;}
function nodes(tree,predicate){const found=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))found.push(node);for(const child of(node.children||[]).flat(Infinity))visit(child);}visit(tree);return found;}
test('prioridade considera apenas pendências com data válida e não altera os registros',()=>{
 const snapshot=JSON.stringify(records),result=pendingInfo(records,new Date('2026-10-30T12:00:00Z'));
 assert.strictEqual(result.oldest,records[1]);assert.equal(result.pending,4);assert.equal(result.dated,2);assert.equal(result.hours,26);assert.equal(JSON.stringify(records),snapshot);
 assert.equal(pendingInfo([{status:'aguardando',dataEntrega:new Date('invalid')}]).oldest,null);assert.equal(pendingInfo([]).pending,0);
});
test('resumo usa os totais existentes e atalhos sem criar nova classificação ou ação de gravação',()=>{
 const root=setup(),calls=[],stats={aguardando:4,atrasadas:1,emAtencao:2,pecasEmTransito:5.5,comProblema:3,emObservacao:1,taxaOk:0.5,conferidosOk:2,conferidos:4,tempoMedioConfirmacaoH:3};
 const tree=root.SC9TransferOverview({records:[],stats,attentionHours:4,lateHours:24,formatHours:value=>value+'h',onPending:()=>calls.push('pending'),onIssues:()=>calls.push('issues'),onHistory:()=>calls.push('history')});
 const buttons=nodes(tree,node=>node.type==='button');assert.equal(buttons.length,3);buttons.forEach(button=>button.props.onClick());assert.deepEqual(calls,['pending','issues','history']);
 const rendered=JSON.stringify(tree);assert.match(rendered,/5,5/);assert.match(rendered,/50%/);assert.match(rendered,/1 em observação/);
});
test('sem recebimentos o resumo não inventa percentual ou tempo médio',()=>{
 const root=setup(),tree=root.SC9TransferOverview({records:[],stats:{aguardando:0,atrasadas:0,emAtencao:0,pecasEmTransito:0,comProblema:0,emObservacao:0,taxaOk:null,conferidosOk:0,conferidos:0,tempoMedioConfirmacaoH:null},attentionHours:4,lateHours:24,formatHours:()=>{throw Error('Tempo ausente não deve ser formatado');}});
 assert.doesNotMatch(JSON.stringify(tree),/NaN|0%/);assert.match(JSON.stringify(tree),/Nenhuma entrega aguardando/);
});
test('atalhos reutilizam o histórico e a conferência existentes sem ultrapassar o bloqueio',()=>{
 const source=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),a=source.indexOf('React.createElement(window.SC9TransferOverview,'),b=source.indexOf(',!le&&React.createElement("details"',a);assert(a>0&&b>a);
 const scrolled=[],focused=[];let props,person='user',issues=false;
 vm.runInNewContext(source.slice(a,b),{React:{createElement:(component,value)=>{props=value;}},window:{SC9TransferOverview:'overview'},$e:records,El:rows=>({aguardando:rows.length}),fl:4,gl:24,xl:()=>'',A:value=>{person=value;},Vd:value=>{issues=value;},document:{getElementById:id=>({scrollIntoView:()=>scrolled.push(id),focus:()=>focused.push(id)})}});
 assert.strictEqual(props.records,records);props.onIssues();assert.equal(person,'');assert.equal(issues,true);assert.equal(scrolled.at(-1),'sc9-transfer-history');props.onHistory();assert.equal(issues,false);props.onPending();assert.equal(scrolled.at(-1),'sc9-transfer-pending');props.onLocate('old');assert.equal(focused.at(-1),'sc9-rcv-qtd-old');
 assert(source.includes('id:"sc9-transfer-history"'));assert(source.includes('cr.length?React.createElement(po,{unlocked:jt||le'));
});
