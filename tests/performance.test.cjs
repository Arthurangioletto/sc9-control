const test=require('node:test'),assert=require('node:assert/strict');
const filters=require('../lot-filters.js'),{paging}=filters,{paginateGroups}=require('../expiry-panel.js');
test('paginação visita todos os registros uma única vez e limita cada página',()=>{
 const items=Array.from({length:8386},(_,i)=>({lote:'L'+i})),visited=[];
 for(let p=0;p<Math.ceil(items.length/25);p++){const info=paging.pageInfo(items.length,p);const rows=items.slice(info.start,info.end);assert(rows.length<=25);visited.push(...rows);}
 assert.deepEqual(visited,items);
 assert.equal(paging.pageInfo(0,99).page,0);
 assert.equal(paging.pageInfo(26,99).page,1);
 assert.equal(paging.pageInfo(26,-1).page,0);
});
test('busca localiza lote além da primeira página sem limitar a base',()=>{
 const rows=Array.from({length:1000},(_,i)=>({lote:'LOTE-'+i}));
 assert.equal(paging.targetPage(rows,' lote-999 '),39);
 assert.equal(paging.targetPage(rows,'ausente'),null);
 assert.equal(paging.targetPage(rows,''),null);
 assert.equal(paging.targetPage([{achado:{lote:'ARQUIVADO'}}],'arquivado'),0);
});
test('cache de análises compartilha a classificação entre filtros e invalida na nova importação',()=>{
 let calls=0;const analyze=rows=>{calls++;return[{lote:'L',registros:rows,temSaldoAtivo:true}]};
 const rows=[{filial:'01',armazem:'1',saldo:3},{filial:'03',armazem:'59',saldo:4}];
 assert.equal(filters.analysis(rows,'duplicado','1','1',analyze)[0].registros.length,1);
 assert.equal(filters.analysis(rows,'duplicado','3','59',analyze)[0].registros.length,1);
 filters.baseAnalysis(rows,analyze);assert.equal(calls,1);
 filters.analysis([...rows],'duplicado','','',analyze);assert.equal(calls,2);
 assert.equal(rows.length,2);
});
test('datas salvas são convertidas uma vez, preservam histórico e renovam ao sincronizar',()=>{
 const saved=[{tipo:'duplicado',historicoSaldo:[{data:'2026-01-01'}],dados:{lote:'L',registros:[{filial:'1',armazem:'1',dtValidade:'2030-01-01T00:00:00Z',dtEntrada:null}]}}];
 const first=filters.savedAnalysis(saved,'duplicado','','')[0];
 const scoped=filters.savedAnalysis(saved,'duplicado','1','1')[0];
 assert.strictEqual(scoped.registros[0],first.registros[0]);
 assert(first.registros[0].dtValidade instanceof Date);
 assert.strictEqual(first.historicoSaldo,saved[0].historicoSaldo);
 assert.equal(typeof saved[0].dados.registros[0].dtValidade,'string');
 assert.notStrictEqual(filters.savedAnalysis([...saved],'duplicado','','')[0],first);
});
test('paginação de vencidos limita o total global e mantém totais dos grupos completos',()=>{
 const groups=Array.from({length:500},(_,g)=>['G'+g,Array.from({length:10},(_,r)=>g*10+r)]);
 const visited=[];
 for(let p=0;p<Math.ceil(5000/30);p++){
   const info=paging.pageInfo(5000,p,30),page=paginateGroups(groups,info.start,info.end);
   const rows=page.flatMap(([,items])=>items);assert(rows.length<=30);visited.push(...rows);
   for(const [key,rows,complete]of page){assert.strictEqual(complete,groups.find(([id])=>id===key)[1]);assert(rows.length<=complete.length);}
 }
 assert.deepEqual(visited,Array.from({length:5000},(_,i)=>i));
 assert.equal(groups.length,500);
});
test('exportação de finalizados usa todos os itens, independentemente da página',()=>{
 const fs=require('fs'),path=require('path'),vm=require('vm'),bundle=fs.readFileSync(path.join(__dirname,'..','bundle.js'),'utf8');
 const start=bundle.indexOf('sr=()=>'),end=bundle.indexOf(',ir=',start);
 assert(start>=0&&end>start);
 const items=Array.from({length:63},(_,i)=>({chave:'L'+i,achado:{lote:'L'+i}}));
 let exported;
 const fn=vm.runInNewContext('('+bundle.slice(start+3,end)+')',{
  Ta:items,sc9Analysis:"duplicado",_e:{},ve:x=>x,Gi:rows=>{assert(Array.isArray(rows));return rows;},
  yt:rows=>{exported=rows;},ze:()=>'',Date,window:{alert:message=>{throw Error(message);}},
  React:{createElement:()=>{throw Error('Exportação tentou renderizar paginação');}}
 });
 fn();assert.equal(exported.length,63);assert.equal(exported[62].chave,'L62');
});
