const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../stock-position.js'),E=require('../expiry-panel.js');
const row=(more={})=>({filial:'01',armazem:'RJ',produto:'P',lote:'L',saldo:10,dtValidade:'2026-10-01',...more});
test('saldo substitui em vez de acumular; zero remove das métricas, sem alterar a base anterior',()=>{
 const previous={rows:[row()]},copy=structuredClone(previous);
 const updated=S.update(previous,[row({saldo:0})]);assert.equal(updated.position.rows[0].saldo,0);assert.deepEqual(previous,copy);
 assert.equal(E.stateSummary(E.enrich(updated.position.rows,new Date(2026,9,29)),'RJ').units,0);
 assert.equal(E.stateSummary(E.enrich(updated.position.rows,new Date(2026,9,29)),'RJ').lots,0);
});
test('parcial retém ausentes; completo zera só os pares filial/armazém presentes',()=>{
 const previous={rows:[row(),row({produto:'AUSENTE'}),row({filial:'02'}),row({armazem:'RT'})]};
 const partial=S.update(previous,[row({saldo:2})]);assert.equal(partial.stats.retained,3);assert.equal(partial.position.rows.find(r=>r.produto==='AUSENTE').saldo,10);
 const complete=S.update(previous,[row({saldo:2})],{mode:'scopes'});assert.equal(complete.stats.zeroed,1);assert.equal(complete.position.rows.find(r=>r.produto==='AUSENTE').saldo,0);assert.equal(complete.position.rows.find(r=>r.filial==='02').saldo,10);assert.equal(complete.position.rows.find(r=>r.armazem==='RT').saldo,10);
});
test('agrega linhas físicas do arquivo e não multiplica referências nos achados antigos',()=>{
 assert.equal(S.aggregate([row(),row({saldo:2.5})])[0].saldo,12.5);
 const findings=[{dados:row()},{dados:{registros:[row()]}}];assert.equal(S.seed(findings).rows.length,1);assert.equal(S.seed(findings).rows[0].saldo,10);
 assert.equal(S.seed([...findings,{dados:row({saldo:3})}]).ambiguous,1);assert.equal(S.seed([...findings,{dados:row({saldo:3})}]).rows.length,0);
});
test('par de armazéns nunca inclui outra filial nem o outro estado',()=>{
 const rows=E.enrich([row({saldo:2}),row({armazem:'RT',saldo:3}),row({armazem:'BH',saldo:9}),row({armazem:'BT',saldo:4}),row({filial:'02',saldo:20}),row({saldo:0,produto:'ZERO'}),row({saldo:-4,produto:'NEG'})],new Date(2026,9,29));
 const scoped=rows.filter(r=>S.code(r.filial)==='1');assert.equal(E.stateSummary(scoped,'RJ').units,5);assert.equal(E.stateSummary(scoped,'BH').units,13);assert.equal(E.stateSummary(scoped,'RJ').lots,1);
});
test('inclui novos lotes a vencer, sem confundir com vencidos e sem incluir saldo zero',()=>{
 const rows=E.enrich([row(),row({lote:'FUT',dtValidade:'2026-11-10',saldo:4}),row({lote:'LONG',dtValidade:'2027-03-01',saldo:8}),row({lote:'ZERO',dtValidade:'2026-11-10',saldo:0})],new Date(2026,9,29));
 const summary=E.stateSummary(rows,'RJ');assert.equal(summary.units,10);assert.equal(summary.upcoming,4);
});
test('saldo igual tem datas comparáveis e reinicia a contagem quando muda',()=>{
 const a=S.update(null,[row()],{now:'2026-10-01T12:00:00Z'}).position;
 const b=S.update(a,[row()],{now:'2026-10-20T12:00:00Z'}).position;assert.equal(b.rows[0].observations,2);assert.equal(b.rows[0].balanceSince,'2026-10-01T12:00:00Z');
 const c=S.update(b,[row({saldo:9})],{now:'2026-10-29T12:00:00Z'}).position;assert.equal(c.rows[0].observations,1);assert.equal(c.rows[0].previousSaldo,10);
});
test('entrada inválida não produz um saldo parcial',()=>{
 assert.throws(()=>S.update(null,[row(),row({filial:''})]),/filial/);assert.throws(()=>S.update(null,[row({saldo:'não numérico'})]),/numérico/);
});
test('arquivo completo zera ausentes inclusive de filiais e armazéns inteiramente ausentes',()=>{
 const previous={rows:[row(),row({filial:'02',armazem:'DT'})]};
 const result=S.update(previous,[row({saldo:3})],{mode:'complete'});assert.equal(result.stats.zeroed,1);assert.equal(result.position.rows.find(r=>r.filial==='02').saldo,0);
});
test('todos os estados incluem o respectivo subestoque confirmado',()=>{
 for(const [state,sub]of [['DF','DT'],['ES','ET'],['CE','CT']]){
  const rows=E.enrich([row({armazem:state,saldo:2}),row({armazem:sub,saldo:4})],new Date(2026,9,29));assert.equal(E.stateSummary(rows,state).units,6);
 }
});
test('validade persistida à meia-noite não retrocede no fuso de São Paulo',()=>{
 const r=E.enrich([row({dtValidade:new Date('2026-10-01T00:00:00.000Z')})],new Date(2026,9,29))[0];
 assert.equal(r.expiryMonth,'10');assert.equal(r.expiredDays,28);assert.deepEqual(E.dateParts(r.dtValidade),{y:2026,m:10,d:1});
});

test('retirada preventiva considera hoje até o 90º dia e avança com a data da consulta',()=>{
 const now=new Date(2026,9,29),base=E.day('2026-10-29');
 const date=offset=>new Date((base+offset)*86400000).toISOString().slice(0,10);
 const rows=[row({lote:'HOJE',dtValidade:date(0),saldo:1}),row({lote:'DIA90',dtValidade:date(90),saldo:2}),row({lote:'DIA91',dtValidade:date(91),saldo:4}),row({lote:'ZERO',dtValidade:date(30),saldo:0}),row({lote:'VENCIDO',dtValidade:date(-1),saldo:8})];
 const today=E.stateSummary(E.enrich(rows,now),'RJ');assert.equal(today.upcoming,3);assert.equal(today.units,8);
 const tomorrow=E.stateSummary(E.enrich(rows,new Date(2026,9,30)),'RJ');assert.equal(tomorrow.upcoming,6);assert.equal(tomorrow.units,9);
});
