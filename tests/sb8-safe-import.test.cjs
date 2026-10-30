const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Stock=require('../stock-position.js');
test('importador envia somente atualização dos presentes e não oferece substituição total',async()=>{
 const requests=[],root={React:{useState:initial=>[initial,()=>{}],createElement:(tag,props,...children)=>({tag,props,children})},SC9Stock:Stock};
 vm.runInNewContext(fs.readFileSync(require.resolve('../stock-import.js'),'utf8'),{window:root,fetch:async(url,options)=>{const body=options?.body?JSON.parse(options.body):null;requests.push({url,body});return {ok:true,json:async()=>body?.acao==='iniciar'?{id:'teste'}:{stats:{}}};}});
 const flatten=node=>!node||typeof node!=='object'?[]:[node,...(node.children||[]).flat(Infinity).flatMap(flatten)];
 const tree=root.SC9StockUI.Importer({readFile:async()=>[{filial:'01',armazem:'RJ',produto:'P',lote:'L',saldo:3}],position:null,onUpdated:()=>{}}),nodes=flatten(tree);
 assert(!nodes.some(node=>node.tag==='select'));assert(!nodes.some(node=>node.tag==='details'));
 await nodes.find(node=>node.tag==='input').props.onChange({target:{files:[{name:'sb8.xlsx'}],value:'sb8.xlsx'}});
 assert.deepEqual(requests.map(r=>r.body.acao),['iniciar','lote','prever']);assert.equal(requests[0].body.mode,'present');assert.equal(requests[1].body.rows[0].saldo,3);
 const admin=flatten(root.SC9StockUI.Importer({isAdmin:true,readFile:()=>{},onUpdated:()=>{}}));assert(admin.some(node=>node.tag==='details'));
});
