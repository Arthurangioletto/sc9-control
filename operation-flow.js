/* Read-only presentation of the app's classified, filtered orders. */
(function(root){
  const definitions=[
    {id:'separation',title:'Separação',description:'Em aberto, sem fim de pick e fora das filas de faturamento e despacho.',basis:'início da separação ou liberação com horário'},
    {id:'conference',title:'Conferência / validação',description:'Com fim de pick; ainda fora das filas de faturamento e despacho.',basis:'fim de pick'},
    {id:'billing',title:'Aguardando faturamento',description:'Sem nota, com separador e conferente informados ou datas de término.',basis:'fim da conferência ou fim de pick'},
    {id:'dispatch',title:'Confirmar despacho',description:'Cambuci: nota e conclusão física, sem confirmação na Entrega.',basis:'fim da conferência'}
  ];
  function timestamp(value){if(value===null||value===undefined||value==='')return null;const time=new Date(value).getTime();return Number.isFinite(time)?time:null;}
  function elapsed(order,id,reference){
    const fields=id==='separation'?['pickStart','dtLiberacaoHora']:id==='conference'?['pickEnd']:id==='billing'?['confEnd','pickEnd']:['confEnd'];
    const end=timestamp(reference);if(end===null)return null;
    for(const field of fields){const start=timestamp(order[field]);if(start!==null&&start<=end)return (end-start)/60000;}
    return null;
  }
  function build(orders,billingOrders=[],reference=null){
    const billingKeys=new Set(billingOrders.map(order=>order.key)),queues=definitions.map(def=>({...def,rows:[],qt:0,timed:0,totalMinutes:0,maxMinutes:null}));
    const milestones=[{id:'released',title:'Liberados',description:'Todos os pedidos no recorte.',rows:[]},{id:'picked',title:'Fim de pick registrado',description:'Pedido com registro de término da separação.',rows:[]},{id:'conferred',title:'Conferente informado',description:'Nome ou código de conferente preenchido e diferente de zero; não comprova término.',rows:[]},{id:'invoiced',title:'Com nota fiscal',description:'Nota fiscal informada; não comprova despacho físico.',rows:[]}];
    let sent=0;
    for(const order of orders){
      milestones[0].rows.push(order);
      if(order.pickEnd)milestones[1].rows.push(order);
      const name=String(order.conferente||'').trim();if(name&&name!=='0')milestones[2].rows.push(order);
      if(order.nf)milestones[3].rows.push(order);
      if(order.status==='Enviado'){sent++;continue;}
      const id=order.faturadoSemDespachoProntoFisico?'dispatch':billingKeys.has(order.key)?'billing':order.pickEnd?'conference':'separation';
      const queue=queues.find(item=>item.id===id),minutes=elapsed(order,id,reference);
      queue.rows.push(order);queue.qt+=Number(order.qt)||0;
      if(minutes!==null){queue.timed++;queue.totalMinutes+=minutes;queue.maxMinutes=queue.maxMinutes===null?minutes:Math.max(queue.maxMinutes,minutes);}
    }
    for(const item of milestones)item.qt=item.rows.reduce((sum,order)=>sum+(Number(order.qt)||0),0);
    const largest=Math.max(0,...queues.map(queue=>queue.rows.length));
    return {total:orders.length,sent,open:orders.length-sent,milestones,
      queues:queues.map(queue=>({...queue,meanMinutes:queue.timed?queue.totalMinutes/queue.timed:null})),
      largest:largest?queues.filter(queue=>queue.rows.length===largest).map(queue=>queue.id):[]};
  }
  function selectionRows(model,selection){return [...model.milestones,...model.queues].find(item=>item.id===selection)?.rows||[];}
  function duration(minutes){if(minutes===null)return 'Sem data válida';if(minutes<60)return Math.floor(minutes)+' min';if(minutes<1440)return Math.floor(minutes/60)+' h '+Math.floor(minutes%60)+' min';return Math.floor(minutes/1440)+' d '+Math.floor(minutes%1440/60)+' h';}
  const api={build,elapsed,selectionRows,duration};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SC9FlowModel=api;
  if(!root.React)return;
  const R=root.React,h=R.createElement,n=value=>value.toLocaleString('pt-BR',{maximumFractionDigits:2});
  root.SC9OperationFlow=function Flow({orders,billingOrders,reference,scope,warehouse,warehouses,labels,cutoff,filters,itemLabel,onWarehouse,onCutoff,onFilter,onClear,onOpenOrder,renderOrders}){
    const model=R.useMemo(()=>build(orders,billingOrders,reference),[orders,billingOrders,reference]),[selection,setSelection]=R.useState(null);
    const selected=[...model.milestones,...model.queues].find(item=>item.id===selection),rows=selectionRows(model,selection);
    const changeCutoff=event=>{if(/^\d{4}-\d{2}-\d{2}$/.test(event.target.value))onCutoff(event.target.value);};
    const changeDay=event=>onFilter('day',event.target.value);
    const context=[scope,cutoff&&'Corte: '+cutoff.split('-').reverse().join('/'),filters.day&&'Liberação: '+filters.day.split('-').reverse().join('/'),filters.status&&'Status: '+filters.status,filters.item&&'Produto: '+itemLabel].filter(Boolean).join(' · ');
    return h('section',{className:'sc9-flow','aria-label':'Fluxo da operação'},
      h('div',{className:'sc9-flow-filters'},
        h('label',null,'Armazém',h('select',{'aria-label':'Armazém',value:warehouse,onChange:event=>onWarehouse(event.target.value)},h('option',{value:'__ALL__'},'Todos os armazéns'),warehouses.map(code=>h('option',{key:code,value:code},labels[code]?.label||code)))),
        h('label',null,'Data de corte',h('input',{'aria-label':'Data de corte',type:'date',value:cutoff,onChange:changeCutoff,onInput:changeCutoff,required:true})),
        h('label',null,'Dia de liberação',h('input',{'aria-label':'Dia de liberação',type:'date',value:filters.day||'',onChange:changeDay,onInput:changeDay})),
        h('label',null,'Status',h('select',{'aria-label':'Status',value:filters.status||'',onChange:event=>onFilter('status',event.target.value)},h('option',{value:''},'Todos os status'),['Enviado','Atrasado','Pendente'].map(status=>h('option',{key:status,value:status},status==='Pendente'?'Em processo':status)))),
        h('button',{type:'button',className:'sc9-ui-button',onClick:onClear},'Limpar recorte')),
      h('div',{className:'sc9-overview-context'},h('div',null,h('strong',null,'Recorte em análise'),h('p',null,context)),h('span',{className:'sc9-flow-total'},n(model.total)+' pedidos · '+n(model.open)+' em aberto · '+n(model.sent)+' enviados')),
      h('div',{className:'sc9-overview-heading'},h('div',null,h('h2',null,'Registros das etapas'),h('p',null,'Contagens independentes: um pedido pode aparecer em várias etapas.'))),
      h('div',{className:'sc9-flow-milestones'},model.milestones.map((item,index)=>h('button',{key:item.id,type:'button',className:'sc9-flow-milestone',onClick:()=>setSelection(selection===item.id?null:item.id),'aria-expanded':selection===item.id,'aria-label':item.title+': '+n(item.rows.length)+' pedidos'},h('span',{className:'sc9-flow-step','aria-hidden':true},String(index+1).padStart(2,'0')),h('strong',null,item.title),h('span',{className:'sc9-flow-value'},n(item.rows.length)),h('span',null,n(item.qt)+' peças'),h('p',null,item.description),h('span',{className:'sc9-overview-link'},'Consultar pedidos →')))),
      h('div',{className:'sc9-overview-heading'},h('div',null,h('h2',null,'Filas de pedidos em aberto'),h('p',null,'Cada pedido sem status Enviado é mostrado em uma única fila abaixo.'))),
      h('div',{className:'sc9-flow-queue-summary',role:'status'},model.largest.length===0?'Nenhum pedido em aberto neste recorte.':(model.largest.length===1?'Maior fila observada: ':'Maiores filas empatadas: ')+model.queues.filter(queue=>model.largest.includes(queue.id)).map(queue=>queue.title+' ('+n(queue.rows.length)+')').join(' · ')),
      h('div',{className:'sc9-flow-queues'},model.queues.map(queue=>h('article',{key:queue.id,className:'sc9-flow-queue'+(model.largest.includes(queue.id)?' is-largest':'')},
        h('div',{className:'sc9-flow-queue-title'},h('h3',null,queue.title),h('span',{className:'sc9-overview-badge'},n(queue.rows.length))),
        h('p',null,queue.description),h('strong',{className:'sc9-flow-quantity'},n(queue.qt)+' peças'),
        h('dl',null,h('div',null,h('dt',null,'Tempo médio decorrido'),h('dd',null,duration(queue.meanMinutes))),h('div',null,h('dt',null,'Maior tempo decorrido'),h('dd',null,duration(queue.maxMinutes)))),
        h('p',{className:'sc9-flow-coverage'},'Data válida em '+n(queue.timed)+' de '+n(queue.rows.length)+(queue.rows.length===1?' pedido.':' pedidos.')+' Referência: '+queue.basis+'.'),
        h('button',{type:'button',className:'sc9-ui-button',onClick:()=>setSelection(selection===queue.id?null:queue.id),'aria-expanded':selection===queue.id,'aria-label':'Consultar fila '+queue.title},'Consultar pedidos →')))),
      h('p',{className:'sc9-flow-note'},timestamp(reference)!==null?'Tempos calculados até a gravação da base: '+new Date(reference).toLocaleString('pt-BR')+'.':'Sem data válida de gravação da base: os tempos não são calculados.', ' Datas sem horário tornam a medida aproximada. Tempo decorrido não comprova inatividade nem atraso por SLA. Datas ausentes, inválidas ou posteriores à base não entram nas médias. A maior fila é definida pelo número de pedidos.'),
      !model.total&&h('div',{className:'sc9-overview-empty',role:'status'},h('strong',null,'Nenhum pedido neste recorte'),h('p',null,'Revise os filtros ou carregue uma base SC9.')),
      selected&&h(root.SC9UI.InlineDetails,{title:selected.title,subtitle:n(rows.length)+(rows.length===1?' pedido · ':' pedidos · ')+context,onClose:()=>setSelection(null)},renderOrders(rows,order=>{setSelection(null);onOpenOrder(order);},{key:JSON.stringify([selection,context,rows.length])})))
  };
})(typeof window==='object'?window:globalThis);
