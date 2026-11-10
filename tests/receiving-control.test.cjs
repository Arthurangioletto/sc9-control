const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../receiving-control.js');
const movement=(more={})=>({filial:'01',armazem:'02',produto:'P',lote:'00123',doc:'D1',tp:999,qt:10,dt:'2026-11-05',cf:'RE4',estornado:false,...more});
const pair=(qt=10,more={})=>[movement({qt,...more}),movement({armazem:'01',tp:499,cf:'DE4',qt,...more})];
const receipt=(more={})=>({id:'R1',filial:'01',lote:'123',quantidade:10,createdAt:'2026-11-05T13:00:00Z',createdBy:'pessoa',...more});
const base=rows=>M.replacePeriod(null,rows,{filial:'01',desde:'2026-11-01',ate:'2026-11-05',now:'2026-11-06T12:00:00Z'}).sd3;
test('recebimento inicia sem envio e aguarda SD3 em vez de acusar erro com uma base antiga',()=>{
 const entry=receipt(),before=structuredClone(entry),result=M.reconcile([entry],base([]));assert.equal(result.rows[0].status,'divergente');assert.match(result.rows[0].message,/não encontrada/);assert.equal(M.reconcile([entry],{}).rows[0].status,'aguardando_sd3');
 const old=M.replacePeriod(null,pair(10,{dt:'2026-11-01'}),{filial:'01',desde:'2026-11-01',ate:'2026-11-01',now:'2026-11-02T12:00:00Z'}).sd3;assert.equal(M.reconcile([entry],old).rows[0].status,'aguardando_sd3');assert.deepEqual(entry,before);
});
test('parciais compartilham a transferência sem conferir a mesma quantidade duas vezes',()=>{
 const sd3=base(pair()),entries=[receipt({id:'A',quantidade:4}),receipt({id:'B',quantidade:6,createdAt:'2026-11-05T14:00:00Z'}),receipt({id:'C',quantidade:3,createdAt:'2026-11-05T15:00:00Z'})],before=structuredClone(sd3),result=M.reconcile(entries,sd3);
 assert.equal(result.rows.find(r=>r.id==='A').status,'conferido');assert.equal(result.rows.find(r=>r.id==='B').status,'conferido');assert.equal(result.rows.find(r=>r.id==='C').status,'divergente');assert.equal(result.rows.find(r=>r.id==='C').missing,3);assert.equal(result.rows.reduce((n,r)=>n+r.allocated,0),10);assert.deepEqual(sd3,before);
});
test('documentos restantes identificam transferência maior que os recebimentos parciais',()=>{
 const result=M.reconcile([receipt({quantidade:4})],base(pair()));assert.equal(result.rows[0].allocated,4);assert.equal(result.excess[0].quantidade,6);
});
test('duas pontas do mesmo documento precisam conferir; destino errado fica explícito',()=>{
 const wrong=base([movement(),movement({tp:499,armazem:'18',cf:'DE4'})]);const r=M.reconcile([receipt()],wrong).rows[0];assert.equal(r.status,'divergente');assert.match(r.message,/armazém 18/);assert.equal(r.allocated,0);assert.equal(r.issues[0].outrosArmazens['18'],10);
 const mismatch=M.reconcile([receipt()],base([movement(),movement({tp:499,armazem:'01',qt:9,cf:'DE4'})])).rows[0];assert.equal(mismatch.status,'divergente');assert.equal(mismatch.allocated,0);
 assert.equal(M.reconcile([receipt()],base([movement({tp:499,armazem:'01',cf:'DE4'})])).rows[0].allocated,0);
});
test('armazém 26 não interfere nas 399 unidades transferidas do 02 para o 01',()=>{
 const sample=movement({armazem:'26',tp:499,cf:'DE4',qt:1});
 const sd3=base([...pair(399),sample,{...sample,produto:'OUTRO'}]);
 const row=M.reconcile([receipt({quantidade:399})],sd3).rows[0];
 assert.equal(row.status,'conferido');
 assert.equal(row.allocated,399);
 assert.deepEqual(row.candidates,['P']);
 assert.equal(sd3.rows.filter(r=>r.armazem==='26').length,2);
 const excess=M.reconcile([receipt({quantidade:400})],sd3).rows[0];
 assert.equal(excess.missing,1);
 assert.equal(excess.status,'saldo_parcial');
 assert.equal(M.reconcile([receipt()],base([sample])).rows[0].allocated,0);
});
test('documentos, datas, produtos e filiais diferentes nunca completam uma transferência artificialmente',()=>{
 for(const more of [{doc:'OUTRO'},{dt:'2026-11-04'},{produto:'OUTRO'},{filial:'02'}]){const r=M.reconcile([receipt()],base([movement(),movement({tp:499,armazem:'01',cf:'DE4',...more})])).rows[0];assert.notEqual(r.status,'conferido');}
 assert.equal(M.reconcile([receipt()],base(pair(10,{dt:'2026-11-01'}))).rows[0].allocated,0);
});
test('lote repetido em produtos diferentes exige identificação antes de conferir',()=>{
 const sd3=base([...pair(),...pair(10,{produto:'Q',doc:'D2'})]),entry=receipt();assert.equal(M.reconcile([entry],sd3).rows[0].status,'produto_ambiguo');const resolved=M.reconcile([{...entry,produto:'P'}],sd3);assert.equal(resolved.rows[0].status,'conferido');assert.equal(resolved.rows[0].docs[0].produto,'P');assert.equal(resolved.excess[0].produto,'Q');
});
test('estornos e movimentos automáticos de reversão não validam recebimentos',()=>{
 assert.equal(M.reconcile([receipt()],base(pair(10,{estornado:true}))).rows[0].status,'divergente');
 assert.equal(M.reconcile([receipt()],base([movement({cf:'RE0'}),movement({tp:499,armazem:'01',cf:'DE0'})])).rows[0].allocated,0);
});
test('importação repetida ou sobreposta atualiza o período sem acumular quantidades',()=>{
 const options={filial:'01',desde:'2026-11-05',ate:'2026-11-05',now:'2026-11-06T12:00:00Z'},first=M.replacePeriod(base(pair(3,{dt:'2026-11-04',doc:'ANTERIOR'})),pair(),options),again=M.replacePeriod(first.sd3,pair(),options);assert.equal(again.sd3.rows.length,4);assert.equal(M.reconcile([receipt()],again.sd3).rows[0].allocated,10);
 const reversed=M.replacePeriod(again.sd3,pair(10,{estornado:true}),options);assert.equal(reversed.sd3.rows.filter(r=>r.dt==='2026-11-04').length,2);assert.equal(M.reconcile([receipt()],reversed.sd3).rows[0].allocated,3);
 const empty=M.replacePeriod(again.sd3,[],options);assert.equal(empty.sd3.rows.length,2);assert.equal(empty.stats.replaced,2);
});
test('cancelamento libera apenas a quantidade daquele recebimento; os demais permanecem válidos',()=>{
 const result=M.reconcile([receipt({id:'A',cancelledAt:'2026-11-06T12:00:00Z'}),receipt({id:'B',createdAt:'2026-11-05T14:00:00Z'})],base(pair()));assert.equal(result.rows.find(r=>r.id==='A').status,'cancelado');assert.equal(result.rows.find(r=>r.id==='B').status,'conferido');assert.equal(result.stats.received,10);
});
test('frações e lotes numéricos com zeros seguem a comparação existente sem misturar lotes alfanuméricos',()=>{
 const r=M.reconcile([receipt({quantidade:.125})],base(pair(.125))).rows[0];assert.equal(r.status,'conferido');assert.equal(r.allocated,.125);assert.equal(M.lot('000123'),'123');assert.notEqual(M.lot('00ABC'),M.lot('ABC'));assert.equal(M.reconcile([receipt({quantidade:.000001})],base([])).rows[0].status,'divergente');
});
test('cobertura importada antes do recebimento no mesmo dia não comprova ausência posterior',()=>{
 const sd3=M.replacePeriod(null,[],{filial:'01',desde:'2026-11-05',ate:'2026-11-05',now:'2026-11-05T12:00:00Z'}).sd3;assert.equal(M.reconcile([receipt()],sd3).rows[0].status,'aguardando_sd3');
});
test('203 conciliadas para 204 recebidas têm saldo parcial com excesso explícito, independente da cobertura',()=>{
 const entry=receipt({quantidade:204}),movements=pair(203);
 const old=M.replacePeriod(null,movements,{filial:'01',desde:'2026-11-05',ate:'2026-11-05',now:'2026-11-05T12:00:00Z'}).sd3;
 let result=M.reconcile([entry],old),row=result.rows[0];assert.equal(row.status,'saldo_parcial');assert.equal(row.allocated,203);assert.equal(row.missing,1);assert.equal(result.partialGroups[0].unmatched,1);
 const current=base(movements);result=M.reconcile([entry],current);row=result.rows[0];assert.equal(row.status,'saldo_parcial');assert.equal(row.allocated,203);assert.equal(row.missing,1);assert.match(row.message,/1 recebidas sem correspondência/);assert(!row.message.includes('não encontrada'));assert(!result.partialGroups[0].complete);
 assert.equal(M.reconcile([receipt({quantidade:203})],current).rows[0].status,'conferido');
 assert.equal(M.reconcile([entry],base(pair(204))).rows[0].status,'conferido');
});

