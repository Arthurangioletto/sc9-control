const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('importador do Cadastro de Lotes aparece para administrador e perfil Cadastro, mantendo os callbacks originais',()=>{
 const source=fs.readFileSync(require.resolve('../bundle.js'),'utf8'),a=source.indexOf('(t||a)&&React.createElement(window.SC9StockUI.Importer,'),b=source.indexOf(',React.createElement(W,{title:"Carregar endereços',a);assert(a>0&&b>a);const expression=source.slice(a,b),position={updatedAt:'teste'},reload=()=>{};
 for(const [admin,cadastro,expected] of [[true,false,true],[false,true,true],[true,true,true],[false,false,false]]){
  let props,calls=0;const result=vm.runInNewContext(expression,{t:admin,a:cadastro,React:{createElement:(_,value)=>{calls++;props=value;return 'importer';}},window:{SC9StockUI:{Importer:'importer'}},sc9Stock:{position,reload}});
  assert.equal(calls,expected?1:0);if(expected){assert.equal(result,'importer');assert.strictEqual(props.position,position);assert.strictEqual(props.onUpdated,reload);assert.equal(typeof props.readFile,'function');}else assert.equal(result,false);
 }
 assert(source.includes('function qn({isAdmin:t,temCadastro:a,authInfo:r'));
 assert(source.includes('React.createElement(qn,{isAdmin:Me.role==="admin",temCadastro:ee,authInfo:Me'));
});
