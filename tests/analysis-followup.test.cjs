const test=require('node:test'),assert=require('node:assert/strict');
const {followup}=require('../lot-filters.js');
test('cada análise mantém seu tipo e identifica vencimento pela rota existente',()=>{
 for(const item of followup.analyses){assert.equal(followup.typeFor(item.id),item.type);assert.equal(followup.typeFor(item.type),item.type);assert.equal(followup.labelFor(item.id),item.label);}
 assert.equal(followup.typeFor('importacoes'),null);
 assert.equal(followup.typeFor('marcados'),null);
});
test('marcações de análises diferentes não se misturam mesmo com a mesma chave',()=>{
 const items=followup.analyses.flatMap(({type})=>[{tipo:type,chave:'LOTE-IGUAL',nota:'Nota '+type},{tipo:type,chave:'OUTRO',nota:'Outro '+type}]);
 for(const {type}of followup.analyses){const view=followup.scope(items,type);assert.equal(view.length,2);assert(view.every(item=>item.tipo===type));assert.strictEqual(view[0],items.find(item=>item.tipo===type));}
 assert.equal(items.length,10);
 assert.deepEqual(Object.values(followup.counts(items)),[2,2,2,2,2]);
});
test('contadores de marcados e finalizados são separados por análise',()=>{
 const marked=[{tipo:'duplicado'},{tipo:'vencimento'},{tipo:'vencimento'}],finalized=[{tipo:'validadeVariavel'},{tipo:'duplicado'},{tipo:'duplicado'},{tipo:'saldoNegativo'}];
 assert.equal(followup.counts(marked).duplicado,1);assert.equal(followup.counts(finalized).duplicado,2);
 assert.equal(followup.counts(marked).vencimento,2);assert.equal(followup.counts(finalized).vencimento,0);
 assert.equal(followup.scope(marked,'validade').length,2);
 assert.equal(followup.scope(finalized,'validade').length,0);
 assert.equal(followup.counts([{tipo:'antigo-desconhecido'}]).duplicado,0);
});
test('exportação de uma análise usa todos os seus finalizados e preserva observações',()=>{
 const items=followup.analyses.flatMap(({type})=>Array.from({length:63},(_,i)=>({tipo:type,chave:type+i,lembrete:{nota:'Nota '+type+i}})));
 const scoped=followup.scope(items,'saldoNegativo');
 assert.equal(scoped.length,63);assert(scoped.every(item=>item.tipo==='saldoNegativo'));
 assert.equal(scoped[62].lembrete.nota,'Nota saldoNegativo62');
});
test('a tela real separa marcações, finalizados e seus contadores por tipo',()=>{
 const fs=require('fs'),path=require('path'),vm=require('vm'),bundle=fs.readFileSync(path.join(__dirname,'..','bundle.js'),'utf8');
 const notes={},lookup=new Map();
 for(const {type}of followup.analyses)for(const status of ['pendente','resolvido']){
  const note={tipo:type,chave:type+'-'+status,status,cor:'vermelho',atualizadoEm:'2026-10-14'};
  notes[note.chave+'|'+type]=note;lookup.set(note.chave+'|'+type,{lote:note.chave});
 }
 const markedStart=bundle.indexOf('sc9AllMarked=(0,g.useMemo)'),markedEnd=bundle.indexOf(',Ca=',markedStart);
 const finalizedStart=bundle.indexOf('sc9AllFinalized=(0,g.useMemo)'),finalizedEnd=bundle.indexOf(',sr=',finalizedStart);
 assert(markedStart>=0&&markedEnd>markedStart&&finalizedStart>=0&&finalizedEnd>finalizedStart);
 const source='let '+bundle.slice(markedStart,markedEnd)+';let '+bundle.slice(finalizedStart,finalizedEnd)+';({Oa,ia,Ta,sc9FollowupCounts})';
 for(const {type}of followup.analyses)for(const includeAll of [false,true]){
  const result=vm.runInNewContext(source,{g:{useMemo:fn=>fn()},$:notes,Eo:lookup,F:includeAll,sc9Filial:'',q:'__TODOS__',sc9Analysis:type,window:{SC9Followup:followup},Date});
  assert.equal(result.Oa.length,1);assert.equal(result.Oa[0].tipo,type);assert.equal(result.Oa[0].status,'pendente');
  assert.equal(result.ia.length,1);assert.equal(result.Ta.length,1);assert.equal(result.Ta[0].tipo,type);
  for(const {type:other}of followup.analyses){assert.equal(result.sc9FollowupCounts.marked[other],1);assert.equal(result.sc9FollowupCounts.finalized[other],1);}
 }
 const noMatches=vm.runInNewContext(source,{g:{useMemo:fn=>fn()},$:notes,Eo:new Map(),F:false,sc9Filial:'',q:'59',sc9Analysis:'duplicado',window:{SC9Followup:followup},Date});
 assert.equal(noMatches.Oa.length,0);assert.equal(noMatches.ia.length,0);
});
