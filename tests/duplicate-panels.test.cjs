const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(target){
 let state,initialized=false;const listeners=new Map(),effects=[];
 const h=(type,props,...children)=>({type,props:{...props,children}});
 const R={createElement:h,Children:{toArray:value=>(Array.isArray(value)?value:[value]).flat(Infinity).filter(v=>v!=null&&v!==false)},useState:initial=>{if(!initialized){state=typeof initial==='function'?initial():initial;initialized=true;}return[state,value=>{state=typeof value==='function'?value(state):value;}];},useId:()=> 'duplicate-panel-test',useEffect:fn=>effects.push(fn)};
 const root={React:R,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','lot-records.js'),'utf8'),{window:root});
 const action=h('button',{onClick:()=>{}},'Reabrir'),input=h('input',{value:'Nota preservada',onChange:()=>{}});
 const original=h('div',{'data-sc9lote':'L1',className:'original'},h('div',{},h('div',{},h('span',{},'Lote L1')),action),input);
 const render=(enabled=true)=>root.SC9DuplicatePanel({lot:'L1',target,enabled,children:original});
 return{render,effects,listeners,input,original,action};
}
test('caixas de duplicados iniciam recolhidas e preservam as ações fora do botão de expansão',()=>{
 const env=setup(),out=env.render(),heading=out.props.children[0],toggle=heading.props.children[0],actions=heading.props.children[1],body=out.props.children[1];
 assert.equal(toggle.props['aria-expanded'],false);assert.equal(body.props.hidden,true);assert.equal(body.props.children[0],null);
 assert.strictEqual(actions.props.children[0][0],env.action);
 toggle.props.onClick();const expanded=env.render();
 assert.equal(expanded.props.children[0].props.children[0].props['aria-expanded'],true);
 assert.strictEqual(expanded.props.children[1].props.children[0][0],env.input);
 expanded.props.children[0].props.children[0].props.onClick();assert.equal(env.render().props.children[1].props.hidden,true);
});
test('busca abre o lote correto e eventos reabrem caixas recolhidas',()=>{
 const env=setup(' l1 ');assert.equal(env.render().props.children[1].props.hidden,false);
 for(const effect of env.effects)effect();
 const toggle=env.render().props.children[0].props.children[0];toggle.props.onClick();assert.equal(env.render().props.children[1].props.hidden,true);
 env.listeners.get('sc9-focus-lot')({detail:'L1'});assert.equal(env.render().props.children[1].props.hidden,false);
});
test('outras análises recebem o cartão original sem recolhimento',()=>{const env=setup();assert.strictEqual(env.render(false),env.original);});
test('a configuração real usa dez lotes apenas em produtos duplicados e remove os três blocos',()=>{
 const bundle=fs.readFileSync(path.join(__dirname,'..','bundle.js'),'utf8');
 assert.match(bundle,/items:Ya,size:10,/);
 assert.match(bundle,/items:U,size:sc9Analysis==="duplicado"\?10:25,/);
 assert.match(bundle,/items:Ta,size:sc9Analysis==="duplicado"\?10:25,/);
 assert.match(bundle,/items:jt,renderItem:/);
 assert.doesNotMatch(bundle,/React\.createElement\(window\.SC9LotFilters\.CoverageNotice,/);
 assert.doesNotMatch(bundle,/📋 Mostrando achados salvos/);
 assert.doesNotMatch(bundle,/rot:"Lote duplicado c\/ saldo"/);
});
