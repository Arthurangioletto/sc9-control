/* Current SB8 balances are independent of historical findings and manual reviews. */
(function(root){
  const code=v=>{const s=String(v??'').trim().toUpperCase();return /^\d+$/.test(s)?String(Number(s)):s;};
  const iso=v=>{if(!v||!String(v).trim())return '';const d=new Date(v);if(isNaN(d))throw Error('Data inválida no SB8.');return d.toISOString().slice(0,10);};
  const key=r=>JSON.stringify([code(r.filial),code(r.armazem),String(r.produto).trim(),String(r.lote).trim(),iso(r.dtValidade)]);
  function normalize(r){
    if(!r||!code(r.filial)||!code(r.armazem)||!String(r.produto||'').trim()||!String(r.lote||'').trim()||r.saldo==null||r.saldo===''||!Number.isFinite(Number(r.saldo)))throw Error('Cada linha precisa de filial, armazém, produto, lote e saldo numérico.');
    return {filial:code(r.filial),armazem:code(r.armazem),produto:String(r.produto).trim(),lote:String(r.lote).trim(),saldo:Number(r.saldo),dtValidade:iso(r.dtValidade),descricao:String(r.descricao||'').slice(0,1000)};
  }
  function aggregate(rows){
    if(!Array.isArray(rows)||!rows.length||rows.length>500000)throw Error('Informe entre 1 e 500.000 linhas.');
    const map=new Map();for(const raw of rows){const row=normalize(raw),k=key(row),old=map.get(k);map.set(k,old?{...old,saldo:old.saldo+row.saldo}:row);if(!Number.isFinite(map.get(k).saldo))throw Error('Saldo total inválido.');}return [...map.values()];
  }
  function seed(findings){
    // A repeated finding is a reference to the same balance, not extra stock.
    const map=new Map(),ambiguous=new Set();
    for(const item of findings||[])for(const raw of item.dados?.registros||[item.dados||{}]){
      if(!code(raw.filial)||!code(raw.armazem)||!raw.produto||!raw.lote)continue;
      const row=normalize(raw),k=key(row),old=map.get(k);
      if(old&&old.saldo!==row.saldo)ambiguous.add(k);else map.set(k,row);
    }
    for(const k of ambiguous)map.delete(k);
    return {rows:[...map.values()],ambiguous:ambiguous.size};
  }
  function update(previous,incoming,{mode='present',now=new Date().toISOString(),source={}}={}){
    if(!['present','scopes','complete'].includes(mode))throw Error('Modo de atualização inválido.');
    const rows=aggregate(incoming),map=new Map((previous?.rows||[]).map(r=>[key(r),r]));
    const scopes=new Set(rows.map(r=>JSON.stringify([r.filial,r.armazem]))),seen=new Set();
    const stats={received:incoming.length,records:rows.length,added:0,changed:0,unchanged:0,zeroed:0,retained:0,emptyRows:0,scopes:[...scopes].map(s=>JSON.parse(s))};
    for(const row of rows){const k=key(row),old=map.get(k),same=old&&Number(old.saldo)===row.saldo;
      seen.add(k);if(!old&&row.saldo===0){stats.emptyRows++;continue;}if(!old)stats.added++;else if(same)stats.unchanged++;else stats.changed++;
      map.set(k,{...old,...row,descricao:row.descricao||old?.descricao||'',firstSeenAt:old?.firstSeenAt||now,balanceSince:same?(old.balanceSince||now):now,observations:same?(old?.observations||0)+1:1,previousSaldo:old?.saldo??null,checkedAt:now});
    }
    for(const [k,old]of map)if(!seen.has(k)){
      if(mode==='complete'||(mode==='scopes'&&scopes.has(JSON.stringify([code(old.filial),code(old.armazem)])))){
        if(Number(old.saldo)!==0)stats.zeroed++;
        map.set(k,{...old,saldo:0,previousSaldo:old.saldo,balanceSince:Number(old.saldo)===0?old.balanceSince:now,checkedAt:now,observations:(old.observations||0)+1});
      }else stats.retained++;
    }
    return {position:{rows:[...map.values()],updatedAt:now,source,mode,baselineAmbiguous:previous?.baselineAmbiguous||0},stats};
  }
  function hydrate(position){return position?.rows?.map(r=>({...r,dtValidade:r.dtValidade?new Date(r.dtValidade+'T12:00:00'):null}))||[];}
  const api={code,key,normalize,aggregate,seed,update,hydrate};root.SC9Stock=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
