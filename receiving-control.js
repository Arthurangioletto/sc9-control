/* Physical receipts and documentary SD3 evidence. No stock balance is inferred. */
(function(root){
  class ValidationError extends Error {}
  const DAY=86400000,eps=1e-8,quantityLabel=v=>Number(v).toLocaleString('pt-BR',{maximumFractionDigits:6});
  const code=v=>{const s=String(v??'').trim().toUpperCase();return /^\d+$/.test(s)?String(Number(s)).padStart(2,'0'):s;};
  const lot=v=>{const s=String(v??'').trim().toUpperCase().replace(/^(\d+)\.0$/,'$1');return /^\d+$/.test(s)?s.replace(/^0+(?=\d)/,''):s;};
  const spFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}),spDay=v=>spFormatter.format(new Date(v));
  function date(v){
    if(v instanceof Date){if(!Number.isFinite(v.getTime()))throw new ValidationError('Data inválida no SD3.');return v.toISOString().slice(0,10);}
    const s=String(v??'').trim(),m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/),raw=m?`${m[3]}-${m[2]}-${m[1]}`:s.slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||!Number.isFinite(Date.parse(raw+'T12:00:00Z'))||new Date(raw+'T12:00:00Z').toISOString().slice(0,10)!==raw)throw new ValidationError('Data inválida no SD3.');return raw;
  }
  const day=v=>Math.floor(Date.parse(date(v)+'T12:00:00Z')/DAY);
  function normalizeMovement(r){
    if(!r||typeof r!=='object')throw new ValidationError('Movimento inválido no SD3.');
    const tp=Number(r.tp);if(tp!==499&&tp!==999)return null;
    const cf=String(r.cf||'').trim().toUpperCase();if(cf&&!['RE4','DE4','RE7','DE7'].includes(cf)||!String(r.lote??'').trim())return null;
    const qt=Number(r.qt),filial=code(r.filial),armazem=code(r.armazem),produto=String(r.produto??'').trim().replace(/^(\d+)\.0$/,'$1'),lote=String(r.lote??'').trim(),doc=String(r.doc??'').trim().replace(/^(\d+)\.0$/,'$1');
    if(!filial||!armazem||!produto||!lote||!doc||r.qt===''||r.qt==null||!Number.isFinite(qt)||qt<0)throw new ValidationError('Movimento 499/999 precisa de filial, armazém, produto, lote, documento e quantidade válida.');
    return {filial,armazem,produto,lote,doc,tp,qt,dt:date(r.dt),cf:String(r.cf||'').trim().toUpperCase(),estornado:r.estornado===true||/^(S|SIM|1|TRUE)$/i.test(String(r.estornado||'')),usuario:String(r.usuario||'').slice(0,100)};
  }
  const movementKey=r=>JSON.stringify([r.filial,r.dt,r.doc,r.produto,lot(r.lote),r.armazem,r.tp,r.cf,r.estornado]);
  function aggregate(rows){const map=new Map();for(const raw of rows){const r=normalizeMovement(raw);if(!r)continue;const k=movementKey(r),old=map.get(k);map.set(k,old?{...r,qt:old.qt+r.qt}:r);if(!Number.isFinite(map.get(k).qt))throw new ValidationError('Quantidade acumulada inválida.');}return [...map.values()];}
  function replacePeriod(previous,rows,{filial,desde,ate,now=new Date().toISOString(),name='SD3',importedBy=''}={}){
    filial=code(filial);desde=date(desde);ate=date(ate);if(!filial||desde>ate)throw new ValidationError('Informe a filial e um período válido.');
    const all=aggregate(rows),selected=all.filter(r=>r.filial===filial);
    if(selected.some(r=>r.dt<desde||r.dt>ate))throw new ValidationError('Há movimentos da filial fora do período informado. Amplie o período para cobrir o arquivo completo.');
    const old=previous?.rows||[],kept=old.filter(r=>r.filial!==filial||r.dt<desde||r.dt>ate),coverage=(previous?.coverage||[]).filter(c=>c.filial!==filial||c.desde!==desde||c.ate!==ate).concat({filial,desde,ate,importedAt:now,name:String(name).slice(0,200),importedBy:String(importedBy).slice(0,100)});
    return {sd3:{rows:[...kept,...selected],coverage,updatedAt:now,source:String(name).slice(0,200)},stats:{received:rows.length,selected:selected.length,ignoredOtherBranches:all.length-selected.length,replaced:old.length-kept.length,retained:kept.length,cancelled:selected.filter(r=>r.estornado).length}};
  }
  function transfers(rows){
    const map=new Map();for(const r of rows||[]){if(code(r.armazem)==='26'||r.estornado||r.cf&& !['RE4','DE4','RE7','DE7'].includes(r.cf))continue;
      const k=JSON.stringify([r.filial,r.dt,r.doc,r.produto,lot(r.lote)]);if(!map.has(k))map.set(k,{key:k,filial:r.filial,dt:r.dt,doc:r.doc,produto:r.produto,lote:r.lote,out:0,into:0,elsewhere:{},users:new Set()});const t=map.get(k);if(r.usuario)t.users.add(r.usuario);
      if(r.tp===999&&r.armazem==='02')t.out+=r.qt;
      if(r.tp===499){if(r.armazem==='01')t.into+=r.qt;else t.elsewhere[r.armazem]=(t.elsewhere[r.armazem]||0)+r.qt;}
    }
    return [...map.values()].filter(t=>t.out>eps||t.into>eps).map(t=>({...t,users:[...t.users],valid:t.out>eps&&Math.abs(t.out-t.into)<=eps&&!Object.values(t.elsewhere).some(q=>q>eps),remaining:t.out>eps&&Math.abs(t.out-t.into)<=eps&&!Object.values(t.elsewhere).some(q=>q>eps)?t.into:0})).sort((a,b)=>a.dt.localeCompare(b.dt)||a.key.localeCompare(b.key));
  }
  function reconcile(entries,sd3={}){
    const docs=transfers(sd3.rows),coverage=(sd3.coverage||[]).map(c=>({...c,importedDay:spDay(c.importedAt)})),products=new Map(),docIndex=new Map(),pendingTransfers=new Set();
    for(const doc of docs){const k=JSON.stringify([doc.filial,lot(doc.lote),doc.produto]);doc.day=day(doc.dt);if(!docIndex.has(k))docIndex.set(k,[]);docIndex.get(k).push(doc);}
    for(const r of sd3.rows||[]){
      if(code(r.armazem)==='26')continue;
      const k=JSON.stringify([r.filial,lot(r.lote)]);if(!products.has(k))products.set(k,new Set());products.get(k).add(r.produto);
    }
    const rows=[...(entries||[])].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||(a.sequence||0)-(b.sequence||0)||a.id.localeCompare(b.id)).map(e=>{
      const candidates=[...(products.get(JSON.stringify([e.filial,lot(e.lote)]))||[])].sort(),produto=e.produto||(candidates.length===1?candidates[0]:''),receivedDay=spDay(e.createdAt),d=day(receivedDay);
      const covered=coverage.some(c=>c.filial===e.filial&&c.desde<=receivedDay&&c.ate>=receivedDay&&(receivedDay<c.importedDay||c.importedAt>=e.createdAt));
      const result={...e,receivedDay,produtoResolvido:produto,candidates,covered,allocated:0,missing:e.quantidade,docs:[],issues:[]};
      if(e.cancelledAt)return {...result,status:'cancelado',message:'Registro cancelado; quantidade fora da conferência.'};
      if(!produto&&candidates.length>1)return {...result,status:'produto_ambiguo',message:'Este lote aparece em mais de um produto. Identifique o produto para conferir sem misturar quantidades.'};
      const compatible=(docIndex.get(JSON.stringify([e.filial,lot(e.lote),produto]))||[]).filter(t=>t.day>=d-2||pendingTransfers.has(t.key));
      for(const t of compatible){if(!t.valid||t.remaining<=eps||result.missing<=eps)continue;const used=Math.min(t.remaining,result.missing);t.remaining-=used;result.allocated+=used;result.missing=Math.max(0,e.quantidade-result.allocated);if(t.remaining>eps)pendingTransfers.add(t.key);else pendingTransfers.delete(t.key);result.docs.push({documentKey:t.key,doc:t.doc,dt:t.dt,produto:t.produto,quantidade:used,transferida:t.into,usuarios:t.users});}
      if(result.missing<=eps){const lateTransfer=result.docs.some(doc=>day(doc.dt)>d);return {...result,lateTransfer,status:'conferido',message:lateTransfer?'Quantidade conciliada com transferência lançada após a data do recebimento. Consulte a data dos documentos.':'Quantidade recebida conciliada com saída do 02 e entrada no 01 no mesmo documento.'};}
      const partial=result.allocated>eps?'O SD3 conciliou '+quantityLabel(result.allocated)+' de '+quantityLabel(e.quantidade)+' recebidas; '+quantityLabel(result.missing)+' ainda sem correspondência. ':'';
      if(!covered)return {...result,status:'aguardando_sd3',message:partial+'Aguardando SD3 atualizado para a data deste recebimento. A ausência na base atual ainda não comprova divergência.'};
      result.issues=compatible.filter(t=>!t.valid).map(t=>({doc:t.doc,dt:t.dt,saida02:t.out,entrada01:t.into,outrosArmazens:t.elsewhere}));
      const other=[...new Set(result.issues.flatMap(i=>Object.entries(i.outrosArmazens).filter(([,q])=>q>eps).map(([arm])=>arm)))];
      const issue=other.length?'O SD3 registra entrada no armazém '+other.join(', ')+', diferente do 01.':result.issues.length?'O documento não possui saída do 02 e entrada no 01 com quantidades iguais.':partial?'A quantidade recebida excede a quantidade disponível para este recebimento no SD3.':compatible.some(t=>t.valid)?'As quantidades disponíveis nas transferências deste lote já estão vinculadas a outros recebimentos.':'Transferência 02 → 01 não encontrada no período do SD3 importado.';
      return {...result,status:'divergente',message:partial+issue};
    });
    // Build groups only through document quantities actually allocated above. Same lot alone is not a link.
    const docByKey=new Map(docs.map(t=>[t.key,t])),owners=new Map(),parents=rows.map((_,i)=>i);
    function find(i){while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;}
    rows.forEach((r,i)=>{if(r.cancelledAt)return;for(const d of r.docs){const previous=owners.get(d.documentKey);if(previous!==undefined)parents[find(i)]=find(previous);else owners.set(d.documentKey,i);}});
    const groups=new Map(),partialGroups=[];rows.forEach((r,i)=>{if(!r.docs.length||r.cancelledAt)return;const key=find(i);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);});
    for(const members of groups.values()){
      const keys=[...new Set(members.flatMap(r=>r.docs.map(d=>d.documentKey)))],documents=keys.map(key=>docByKey.get(key)),expected=documents.reduce((sum,t)=>sum+t.into,0),received=members.reduce((sum,r)=>sum+r.quantidade,0),allocated=members.reduce((sum,r)=>sum+r.allocated,0),remaining=documents.reduce((sum,t)=>sum+Math.max(0,t.remaining),0),unmatched=members.reduce((sum,r)=>sum+r.missing,0),complete=remaining<=eps&&unmatched<=eps;
      if(members.length===1&&complete)continue;
      const group={id:members[0].id,expected,received,allocated,remaining,unmatched,complete,documents:documents.map(t=>({doc:t.doc,dt:t.dt,produto:t.produto,quantidade:t.into})),receipts:members.map(r=>({id:r.id,lote:r.lote,quantidade:r.quantidade,allocated:r.allocated,createdAt:r.createdAt,createdBy:r.createdBy,createdByName:r.createdByName}))};
      partialGroups.push(group);
      for(const r of members){
        r.partialGroupId=group.id;
        if(r.issues.length)continue; // An invalid destination/document keeps its operational warning.
        const description=members.length+(members.length===1?' bipagem vinculada: ':' bipagens vinculadas: ')+quantityLabel(received)+' recebidas para '+quantityLabel(expected)+' nos documentos.';
        if(complete){r.status='conferido';r.message='Conferido por bipagens parciais. '+description+(r.lateTransfer?' Há transferência lançada após a data do recebimento.':'');}
        else{r.status='saldo_parcial';r.message='Saldo parcial. '+description+(remaining>eps?' Faltam receber '+quantityLabel(remaining)+' para completar os documentos.':'')+(unmatched>eps?' Há '+quantityLabel(unmatched)+' recebidas sem correspondência no SD3. Confira o lançamento ou o documento antes de registrar novas quantidades.':'');}
      }
    }
    const excess=docs.filter(t=>t.valid&&t.remaining>eps).map(t=>({filial:t.filial,produto:t.produto,lote:t.lote,doc:t.doc,dt:t.dt,quantidade:t.remaining}));
    return {rows:rows.reverse(),partialGroups,excess,stats:{active:rows.filter(r=>!r.cancelledAt).length,received:rows.filter(r=>!r.cancelledAt).reduce((sum,r)=>sum+r.quantidade,0),conferido:rows.filter(r=>r.status==='conferido').length,saldo_parcial:rows.filter(r=>r.status==='saldo_parcial').length,aguardando_sd3:rows.filter(r=>r.status==='aguardando_sd3').length,divergente:rows.filter(r=>r.status==='divergente').length,produto_ambiguo:rows.filter(r=>r.status==='produto_ambiguo').length}};
  }
  function parseWorkbook(wb,XLSX,{filial='01'}={}){
    const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/[_\.]/g,' ').replace(/\s+/g,' ');
    const aliases={tp:['TP MOVIMENTO','TIPO MOVIMENTO','D3 TM'],produto:['PRODUTO','CODIGO DO PRODUTO','D3 COD'],qt:['QUANTIDADE','D3 QUANT'],armazem:['ARMAZEM','D3 LOCAL'],doc:['DOCUMENTO','D3 DOC'],dt:['DT EMISSAO','DATA EMISSAO','D3 EMISSAO'],lote:['LOTE','LOTE CONTROLE','D3 LOTECTL'],filial:['FILIAL','D3 FILIAL'],cf:['TIPO RE/DE','D3 CF'],estornado:['ESTORNADO','D3 ESTORNO'],usuario:['USUARIO','D3 USUARIO']};
    let header,table;for(const name of [...wb.SheetNames].sort((a,b)=>Number(/MOVIMENT|SD3/i.test(b))-Number(/MOVIMENT|SD3/i.test(a)))){
      const data=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',raw:true});for(let i=0;i<Math.min(20,data.length);i++){const cols={};for(const [key,labels]of Object.entries(aliases)){const index=data[i].findIndex(value=>labels.includes(norm(value)));if(index>=0)cols[key]=index;}
        if(['tp','produto','qt','armazem','doc','dt','lote','estornado'].every(key=>cols[key]!==undefined)){header={cols,row:i};table=data;break;}}
      if(header)break;
    }
    if(!header)throw new ValidationError('O SD3 precisa de Tipo de movimento, Produto, Quantidade, Armazém, Documento, Data de emissão, Lote e Estornado.');
    const rows=[];let ignored=0,desde='',ate='';for(let i=header.row+1;i<table.length;i++){const raw=table[i],tp=Number(raw[header.cols.tp]);if(!String(raw[header.cols.tp]??'').trim()||!Number.isFinite(tp)){ignored++;continue;}const r={};for(const [key,index]of Object.entries(header.cols))r[key]=raw[index];r.filial=r.filial||filial;
      if(typeof r.dt==='number'){const d=XLSX.SSF.parse_date_code(r.dt);if(!d)throw new ValidationError('Data inválida na linha '+(i+1));r.dt=`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;}
      try{const stamp=date(r.dt);if(code(r.filial)===code(filial)){if(!desde||stamp<desde)desde=stamp;if(!ate||stamp>ate)ate=stamp;}const normalized=normalizeMovement(r);if(normalized)rows.push(normalized);else ignored++;}catch(e){throw new ValidationError('Linha '+(i+1)+': '+e.message);}}
    return {rows,ignored,period:{desde,ate},hasBranch:header.cols.filial!==undefined};
  }
  const api={ValidationError,code,lot,date,day,spDay,normalizeMovement,movementKey,aggregate,replacePeriod,transfers,reconcile,parseWorkbook};root.SC9Receiving=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
