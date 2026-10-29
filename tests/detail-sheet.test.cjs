const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('painel lateral abre como modal, trata Escape e restaura foco e rolagem ao fechar',()=>{
 let effect,closed=0,restored=0,prevented=0;
 const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
 const h=(type,props,...children)=>({type,props:{...props,children}}),body={style:{overflow:'auto'}};
 const root={React:{createElement:h,useRef:()=>({current:dialog}),useId:()=> 'sheet-test',useEffect:fn=>effect=fn},document:{body,activeElement:{isConnected:true,focus(){restored++;}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','navigation.js'),'utf8'),{window:root,React:root.React});
 const output=root.SC9UI.Sheet({title:'Produto',subtitle:'Ficha do produto 23693',children:'Dados preservados',onClose:()=>closed++});
 assert.equal(output.type,'dialog');assert.equal(output.props['aria-labelledby'],'sheet-test');
 const cleanup=effect();assert.equal(dialog.open,true);assert.equal(body.style.overflow,'hidden');
 const first={getClientRects:()=>[1],closest:()=>null,focus(){root.document.activeElement=this;}},last={getClientRects:()=>[1],closest:()=>null,focus(){root.document.activeElement=this;}};
 dialog.querySelectorAll=()=>[first,last];root.document.activeElement=first;
 output.props.onKeyDown({key:'Tab',shiftKey:true,currentTarget:dialog,preventDefault(){prevented++;}});assert.strictEqual(root.document.activeElement,last);
 output.props.onKeyDown({key:'Tab',shiftKey:false,currentTarget:dialog,preventDefault(){prevented++;}});assert.strictEqual(root.document.activeElement,first);
 output.props.onClick({target:{tagName:'BUTTON'},currentTarget:dialog,clientX:0,clientY:0});assert.equal(closed,0);
 output.props.onCancel({preventDefault(){prevented++;}});assert.equal(closed,1);assert.equal(prevented,3);
 cleanup();assert.equal(dialog.open,false);assert.equal(body.style.overflow,'auto');assert.equal(restored,1);
});
test('ficha lateral usa os registros atuais e as ações do lote, sem criar cópias para editar',()=>{
 const h=(type,props,...children)=>({type,props:{...props,children}}),root={React:{createElement:h},SC9UI:{Sheet:()=>{}},SC9Paging:{List:()=>{}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','expiry-panel.js'),'utf8'),{window:root});
 const items=[{produto:'23693',lote:'L',filial:'1',armazem:'RJ',saldo:2,expiredDays:5,dtValidade:'2026-10-24'}],snapshot=JSON.stringify(items),actions=h('input',{value:'Nota original'});
 const output=root.SC9Expiry.ProductDrawer({product:'23693',description:'FRESA',items,target:'L',filters:['RJ + RT'],position:null,onClose:()=>{},renderActions:()=>actions});
 const section=output.props.children[2],list=section.props.children[1];assert.strictEqual(list.props.items,items);assert.equal(list.props.target,'L');
 const rendered=list.props.renderItem(items[0],0);assert.strictEqual(rendered.props.children[3].props.children[0],actions);assert.equal(rendered.props['data-sc9lote'],'L');assert.equal(JSON.stringify(items),snapshot);
});