test('135 de 245 ficam parciais; ao bipar 110 ambas passam a conferidas com o vínculo preservado',()=>{
 const sd3=base(pair(245)),a=receipt({id:'A',quantidade:135}),b=receipt({id:'B',quantidade:110,createdAt:'2026-11-05T14:00:00Z'}),before=structuredClone([a,sd3]);
 const partial=M.reconcile([a],sd3);assert.equal(partial.rows[0].status,'saldo_parcial');assert.equal(partial.rows[0].allocated,135);assert.equal(partial.rows[0].missing,0);assert.equal(partial.partialGroups[0].remaining,110);assert.match(partial.rows[0].message,/Faltam receber 110/);
 const done=M.reconcile([a,b],sd3);assert(done.rows.every(r=>r.status==='conferido'));assert(done.rows.every(r=>r.partialGroupId==='A'));assert.equal(done.partialGroups.length,1);assert.equal(done.partialGroups[0].received,245);assert.equal(done.partialGroups[0].receipts.length,2);assert(done.partialGroups[0].complete);assert(done.rows.every(r=>r.message.includes('Conferido por bipagens parciais')));assert.deepEqual([a,sd3],before);
 const cancelled=M.reconcile([{...b,cancelledAt:'2026-11-05T15:00:00Z'},a],sd3);assert.equal(cancelled.rows.find(r=>r.id==='A').status,'saldo_parcial');assert.equal(cancelled.partialGroups[0].remaining,110);assert.equal(cancelled.partialGroups[0].receipts.length,1);
});

