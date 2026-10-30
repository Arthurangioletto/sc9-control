/* The overview consumes the app's already classified and filtered orders. */
(function(root){
  function build(orders,billingOrders=[],warehouses=[]){
    const billingKeys=new Set(billingOrders.map(order=>order.key));
    const lists={all:orders,open:[],sent:[],late:[],billing:[],dispatch:[]},byWarehouse=new Map();
    for(const code of warehouses)byWarehouse.set(code,{code,total:0,sent:0,open:0,late:0,qt:0});
    let qt=0;
    for(const order of orders){
      const sent=order.status==='Enviado',billing=!sent&&billingKeys.has(order.key);
      if(!byWarehouse.has(order.armazem))byWarehouse.set(order.armazem,{code:order.armazem||'Sem armazém',total:0,sent:0,open:0,late:0,qt:0});
      const row=byWarehouse.get(order.armazem),quantity=Number(order.qt)||0;
      qt+=quantity;row.qt+=quantity;row.total++;row[sent?'sent':'open']++;
      lists[sent?'sent':'open'].push(order);
      if(order.status==='Atrasado'&&!billing){lists.late.push(order);row.late++;}
      if(billing)lists.billing.push(order);
      if(!sent&&order.faturadoSemDespachoProntoFisico)lists.dispatch.push(order);
    }
    return {lists,qt,total:orders.length,sent:lists.sent.length,open:lists.open.length,
      sentRate:orders.length?lists.sent.length/orders.length:null,
      warehouses:Array.from(byWarehouse.values()).map(row=>({...row,rate:row.total?row.sent/row.total:null}))};
  }
  function selectionRows(model,selection){
    if(!selection)return [];
    return selection.warehouse!==undefined?model.lists.all.filter(order=>(order.armazem||'Sem armazém')===selection.warehouse):model.lists[selection.kind]||[];
  }
  const api={build,selectionRows};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SC9OperationModel=api;
  if(!root.React)return;
  const R=root.React,h=R.createElement,n=value=>value.toLocaleString('pt-BR',{maximumFractionDigits:2}),pct=value=>value===null?'—':(value*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
  const titles={all:'Todos os pedidos',open:'Pedidos em aberto',sent:'Pedidos enviados',late:'Atrasos na separação / conferência',billing:'Aguardando faturamento',dispatch:'Faturados sem confirmação de despacho'};
  root.SC9OperationOverview=function Overview({orders,billingOrders,warehouses,labels,scope,cutoff,filters,savedAt,deliveryPresent,onClear,onItems,onOpenOrder,renderOrders,renderLateOrders}){
    const model=R.useMemo(()=>build(orders,billingOrders,warehouses),[orders,billingOrders,warehouses]);
    const [selection,setSelection]=R.useState(null),rows=selectionRows(model,selection);
    const [showLate,setShowLate]=R.useState(false),latePanel=R.useRef(null),lateTrigger=R.useRef(null);
    R.useEffect(()=>{if(showLate){latePanel.current?.scrollIntoView({behavior:'smooth',block:'start'});latePanel.current?.focus({preventScroll:true});}},[showLate]);
    const open=kind=>setSelection({kind,title:titles[kind]}),label=code=>labels[code]?.label||code;
    const metric=(kind,title,value,description,tone,action)=>h('button',{type:'button',className:'sc9-overview-metric '+(tone||''),onClick:action||(()=>open(kind)),'aria-label':title+': '+n(value)+'. '+description,...kind==='late'?{ref:lateTrigger,'aria-expanded':showLate,'aria-controls':'sc9-overview-late'}:{}},h('span',{className:'sc9-overview-eyebrow'},title),h('strong',null,n(value)),h('span',{className:'sc9-overview-metric-sub'},description),h('span',{className:'sc9-overview-link'},kind==='pieces'?'Analisar produtos ↗':kind==='late'?(showLate?'Recolher lista ↑':'Ver atrasados nesta página ↓'):'Consultar pedidos →'));
    const priorities=[['billing','Aguardando faturamento','Sem nota fiscal; com separador e conferente informados ou datas de término registradas.','warning'],['dispatch','Confirmar despacho','Prontos fisicamente e com nota, sem presença na Entrega do Cambuci.','accent']];
    return h('section',{className:'sc9-overview','aria-label':'Resumo gerencial da operação'},
      h('div',{className:'sc9-overview-context'},h('div',null,h('strong',null,'Recorte em análise'),h('p',null,[scope,cutoff&&'Corte: '+cutoff.split('-').reverse().join('/'),...filters].filter(Boolean).join(' · '))),h('div',{className:'sc9-overview-context-actions'},h('span',null,savedAt?'Base salva em '+new Date(savedAt).toLocaleString('pt-BR'):'Base carregada nesta sessão'),h('button',{type:'button',className:'sc9-ui-button',onClick:onClear},'Limpar recorte'))),
      h('div',{className:'sc9-overview-metrics sc9-overview-metrics-restored'},metric('all','Pedidos no recorte',model.total,'Base para os indicadores abaixo.',''),metric('late','Atrasados',model.lists.late.length,'Em separação/conferência; exclui os que aguardam faturamento.','danger',()=>setShowLate(!showLate)),metric('open','Em aberto',model.open,'Ainda sem status Enviado.','warning'),metric('sent','Enviados',model.sent,model.sentRate===null?'Sem pedidos para calcular o percentual.':pct(model.sentRate)+' dos pedidos no recorte.','success'),metric('pieces','Peças liberadas',model.qt,'Quantidade de todos os pedidos do recorte.','',onItems)),
      showLate&&h('section',{id:'sc9-overview-late',ref:latePanel,tabIndex:-1,className:'sc9-overview-late','aria-label':'Pedidos atrasados na página'},
        h('div',{className:'sc9-overview-late-heading'},h('strong',null,n(model.lists.late.length),model.lists.late.length===1?' pedido atrasado':' pedidos atrasados'),h('button',{type:'button',className:'sc9-ui-button',onClick:()=>{setShowLate(false);lateTrigger.current?.focus();}},'Recolher atrasados')),
        model.lists.late.length?(renderLateOrders||renderOrders)(model.lists.late,onOpenOrder):h('p',{className:'sc9-overview-note',role:'status'},'Nenhum pedido atrasado em separação/conferência neste recorte.')),
      h('div',{className:'sc9-overview-heading'},h('div',null,h('h2',null,'Filas que precisam de ação'),h('p',null,'Posição da base carregada. Consulte os pedidos antes de definir a ação.'))),
      h('div',{className:'sc9-overview-priorities sc9-overview-priorities-restored'},priorities.map(([kind,title,description,tone])=>h('button',{key:kind,type:'button',className:'sc9-overview-priority '+tone,onClick:()=>open(kind),'aria-label':title+': '+n(model.lists[kind].length)+(model.lists[kind].length===1?' pedido':' pedidos')},h('span',{className:'sc9-overview-priority-top'},h('strong',null,title),h('span',{className:'sc9-overview-badge'},n(model.lists[kind].length))),h('p',null,description),h('span',{className:'sc9-overview-link'},model.lists[kind].length?'Ver pedidos →':'Nenhum pedido nesta fila')))),
      h('p',{className:'sc9-overview-note'},'As filas são sinais operacionais e não devem ser somadas como etapas exclusivas. Enviado segue a regra da base: '+(deliveryPresent?'no Cambuci, exige nota fiscal e presença na Entrega; nos demais armazéns, considera nota fiscal.':'sem a aba Entrega, considera nota fiscal e não confirma saída física.')),
      h('div',{className:'sc9-overview-comparison'},h('div',{className:'sc9-overview-heading'},h('div',null,h('h2',null,'Comparativo por armazém'),h('p',null,'Mesmo recorte dos indicadores. Percentual enviado não representa atendimento dentro do prazo.'))),h('div',{className:'sc9-overview-table-wrap'},h('table',null,h('caption',{className:'sr-only'},'Pedidos por armazém no recorte atual'),h('thead',null,h('tr',null,['Armazém','Pedidos','Em aberto','Enviados','% enviado','Peças liberadas','Detalhes'].map(text=>h('th',{key:text,scope:'col'},text)))),h('tbody',null,model.warehouses.map(row=>h('tr',{key:row.code},h('th',{scope:'row'},label(row.code)),h('td',null,n(row.total)),h('td',null,n(row.open)),h('td',null,n(row.sent)),h('td',null,h('div',{className:'sc9-overview-rate'},h('span',null,pct(row.rate)),h('span',{className:'sc9-overview-track','aria-hidden':true},h('span',{style:{width:(row.rate||0)*100+'%'}})))),h('td',null,n(row.qt)),h('td',null,h('button',{type:'button',className:'sc9-ui-button',onClick:()=>setSelection({warehouse:row.code,title:'Pedidos · '+label(row.code)}),'aria-label':'Consultar pedidos de '+label(row.code)},'Consultar')))))))),
      !model.total&&h('div',{className:'sc9-overview-empty',role:'status'},h('strong',null,'Nenhum pedido neste recorte'),h('p',null,'Confira os filtros ou carregue uma base SC9. Os indicadores não incluem registros fora do recorte.')),
      selection&&h(root.SC9UI.Sheet,{title:selection.title,subtitle:n(rows.length)+(rows.length===1?' pedido · ':' pedidos · ')+[scope,cutoff&&'Corte: '+cutoff.split('-').reverse().join('/'),...filters].filter(Boolean).join(' · '),onClose:()=>setSelection(null)},renderOrders(rows,order=>{setSelection(null);onOpenOrder(order);})))
  };
})(typeof window==='object'?window:globalThis);
