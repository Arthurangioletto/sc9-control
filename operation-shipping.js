/* Presentation uses the existing SC9/SF2/Entrega comparison, without reclassification. */
(function(root){
  function build(comparison,orders){
    const byKey=new Map(orders.map(order=>[JSON.stringify([order.armazem,order.pedido]),order]));
    const entries=comparison.rows.map(row=>({row,order:byKey.get(JSON.stringify([row.armazem,row.pedido]))})).filter(entry=>entry.order);
    const lists={conferred:entries.map(entry=>entry.order),invoiced:comparison.present?entries.filter(entry=>entry.row.confParaFatMin!==null).map(entry=>entry.order):null,
      delivered:comparison.totalDespachados===null?null:entries.filter(entry=>entry.row.despachado).map(entry=>entry.order),
      awaiting:comparison.present&&comparison.totalDespachados!==null?entries.filter(entry=>entry.row.confParaFatMin!==null&&entry.row.despachado===false).map(entry=>entry.order):null,
      earlier:comparison.present?entries.filter(entry=>entry.row.faturadoEm&&entry.row.confEnd&&entry.row.faturadoEm<entry.row.confEnd).map(entry=>entry.order):null};
    return {lists,meanMinutes:comparison.mediaMin,quantity:id=>lists[id]===null?null:lists[id].reduce((sum,order)=>sum+(Number(order.qt)||0),0)};
  }
  const api={build};if(typeof module==='object'&&module.exports)module.exports=api;root.SC9ShippingModel=api;
  if(!root.React)return;
  const R=root.React,h=R.createElement,n=value=>value.toLocaleString('pt-BR',{maximumFractionDigits:2});
  const titles={conferred:'Conferência finalizada',invoiced:'Faturados na SF2',delivered:'Presentes na Entrega',awaiting:'Faturados sem Entrega',earlier:'Faturados antes da conferência'};
  root.SC9OperationShipping=function Shipping({comparison,orders,scope,warehouse,warehouses,labels,cutoff,filters,itemLabel,savedAt,onWarehouse,onCutoff,onFilter,onClear,onOpenOrder,renderOrders}){
    const model=R.useMemo(()=>build(comparison,orders),[comparison,orders]),[selection,setSelection]=R.useState(null),rows=model.lists[selection]||[];
    const context=[scope,cutoff&&'Corte: '+cutoff.split('-').reverse().join('/'),filters.day&&'Liberação: '+filters.day.split('-').reverse().join('/'),filters.status&&'Status: '+filters.status,filters.item&&'Produto: '+itemLabel].filter(Boolean).join(' · ');
    const changeCutoff=event=>{if(/^\d{4}-\d{2}-\d{2}$/.test(event.target.value))onCutoff(event.target.value);},changeDay=event=>onFilter('day',event.target.value);
    const cards=[['conferred','Pedidos com data de término de conferência no SC9.'],['invoiced','Entre os conferidos, nota localizada na SF2.'],['delivered','Entre os conferidos, pedido localizado na Entrega.'],['awaiting','Entre os conferidos, nota na SF2 e pedido ausente da Entrega.']];
    return h('section',{className:'sc9-shipping','aria-label':'Resumo da expedição'},
      h('div',{className:'sc9-flow-filters'},
        h('label',null,'Armazém',h('select',{'aria-label':'Armazém',value:warehouse,onChange:event=>onWarehouse(event.target.value)},h('option',{value:'__ALL__'},'Todos os armazéns'),warehouses.map(code=>h('option',{key:code,value:code},labels[code]?.label||code)))),
        h('label',null,'Data de corte',h('input',{'aria-label':'Data de corte',type:'date',required:true,value:cutoff,onChange:changeCutoff,onInput:changeCutoff})),
        h('label',null,'Dia de liberação',h('input',{'aria-label':'Dia de liberação',type:'date',value:filters.day||'',onChange:changeDay,onInput:changeDay})),
        h('label',null,'Status',h('select',{'aria-label':'Status',value:filters.status||'',onChange:event=>onFilter('status',event.target.value)},h('option',{value:''},'Todos os status'),['Enviado','Atrasado','Pendente'].map(status=>h('option',{key:status,value:status},status==='Pendente'?'Em processo':status)))),
        h('button',{type:'button',className:'sc9-ui-button',onClick:onClear},'Limpar recorte')),
      h('div',{className:'sc9-overview-context'},h('div',null,h('strong',null,'Recorte em análise'),h('p',null,context)),h('span',{className:'sc9-flow-total'},savedAt?'Base salva em '+new Date(savedAt).toLocaleString('pt-BR'):'Base carregada nesta sessão')),
      h('div',{className:'sc9-overview-heading'},h('div',null,h('h2',null,'Da conferência ao despacho'),h('p',null,'Os indicadores abaixo consideram apenas os pedidos com conferência finalizada no recorte.'))),
      h('div',{className:'sc9-shipping-sources'},h('span',null,'SC9 · término da conferência'),h('span',null,comparison.present?'SF2 disponível · vínculo pela nota':'SF2 ausente · faturamento indisponível'),h('span',null,comparison.totalDespachados===null?'Entrega ausente · despacho indisponível':'Entrega disponível · vínculo pelo pedido')),
      h('div',{className:'sc9-overview-metrics'},cards.map(([id,description])=>{
        const list=model.lists[id],available=list!==null;
        return h('button',{key:id,type:'button',className:'sc9-overview-metric'+(id==='delivered'?' success':''),disabled:!available,onClick:()=>setSelection(selection===id?null:id),'aria-expanded':selection===id,'aria-label':titles[id]+': '+(available?n(list.length)+(list.length===1?' pedido':' pedidos'):'dado indisponível')},
          h('span',{className:'sc9-overview-eyebrow'},titles[id]),h('strong',null,available?n(list.length):'—'),
          h('span',{className:'sc9-overview-metric-sub'},description, h('br'),available?n(model.quantity(id))+' peças':'Carregue a base complementar para calcular.'),
          h('span',{className:'sc9-overview-link'},available?'Consultar pedidos →':'Fonte indisponível'));
      })),
      h('div',{className:'sc9-shipping-time'},h('div',null,h('h3',null,'Conferência → faturamento'),h('strong',null,!comparison.present||model.meanMinutes===null?'Sem dados para calcular':root.SC9FlowModel.duration(model.meanMinutes)),h('p',null,comparison.present?'Tempo médio no recorte · '+n(model.lists.invoiced.length)+' pedidos com vínculo na SF2. Notas anteriores ao fim da conferência contam como zero minuto.':'O tempo entre conferência e faturamento depende da SF2.')),
        comparison.present&&h('button',{type:'button',className:'sc9-ui-button',onClick:()=>setSelection(selection==='earlier'?null:'earlier'),'aria-expanded':selection==='earlier'},n(model.lists.earlier.length)+(model.lists.earlier.length===1?' faturado antes da conferência · consultar':' faturados antes da conferência · consultar'))),
      h('p',{className:'sc9-flow-note'},'Os grupos podem se sobrepor e não devem ser somados. A presença na Entrega usa o número do pedido, sem validar a unidade por esse vínculo; confira o armazém na lista. Nota fiscal isolada não comprova saída física. O dia de liberação filtra os pedidos; os gráficos diários usam as datas dos eventos.'),
      !orders.length&&h('div',{className:'sc9-overview-empty',role:'status'},h('strong',null,'Nenhum pedido neste recorte'),h('p',null,'Revise os filtros ou carregue uma base SC9.')),
      !!orders.length&&!model.lists.conferred.length&&h('div',{className:'sc9-overview-empty',role:'status'},h('strong',null,'Sem conferência finalizada neste recorte'),h('p',null,'Os pedidos sem data de término continuam disponíveis no Fluxo.')),
      selection&&h(root.SC9UI.InlineDetails,{title:titles[selection],subtitle:n(rows.length)+(rows.length===1?' pedido · ':' pedidos · ')+context,onClose:()=>setSelection(null)},renderOrders(rows,order=>{setSelection(null);onOpenOrder(order);},{key:JSON.stringify([selection,context,rows.length])})))
  };
})(typeof window==='object'?window:globalThis);