test('bipagens anteriores consomem o mesmo documento; 111 mais 135 não fecham um documento de 245',()=>{
 const sd3=base(pair(245)),a=receipt({id:'A',quantidade:111}),b=receipt({id:'B',quantidade:135,createdAt:'2026-11-05T14:00:00Z'});
 let result=M.reconcile([a,b],sd3);assert.equal(result.rows.find(r=>r.id==='B').allocated,134);assert(result.rows.every(r=>r.status==='saldo_parcial'));assert.equal(result.partialGroups[0].received,246);assert.equal(result.partialGroups[0].expected,245);assert.equal(result.partialGroups[0].unmatched,1);assert(!result.partialGroups[0].complete);
 result=M.reconcile([a,b,receipt({id:'C',quantidade:110,createdAt:'2026-11-05T15:00:00Z'})],sd3);assert(result.rows.every(r=>r.status!=='conferido'));assert.equal(result.rows.reduce((sum,r)=>sum+r.allocated,0),245);
});

test('restante de uma bipagem já iniciada pode completar o documento após a janela inicial de dois dias',()=>{
 const sd3=base(pair(10)),a=receipt({id:'A',quantidade:4}),b=receipt({id:'B',quantidade:6,createdAt:'2026-11-12T14:00:00Z'});
 assert.equal(M.reconcile([b],sd3).rows[0].status,'aguardando_sd3');const result=M.reconcile([a,b],sd3);assert(result.rows.every(r=>r.status==='conferido'));assert.equal(result.partialGroups[0].receipts.length,2);
});

