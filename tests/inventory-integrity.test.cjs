const test=require('node:test'),assert=require('node:assert/strict'),I=require('../inventory-integrity.js');
const row=(filial='01',armazem='01',produto='A',lote='L',dtValidade='2020-01-01')=>({filial,armazem,produto,lote,dtValidade,saldo:5});
test('identidade individual diferencia filial, armazém, produto e validade',()=>{const base=row();const variants=[base,row('03'),row('01','02'),row('01','01','B'),row('01','01','A','L','2021-01-01')];assert.equal(new Set(variants.map(I.recordKey)).size,5);assert.equal(I.recordKey(base),I.recordKey({...base,filial:1,armazem:1,dtValidade:new Date('2020-01-01T00:00:00Z')}));});
test('divergências de produtos diferentes permanecem no mesmo grupo de lote',()=>{assert.equal(I.findingKey('duplicado',row()),'L');assert.equal(I.findingKey('duplicado',row('03','02','B')),'L');assert.notEqual(I.findingKey('vencimento',row()),I.findingKey('vencimento',row('03')));});
test('leitura de dados antigos troca a chave sem perder histórico',()=>{const history=[{data:'2020-01-01'}],old={chave:'L|A',tipo:'vencimento',dados:row(),historicoSaldo:history};const migrated=I.canonicalizeFindings([old]);assert.equal(migrated[0].chave,I.recordKey(row()));assert.deepEqual(migrated[0].historicoSaldo,history);assert.equal(old.chave,'L|A');});
test('sincronização parcial mantém os registros de outros armazéns',()=>{const old={dados:{registros:[row(),row('01','02','B')]}},next={dados:{registros:[{...row(),saldo:9}]}};assert.equal(I.mergeFinding(old,next).dados.registros.length,2);assert.equal(I.mergeFinding(old,next).dados.registros[0].saldo,9);assert.equal(I.mergeFinding(old,next,true).dados.registros.length,1);assert.equal(old.dados.registros[0].saldo,5);});
test('nota antiga única preserva identidade, texto e finalização',()=>{const note={id:'n',tipo:'vencimento',chave:'L|A',nota:'Conferir',status:'resolvido'};const found=I.canonicalizeFindings([{chave:'L|A',tipo:'vencimento',dados:row()}]);const migrated=I.migrateNotes([note],found)[0];assert.equal(migrated.id,'n');assert.equal(migrated.chave,I.recordKey(row()));assert.equal(migrated.nota,'Conferir');assert.equal(migrated.status,'resolvido');assert.equal(note.chave,'L|A');});
test('nota antiga ambígua não finaliza automaticamente várias filiais',()=>{const note={id:'n',tipo:'vencimento',chave:'L|A',nota:'Antiga',status:'resolvido'};const found=I.canonicalizeFindings([row(),row('03')].map(dados=>({chave:'L|A',tipo:'vencimento',dados})));const result=I.migrateNotes([note],found);assert.equal(result.length,1);assert.equal(result[0].legacyUnscoped,true);assert.equal(result[0].chave,'L|A');});
test('nota scoped prevalece e a antiga permanece disponível para consulta',()=>{const old={id:'old',tipo:'vencimento',chave:'L|A',nota:'Antiga'},scoped={id:'new',tipo:'vencimento',chave:I.recordKey(row()),nota:'Nova'};const result=I.migrateNotes([old,scoped],I.canonicalizeFindings([{tipo:'vencimento',chave:'L|A',dados:row()}]));assert.equal(result[0].legacyUnscoped,true);assert.equal(result[1].nota,'Nova');});
test('snapshot completo inclui futuras validades sem depender de filtro de prazo',()=>{const records=I.allExpiryRecords([row(),row('01','02','B','F','2040-01-01'),{...row(),saldo:0}],new Date('2026-01-01'));assert.equal(records.length,2);assert.equal(records[0].jaVencido,true);assert.equal(records[1].jaVencido,false);});

test('base com filial não duplica a ocorrência antiga sem filial e preserva seu histórico',()=>{
 const old={tipo:'saldoNegativo',chave:I.recordKey(row('')),dados:row(''),historicoSaldo:[{data:'2020-01-01'}]};
 const fresh={tipo:'saldoNegativo',chave:I.recordKey(row('03')),dados:row('03')};
 const all=[old,fresh];assert.deepEqual(I.currentFindings(all),[fresh]);assert.equal(all.length,2);assert.equal(old.historicoSaldo.length,1);
 assert.equal(I.currentFindings([old,{...fresh,dados:row('03','02')}]).length,2);
});

