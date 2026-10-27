const {test}=require('node:test'),assert=require('node:assert/strict');
const I=require('../inventory-integrity.js');
const row=(produto='A',lote='L')=>({produto,lote,armazem:'01',filial:'',saldo:5,dtValidade:'2030-01-01',dtFabricacao:'2020-01-01',descricao:'Preservar'});
const finding=(tipo='duplicado',dados={lote:'L',registros:[row()]})=>({tipo,chave:I.findingKey(tipo,dados),dados,historicoSaldo:[{data:'2026-01-01',porProduto:{A:5}}],primeiraVezEm:'2026-01-01',ultimaVezEm:'2026-10-14'});
test('preenche somente filial e conserva todos os campos e históricos',()=>{
 const old=finding(),snapshot=JSON.stringify(old);
 const result=I.enrichBranches([old],[],[['A','L','1','01']]);
 assert.equal(result.stats.updatedRows,1);assert.equal(result.achados[0].dados.registros[0].filial,'1');
 const restored=structuredClone(result.achados[0]);restored.dados.registros[0].filial='';
 assert.deepEqual(restored,old);assert.equal(JSON.stringify(old),snapshot);
});
test('qualquer observação protege finalizados, marcados, ignorados e conferências',()=>{
 for(const fields of [{status:'resolvido'},{cor:'amarelo'},{status:'ignorado'},{nota:'Trabalho feito'},{correto:'|A|1|2030-01-01'},{fisico:{x:{anvisa:'123'}}},{}]){
  const old=finding(),note={tipo:'duplicado',chave:'L',...fields};
  const snapshot=JSON.stringify(note),result=I.enrichBranches([old],[note],[['A','L','1','1']]);
  assert.strictEqual(result.achados[0],old);assert.equal(result.stats.protectedFindings,1);assert.equal(JSON.stringify(note),snapshot);
 }
});
test('protege registros individuais com notas atuais ou antigas',()=>{
 const old=finding('saldoNegativo',row());
 for(const chave of [old.chave,'L|A']){
  assert.strictEqual(I.enrichBranches([old],[{tipo:old.tipo,chave,cor:'verde'}],[['A','L','1','3']]).achados[0],old);
 }
});
test('individual pendente recebe identidade da filial e mantém quantidade de achados',()=>{
 const old=finding('vencimento',row()),result=I.enrichBranches([old],[],[['A','L','1','4']]);
 assert.equal(result.achados.length,1);assert.equal(result.achados[0].chave,I.recordKey({...row(),filial:'4'}));
 assert.deepEqual(result.achados[0].historicoSaldo,old.historicoSaldo);
});
test('vínculos ambíguos, ausentes e filiais existentes permanecem intactos',()=>{
 const old=finding(),hasBranch=finding('duplicado',{lote:'L',registros:[{...row(),filial:'2'}]});
 assert.strictEqual(I.enrichBranches([old],[],[['A','L','1','1'],['A','L','1','3']]).achados[0],old);
 assert.strictEqual(I.enrichBranches([old],[],[['B','L','1','1']]).achados[0],old);
 assert.strictEqual(I.enrichBranches([hasBranch],[],[['A','L','1','1']]).achados[0],hasBranch);
});
test('não colide com um registro que já tem identidade de filial',()=>{
 const old=finding('vencimento',row()),scoped=finding('vencimento',{...row(),filial:'1'});
 const result=I.enrichBranches([old,scoped],[],[['A','L','1','1']]);
 assert.deepEqual(result.achados,[old,scoped]);assert.equal(result.stats.updatedRows,0);
});
test('produto em várias filiais exige coincidência de saldo e validade para desambiguar',()=>{
 const old=finding();
 const result=I.enrichBranches([old],[],[['A','L','1','1','5','2030-01-01'],['A','L','1','3','9','2030-01-01']]);
 assert.equal(result.achados[0].dados.registros[0].filial,'1');
 assert.strictEqual(I.enrichBranches([old],[],[['A','L','1','1','5','2030-01-01'],['A','L','1','3','5','2030-01-01']]).achados[0],old);
});
test('valida a entrada toda antes de produzir mudanças',()=>{
 const old=finding(),snapshot=JSON.stringify(old);
 assert.throws(()=>I.enrichBranches([old],[],[['A','L','1','1'],['B','L','1','99']]),/inválido/);
 assert.equal(JSON.stringify(old),snapshot);
});
test('importação específica envia uma atualização única sem recalcular achados',async()=>{
 const bodies=[],progress=[];
 const result=await I.importPrepared({format:'sc9-sb8-filiais-v1',entries:[['A','L','1','1']],source:{rows:421130}},async body=>{bodies.push(body);return {updatedRows:1,protectedFindings:53};},(...p)=>progress.push(p));
 assert.equal(bodies.length,1);assert.equal(bodies[0].acao,'completarFiliais');assert.equal(bodies[0].achados,undefined);assert.equal(result.updatedRows,1);assert.equal(result.branchOnly,true);assert.deepEqual(progress,[[0,1],[1,1]]);
});