test('grupos não misturam produtos, filiais nem documentos independentes do mesmo lote',()=>{
 const sd3=M.replacePeriod(base([...pair(10,{doc:'D1'}),...pair(20,{doc:'D2'}),...pair(30,{doc:'D3',produto:'Q'})]),pair(40,{doc:'D4',filial:'02'}),{filial:'02',desde:'2026-11-05',ate:'2026-11-05',now:'2026-11-06T12:00:00Z'}).sd3;
 const entries=[receipt({id:'A',quantidade:10,produto:'P'}),receipt({id:'B',quantidade:5,produto:'P'}),receipt({id:'C',quantidade:15,produto:'P'}),receipt({id:'D',quantidade:5,produto:'Q'}),receipt({id:'E',quantidade:5,produto:'P',filial:'02'})],result=M.reconcile(entries,sd3);
 assert(!result.rows.find(r=>r.id==='A').partialGroupId);assert.equal(result.rows.find(r=>r.id==='B').partialGroupId,'B');assert.equal(result.rows.find(r=>r.id==='C').partialGroupId,'B');assert.equal(result.rows.find(r=>r.id==='D').status,'saldo_parcial');assert.equal(result.rows.find(r=>r.id==='E').status,'saldo_parcial');assert.equal(result.rows.find(r=>r.id==='E').partialGroupId,'E');assert.equal(result.partialGroups.find(g=>g.id==='E').expected,40);assert(result.partialGroups.every(g=>g.documents.every(d=>d.produto===g.documents[0].produto)));
});

test('uma bipagem pode iniciar dois documentos e ambos fecham ao receber o restante, sem duplicar a soma',()=>{
 const sd3=base([...pair(100,{doc:'D1'}),...pair(145,{doc:'D2'})]),a=receipt({id:'A',quantidade:135}),b=receipt({id:'B',quantidade:110,createdAt:'2026-11-05T14:00:00Z'});
 const result=M.reconcile([a,b],sd3);assert.equal(result.partialGroups.length,1);assert.equal(result.partialGroups[0].documents.length,2);assert.equal(result.partialGroups[0].expected,245);assert.equal(result.partialGroups[0].allocated,245);assert(result.rows.every(r=>r.status==='conferido'));assert.equal(result.rows.reduce((sum,r)=>sum+r.allocated,0),245);
});
test('datas e campos inválidos impedem importar parcialmente um arquivo',()=>{
 assert.throws(()=>base([movement({qt:'inválida'})]),/quantidade/);assert.throws(()=>base([movement({dt:'2026-02-30'})]),/Data/);assert.throws(()=>base([movement({doc:''})]),/documento/);assert.throws(()=>M.replacePeriod(null,pair(),{filial:'01',desde:'2026-11-01',ate:'2026-11-02'}),/fora/);
});
test('arquivo SD3 reconhece cabeçalhos, datas de Excel e filial informada sem ignorar transferências inválidas',()=>{
 const columns=['Tp Movimento','Produto','Quantidade','Armazém','Documento','Dt Emissão','Lote','Estornado','Tipo RE/DE'],table=[['Export do SD3'],columns,[999,'P',2,'02','D',45000,'L','N','RE4'],[499,'P',2,'01','D',45000,'L','N','DE4'],[100,'P',3,'01','X',45000,'L','N','DE0']];
 const wb={SheetNames:['SD3'],Sheets:{SD3:{}}},XLSX={utils:{sheet_to_json:()=>table},SSF:{parse_date_code:()=>({y:2026,m:11,d:5})}};const result=M.parseWorkbook(wb,XLSX,{filial:'03'});assert.equal(result.rows.length,2);assert.equal(result.hasBranch,false);assert.equal(result.rows[0].filial,'03');assert.equal(result.rows[0].dt,'2026-11-05');assert.equal(result.rows[0].estornado,false);
 table[2][2]='inválido';assert.throws(()=>M.parseWorkbook(wb,XLSX),/Linha 3/);table[2][2]=2;table[1][7]='Campo ausente';assert.throws(()=>M.parseWorkbook(wb,XLSX),/Estornado/);
});
test('cobertura sugerida inclui dias com outros movimentos, mesmo sem transferências de lotes',()=>{
 const table=[['Tp Movimento','Produto','Quantidade','Armazém','Documento','Dt Emissão','Lote','Estornado'],[999,'P',1,'02','D','2026-11-04','L','N'],[499,'P',1,'01','D','2026-11-04','L','N'],[100,'P',3,'01','X','2026-11-05','','N']],wb={SheetNames:['SD3'],Sheets:{SD3:{}}},XLSX={utils:{sheet_to_json:()=>table}};
 const result=M.parseWorkbook(wb,XLSX);assert.equal(result.rows.length,2);assert.deepEqual(result.period,{desde:'2026-11-04',ate:'2026-11-05'});table.splice(1,2);assert.equal(M.parseWorkbook(wb,XLSX).rows.length,0);assert.equal(M.parseWorkbook(wb,XLSX).period.ate,'2026-11-05');
});
test('recebimentos no mesmo instante preservam a ordem de registro ao distribuir o documento',()=>{
 const result=M.reconcile([receipt({id:'Z',sequence:0}),receipt({id:'A',sequence:1})],base(pair()));assert.equal(result.rows.find(r=>r.id==='Z').allocated,10);assert.equal(result.rows.find(r=>r.id==='A').allocated,0);
});
test('lançamento tardio regulariza o recebimento e informa a data posterior sem repetir a transferência',()=>{
 const sd3=M.replacePeriod(null,pair(10,{dt:'2026-11-08'}),{filial:'01',desde:'2026-11-01',ate:'2026-11-08',now:'2026-11-09T12:00:00Z'}).sd3,result=M.reconcile([receipt()],sd3);assert.equal(result.rows[0].status,'conferido');assert.equal(result.rows[0].lateTransfer,true);assert.match(result.rows[0].message,/após a data/);assert.equal(M.lot('000123.0'),'123');
});

