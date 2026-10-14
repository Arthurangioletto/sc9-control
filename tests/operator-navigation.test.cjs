const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('menu real exige perfil específico de Alterações',()=>{
  const bundle=fs.readFileSync(path.join(__dirname,'..','bundle.js'),'utf8');
  const start=bundle.indexOf('Vo=['),end=bundle.indexOf(',Ma=',start);
  assert(start>=0&&end>start);
  const expression=bundle.slice(start+3,end);
  const tabs=flags=>Array.from(vm.runInNewContext(expression,{Yt:false,oe:false,Ve:false,Mt:false,Ae:false,ee:false,...flags}),x=>x[0]);
  assert.deepEqual(tabs({oe:true,ee:true}),['saida','cadastro_sb8']);
  assert.deepEqual(tabs({Yt:true}),['geral']);
  assert.deepEqual(tabs({Mt:true}),['controle']);
  assert.deepEqual(tabs({Ae:true}),['alteracoes_sep']);
});
