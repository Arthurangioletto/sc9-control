/* Presentation only. Original records, classifications and action elements are retained. */
(function(root){
  const number=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:6});
  function measure(items){return {items:items.length,lines:items.reduce((sum,item)=>sum+(Array.isArray(item.registros)?item.registros.length:1),0)};}
  const api={number,measure};if(typeof module==='object'&&module.exports)module.exports=api;root.SC9InventoryPresentation=api;
  if(!root.React)return;
  const R=root.React,h=R.createElement,list=value=>R.Children.toArray(value);
  function unit(value){if(!value)return 'Todas as unidades';if(value==='__SEM_FILIAL__')return 'Sem filial informada';const code=String(value).replace(/^0+/,''),labels={'1':'Cambuci · 01','2':'Santa Catarina · 02','3':'Tamboré · 03','4':'Paraíso · 04'};return labels[code]||'Filial '+value;}
  const descriptions={duplicado:'Compare os produtos que usam o mesmo lote antes de escolher o registro correto.',validadeVariavel:'Compare produto, filial, armazém e validade com a etiqueta física e os documentos.',saldoNegativo:'Confira os registros com saldo negativo antes de definir o tratamento.',multiFilial:'Compare o lote e o produto entre filiais; a categoria indica onde existe saldo.'};
  api.AnalysisContext=function Context({analysis,items,filial,warehouse,prioritized,priorityFilial,onlyPriority,showWorked,category,ready,source,onClear}){
    const counts=measure(items),grouped=analysis!=='saldoNegativo';
    return h('section',{className:'sc9-inventory-context','aria-label':'Recorte da análise de lotes'},h('div',null,h('strong',null,'Recorte em análise'),h('p',null,[unit(filial),!warehouse||warehouse==='__TODOS__'?'Todos os armazéns':'Armazém '+warehouse,category&&'Categoria: '+category].filter(Boolean).join(' · ')),h('p',null,prioritized?(onlyPriority?'Somente com saldo no armazém ':'Prioridade de ordenação no armazém ')+prioritized+(priorityFilial?' / filial '+priorityFilial:''):'Sem prioridade de armazém'),h('p',null,showWorked?'Inclui marcados, finalizados e ignorados.':'Respeita o acompanhamento dos registros desta análise.')),
      h('div',{className:'sc9-inventory-context-summary'},h('strong',{role:'status'},ready?number(counts.items)+(grouped?(counts.items===1?' grupo · ':' grupos · ')+number(counts.lines)+(counts.lines===1?' linha no grupo':' linhas nos grupos'):(counts.items===1?' registro no recorte':' registros no recorte')):'Carregando os achados…'),h('span',null,source),h('button',{type:'button',className:'sc9-ui-button',onClick:onClear},'Limpar recorte')),
      h('p',{className:'sc9-inventory-context-guide'},descriptions[analysis], ' A classificação considera a base completa; a lista mostra os registros do recorte. As contagens não representam peças de estoque.'));
  };
  api.RecordCards=function RecordCards({lot,children}){
    const [head,body]=list(children),headers=list(head?.props?.children),labels=list(headers[0]?.props?.children).map(cell=>cell.props.children);
    if(!head||!body||!labels.length)return h('table',null,children);
    return h('div',{className:'sc9-inventory-records'},list(body.props.children).map((row,index)=>{
      const cells=list(row.props.children);if(cells.some(cell=>cell.props.colSpan))return h('div',{key:row.key||index,className:'sc9-lot-total'},cells.map(cell=>cell.props.children));
      const fields=labels.map((label,i)=>({label,cell:cells[i]})).filter(field=>field.cell),get=label=>fields.find(field=>field.label===label)?.cell;
      const product=get('Produto'),description=get('Descrição'),balance=get('Saldo'),lotValue=get('Lote')?.props.children||lot||'—';
      const details=fields.filter(field=>!['Lote','Produto','Descrição','Saldo',''].includes(field.label)),actions=fields.filter(field=>!field.label);
      return h('article',{...row.props,key:row.key||index,className:'sc9-inventory-record','data-sc9lote':row.props['data-sc9lote']||lot,'aria-label':'Produto '+(product?.props.children||'não informado')+' · lote '+lotValue},
        h('div',{className:'sc9-inventory-record-heading'},h('div',null,h('h4',null,product?.props.children||'Produto não informado',' · Lote ',lotValue),description&&h('p',null,description.props.children)),balance&&h('div',{className:'sc9-inventory-record-balance'},h('span',null,'Saldo'),h('strong',{style:balance.props.style},balance.props.children))),
        h('dl',{className:'sc9-inventory-record-fields'},details.map(({label,cell},i)=>h('div',{key:i},h('dt',null,label),h('dd',{style:cell.props.style},label==='Filial'&&['','—'].includes(String(cell.props.children||'').trim())?'Não informada':cell.props.children)))),
        actions.length>0&&h('div',{className:'sc9-inventory-record-actions',role:'group','aria-label':'Acompanhamento deste registro'},actions.map(({cell})=>cell.props.children)));
    }));
  };
})(typeof window==='object'?window:globalThis);
