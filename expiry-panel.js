/* Expiry analysis uses calendar days since expiry, never presumed stock movement. */
(function (root) {
  const BRANCHES = [['1','Cambuci'],['2','Santa Catarina'],['3','Tamboré'],['4','Paraíso']];
  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  function code(value) { const s=String(value == null?'':value).trim(); return /^\d+$/.test(s)?String(Number(s)):s; }
  function dateParts(value) {
    if (!value) return null;
    if (typeof value==='string') { const m=value.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) { const y=+m[1],mo=+m[2],d=+m[3],check=new Date(Date.UTC(y,mo-1,d));return check.getUTCFullYear()===y&&check.getUTCMonth()===mo-1&&check.getUTCDate()===d?{y,m:mo,d}:null; } }
    const d=value instanceof Date?value:new Date(value);return isNaN(d)?null:{y:d.getFullYear(),m:d.getMonth()+1,d:d.getDate()};
  }
  function day(value) { const p=dateParts(value);return p?Date.UTC(p.y,p.m-1,p.d)/86400000:null; }
  function ageBand(days) { return days<=0?'A vencer':days<=30?'Até 30 dias':days<=90?'31–90 dias':days<=180?'91–180 dias':days<=365?'181–365 dias':'Mais de 1 ano'; }
  function enrich(rows, now=new Date()) { const today=day(now);return rows.map(row=>{const p=dateParts(row.dtValidade),expiry=day(row.dtValidade);const age=expiry===null?null:today-expiry;return {...row,expiryYear:p?String(p.y):'',expiryMonth:p?String(p.m).padStart(2,'0'):'',expiredDays:age,ageBand:age===null?'Sem validade':ageBand(age)};}); }
  function summarize(rows) {return {units:rows.reduce((s,r)=>s+Math.max(0,Number(r.saldo)||0),0),lots:new Set(rows.map(r=>[code(r.filial),r.produto,r.lote].join('|'))).size,products:new Set(rows.map(r=>r.produto)).size,oldest:rows.reduce((m,r)=>Math.max(m,r.expiredDays||0),0)};}
  function group(rows,key) {const map=new Map();rows.forEach(row=>{const k=key(row);if(!map.has(k))map.set(k,[]);map.get(k).push(row);});return [...map.entries()];}
  function Panel({rows,overviewRows,inventory,saved,filial,warehouse,onFilial,onWarehouse,days,onDays,renderActions,onExport}) {
    const h=root.React.createElement,R=root.React;
    const [year,setYear]=R.useState(''),[month,setMonth]=R.useState(''),[band,setBand]=R.useState(''),[future,setFuture]=R.useState(false),[limit,setLimit]=R.useState(30);
    const all=R.useMemo(()=>enrich(overviewRows),[overviewRows]),scoped=R.useMemo(()=>enrich(rows),[rows]);
    const years=[...new Set(scoped.filter(r=>future||r.expiredDays>0).map(r=>r.expiryYear).filter(Boolean))].sort();
    const visible=scoped.filter(r=>(future||r.expiredDays>0)&&(!year||r.expiryYear===year)&&(!month||r.expiryMonth===month)&&(!band||r.ageBand===band));
    const stats=summarize(visible),fmt=v=>Number(v||0).toLocaleString('pt-BR'),label=v=>v?String(v).padStart(2,'0'):'Não informado';
    const branchName=v=>(BRANCHES.find(([c])=>c===code(v))||[v,'Filial '+label(v)])[1];
    const warehouses=root.SC9LotFilters.warehouses(inventory,saved,filial);
    const change=(set,value)=>{set(value);setLimit(30);};
    function metric(title,value,sub){return h('div',{className:'sc9-exp-metric'},h('span',null,title),h('strong',null,value),h('small',null,sub));}
    function select(title,value,set,options){return h('label',null,title,h('select',{value,onChange:e=>change(set,e.target.value)},h('option',{value:''},'Todos'),options.map(([v,t])=>h('option',{key:v,value:v},t))));}
    function summary(title,items){const s=summarize(items);return h('summary',null,h('strong',null,title),h('span',null,fmt(s.units)+' un. · '+fmt(s.lots)+' lotes/produtos'));}
    const buckets=['Até 30 dias','31–90 dias','91–180 dias','181–365 dias','Mais de 1 ano'];
    return h('section',{className:'sc9-expiry','aria-label':'Análise de vencidos'},
      h('div',{className:'sc9-exp-heading'},h('div',null,h('h2',null,'Estoque vencido'),h('p',null,'Filial → armazém → ano e mês da validade. Tempo contado desde o vencimento, sem prazo de resolução.'))),
      h('div',{className:'sc9-exp-branches'},h('button',{type:'button',className:!filial?'is-active':'',onClick:()=>{onFilial('');setYear('');setMonth('');}},'Todas as filiais'),BRANCHES.map(([id,name])=>{const s=summarize(all.filter(r=>code(r.filial)===id&&r.expiredDays>0));return h('button',{key:id,type:'button',className:code(filial)===id?'is-active':'',onClick:()=>{onFilial(id);setYear('');setMonth('');setLimit(30);}},h('strong',null,name+' · '+label(id)),h('span',null,fmt(s.units)+' un. vencidas · '+fmt(s.lots)+' lotes/produtos'));})),
      h('div',{className:'sc9-exp-controls'},h('label',null,'Armazém',h('select',{value:warehouse,onChange:e=>onWarehouse(e.target.value)},h('option',{value:'__TODOS__'},'Todos os armazéns'),warehouses.map(id=>h('option',{key:id,value:id},label(id))))),select('Ano de vencimento',year,setYear,years.map(y=>[y,y])),select('Mês de vencimento',month,setMonth,MONTHS.map((m,i)=>[String(i+1).padStart(2,'0'),m])),select('Tempo vencido',band,setBand,buckets.map(b=>[b,b])),h('button',{type:'button',onClick:()=>{setYear('');setMonth('');setBand('');}},'Limpar período')),
      h('div',{className:'sc9-exp-metrics'},metric(future?'Volume no recorte':'Volume vencido',fmt(stats.units),'unidades no recorte'),metric('Lotes / produtos',fmt(stats.lots),fmt(stats.products)+' produtos distintos'),metric('Maior tempo vencido',fmt(stats.oldest)+' dias',stats.oldest>=365?(stats.oldest/365.25).toFixed(1).replace('.',',')+' anos desde a validade':'desde a validade')),
      h('div',{className:'sc9-exp-aging'},buckets.map(b=>{const subset=scoped.filter(r=>r.ageBand===b&&(!year||r.expiryYear===year)&&(!month||r.expiryMonth===month)),s=summarize(subset);return h('button',{key:b,type:'button',className:band===b?'is-active':'',onClick:()=>change(setBand,band===b?'':b)},h('span',null,b),h('strong',null,fmt(s.units)+' un.'),h('small',null,fmt(s.lots)+' lotes/produtos'));})),
      h('p',{className:'sc9-exp-note'},'As faixas indicam envelhecimento do estoque vencido. Dias sem movimentação não são calculados sem histórico de movimentação.'),
      h('div',{className:'sc9-exp-controls'},h('label',{className:'sc9-exp-check'},h('input',{type:'checkbox',checked:future,onChange:e=>setFuture(e.target.checked)}),'Incluir itens a vencer'),future&&h('label',null,'A vencer em até (dias)',h('input',{type:'number',min:0,value:days,onChange:e=>onDays(e.target.value)})),h('button',{type:'button',onClick:()=>onExport(visible)},'Exportar recorte')),
      !visible.length&&h('p',{className:'sc9-exp-empty'},'Nenhum registro encontrado para esses filtros.'),
      group(visible,r=>code(r.filial)).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).map(([branch,branchRows])=>h('details',{key:branch,className:'sc9-exp-group',open:true},summary(branchName(branch)+' · '+label(branch),branchRows),
        group(branchRows,r=>code(r.armazem)).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).map(([arm,armRows])=>h('details',{key:arm,className:'sc9-exp-warehouse'},summary('Armazém '+label(arm),armRows),
          group(armRows,r=>r.expiryYear).sort((a,b)=>a[0].localeCompare(b[0])).map(([yr,yrRows])=>h('details',{key:yr,className:'sc9-exp-year',open:!!year},summary(yr||'Sem validade',yrRows),
            group(yrRows,r=>r.expiryMonth).sort((a,b)=>a[0].localeCompare(b[0])).map(([mo,monthRows])=>h('details',{key:mo,className:'sc9-exp-month',open:!!month},summary(MONTHS[Number(mo)-1]||'Sem mês',monthRows),monthRows.slice().sort((a,b)=>b.expiredDays-a.expiredDays).slice(0,limit).map((r,i)=>h('article',{key:[r.produto,r.lote,r.armazem,i].join('|'),className:'sc9-exp-record'},
              h('div',{className:'sc9-exp-record-top'},h('strong',null,r.produto+' · Lote '+r.lote),h('span',{className:r.expiredDays>365?'sc9-exp-old':''},r.expiredDays>0?'Vencido há '+fmt(r.expiredDays)+' dias':r.expiredDays===0?'Vence hoje':'Vence em '+fmt(-r.expiredDays)+' dias')),
              h('p',null,r.descricao||'Sem descrição'),h('div',{className:'sc9-exp-record-meta'},h('span',null,'Saldo: '+fmt(r.saldo)+' un.'),h('span',null,'Validade: '+(dateParts(r.dtValidade)?[dateParts(r.dtValidade).d,dateParts(r.dtValidade).m,dateParts(r.dtValidade).y].map((v,i)=>i<2?String(v).padStart(2,'0'):v).join('/'):'Não informada')),h('span',null,'Armazém '+label(r.armazem))),renderActions(r))),monthRows.length>limit&&h('button',{type:'button',onClick:()=>setLimit(limit+30)},'Mostrar mais 30 registros'))))))))));
  }
  function exportRows(rows) {return rows.map(r=>({Filial:code(r.filial),Unidade:(BRANCHES.find(([id])=>id===code(r.filial))||['','Não informada'])[1],Armazém:code(r.armazem),Produto:r.produto,Descrição:r.descricao||'',Lote:r.lote,Saldo:r.saldo,'Ano de vencimento':r.expiryYear,'Mês de vencimento':r.expiryMonth,'Dias desde o vencimento':r.expiredDays,'Faixa de tempo':r.ageBand}));}
  const api={code,dateParts,day,ageBand,enrich,summarize,group,exportRows,Panel};root.SC9Expiry=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);

