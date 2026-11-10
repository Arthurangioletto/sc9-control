const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../entradas-tdc.js');

test('a busca da nota destaca o lote e mantém a marcação de cada linha independente',()=>{
  const states=[],refs=[],scrolled=[];
  let stateIndex=0,refIndex=0;
  const window={
    document:{readyState:'loading',addEventListener(){},createElement:()=>({}),head:{appendChild(){}}},
    ReactDOM:{},
    SC9EntradasTDC:model,
    SC9FindScannedLot:(value,items)=>({itens:items.filter(item=>value==='(10)'+item.lote)}),
    React:{
      createElement:(type,props,...children)=>({type,props:props||{},children}),
      useState(initial){
        const index=stateIndex++;
        if(!(index in states))states[index]=initial;
        return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];
      },
      useRef(initial){const index=refIndex++;return refs[index]||={current:initial};},
    },
  };
  const source=fs.readFileSync(require.resolve('../entradas-tdc-ui.js'),'utf8');
  vm.runInNewContext(source.replace('{montar};','{montar,NotaItens};'),{window});
  const items=[{produto:'A',lote:'ABC',qt:12},{produto:'B',lote:'ABC',qt:8},{produto:'C',lote:'XYZ',qt:1}];
  function nodes(tree,type){
    if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,type));
    if(!tree||typeof tree!=='object')return [];
    return [...(tree.type===type?[tree]:[]),...nodes(tree.children,type)];
  }
  function render(){
    stateIndex=refIndex=0;
    const tree=window.SC9EntradasTDCUI.NotaItens({itens:items});
    nodes(tree,'tr').slice(1).forEach((row,index)=>row.props.ref({scrollIntoView:()=>scrolled.push(index)}));
    return tree;
  }
  const input=tree=>nodes(tree,'input').find(node=>node.props.type==='search');
  const checks=tree=>nodes(tree,'input').filter(node=>node.props.type==='checkbox');
  let tree=render();
  input(tree).props.onChange({target:{value:'(10)ABC'}});
  nodes(render(),'form')[0].props.onSubmit({preventDefault(){}});
  assert.equal(scrolled.at(-1),0);
  tree=render();
  assert.deepEqual(checks(tree).map(node=>node.props.checked),[false,false,false]);
  checks(tree)[0].props.onChange();
  tree=render();
  assert.deepEqual(checks(tree).map(node=>node.props.checked),[true,false,false]);
  nodes(tree,'button').find(node=>node.children.includes('Próxima linha')).props.onClick();
  assert.equal(scrolled.at(-1),1);
  tree=render();
  input(tree).props.onChange({target:{value:'OUTRA NOTA'}});
  nodes(render(),'form')[0].props.onSubmit({preventDefault(){}});
  assert.match(JSON.stringify(render()),/Lote não encontrado nesta nota/);
  assert.deepEqual(checks(render()).map(node=>node.props.checked),[true,false,false]);
});
