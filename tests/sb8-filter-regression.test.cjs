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
test('prazo de vencimento inclui o dia 30 inteiro e não depende do horário da importação',()=>{
 const rows=[{saldo:2,dtValidade:new Date('2026-11-28T15:00:00Z')},{saldo:5,dtValidade:new Date('2026-11-29T00:00:00Z')},{saldo:1,dtValidade:new Date('2026-10-29T00:00:00Z')}];
 const now=new Date(2026,9,29,8);const result=Ei(rows,30,now);
 assert.equal(result.length,2);assert.equal(result[1].diasParaVencer,30);assert.equal(result[0].jaVencido,false);
});
test('atualização de saldo rejeita números inválidos e identidade incompleta antes de enviar',async()=>{
 for(const record of [['01','A','L','RJ','erro'],['','A','L','RJ',5],['01','A','L','',5]]){
  const book={SheetNames:['SB8'],Sheets:{SB8:sheet([['Filial','Produto','Lote','Armazém','Saldo'],record])}};
  await assert.rejects(()=>pi(book,undefined,true),/inválido|ausente/);
 }
 const valid={SheetNames:['SB8'],Sheets:{SB8:sheet([['Filial','Produto','Lote','Armazém','Saldo','B8_DTVALID'],['01','A','L','RJ',0,'        ']])}};
 assert.equal((await pi(valid,undefined,true)).records[0].saldo,0);
});
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

test('SB8 bruto: fabricação real, entrada, datas texto, filial e exclusão lógica',async()=>{
 const headers=['B8_FILIAL','B8_PRODUTO','B8_LOCAL','B8_DATA','B8_DTVALID','B8_SALDO','B8_LOTECTL','B8_NUMLOTE','B8_DFABRIC','D_E_L_E_T_'];
 const book={SheetNames:['Planilha1'],Sheets:{Planilha1:sheet([
  headers,
  [1,'A',1,20230118,'20280102',5,'CONTROLE','SUBLOTE','20220905',' '],
  ['03','B','59','20230118',20280102,8,'CONTROLE','','20220228','*'],
  ['02','C','02','20230118',20280102,2,' ','ALTERNATIVO','20220228',''],
  ['04','D','04','20230118',20280102,3,'LOTE-D','','','']
 ])}};
 const parsed=await pi(book);
 assert.equal(parsed.records.length,3);
 const [a,c,d]=parsed.records;
 assert.equal(a.filial,'1');assert.equal(a.armazem,'1');assert.equal(a.lote,'CONTROLE');
 assert.equal(a.dtFabricacao.getFullYear(),2022);assert.equal(a.dtFabricacao.getMonth(),8);assert.equal(a.dtFabricacao.getDate(),5);
 assert.equal(a.dtEntrada.getFullYear(),2023);assert.equal(a.dtEntrada.getDate(),18);
 assert.equal(a.dtValidade.getFullYear(),2028);assert.equal(c.lote,'ALTERNATIVO');
 assert.equal(d.dtFabricacao,null);assert.equal(d.dtEntrada.getFullYear(),2023);
 assert.deepEqual(Array.from(parsed.records,r=>r.filial),['1','2','4']);
});

test('datas compactas inválidas não são convertidas para outro mês',()=>{
 for(const v of ['20230229','20241301','00000000','20240230','20240100',20241301,'texto',new Date('invalid')])assert.equal(context.ci(v),null);
 assert.equal(context.ci('20240229').getDate(),29);
});

test('exclusões lógicas consecutivas não interrompem a leitura',async()=>{
 const headers=['B8_FILIAL','B8_PRODUTO','B8_LOCAL','B8_LOTECTL','B8_SALDO','D_E_L_E_T_'];
 const deleted=Array.from({length:301},()=>['01','A','01','L',5,'*']);
 const parsed=await pi({SheetNames:['SB8'],Sheets:{SB8:sheet([headers,...deleted,['03','B','59','ATIVO',9,' ']])}});
 assert.equal(parsed.records.length,1);assert.equal(parsed.records[0].lote,'ATIVO');
});

test('cópia CSV conserva zeros dos códigos e datas compactas textuais',async()=>{
 const parsed=await pi({SheetNames:['Sheet1'],Sheets:{Sheet1:sheet([
  ['Filial','Produto','Lote','Armazem','Saldo','Fabricacao','Validade','Dt Entrada'],
  ['01','000123','000456','01','5','20220228','20280102','20230118']
 ])}});
 assert.equal(parsed.records[0].produto,'000123');assert.equal(parsed.records[0].lote,'000456');assert.equal(parsed.records[0].saldo,5);assert.equal(parsed.records[0].dtFabricacao.getFullYear(),2022);
 const upload=bundle.slice(bundle.indexOf('let bt=async u=>'),bundle.indexOf('},Ot=async',bundle.indexOf('let bt=async u=>')));
 assert.match(upload,/raw:!0/);assert.match(bundle,/accept:t\?"\.xlsx,\.xls,\.csv,\.json":"\.xlsx,\.xls,\.csv",onChange:u=>bt/);
});
