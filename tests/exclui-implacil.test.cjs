const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const bundle=fs.readFileSync(path.join(__dirname,'..','bundle.js'),'utf8');
test('a análise do painel não conta pedidos com Implacil no nome do cliente (transferência)',()=>{
  assert.match(bundle,/function Nc\(t\)\{let sc9SemTransf=R=>!\/IMPLACIL\/i\.test\(String\(R&&R\.nome\|\|""\)\),a=t\.orders\.filter\(sc9SemTransf\)/);
  assert.match(bundle,/r=t\.items\.filter\(sc9SemTransf\)/);
  const keep=R=>!/IMPLACIL/i.test(String(R&&R.nome||''));
  const rows=[{nome:'IMPLACIL OSSTEM - MATERIAL ODONTOLOGICO S.A.'},{nome:'Clinica Sorriso'},{nome:null},{}];
  assert.deepEqual(rows.filter(keep).map(r=>r.nome),['Clinica Sorriso',null,undefined]);
});