test('nota v2 sem filial migra somente para uma ocorrência única',()=>{
 const old={id:'x',tipo:'saldoNegativo',chave:I.recordKey(row('')),nota:'Conferir',status:'resolvido',finalizadoEm:'2020-01-01'};
 const found=[row(''),row('03')].map(dados=>({tipo:old.tipo,chave:I.recordKey(dados),dados}));
 const result=I.migrateNotes([old],found)[0];assert.equal(result.chave,I.recordKey(row('03')));assert.equal(result.status,'resolvido');assert.equal(result.finalizadoEm,old.finalizadoEm);assert.equal(old.chave,I.recordKey(row('')));
 const ambiguous=I.migrateNotes([old],[...found,{tipo:old.tipo,chave:I.recordKey(row('02')),dados:row('02')}])[0];assert.equal(ambiguous.chave,old.chave);assert.equal(ambiguous.legacyUnscoped,true);
});

test('produto correto e campos físicos acompanham uma filial única sem perder texto ou finalização',()=>{
 const key='|A|1|2020-01-01',scoped='3|A|1|2020-01-01';
 const note={id:'g',tipo:'duplicado',chave:'L',nota:'Manter',status:'resolvido',correto:key,fisico:{[key]:{anvisa:'123',fab:'2019-01-01'}}};
 const finding={tipo:'duplicado',chave:'L',dados:{registros:[row('03'),row('01','02','B')]}};
 const migrated=I.migrateNotes([note],[finding])[0];assert.equal(migrated.correto,scoped);assert.deepEqual(migrated.fisico[scoped],note.fisico[key]);assert.equal(migrated.fisico[key],undefined);assert.equal(migrated.nota,'Manter');assert.equal(migrated.status,'resolvido');assert.deepEqual(migrated.legacyRecordFields,[]);assert.equal(note.correto,key);
});

test('conferência física ambígua ou conflitante fica preservada e não é copiada entre filiais',()=>{
 const key='|A|1|2020-01-01';const note={tipo:'duplicado',chave:'L',correto:key,fisico:{[key]:{anvisa:'123'}}};
 const finding={tipo:'duplicado',chave:'L',dados:{registros:[row('01'),row('03')]}};
 const migrated=I.migrateNotes([note],[finding])[0];assert.equal(migrated.correto,key);assert.deepEqual(migrated.fisico,note.fisico);assert.equal(migrated.legacyRecordFields.length,2);
 const conflict={...note,fisico:{...note.fisico,'1|A|1|2020-01-01':{anvisa:'456'}}};
 const result=I.migrateNotes([conflict],[{...finding,dados:{registros:[row('01')]}}])[0];assert.deepEqual(result.fisico,conflict.fisico);assert.deepEqual(result.legacyRecordFields,['conferência física']);
});

test('importação processada valida a base inteira antes de gravar e mantém grupos completos',async()=>{
 const items=Array.from({length:2001},(_,n)=>({chave:'L'+n,tipo:'duplicado',dados:{registros:[row()]}}));const calls=[],progress=[];
 const result=await I.importPrepared({format:'sc9-sb8-v1',source:{rows:421130},achados:items},async body=>calls.push(body),(done,total)=>progress.push([done,total]));
 assert.deepEqual(calls.map(c=>c.achados.length),[2000,1]);assert(calls.every(c=>c.completeGroups===true));assert.deepEqual(progress,[[2000,2001],[2001,2001]]);assert.equal(result.records,421130);assert.equal(result.findings,2001);
 const invalid=[...items,{chave:'x',tipo:'duplicado',dados:{}}];let writes=0;
 await assert.rejects(I.importPrepared({format:'sc9-sb8-v1',achados:invalid},async()=>writes++),/sem registros/);assert.equal(writes,0);
});

test('importação processada interrompe após erro e não comunica conclusão parcial',async()=>{
 const items=Array.from({length:4001},(_,n)=>({chave:'L'+n,tipo:'duplicado',dados:{registros:[row()]}}));let sends=0;const progress=[];
 await assert.rejects(I.importPrepared({format:'sc9-sb8-v1',achados:items},async()=>{if(++sends===2)throw Error('503');},done=>progress.push(done)),/503/);
 assert.equal(sends,2);assert.deepEqual(progress,[2000]);
});
