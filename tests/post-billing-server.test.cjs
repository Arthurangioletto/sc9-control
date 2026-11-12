const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
test('pós-faturamento exige motivo, confere lote original disponível e registra conferência manual quando ausente',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sc9-post-billing-'));for(const name of ['server.js','stock-position.js','inventory-integrity.js'])fs.copyFileSync(path.join(__dirname,'..',name),path.join(dir,name));fs.mkdirSync(path.join(dir,'data'));
 const index={pedidos:{'900001':{a:'Cambuci',nf:'NF1',it:[{produto:'P',qt:6,lote:''}]},'900002':{a:'Cambuci',nf:'NF2',it:[{produto:'P',qt:3,lote:'L-ORIGINAL'},{produto:'Q',qt:2,lote:'Q-ORIGINAL'}]}},nomes:{P:'Produto P',Q:'Produto Q'}};
 fs.writeFileSync(path.join(dir,'data','pedidos-indice.json'),JSON.stringify(index));const notes='{"lembretes":[{"nota":"preservar"}]}',snapshot='{"teste":"base global preservada"}';fs.writeFileSync(path.join(dir,'data','cadastro-lembretes.json'),notes);fs.writeFileSync(path.join(dir,'data','latest.json'),snapshot);
 delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_KEY;process.env.PORT='0';process.env.APP_PASSWORD=crypto.randomUUID();process.env.SESSION_SECRET=crypto.randomUUID();process.env.NODE_ENV='test';
 const server=require(path.join(dir,'server.js'));if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;let cookie;
 async function req(url,body,auth=cookie){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Sc9-App':'1',...(auth?{Cookie:auth}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 try{
  cookie=(await req('/api/login',{password:process.env.APP_PASSWORD})).cookie;
  const entries={};for(const pedido of ['900001','900002','900003']){const created=await req('/api/saida/bipar',{pedido});assert.equal(created.status,200);entries[pedido]=created.data.entry;assert.equal((await req('/api/saida/alteracao',{id:entries[pedido].id,acao:'marcar'})).status,200);}
  const original=(await req('/api/saida/alteracoes')).data;
  await req('/api/usuarios',{acao:'criar',usuario:'revisor',nome:'Revisor',senha:'ficticio-revisao-123',perfis:['alteracoes']});
  const reviewer=(await req('/api/login',{usuario:'revisor',password:'ficticio-revisao-123'})).cookie;
  assert.equal((await req('/api/saida/alteracoes',null,reviewer)).data.itens.length,3);
  assert.equal((await req('/api/revisao-alteracoes?pedido=0900001',null,reviewer)).data.itens[0].status,'pendente');
  assert.equal((await req('/api/saida/alteracao',{id:entries['900001'].id,acao:'marcar'},reviewer)).status,403);
  const confirm=(pedido,more={})=>req('/api/saida/alteracao',{id:entries[pedido].id,acao:'confirmar',pedidoComplemento:'900099',motivo:'Troca de lote conferida na NF',itens:[{item:'P',quantidade:2,lote:'MANUAL'}],...more});
  assert.equal((await confirm('900001',{motivo:''})).status,400);assert.equal((await confirm('900001',{pedidoComplemento:'900001'})).status,400);assert.equal((await confirm('900001',{itens:[{item:'P',quantidade:'Infinity',lote:'L'}]})).status,400);assert.equal((await confirm('900001',{itens:[{item:'P',quantidade:1,lote:''}]})).status,400);
  assert.equal((await confirm('900001',{itens:[{item:'OUTRO',quantidade:1,lote:'L'}]})).status,400);
  assert.equal((await confirm('900002',{itens:[{item:'P',quantidade:1,lote:'L-ORIGINAL'},{item:'Q',quantidade:1,lote:'ERRADO'}]})).status,400);assert.deepEqual((await req('/api/saida/alteracoes')).data,original);
  const manual=await confirm('900001',{itens:[{item:'P',quantidade:.5,lote:'159537'}]});assert.equal(manual.status,200);assert.equal(manual.data.entry.alteracao.itens[0].validacaoLote,'manual_sem_lote_sc9');assert.equal(manual.data.entry.alteracao.itens[0].quantidade,.5);assert.equal(manual.data.entry.alteracao.motivo,'Troca de lote conferida na NF');assert.equal(manual.data.entry.alteracao.pedidoComplemento,'900099');
  const checked=await confirm('900002',{itens:[{item:'P',quantidade:1,lote:'L-ORIGINAL'}]});assert.equal(checked.status,200);assert.equal(checked.data.entry.alteracao.itens[0].validacaoLote,'conferido_sc9');
  const missing=await confirm('900003');assert.equal(missing.status,200);assert.equal(missing.data.entry.alteracao.itens[0].validacaoLote,'manual_sem_pedido_sc9');
  assert.equal((await req('/api/saida/alteracoes')).data.itens.length,0);assert.equal((await req('/api/saida/alteracoes?confirmadas=1')).data.itens.length,3);
  const history=(await req('/api/revisao-alteracoes?pedido=900099',null,reviewer)).data.itens;
  assert.equal(history.length,3);
  assert.ok(history.every(item=>item.status==='confirmada'&&item.tipo==='nota'));
  assert.equal((await req('/api/saida/alteracao',{id:entries['900001'].id,acao:'cancelar'},reviewer)).status,409);
  const normal=(await req('/api/alteracao-separacao',{acao:'marcar',pedido:'900001'})).data.registro;
  assert.equal((await req('/api/alteracao-separacao',{acao:'confirmar',id:normal.id,motivo:'Troca',itens:[{item:'P',lote:'L',quantidade:'Infinity'}]},reviewer)).status,400);
  assert.equal((await req('/api/alteracao-separacao',{acao:'confirmar',id:normal.id,motivo:'Troca',itens:[{item:'P',lote:'L',quantidade:1}]},reviewer)).status,200);
  const second=(await req('/api/alteracao-separacao',{acao:'marcar',pedido:'900001'})).data.registro;
  assert.equal((await req('/api/alteracao-separacao',{acao:'cancelar',id:second.id},reviewer)).status,200);
  const searched=await req('/api/revisao-alteracoes?pedido=900001',null,reviewer);
  assert.deepEqual(searched.data.itens.map(item=>item.status).sort(),['cancelada','confirmada','confirmada']);
  assert.deepEqual((await req('/api/revisao-alteracoes?pedido=123456',null,reviewer)).data.itens,[]);
  assert.equal((await req('/api/revisao-alteracoes?pedido=ABC123456',null,reviewer)).status,400);
  const byReviewer=(await req('/api/saida/bipar',{pedido:'900004'})).data.entry;
  await req('/api/saida/alteracao',{id:byReviewer.id,acao:'marcar'});
  const reviewPayload={id:byReviewer.id,acao:'confirmar',pedidoComplemento:'900005',motivo:'Troca',itens:[{item:'P',lote:'L',quantidade:1}]};
  assert.equal((await req('/api/saida/alteracao',reviewPayload,reviewer)).status,200);
  assert.equal(fs.readFileSync(path.join(dir,'data','cadastro-lembretes.json'),'utf8'),notes);assert.equal(fs.readFileSync(path.join(dir,'data','latest.json'),'utf8'),snapshot);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'data','pedidos-indice.json'))),index);
  await req('/api/usuarios',{acao:'criar',usuario:'restrito',nome:'Teste',senha:'ficticio-local-123',perfis:['controle0201']});const restricted=(await req('/api/login',{usuario:'restrito',password:'ficticio-local-123'})).cookie;assert.equal((await req('/api/saida/alteracao',{id:entries['900001'].id,acao:'confirmar'},restricted)).status,403);
  assert.equal((await req('/api/revisao-alteracoes?pedido=900001',null,restricted)).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