test('a nova extração sobreposta é a referência do período substituído',()=>{
 const original=base([]);
 const next=M.replacePeriod(original,[],{filial:'01',desde:'2026-11-05',ate:'2026-11-05',now:'2026-11-06T14:00:00Z',extractedAt:'2026-11-05T12:00:00Z'}).sd3;
 const result=M.reconcile([receipt(),receipt({id:'Earlier',createdAt:'2026-11-04T13:00:00Z'})],next);
 assert.equal(result.rows.find(r=>r.id==='R1').status,'aguardando_sd3');
 assert.equal(result.rows.find(r=>r.id==='Earlier').status,'divergente');
 assert.throws(()=>M.replacePeriod(next,[],{filial:'01',desde:'2026-11-01',ate:'2026-11-05',now:'2026-11-06T15:00:00Z',extractedAt:'2026-11-05T11:00:00Z'}),/mais recente/);
 assert.throws(()=>M.replacePeriod(null,[],{filial:'01',desde:'2026-11-05',ate:'2026-11-06',now:'2026-11-06T14:00:00Z',extractedAt:'2026-11-05T12:00:00Z'}),/posterior/);
});

test('documentos fora da janela aparecem como candidatos sem consumir saldo',()=>{
 const snapshot=base(pair(10,{dt:'2026-11-02'}));
 const result=M.reconcile([receipt({produto:'P'})],snapshot).rows[0];
 assert.equal(result.status,'divergente');
 assert.equal(result.allocated,0);
 assert.deepEqual(result.olderCandidates,[{doc:'D1',dt:'2026-11-02',remaining:10}]);
 const matched=M.reconcile([receipt({id:'old',createdAt:'2026-11-03T13:00:00Z'}),receipt({produto:'P'})],snapshot).rows.find(r=>r.id==='R1');
 assert.equal(matched.olderCandidates,undefined);
});
