/* Read-only presentation of the server's live monitor. No reclassification or writes. */
(function(root){
  const reasons=[
    {id:'separar',list:'listaSeparar',count:'separarEstourado',limit:'separarHoras',label:'Separação acima do prazo'},
    {id:'conferir',list:'listaConferir',count:'conferirEstourado',limit:'conferirHoras',label:'Conferência acima do prazo'},
    {id:'expedicao',list:'listaExpedicao',count:'expedicaoEstourado',limit:'expedicaoHoras',label:'Envio à expedição acima do prazo'},
    {id:'faturar',list:'listaFaturar',count:'faturarEstourado',limit:'faturarHoras',label:'Faturamento acima do prazo'},
    {id:'sc9',list:'listaAtrasados',label:'Atraso pela regra SC9'}
  ];
  const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  const number=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:6});
  function freshness(data,error,now){
    if(error)return {tone:'error',label:data?.savedAt?'Falha na atualização · mantendo a última consulta':'Não foi possível carregar o monitor'};
    if(!data)return {tone:'loading',label:'Carregando o monitor…'};
    if(!data.savedAt)return {tone:'empty',label:'Aguardando a primeira base SC9'};
    const time=data.atualizadoEm?new Date(data.atualizadoEm).getTime():NaN,age=(now-time)/1000;
    if(!Number.isFinite(age)||age< -5)return {tone:'stale',label:'Data de atualização indisponível ou inválida'};
    return {tone:age>30?'stale':'current',label:age>30?'Consulta sem atualização recente':'Consulta atualizada',age:Math.max(0,Math.floor(age))};
  }
  function priorityRows(data){
    const rows=new Map(),sla=data.sla||{};
    for(const reason of reasons)for(const item of sla[reason.list]||[]){
      const key=String(item.pedido)+'|'+String(item.etapa),row=rows.get(key)||{key,pedido:item.pedido,cliente:item.cliente,transportadora:item.transportadora,etapa:item.etapa,reasons:[],stageHours:null,releaseHours:null};
      if(!row.reasons.includes(reason.id))row.reasons.push(reason.id);
      const field=reason.id==='sc9'?'releaseHours':'stageHours';
      if(valid(item.horasParado))row[field]=row[field]===null?item.horasParado:Math.max(row[field],item.horasParado);
      rows.set(key,row);
    }
    return [...rows.values()].sort((a,b)=>Math.max(b.stageHours??-1,b.releaseHours??-1)-Math.max(a.stageHours??-1,a.releaseHours??-1)||String(a.pedido).localeCompare(String(b.pedido)));
  }
  function filterRows(rows,reason,query){
    const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const terms=normalize(query).trim().split(/\s+/).filter(Boolean);
    return rows.filter(row=>(!reason||row.reasons.includes(reason))&&terms.every(term=>normalize([row.pedido,row.cliente,row.transportadora].join(' ')).includes(term)));
  }
  const api={freshness,priorityRows,filterRows,reasons,number};
  if(typeof module==='object'&&module.exports)module.exports=api;root.SC9LiveModel=api;
  if(!root.React)return;
  const R=root.React,h=R.createElement;
  const date=value=>{const time=value?new Date(value):null;return time&&Number.isFinite(time.getTime())?time.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Não informada';};
  function actions(busy,onRefresh,onTV){return h('div',{className:'sc9-live-actions'},h('button',{type:'button',className:'sc9-ui-button',disabled:busy,onClick:onRefresh},busy?'Atualizando…':'Atualizar consulta'),onTV&&h('button',{type:'button',className:'sc9-ui-button sc9-live-primary',onClick:onTV},'Modo TV'));}
  root.SC9LiveState=function State({data,error,busy,now,onRefresh}){
    const state=freshness(data,error,now);
    return h('section',{className:'sc9-live-state','aria-label':'Situação do Monitor ao vivo'},h('h2',{role:error?'alert':'status'},state.label),h('p',null,error||(!data?'Consultando as informações da operação.':'O administrador precisa carregar a base SC9 para iniciar o monitor.')),actions(busy,onRefresh));
  };
  root.SC9LiveOverview=function Overview({data,error,busy,now,onRefresh,onTV}){
    const state=freshness(data,error,now),metrics=[
      ['Em processo agora',data.emProcesso,'Pedidos ainda não expedidos, de qualquer dia.'],
      ['Liberados hoje',data.liberadosHoje,'Pedidos com data de liberação de hoje, mesmo que já expedidos.'],
      ['Pendências anteriores',data.pendenciasAntigas,'Pedidos em aberto com liberação fora de hoje ou data não identificada.'],
      ['Expedidos hoje com bipe',data.concluidosHoje,'Pedidos classificados como expedidos e com bipe de saída de hoje.']
    ];
    return h('section',{className:'sc9-live-overview','aria-label':'Resumo do Monitor ao vivo'},
      h('div',{className:'sc9-live-heading'},h('div',null,h('h2',null,'Operação do Cambuci'),h('p',null,'Hoje, ',new Date(now).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}),' · os filtros das outras telas não se aplicam a este monitor.'),h('span',{className:'sc9-live-status is-'+state.tone,role:error?'alert':'status'},state.label)),actions(busy,onRefresh,onTV)),
      h('div',{className:'sc9-live-source'},h('span',null,'Base SC9 salva em: ',date(data.savedAt)),h('span',null,'Consulta calculada em: ',date(data.atualizadoEm)),h('span',null,'Consulta automática a cada 6 segundos enquanto a tela está visível. Isso não importa um novo SC9.')),
      error&&h('p',{className:'sc9-live-error'},error,' Os números abaixo são da última consulta recebida; uma nova tentativa será feita automaticamente.'),
      h('div',{className:'sc9-live-metrics'},metrics.map(([label,value,help])=>h('div',{className:'sc9-live-metric',key:label},h('span',null,label),h('strong',null,number(value)),h('p',null,help)))),
      h('p',{className:'sc9-live-help'},'Indicadores com critérios diferentes; não devem ser somados. ',h('a',{href:'#sc9-live-priorities'},'Consultar prioridades ↓')));
  };
  root.SC9LivePriorities=function Priorities({data}){
    const [reason,setReason]=R.useState(''),[query,setQuery]=R.useState(''),[page,setPage]=R.useState(1);
    const all=R.useMemo(()=>priorityRows(data),[data]),rows=filterRows(all,reason,query),pages=Math.max(1,Math.ceil(rows.length/10)),current=Math.min(page,pages),start=(current-1)*10,sla=data.sla;
    R.useEffect(()=>setPage(1),[reason,query]);
    const hours=value=>valid(value)?number(value)+' h':'Não informado';
    return h('section',{id:'sc9-live-priorities',className:'sc9-live-priorities','aria-label':'Prioridades do Monitor ao vivo',tabIndex:-1},
      h('div',{className:'sc9-live-section-heading'},h('div',null,h('h2',null,'Prioridades da operação'),h('p',null,'Prazos por etapa e regra de atraso do SC9 são sinais diferentes. Um pedido pode ter mais de um motivo.'))),
      !sla?h('p',{className:'sc9-live-empty'},'Informações de prioridade indisponíveis nesta consulta.'):
      h(R.Fragment,null,h('div',{className:'sc9-live-signals'},reasons.map(item=>h('button',{key:item.id,type:'button','aria-pressed':reason===item.id,onClick:()=>{setReason(reason===item.id?'':item.id);setPage(1);},className:'sc9-live-signal'},h('span',null,item.label),h('strong',null,number(item.id==='sc9'?data.atrasados:sla[item.count])),h('small',null,item.id==='sc9'?'Critério de nota / Entrega e corte':valid(sla[item.limit])?'Limite da etapa: '+number(sla[item.limit])+' h':'Limite não informado')))),
      h('div',{className:'sc9-live-filters'},h('label',null,'Motivo',h('select',{'aria-label':'Motivo',value:reason,onChange:e=>{setReason(e.target.value);setPage(1);}},h('option',{value:''},'Todos os motivos'),reasons.map(item=>h('option',{value:item.id,key:item.id},item.label)))),h('label',null,'Buscar pedido, cliente ou transportadora',h('input',{type:'search',value:query,onChange:e=>{setQuery(e.target.value);setPage(1);},placeholder:'Digite para localizar…'})),h('button',{type:'button',className:'sc9-ui-button',onClick:()=>{setReason('');setQuery('');setPage(1);}},'Limpar busca e motivo')),
      h('p',{className:'sc9-live-help'},'O servidor fornece até 30 registros por motivo. Os totais acima podem ser maiores que as listas. A mesma combinação de pedido e etapa aparece uma vez, reunindo os motivos. Ordenação pelo maior tempo informado.'),
      rows.length?h('div',{className:'sc9-live-table-scroll'},h('table',null,h('caption',null,number(rows.length),rows.length===1?' registro de prioridade no recorte':' registros de prioridade no recorte'),h('thead',null,h('tr',null,['Pedido / cliente','Etapa / transportadora','Motivos','Tempo informado'].map(label=>h('th',{key:label,scope:'col'},label)))),h('tbody',null,rows.slice(start,start+10).map(row=>h('tr',{key:row.key},h('td',null,h('strong',null,row.pedido),h('span',null,row.cliente||'Cliente não informado')),h('td',null,h('strong',null,data.etapaLabel?.[row.etapa]||row.etapa),h('span',null,row.transportadora||'Transportadora não informada')),h('td',null,row.reasons.map(id=>h('span',{key:id,className:'sc9-live-reason'},reasons.find(item=>item.id===id).label))),h('td',null,row.reasons.some(id=>id!=='sc9')&&h('span',null,'Desde o marco da etapa: ',hours(row.stageHours)),row.reasons.includes('sc9')&&h('span',null,'Desde a liberação: ',hours(row.releaseHours)))))))):h('p',{className:'sc9-live-empty',role:'status'},all.length?'Nenhum registro corresponde à busca e ao motivo selecionados.':'Nenhuma prioridade listada nesta consulta.'),
      rows.length>0&&h('nav',{className:'sc9-live-pagination','aria-label':'Páginas das prioridades'},h('span',null,start+1,'–',Math.min(start+10,rows.length),' de ',number(rows.length),rows.length===1?' registro':' registros'),h('button',{type:'button',className:'sc9-ui-button',disabled:current===1,onClick:()=>setPage(current-1)},'Anterior'),h('span',null,'Página ',current,' de ',pages),h('button',{type:'button',className:'sc9-ui-button',disabled:current===pages,onClick:()=>setPage(current+1)},'Próxima')),
      h('p',{className:'sc9-live-help'},'Tempo decorrido desde o registro disponível não comprova que o pedido ficou parado. Dados de etapas e atrasos seguem a classificação do servidor.')));
  };
})(typeof window==='object'?window:globalThis);
