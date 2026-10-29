const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','navigation.js'),'utf8');
function setup({collapsed=false,desktop=true,tabs=[['saida','Saída p/ Expedição'],['cadastro_sb8','Cadastro de Lotes (SB8)']]}={}){
 const states=[];let cursor=0;const navigations=[];
 const R={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],next=>states[i]=typeof next==='function'?next(states[i]):next];},useEffect:()=>{}};
 const root={React:R,localStorage:{getItem:()=>String(collapsed),setItem:()=>{}},matchMedia:()=>({matches:desktop})};
 vm.runInNewContext(source,{window:root,React:R});
 return {model:root.SC9NavigationModel,navigations,render:(active='saida')=>{cursor=0;return root.SC9Navigation({tabs,active,onNavigate:id=>navigations.push(id)});}};
}
function nodes(tree,predicate){const found=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))found.push(node);for(const child of (node.props?.children||[]).flat(Infinity))visit(child);}visit(tree);return found;}
const links=tree=>nodes(tree,node=>String(node.props?.className||'').split(' ').includes('sc9-nav-link'));
test('busca e seções partem apenas das telas autorizadas e aceitam termos sem acento',()=>{
 const {model}=setup(),allowed=[['saida','Saída'],['cadastro_sb8','Cadastro de Lotes (SB8)']];
 const ids=query=>Array.from(model.availableSections(allowed,query)).flatMap(g=>Array.from(g.items,x=>x.id));
 assert.deepEqual(ids(''),['saida','cadastro_sb8']);assert.deepEqual(ids('vencimentos'),['cadastro_sb8']);assert.deepEqual(ids('operacao'),['saida']);assert.deepEqual(ids('usuarios'),[]);
 const review=model.availableSections([['alteracoes_sep','Revisão']], 'revisao');assert.equal(review.length,1);assert.equal(review[0].items[0].id,'alteracoes_sep');
});
test('rota de controle do operador e telas adicionais continuam navegáveis',()=>{
 const {model}=setup(),sections=model.availableSections([['controle','Controle 02→01'],['especial','Inventário especial']]);
 assert.equal(sections[0].name,'Operação');assert.equal(sections[0].items[0].id,'controle');assert.equal(sections[1].items[0].id,'especial');assert.equal(model.availableSections([['especial','Inventário especial']],'inventario')[0].items[0].id,'especial');
});
test('buscar uma tela e pressionar Enter navega com o identificador original e limpa a busca',()=>{
 const env=setup();let view=env.render();nodes(view,n=>n.type==='input')[0].props.onChange({target:{value:'vencimentos'}});view=env.render();
 assert.equal(links(view).length,1);assert.equal(links(view)[0].props.key,'cadastro_sb8');
 let prevented=false;nodes(view,n=>n.type==='input')[0].props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});assert(prevented);assert.deepEqual(env.navigations,['cadastro_sb8']);assert.equal(links(env.render()).length,2);
});
test('busca sem resultado não altera a tela e Escape limpa somente o filtro do menu',()=>{
 const env=setup();let view=env.render();nodes(view,n=>n.type==='input')[0].props.onChange({target:{value:'inexistente'}});view=env.render();assert.equal(links(view).length,0);assert.equal(env.navigations.length,0);
 nodes(view,n=>n.type==='input')[0].props.onKeyDown({key:'Escape'});assert.equal(links(env.render()).length,2);
});
test('menu recolhido mantém atalhos identificados sem ultrapassar o perfil permitido',()=>{
 const env=setup({collapsed:true}),view=env.render(),buttons=links(view);
 assert.equal(nodes(view,n=>n.type==='aside')[0].props.className,'sc9-sidebar is-collapsed');assert.equal(buttons.length,2);assert(buttons.every(b=>b.props['aria-label']&&b.props.title));
 buttons[1].props.onClick();assert.deepEqual(env.navigations,['cadastro_sb8']);
 assert(nodes(view,n=>String(n.props?.id||'').startsWith('sc9-group-')).every(n=>n.props.hidden===false));
});
test('preferência de recolhimento do computador não esconde os nomes no menu móvel',()=>{
 const env=setup({collapsed:true,desktop:false}),view=env.render();assert.equal(nodes(view,n=>n.type==='aside')[0].props.className,'sc9-sidebar');assert.equal(nodes(view,n=>n.type==='input').length,1);
 const menu=nodes(view,n=>n.type==='button'&&n.props.className==='sc9-menu-toggle')[0];menu.props.onClick();assert.equal(nodes(env.render(),n=>n.type==='aside')[0].props.className,'sc9-sidebar is-open');
});
