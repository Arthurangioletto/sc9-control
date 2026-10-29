const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('../expiry-panel.js');
const row=extra=>({produto:'23693',descricao:'FRESA FIXADOR 1.3',filial:'1',armazem:'1',lote:'98339',saldo:2,expiredDays:744,dtValidade:'2024-10-15',...extra});
test('um card por produto reúne todos os lotes e locais sem alterar os registros',()=>{
 const rows=[row(),row({lote:'OUTRO',armazem:'RJ',saldo:3}),row({filial:'2',saldo:4}),row({produto:'26424',descricao:'ANEL',saldo:5,expiredDays:310})],copy=structuredClone(rows);
 const groups=E.productGroups(rows);assert.equal(groups.length,2);assert.equal(groups[0].product,'23693');assert.equal(groups[0].items.length,3);assert.equal(E.summarize(groups[0].items).units,9);assert.equal(groups.flatMap(g=>g.items).length,rows.length);assert.deepEqual(rows,copy);
});
test('busca localiza a página do produto, mesmo quando um produto contém muitos lotes',()=>{
 const groups=E.productGroups(Array.from({length:25},(_,i)=>row({produto:String(i),lote:'L'+i,expiredDays:100-i})));groups[0].items.push(row({lote:'SEGUNDO'}));
 assert.equal(E.productTargetPage(groups,' l21 '),2);assert.equal(E.productTargetPage(groups,'SEGUNDO'),0);assert.equal(E.productTargetPage(groups,'AUSENTE'),null);
 const paging=require('../lot-filters.js').paging,info=paging.pageInfo(groups.length,2,10);assert.deepEqual(groups.slice(info.start,info.end).map(g=>g.product),['20','21','22','23','24']);
});
function setup(target){
 let state,initialized=false;const effects=[],listeners=new Map();
 const h=(type,props,...children)=>({type,props:{...props,children}});
 const root={React:{createElement:h,useState:initial=>{if(!initialized){state=typeof initial==='function'?initial():initial;initialized=true;}return[state,next=>{state=typeof next==='function'?next(state):next;}];},useId:()=> 'expiry-product-test',useEffect:fn=>effects.push(fn)},SC9Paging:{List:()=>{}},addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','expiry-panel.js'),'utf8'),{window:root});
 const items=[row(),row({lote:'OUTRO',filial:'2',armazem:'RT',saldo:3})],actions=h('input',{value:'Nota existente'}),render=()=>root.SC9Expiry.ProductCard({product:'23693',description:'FRESA FIXADOR 1.3',items,target,renderActions:()=>actions});
 return {render,effects,listeners,items,actions};
}
test('card recolhido abre os lotes e mantém ações e identidade de cada registro',()=>{
 const env=setup(),first=env.render();assert.equal(first.props.children[0].props['aria-expanded'],false);assert.equal(first.props.children[1].props.hidden,true);
 first.props.children[0].props.onClick();const opened=env.render(),list=opened.props.children[1].props.children[0];assert.equal(opened.props.children[0].props['aria-expanded'],true);assert.strictEqual(list.props.items,env.items);assert.equal(list.props.size,10);
 const lot=list.props.renderItem(env.items[1],1);assert.equal(lot.props['data-sc9lote'],'OUTRO');assert.strictEqual(lot.props.children[3].props.children[0],env.actions);
 opened.props.children[0].props.onClick();assert.equal(env.render().props.children[1].props.hidden,true);
});
test('busca abre o produto e um novo evento reabre o card recolhido',()=>{
 const env=setup('OUTRO');assert.equal(env.render().props.children[1].props.hidden,false);for(const effect of env.effects)effect();
 env.render().props.children[0].props.onClick();assert.equal(env.render().props.children[1].props.hidden,true);
 env.listeners.get('sc9-focus-lot')({detail:'OUTRO'});assert.equal(env.render().props.children[1].props.hidden,false);
});
