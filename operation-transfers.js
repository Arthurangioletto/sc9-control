/* Read-only overview: statuses, totals and thresholds come from the existing control. */
(function(root){
  function pendingInfo(records,reference=Date.now()){
    const end=new Date(reference).getTime(),pending=records.filter(record=>record.status==='aguardando');
    const dated=pending.filter(record=>record.dataEntrega instanceof Date&&Number.isFinite(record.dataEntrega.getTime())&&record.dataEntrega.getTime()<=end);
    const oldest=dated.reduce((found,record)=>!found||record.dataEntrega<found.dataEntrega?record:found,null);
    return {oldest,dated:dated.length,pending:pending.length,hours:oldest?(end-oldest.dataEntrega.getTime())/3600000:null};
  }
  const api={pendingInfo};if(typeof module==='object'&&module.exports)module.exports=api;root.SC9TransferModel=api;
  if(!root.React)return;
  const R=root.React,h=R.createElement,n=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:2});
  root.SC9TransferOverview=function Overview({records,stats,attentionHours,lateHours,formatHours,onPending,onIssues,onHistory,onLocate}){
    const pending=pendingInfo(records),oldest=pending.oldest;
    function metric(title,value,description,action){return h(action?'button':'article',{key:title,type:action?'button':undefined,className:'sc9-transfer-metric',onClick:action,'aria-label':title+': '+value},h('span',null,title),h('strong',null,value),h('p',null,description),action&&h('span',{className:'sc9-overview-link'},title==='Aguardando o 01'?'Ir para conferência →':title==='Divergências'?'Ver divergências e observações →':'Ver histórico →'));}
    return h('section',{className:'sc9-transfer-overview','aria-label':'Resumo das transferências 02 para 01'},
      h('div',{className:'sc9-transfer-context'},h('div',null,h('h2',null,'Transferências do 02 para o 01'),h('p',null,'Indicadores de todos os registros. Os filtros por pessoa e divergência são aplicados no histórico.')),h('span',null,'Atenção: '+attentionHours+' h · atraso: '+lateHours+' h')),
      h('div',{className:'sc9-transfer-summary'},
        metric('Aguardando o 01',n(stats.aguardando),n(stats.atrasadas)+' em atraso · '+n(stats.emAtencao)+' em atenção.',onPending),
        metric('Quantidade enviada pendente',n(stats.pecasEmTransito),'Soma da quantidade enviada dos registros ainda aguardando conferência.'),
        metric('Divergências',n(stats.comProblema),n(stats.emObservacao)+' em observação. A observação ainda não é divergência confirmada.',onIssues),
        metric('Conferidas sem erro',stats.taxaOk===null?'—':n(stats.taxaOk*100)+'%',n(stats.conferidosOk)+' de '+n(stats.conferidos)+' registros com quantidade recebida.',onHistory),
        metric('Tempo médio para conferir',stats.tempoMedioConfirmacaoH===null?'—':formatHours(stats.tempoMedioConfirmacaoH),'Da entrega à confirmação, nos registros com datas válidas.')),
      h('div',{className:'sc9-transfer-priority'},h('div',null,h('strong',null,oldest?'Entrega pendente mais antiga':'Prioridade de conferência'),h('p',null,oldest?'Lote '+oldest.lote+' · registrado em '+oldest.dataEntrega.toLocaleString('pt-BR')+' · há '+formatHours(pending.hours):pending.pending?'Há pendências sem data válida para priorizar.':'Nenhuma entrega aguardando confirmação.'),h('p',{className:'sc9-transfer-note'},n(pending.dated)+' de '+n(pending.pending)+' pendências com data válida até a consulta. Tempo desde o registro não comprova paralisação física.')),oldest&&h('button',{type:'button',className:'sc9-ui-button',onClick:()=>onLocate(oldest.id)},'Localizar lote para conferir')))
  };
})(typeof window==='object'?window:globalThis);
