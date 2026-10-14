const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const filters = require('../lot-filters.js');
const bundle = fs.readFileSync(require('node:path').join(__dirname, '..', 'bundle.js'), 'utf8');
function cut(a,b) { const i=bundle.indexOf(a),j=bundle.indexOf(b,i);assert(i>=0&&j>i);return bundle.slice(i,j); }
const context = vm.createContext({
  window: { SC9LotFilters:filters }, Date, setTimeout,
  ze:value=>value.toISOString().slice(0,10), Ht:filters.normalize, pa:filters.normalize,
  Qe:{ utils:{ encode_cell:({r,c})=>r+':'+c, decode_range:ref=>ref } },
  Ge:value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim().replace(/\s+/g,' '),
  Le:value=>String(value??'').trim(), io:value=>value, co:filters.normalize, k:String, no:value=>value,
  Y:(sheet,r,c)=>sheet['!data']?.[r]?.[c]?.v ?? sheet[r+':'+c]?.v ?? null
});
vm.runInContext(cut('function ci(', 'async function pi(')+cut('async function pi(', 'function vi(')+cut('function _i(', 'var pt='),context);
const {mi,ui,pi,fi,gi,_i,Ao,Vi,Ei}=context;
function sheet(rows,dense=true,offset=0){
  const data=Array.from({length:offset},()=>[]).concat(rows);
  const out={'!ref':{s:{r:0,c:0},e:{r:data.length-1,c:rows[0].length-1}}};
  if(dense)out['!data']=data.map(row=>row.map(v=>({v})));
  else data.forEach((row,r)=>row.forEach((v,c)=>out[r+':'+c]={v}));
  return out;
}
for(const header of ['Filial','B8_FILIAL',' Cód. Filial ','Código da Filial','Filial (B8_FILIAL)','Filial SB8']){
  for(const dense of [true,false]){
    test('importação real: '+header+' / '+(dense?'densa':'esparsa'),async()=>{
      const book={SheetNames:['SB8'],Sheets:{SB8:sheet([[header,'Produto','Lote','Armazém','Saldo'],['01','A','L','01',5],['03','B','L','59',0]],dense,2)}};
      const parsed=await pi(book);
      assert.equal(parsed.present,true);assert.equal(parsed.records.length,2);
      assert.deepEqual(Array.from(parsed.records,r=>r.filial),['1','3']);
      assert.equal(filters.records(parsed.records,'01').length,1);
      assert.equal(filters.records(parsed.records,'03').length,1);
    });
  }
}
test('coluna ausente e células vazias não viram filial por suposição',async()=>{
  for(const rows of [
    [['Produto','Lote','Armazém','Saldo'],['A','L','01',5]],
    [['Filial','Produto','Lote','Armazém','Saldo'],['','A','L','01',5]]
  ]){
    const parsed=await pi({SheetNames:['SB8'],Sheets:{SB8:sheet(rows)}});
    assert.equal(parsed.records[0].filial,'');
    assert.equal(filters.coverage(parsed.records,[]).missing,1);
    assert.equal(filters.records(parsed.records,'01').length,0);
    assert.equal(filters.records(parsed.records,'__SEM_FILIAL__').length,1);
  }
  assert.equal(filters.branchHeader('Filial de origem'),false);
  assert.equal(filters.branchHeader('Armazém'),false);
});
const rows=[
 {filial:'01',armazem:'01',produto:'A',lote:'MISTO',saldo:10,dtValidade:new Date('2020-01-01')},
 {filial:'03',armazem:'59',produto:'B',lote:'MISTO',saldo:0,dtValidade:new Date('2021-01-01')},
 {filial:'02',armazem:'02',produto:'A',lote:'DUAS',saldo:8,dtValidade:new Date('2020-01-01')},
 {filial:'04',armazem:'04',produto:'A',lote:'DUAS',saldo:7,dtValidade:new Date('2020-01-01')},
 {filial:'',armazem:'01',produto:'X',lote:'SEM',saldo:-2,dtValidade:new Date('2020-01-01')}
];
test('reproduz a perda da divergência ao recalcular apenas a unidade ou armazém',()=>{
 assert.equal(fi(filters.records(rows,'01')).length,0);
 const fixed=filters.analysis(rows,'duplicado','01','01',fi);
 assert.equal(fixed.length,1);assert.equal(fixed[0].registros.length,1);
 assert.equal(fixed[0].qtdProdutosDistintos,2);
 assert.equal(filters.analysis(rows,'validadeVariavel','03','59',gi).length,1);
 assert.equal(filters.analysis(rows,'multiFilial','02','02',_i).length,1);
});
test('matriz de filial × armazém coincide na base carregada e nos achados salvos',()=>{
 let combinations=0;
 for(const [type,analyze] of [['duplicado',fi],['validadeVariavel',gi],['multiFilial',_i]]){
   const saved=analyze(rows).map(dados=>({tipo:type,dados}));
   for(const filial of ['', '01','02','03','04','__SEM_FILIAL__'])
     for(const arm of ['__TODOS__','01','02','04','59','99']){
       const live=filters.analysis(rows,type,filial,arm,analyze);
       const stored=filters.findings(saved,filial,arm).map(item=>item.dados);
       assert.deepEqual(live,stored);combinations++;
       for(const item of live)for(const row of item.registros){
         assert(filters.records([row],filial).length);
         if(arm!=='__TODOS__')assert.equal(filters.normalize(row.armazem),filters.normalize(arm));
       }
     }
 }
 assert.equal(combinations,108);
 assert.equal(rows.length,5);
});
test('prioridade só ordena; a caixa só-com-saldo é que remove registros',()=>{
 const group=filters.analysis(rows,'duplicado','03','59',fi);
 assert.equal(Ao(group,{armazem:'01',filial:'',soComSaldo:false}).length,1);
 assert.equal(Ao(group,{armazem:'01',filial:'',soComSaldo:true}).length,0);
 assert.equal(Ao(filters.analysis(rows,'duplicado','01','01',fi),{armazem:'01',filial:'01',soComSaldo:true}).length,1);
});
test('sem filial permanece acessível e a cobertura independe do filtro ativo',()=>{
 const saved=[{tipo:'saldoNegativo',dados:rows[4]}];
 assert.equal(filters.findings(saved,'__SEM_FILIAL__','01').length,1);
 assert.equal(filters.findings(saved,'01','01').length,0);
 assert.equal(filters.findings(saved,'','01').length,1);
 assert.deepEqual(filters.coverage(rows,[]),{total:5,missing:1});
 assert.deepEqual(filters.coverage([],saved),{total:1,missing:1});
});
