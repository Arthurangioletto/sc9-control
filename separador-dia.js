/* Produção do separador por dia em que o pick terminou (não pelo dia de liberação do pedido).
 * Só lê as linhas de item já carregadas no SC9 (armazem, pedido, qt, separador, pickEnd); não grava nada. */
(function(root){
  const TZ='America/Sao_Paulo';
  const fmtDia=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
  const fmtHora=new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false});
  const number=v=>Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  const norm=v=>String(v||'').trim();
  const quando=v=>{if(!v)return null;const d=v instanceof Date?v:new Date(v);return Number.isNaN(d.getTime())?null:d;};
  const diaDe=d=>fmtDia.format(d); // AAAA-MM-DD no horário de Brasília
  function hojeSP(agora){return diaDe(agora||new Date());}
  // Linhas por separador no dia pedido. armazem '' ou '__ALL__' = todos.
  function porSeparador(items,dia,armazem){
    const todos=!armazem||armazem==='__ALL__',mapa=new Map();let semNome={pecas:0,linhas:0},total={pecas:0,linhas:0,pedidos:new Set()};
    for(const it of items||[]){
      const fim=quando(it.pickEnd);if(!fim||diaDe(fim)!==dia)continue;
      if(!todos&&it.armazem!==armazem)continue;
      const nome=norm(it.separador),qt=Number(it.qt)||0,chave=it.armazem+'|'+it.pedido;
      total.pecas+=qt;total.linhas+=1;total.pedidos.add(chave);
      if(!nome||nome==='0'){semNome.pecas+=qt;semNome.linhas+=1;continue;}
      let r=mapa.get(nome);if(!r){r={nome,pecas:0,linhas:0,pedidos:new Set(),primeiro:fim,ultimo:fim};mapa.set(nome,r);}
      r.pecas+=qt;r.linhas+=1;r.pedidos.add(chave);if(fim<r.primeiro)r.primeiro=fim;if(fim>r.ultimo)r.ultimo=fim;
    }
    const linhas=[...mapa.values()].map(r=>({nome:r.nome,pecas:r.pecas,linhas:r.linhas,pedidos:r.pedidos.size,primeiro:r.primeiro,ultimo:r.ultimo}))
      .sort((a,b)=>b.pecas-a.pecas||a.nome.localeCompare(b.nome,'pt-BR'));
    return {dia,linhas,semNome,total:{pecas:total.pecas,linhas:total.linhas,pedidos:total.pedidos.size}};
  }
  const api={porSeparador,hojeSP,diaDe,number};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SC9SeparadorDia=api;
  if(!root.React)return;
  const R=root.React,h=R.createElement;
  const hora=d=>fmtHora.format(d);
  const dataBr=iso=>iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4);
  api.Panel=function Panel({items,warehouse,warehouseLabel}){
    const [dia,setDia]=R.useState(()=>hojeSP());
    const r=R.useMemo(()=>porSeparador(items,dia,warehouse),[items,dia,warehouse]);
    const dias=R.useMemo(()=>{const s=new Set();for(const it of items||[]){const f=quando(it.pickEnd);if(f)s.add(diaDe(f));}return [...s].sort();},[items]);
    const escopo=(warehouse&&warehouse!=='__ALL__'?(warehouseLabel||warehouse):'Todos os armazéns');
    const ultimoComDados=dias.length?dias[dias.length-1]:'';
    const baixar=()=>{
      const linhas=[['Separador','Peças','Pedidos','Linhas','Primeiro pick','Último pick']].concat(r.linhas.map(l=>[l.nome,String(l.pecas).replace('.',','),l.pedidos,l.linhas,hora(l.primeiro),hora(l.ultimo)]));
      const csv='﻿'+linhas.map(l=>l.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(';')).join('\r\n');
      const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='producao-separadores-'+dia+'.csv';document.body.appendChild(a);a.click();a.remove();
    };
    return h('section',{className:'sc9-productivity-overview','aria-label':'Produção do separador por dia de separação'},
      h('div',{className:'sc9-productivity-heading'},h('div',null,h('h2',null,'Produção por dia de separação'),h('p',null,'Conta pelo dia em que o separador terminou o pick, não pelo dia de liberação do pedido · ',escopo))),
      h('div',{className:'sc9-productivity-filters'},
        h('label',null,'Dia da separação',h('input',{'aria-label':'Dia da separação',type:'date',value:dia,onChange:e=>{if(e.target.value)setDia(e.target.value);}})),
        h('button',{type:'button',className:'sc9-ui-button',onClick:()=>setDia(hojeSP())},'Hoje'),
        ultimoComDados&&ultimoComDados!==dia&&h('button',{type:'button',className:'sc9-ui-button',onClick:()=>setDia(ultimoComDados)},'Último dia com pick ('+dataBr(ultimoComDados)+')'),
        r.linhas.length>0&&h('button',{type:'button',className:'sc9-ui-button',onClick:baixar},'Baixar CSV')),
      h('div',{className:'sc9-productivity-metrics'},[['Peças separadas',r.total.pecas,'Soma das peças com pick terminado neste dia.'],['Pedidos',r.total.pedidos,'Pedidos com ao menos uma linha separada neste dia.'],['Linhas',r.total.linhas,'Linhas de item com pick terminado neste dia.'],['Separadores',r.linhas.length,'Pessoas com ao menos uma linha neste dia.']].map(([t,v,p])=>h('div',{className:'sc9-productivity-metric',key:t},h('span',null,t),h('strong',null,number(v)),h('p',null,p)))),
      r.total.linhas===0?h('p',{className:'sc9-productivity-empty',role:'status'},'Nenhum pick terminado em '+dataBr(dia)+' na base carregada.'+(dias.length?' Dias com pick na base: de '+dataBr(dias[0])+' a '+dataBr(dias[dias.length-1])+'.':'')):
      h('div',{className:'sc9-productivity-table',style:{overflowX:'auto'}},h('table',{style:{minWidth:560}},
        h('thead',null,h('tr',null,['Separador','Peças','Pedidos','Linhas','Primeiro pick','Último pick'].map((t,i)=>h('th',{key:t,style:{textAlign:i?'right':'left'}},t)))),
        h('tbody',null,r.linhas.map(l=>h('tr',{key:l.nome},h('td',null,l.nome),h('td',{style:{textAlign:'right'}},number(l.pecas)),h('td',{style:{textAlign:'right'}},number(l.pedidos)),h('td',{style:{textAlign:'right'}},number(l.linhas)),h('td',{style:{textAlign:'right'}},hora(l.primeiro)),h('td',{style:{textAlign:'right'}},hora(l.ultimo)))),
          r.semNome.linhas>0&&h('tr',{key:'__sem'},h('td',null,'Sem separador informado'),h('td',{style:{textAlign:'right'}},number(r.semNome.pecas)),h('td',{style:{textAlign:'right'}},'—'),h('td',{style:{textAlign:'right'}},number(r.semNome.linhas)),h('td',{style:{textAlign:'right'}},'—'),h('td',{style:{textAlign:'right'}},'—'))))),
      h('p',{className:'sc9-productivity-note'},'Usa só o que está na base carregada no SC9: se o dia ainda não foi carregado, ele não aparece aqui.'));
  };
})(typeof window==='object'?window:globalThis);
