/* Expiry analysis uses calendar days since expiry, never presumed stock movement. */
(function (root) {
  const BRANCHES = [['1','Cambuci'],['2','Santa Catarina'],['3','Tamboré'],['4','Paraíso']];
  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const STATES = [{id:'RJ',name:'Rio de Janeiro',warehouses:['RJ','RT']},{id:'DF',name:'Distrito Federal',warehouses:['DF','DT']},{id:'ES',name:'Espírito Santo',warehouses:['ES','ET']},{id:'CE',name:'Ceará',warehouses:['CE','CT']},{id:'BH',name:'Belo Horizonte',warehouses:['BH','BT']}];
  const warehouseCode=value=>code(value).toUpperCase();
  function stateRows(rows,state){const match=STATES.find(s=>s.id===state);return match?rows.filter(r=>match.warehouses.includes(warehouseCode(r.armazem))):rows;}
  function stateSummary(rows,state){const scoped=stateRows(rows,state).filter(r=>Number(r.saldo)>0);return {...summarize(scoped.filter(r=>r.expiredDays>0)),upcoming:scoped.filter(r=>r.expiredDays!==null&&r.expiredDays<=0&&r.expiredDays>=-30).reduce((n,r)=>n+Number(r.saldo),0)};}
  function code(value) { const s=String(value == null?'':value).trim(); return /^\d+$/.test(s)?String(Number(s)):s; }
  function dateParts(value) {
    if (!value) return null;
    if (typeof value==='string') { const m=value.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) { const y=+m[1],mo=+m[2],d=+m[3],check=new Date(Date.UTC(y,mo-1,d));return check.getUTCFullYear()===y&&check.getUTCMonth()===mo-1&&check.getUTCDate()===d?{y,m:mo,d}:null; } }
    const d=value instanceof Date?value:new Date(value);return isNaN(d)?null:{y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate()};
  }
  function day(value) { const p=dateParts(value);return p?Date.UTC(p.y,p.m-1,p.d)/86400000:null; }
  function ageBand(days) { return days<=0?'A vencer':days<=30?'Até 30 dias':days<=90?'31–90 dias':days<=180?'91–180 dias':days<=365?'181–365 dias':'Mais de 1 ano'; }
  function enrich(rows, now=new Date()) { const today=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/86400000;return rows.map(row=>{const p=dateParts(row.dtValidade),expiry=day(row.dtValidade);const age=expiry===null?null:today-expiry;return {...row,expiryYear:p?String(p.y):'',expiryMonth:p?String(p.m).padStart(2,'0'):'',expiredDays:age,ageBand:age===null?'Sem validade':ageBand(age)};}); }
  function summarize(rows) {return {units:rows.reduce((s,r)=>s+Math.max(0,Number(r.saldo)||0),0),lots:new Set(rows.map(r=>[code(r.filial),r.produto,r.lote].join('|'))).size,products:new Set(rows.map(r=>r.produto)).size,oldest:rows.reduce((m,r)=>Math.max(m,r.expiredDays||0),0)};}
  function group(rows,key) {const map=new Map();rows.forEach(row=>{const k=key(row);if(!map.has(k))map.set(k,[]);map.get(k).push(row);});return [...map.entries()];}
  function paginateGroups(groups, start, end) {
    const page=[];let offset=0;
    for(const [key,items] of groups) {
      const from=Math.max(0,start-offset),to=Math.min(items.length,end-offset);
      if(to>from)page.push([key,items.slice(from,to),items]);
      offset+=items.length;if(offset>=end)break;
    }
    return page;
  }
  function Panel({target,rows,overviewRows,inventory,saved,filial,warehouse,onFilial,onWarehouse,days,onDays,renderActions,onExport,position,stockError}) {
    const h=root.React.createElement,R=root.React;
    const [year,setYear]=R.useState(''),[month,setMonth]=R.useState(''),[band,setBand]=R.useState(''),[future,setFuture]=R.useState(false),[page,setPage]=R.useState(0),[state,setState]=R.useState('');
    const all=R.useMemo(()=>enrich(overviewRows),[overviewRows]),scoped=R.useMemo(()=>enrich(rows),[rows]);
    const years=[...new Set(scoped.filter(r=>future||r.expiredDays>0).map(r=>r.expiryYear).filter(Boolean))].sort();
    const visible=R.useMemo(()=>stateRows(scoped,state).filter(r=>Number(r.saldo)>0&&(future||r.expiredDays>0)&&(!year||r.expiryYear===year)&&(!month||r.expiryMonth===month)&&(!band||r.ageBand===band)),[scoped,state,future,year,month,band]);
    const cardRows=R.useMemo(()=>root.SC9LotFilters.records(all,filial).filter(r=>(!year||r.expiryYear===year)&&(!month||r.expiryMonth===month)&&(!band||r.ageBand===band)),[all,filial,year,month,band]);
    const groups=R.useMemo(()=>group(visible,r=>JSON.stringify([code(r.filial),code(r.armazem),r.expiryYear,r.expiryMonth])).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).map(([key,items])=>[key,items.slice().sort((a,b)=>b.expiredDays-a.expiredDays)]),[visible]);
    const ordered=R.useMemo(()=>groups.flatMap(([,items])=>items),[groups]);
    R.useEffect(()=>setPage(0),[year,month,band,future,filial,warehouse,state]);
    R.useEffect(()=>setState(''),[filial]);
    R.useEffect(()=>{const focus=event=>{const found=root.SC9Paging.targetPage(ordered,event.detail,30);if(found!==null)setPage(found);};root.addEventListener('sc9-focus-lot',focus);return()=>root.removeEventListener('sc9-focus-lot',focus);},[ordered]);
    R.useEffect(()=>{const found=root.SC9Paging.targetPage(ordered,target,30);if(found!==null)setPage(found);},[target]);
    const info=root.SC9Paging.pageInfo(visible.length,page,30),pageGroups=paginateGroups(groups,info.start,info.end);
    const stats=summarize(visible),fmt=v=>Number(v||0).toLocaleString('pt-BR'),label=v=>v?String(v).padStart(2,'0'):'Não informado';
    const branchName=v=>(BRANCHES.find(([c])=>c===code(v))||[v,'Filial '+label(v)])[1];
    const warehouses=root.SC9LotFilters.warehouses(inventory,saved,filial);
    const change=(set,value)=>{set(value);setPage(0);};
    function metric(title,value,sub){return h('div',{className:'sc9-exp-metric'},h('span',null,title),h('strong',null,value),h('small',null,sub));}
    function select(title,value,set,options){return h('label',null,title,h('select',{value,onChange:e=>change(set,e.target.value)},h('option',{value:''},'Todos'),options.map(([v,t])=>h('option',{key:v,value:v},t))));}
    const buckets=['Até 30 dias','31–90 dias','91–180 dias','181–365 dias','Mais de 1 ano'];
    return h('section',{className:'sc9-expiry','aria-label':'Análise de vencidos'},
      h('div',{className:'sc9-exp-heading'},h('div',null,h('h2',null,'Estoque vencido'),h('p',null,'Selecione a filial e compare o estoque vencido e os próximos vencimentos por estado.'))),
      h('div',{className:'sc9-exp-branches'},h('button',{type:'button',className:!filial?'is-active':'',onClick:()=>{onFilial('');setYear('');setMonth('');}},'Todas as filiais'),BRANCHES.map(([id,name])=>{return h('button',{key:id,type:'button',className:code(filial)===id?'is-active':'',onClick:()=>{onFilial(id);setYear('');setMonth('');setPage(0);}},h('strong',null,name+' · '+label(id)));})),
      h('div',{className:'sc9-state-heading'},h('h3',null,'Estoque por estado'),h('span',null,filial==='__SEM_FILIAL__'?'Sem filial informada':filial?branchName(filial)+' · '+label(filial):'Todas as filiais')),
      h('div',{className:'sc9-state-cards'},STATES.map(item=>{const s=stateSummary(cardRows,item.id);return h('button',{type:'button',key:item.id,className:'sc9-state-card'+(state===item.id?' is-active':''),'aria-pressed':state===item.id,onClick:()=>{onWarehouse('__TODOS__');setState(state===item.id?'':item.id);setPage(0);}},h('div',{className:'sc9-state-card-title'},h('strong',null,item.id),h('span',null,item.name)),h('small',null,item.warehouses.join(' + ')),h('strong',{className:'sc9-state-quantity'},fmt(s.units)),h('span',null,'unidades vencidas'),h('div',{className:'sc9-state-card-footer'},h('span',null,fmt(s.lots)+' lotes/produtos'),h('span',null,fmt(s.upcoming)+' un. a vencer em 30 dias')));})),
      h('p',{className:'sc9-exp-note'},'Os cards consideram saldo positivo, inclusive dos itens marcados e finalizados. A lista respeita o filtro de acompanhamento.'),
      state&&h('p',{className:'sc9-exp-note'},'Recorte: '+STATES.find(s=>s.id===state).warehouses.join(' + '),h('button',{type:'button',onClick:()=>setState('')},'Mostrar todos os estados')),
      h('p',{className:'sc9-exp-note'},position?.updatedAt?'Saldo atualizado em '+new Date(position.updatedAt).toLocaleString('pt-BR')+'. Os cards comparam os estados da filial; o filtro Armazém abaixo refina a lista.':'Saldos da base já salva. Importe uma posição atual do SB8 em Importações para atualizar as quantidades.'),
      stockError&&h('p',{role:'alert',className:'sc9-exp-note'},'Não foi possível consultar o saldo atual: '+stockError),
      h('div',{className:'sc9-exp-controls'},h('label',null,'Armazém',h('select',{value:warehouse,onChange:e=>{setState('');onWarehouse(e.target.value);}},h('option',{value:'__TODOS__'},'Todos os armazéns'),warehouses.map(id=>h('option',{key:id,value:id},label(id))))),select('Ano de vencimento',year,setYear,years.map(y=>[y,y])),select('Mês de vencimento',month,setMonth,MONTHS.map((m,i)=>[String(i+1).padStart(2,'0'),m])),select('Tempo vencido',band,setBand,buckets.map(b=>[b,b])),h('button',{type:'button',onClick:()=>{setYear('');setMonth('');setBand('');}},'Limpar período')),
      h('div',{className:'sc9-exp-controls'},h('label',{className:'sc9-exp-check'},h('input',{type:'checkbox',checked:future,onChange:e=>setFuture(e.target.checked)}),'Incluir itens a vencer'),future&&h('label',null,'A vencer em até (dias)',h('input',{type:'number',min:0,value:days,onChange:e=>onDays(e.target.value)})),h('button',{type:'button',onClick:()=>onExport(visible)},'Exportar recorte')),
      !visible.length&&h('p',{className:'sc9-exp-empty'},'Nenhum registro encontrado para esses filtros.'),
      h(root.SC9Paging.Controls,{info,onPage:setPage,label:'vencimentos'}),
      pageGroups.map(([key,items,complete])=>{
          const [branch,arm,yr,mo]=JSON.parse(key),totals=summarize(complete);
          return h('section',{key,className:'sc9-exp-flat-group'},
            h('header',{className:'sc9-exp-flat-heading'},
              h('h3',null,branchName(branch)+' · Armazém '+label(arm)+' · '+(MONTHS[Number(mo)-1]||'Sem mês')+' / '+yr),
              h('span',null,fmt(totals.units)+' un. · '+fmt(totals.lots)+' lotes/produtos')),
            items.map((r,i)=>h('article',{key:[r.produto,r.lote,r.armazem,i].join('|'),className:'sc9-exp-record','data-sc9lote':String(r.lote||'').trim().toUpperCase()},
              h('div',{className:'sc9-exp-record-top'},h('strong',null,r.produto+' · Lote '+r.lote),h('span',{className:r.expiredDays>365?'sc9-exp-old':''},r.expiredDays>0?'Vencido há '+fmt(r.expiredDays)+' dias':r.expiredDays===0?'Vence hoje':'Vence em '+fmt(-r.expiredDays)+' dias')),
              h('p',null,r.descricao||'Sem descrição'),h('div',{className:'sc9-exp-record-meta'},h('span',null,'Saldo: '+fmt(r.saldo)+' un.'),h('span',null,'Validade: '+(dateParts(r.dtValidade)?[dateParts(r.dtValidade).d,dateParts(r.dtValidade).m,dateParts(r.dtValidade).y].map((v,i)=>i<2?String(v).padStart(2,'0'):v).join('/'):'Não informada')),h('span',null,'Armazém '+label(r.armazem))),r.observations>=2&&h('p',{className:'sc9-exp-note'},'Saldo igual nas últimas observações desde '+new Date(r.balanceSince).toLocaleDateString('pt-BR')+'. Isso não comprova ausência de movimentação.'),renderActions(r))));
        }),
      info.pages>1&&h(root.SC9Paging.Controls,{info,onPage:setPage,label:'vencimentos'}));
  }
  function exportRows(rows) {return rows.map(r=>({Filial:code(r.filial),Unidade:(BRANCHES.find(([id])=>id===code(r.filial))||['','Não informada'])[1],Armazém:code(r.armazem),Produto:r.produto,Descrição:r.descricao||'',Lote:r.lote,Saldo:r.saldo,'Ano de vencimento':r.expiryYear,'Mês de vencimento':r.expiryMonth,'Dias desde o vencimento':r.expiredDays,'Faixa de tempo':r.ageBand}));}
  const api={STATES,stateRows,stateSummary,code,dateParts,day,ageBand,enrich,summarize,group,paginateGroups,exportRows,Panel};root.SC9Expiry=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);

