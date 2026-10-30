/* Presentation of existing team aggregates. No writes or changes to scoring. */
(function(root){
  const number=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:6});
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function build(rows,orders,role){
    const names=new Set(rows.map(row=>row.name));
    const assigned=orders.filter(order=>names.has(String(order[role]||'').trim()));
    const real=role==='conferente'?assigned.filter(order=>order.confStart&&order.confEnd).length:assigned.filter(order=>typeof order.durationMin==='number'&&Number.isFinite(order.durationMin)&&order.durationMin>=0).length;
    const proxy=role==='conferente'?assigned.filter(order=>!(order.confStart&&order.confEnd)&&order.pickEnd).length:0;
    return {people:rows.length,eligible:rows.filter(row=>row.elegivel===true).length,orders:rows.reduce((sum,row)=>sum+row.pedidos,0),quantity:rows.reduce((sum,row)=>sum+row.qt,0),assigned:assigned.length,unassigned:orders.length-assigned.length,real,proxy,missing:assigned.length-real-proxy};
  }
  function selectRows(rows,query,category,sort){
    const terms=normalize(query).split(/\s+/).filter(Boolean);
    const selected=rows.filter(row=>terms.every(term=>normalize(row.name).includes(term))&&(!category||(category==='eligible'?row.elegivel===true:category==='rotating'?row.fixo===false:row.fixo!==false&&row.elegivel!==true)));
    if(sort==='name')selected.sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR'));
    if(sort==='orders'||sort==='quantity')selected.sort((a,b)=>(sort==='orders'?b.pedidos-a.pedidos:b.qt-a.qt)||String(a.name).localeCompare(String(b.name),'pt-BR'));
    return selected;
  }
  const api={build,selectRows,number};if(typeof module==='object'&&module.exports)module.exports=api;root.SC9ProductivityModel=api;
  if(!root.React)return;
  const R=root.React,h=R.createElement;
  const date=value=>value?new Date(value).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Não informada';
  root.SC9ProductivityOverview=function Overview({role,rows,orders,scope,warehouse,warehouses,labels,cutoff,filters,itemLabel,savedAt,onWarehouse,onCutoff,onFilter,onClear}){
    const model=build(rows,orders,role),conference=role==='conferente',id='sc9-team-'+role;
    const changeCutoff=event=>{if(event.target.value)onCutoff(event.target.value);},changeDay=event=>onFilter('day',event.target.value);
    const metrics=[['Pessoas identificadas',model.people,'Responsáveis presentes nos pedidos do recorte.'],['Pedidos atribuídos',model.orders,'Pedidos com responsável identificado nesta função.'],['Peças atribuídas',model.quantity,'Volume associado aos pedidos com responsável.'],['Elegíveis à comparação',model.eligible,'Equipe fixa com pelo menos 10 dias no recorte, pelo critério atual.']];
    return h('section',{className:'sc9-productivity-overview','aria-label':'Recorte da produtividade'},
      h('div',{className:'sc9-productivity-heading'},h('div',null,h('h2',null,conference?'Visão da conferência':'Visão da separação'),h('p',null,scope,' · Base salva em: ',savedAt?new Date(savedAt).toLocaleString('pt-BR'):'Não informada')),h('a',{className:'sc9-ui-button',href:'#'+id},'Consultar equipe ↓')),
      h('div',{className:'sc9-productivity-filters'},
        h('label',null,'Armazém',h('select',{'aria-label':'Armazém da produtividade',value:warehouse,onChange:event=>onWarehouse(event.target.value)},h('option',{value:'__ALL__'},'Todos os armazéns'),warehouses.map(code=>h('option',{key:code,value:code},labels[code]?.label||code)))),
        h('label',null,'Data de corte',h('input',{'aria-label':'Data de corte da produtividade',type:'date',value:cutoff,onChange:changeCutoff,onInput:changeCutoff,required:true})),
        h('label',null,'Dia de liberação',h('input',{'aria-label':'Dia de liberação da produtividade',type:'date',value:filters.day||'',onChange:changeDay,onInput:changeDay})),
        h('label',null,'Status',h('select',{'aria-label':'Status da produtividade',value:filters.status||'',onChange:event=>onFilter('status',event.target.value)},h('option',{value:''},'Todos os status'),['Enviado','Atrasado','Pendente'].map(status=>h('option',{key:status,value:status},status==='Pendente'?'Em processo':status)))),
        h('button',{type:'button',className:'sc9-ui-button',onClick:onClear},'Limpar recorte')),
      h('p',{className:'sc9-productivity-context'},'Recorte: ',scope,' · Corte de status: ',date(cutoff+'T12:00:00'),filters.day&&' · Liberação: '+date(filters.day+'T12:00:00'),filters.status&&' · Status: '+(filters.status==='Pendente'?'Em processo':filters.status),filters.item&&' · Produto: '+(itemLabel||filters.item)),
      h('div',{className:'sc9-productivity-metrics'},metrics.map(([title,value,help])=>h('div',{className:'sc9-productivity-metric',key:title},h('span',null,title),h('strong',null,number(value)),h('p',null,help)))),
      h('p',{className:'sc9-productivity-note'},number(model.unassigned),model.unassigned===1?' pedido do recorte sem responsável identificado nesta função.':' pedidos do recorte sem responsável identificado nesta função.',' Os dias usados na elegibilidade são os dias de liberação dos pedidos; não representam presença ou jornada.'),
      h('div',{className:'sc9-productivity-coverage'},h('h3',null,conference?'Cobertura dos horários de conferência':'Cobertura dos tempos de separação'),
        h('strong',null,number(model.real),' de ',number(model.assigned),conference?' pedidos atribuídos com início e fim de conferência.':' pedidos atribuídos com duração válida registrada.'),
        conference&&h('p',null,number(model.proxy),' sem o par completo, com fim de pick usado como referência alternativa; ',number(model.missing),' sem esse par nem referência de pick. A coluna % Real indica a presença dos dois horários, que não garante duração válida.'),
        h('p',null,'Confira a cobertura antes de comparar tempos. Os resultados refletem os pedidos e horários disponíveis no recorte, sem medir presença, capacidade disponível ou desempenho individual por si só.')),
      h('details',{className:'sc9-productivity-method'},h('summary',null,'Como interpretar esta análise'),conference?
        h('p',null,'Pedidos e peças usam o responsável de conferência do SC9. Os tempos mantêm o cálculo existente, que combina horários reais quando presentes e uma referência pelo fim de pick quando faltam. Esta tela não apresenta uma classificação de carga para conferentes, pois não há índice ponderado calculado para essa função.'):
        h('p',null,'O índice ponderado atual usa os volumes de pedidos (20%), linhas (50%) e peças (30%), normalizados pelo maior valor por pessoa no recorte, incluindo os não elegíveis. Não usa taxas por hora. As faixas Alto (≥70), Médio (40 a 69,9) e Baixo (<40) aparecem para os elegíveis. A carga compara esse índice com a média dos elegíveis: Alta ≥130% e Baixa ≤70%. A comparação indica volume relativo, sem comprovar sobrecarga ou ociosidade. Os TOP 5 iniciais incluem todas as pessoas com dado para o indicador, inclusive não elegíveis.'),
        h('p',null,'A data de corte participa da classificação do status; não limita automaticamente o período. O dia de liberação filtra os pedidos dessa data. Aproveitamento e taxas por hora usam a janela entre o primeiro e o último horário disponíveis, que pode abranger vários dias e intervalos fora da jornada. Na separação, o intervalo sem duração é a diferença entre essa janela e as durações somadas; não comprova tempo ocioso.')),
      !rows.length&&h('p',{className:'sc9-productivity-empty',role:'status'},'Nenhum responsável identificado neste recorte. Revise os filtros ou os dados da base.'));
  };
  root.SC9ProductivityRoster=function Roster({rows,role,renderRows}){
    const [query,setQuery]=R.useState(''),[category,setCategory]=R.useState(''),[sort,setSort]=R.useState('original'),[page,setPage]=R.useState(1);
    const selected=selectRows(rows,query,category,sort),pages=Math.max(1,Math.ceil(selected.length/10)),current=Math.min(page,pages),start=(current-1)*10;
    R.useEffect(()=>setPage(1),[query,category,sort]);
    return h('div',{id:'sc9-team-'+role,className:'sc9-productivity-roster',tabIndex:-1},
      h('div',{className:'sc9-productivity-filters'},h('label',null,'Buscar pessoa',h('input',{'aria-label':'Buscar pessoa na equipe',type:'search',value:query,placeholder:'Nome do responsável…',onChange:event=>{setQuery(event.target.value);setPage(1);}})),
        h('label',null,'Participação',h('select',{'aria-label':'Participação na comparação',value:category,onChange:event=>{setCategory(event.target.value);setPage(1);}},h('option',{value:''},'Todas as pessoas'),h('option',{value:'eligible'},'Elegíveis à comparação'),h('option',{value:'insufficient'},'Dados insuficientes'),role==='separador'&&h('option',{value:'rotating'},'Rotativos'))),
        h('label',null,'Ordenar por',h('select',{'aria-label':'Ordenação da equipe',value:sort,onChange:event=>{setSort(event.target.value);setPage(1);}},h('option',{value:'original'},'Ordem original'),h('option',{value:'name'},'Nome (A–Z)'),h('option',{value:'orders'},'Mais pedidos'),h('option',{value:'quantity'},'Mais peças'))),
        h('button',{type:'button',className:'sc9-ui-button',onClick:()=>{setQuery('');setCategory('');setSort('original');setPage(1);}},'Limpar busca da equipe')),
      h('p',{className:'sc9-productivity-note'},'Busca, participação e ordenação afetam somente esta tabela. Os indicadores e gráficos mantêm o recorte acima. Clique no nome para abrir os detalhes da pessoa.'),
      selected.length?h('div',{className:'sc9-productivity-table'},renderRows(selected.slice(start,start+10))):h('p',{className:'sc9-productivity-empty',role:'status'},rows.length?'Nenhuma pessoa corresponde à busca e à participação selecionadas.':'Nenhuma pessoa neste recorte.'),
      selected.length>0&&h('nav',{className:'sc9-productivity-pagination','aria-label':'Páginas da equipe'},h('span',null,start+1,'–',Math.min(start+10,selected.length),' de ',number(selected.length),selected.length===1?' pessoa':' pessoas'),h('button',{type:'button',className:'sc9-ui-button',disabled:current===1,onClick:()=>setPage(current-1)},'Anterior'),h('span',null,'Página ',current,' de ',pages),h('button',{type:'button',className:'sc9-ui-button',disabled:current===pages,onClick:()=>setPage(current+1)},'Próxima')));
  };
})(typeof window==='object'?window:globalThis);
