/* Shared SB8 identity. Grouped divergences stay grouped; individual occurrences are scoped. */
(function(root){
  const individual = type => type === 'vencimento' || type === 'saldoNegativo';
  const code = value => { const s=String(value == null?'':value).trim();return /^\d+$/.test(s)?String(Number(s)):s; };
  const date = value => {if(!value)return '';const d=new Date(value);return isNaN(d)?String(value):d.toISOString().slice(0,10);};
  const recordKey = row => 'v2:'+JSON.stringify([code(row.filial),code(row.armazem),String(row.produto||''),String(row.lote||''),date(row.dtValidade)]);
  const legacyKey = (type,row) => type==='duplicado'||type==='validadeVariavel'?row.lote:type==='multiFilial'?`${row.lote}|${row.produtoBase}`:`${row.lote}|${row.produto}`;
  const findingKey = (type,row) => individual(type)?recordKey(row):legacyKey(type,row);
  function mergeFinding(previous,next,complete=false){
    if(!previous||!Array.isArray(previous.dados?.registros)||!Array.isArray(next.dados?.registros)||complete)return next;
    const records=new Map(previous.dados.registros.map(row=>[recordKey(row),row]));
    next.dados.registros.forEach(row=>records.set(recordKey(row),row));
    return {...next,dados:{...next.dados,registros:[...records.values()]}};
  }
  function canonicalizeFindings(findings){const map=new Map();for(const item of findings||[]){const chave=individual(item.tipo)&&item.dados?.produto&&item.dados?.lote?findingKey(item.tipo,item.dados):item.chave;const next={...item,chave};const key=JSON.stringify([chave,item.tipo]);map.set(key,mergeFinding(map.get(key),next));}return [...map.values()];}
  // Keep the historical unscoped finding on disk, but do not count it twice
  // once the same occurrence is identified in the new source with a filial.
  const unscopedKey = row => recordKey({...row,filial:''});
  function currentFindings(findings){
    const scoped=new Set((findings||[]).filter(item=>individual(item.tipo)&&code(item.dados?.filial)).map(item=>JSON.stringify([item.tipo,unscopedKey(item.dados)])));
    return (findings||[]).filter(item=>!individual(item.tipo)||code(item.dados?.filial)||!scoped.has(JSON.stringify([item.tipo,unscopedKey(item.dados||{})])));
  }
  const physicalKey = row => [code(row.filial),String(row.produto||''),code(row.armazem),date(row.dtValidade)].join('|');
  function migrateNotes(notes,findings){
    const visible=currentFindings(findings),byLegacy=new Map(),byUnscoped=new Map(),groups=new Map();
    const explicit=new Set(notes.map(note=>JSON.stringify([note.tipo,note.chave])));
    const add=(map,key,value)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(value);};
    for(const item of visible){
      if(individual(item.tipo)){
        add(byLegacy,JSON.stringify([item.tipo,legacyKey(item.tipo,item.dados||{})]),item.chave);
        if(code(item.dados?.filial))add(byUnscoped,JSON.stringify([item.tipo,unscopedKey(item.dados)]),item.chave);
      }else if(Array.isArray(item.dados?.registros)){
        const aliases=new Map();
        for(const row of item.dados.registros)if(code(row.filial))add(aliases,physicalKey({...row,filial:''}),physicalKey(row));
        groups.set(JSON.stringify([item.tipo,item.chave]),aliases);
      }
    }
    return notes.map(note=>{
      if(individual(note.tipo)){
        let matches;
        if(String(note.chave).startsWith('v2:')){
          try{const key=JSON.parse(note.chave.slice(3));if(key[0])return note;}catch{return note;}
          matches=byUnscoped.get(JSON.stringify([note.tipo,note.chave]));
          if(!matches?.size)return note;
        }else matches=byLegacy.get(JSON.stringify([note.tipo,note.chave]))||new Set();
        if(matches.size!==1)return {...note,legacyUnscoped:true};
        const chave=[...matches][0];
        if(chave===note.chave)return note;
        if(explicit.has(JSON.stringify([note.tipo,chave])))return {...note,legacyUnscoped:true};
        return {...note,chave,legacyKey:note.chave,legacyUnscoped:false};
      }
      const aliases=groups.get(JSON.stringify([note.tipo,note.chave]));
      if(!aliases)return note;
      let result={...note},unlinked=[];
      if(String(note.correto||'').startsWith('|')){
        const candidates=aliases.get(note.correto);
        if(candidates?.size===1)result.correto=[...candidates][0];else unlinked.push('produto correto');
      }
      if(note.fisico){
        result.fisico={...note.fisico};
        for(const [oldKey,value]of Object.entries(note.fisico))if(oldKey.startsWith('|')){
          const candidates=aliases.get(oldKey),key=candidates?.size===1?[...candidates][0]:null;
          if(key&&(!result.fisico[key]||JSON.stringify(result.fisico[key])===JSON.stringify(value))){result.fisico[key]=value;delete result.fisico[oldKey];}
          else unlinked.push('conferência física');
        }
      }
      result.legacyRecordFields=[...new Set(unlinked)];
      return result;
    });
  }

  // Add only a missing branch. Existing manual work and every other field are retained.
  function enrichBranches(findings, notes, entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 500000) throw new Error('Lista de filiais inválida.');
    const identity = row => JSON.stringify([String(row.produto||'').trim(),String(row.lote||'').trim(),code(row.armazem)]);
    const index = new Map();
    for (const entry of entries) {
      if (!Array.isArray(entry) || ![4,6].includes(entry.length) || entry.some(value => typeof value !== 'string') || !entry[0].trim() || !entry[1].trim() || !entry[2].trim() || !['1','2','3','4'].includes(code(entry[3])) || (entry.length===6&&(!Number.isFinite(Number(entry[4]))||!/^$|^\d{4}-\d{2}-\d{2}$/.test(entry[5])))) throw new Error('Vínculo de filial inválido.');
      const base = identity({produto:entry[0],lote:entry[1],armazem:entry[2]});
      const key = entry.length===6 ? JSON.stringify([base,Number(entry[4]),entry[5]]) : base, branch=code(entry[3]);
      index.set(key,index.has(key)&&index.get(key)!==branch?null:branch);
    }
    // Protect even a pending note: it may contain a selected product or physical checks.
    const reviewed = new Set((notes||[]).map(note=>JSON.stringify([note.tipo,note.chave])));
    const occupied = new Set((findings||[]).map(item=>JSON.stringify([item.tipo,item.chave])));
    const stats={updatedFindings:0,updatedRows:0,protectedFindings:0,unmatchedRows:0,existingBranchRows:0};
    const updated=(findings||[]).map(item=>{
      const data=item.dados||{};
      const aliases=[item.chave,legacyKey(item.tipo,data)];
      if(individual(item.tipo))aliases.push(recordKey({...data,filial:''}));
      if(aliases.some(key=>reviewed.has(JSON.stringify([item.tipo,key])))){stats.protectedFindings++;return item;}
      let changes=0;
      const enrich=row=>{
        if(code(row.filial)){stats.existingBranchRows++;return row;}
        const base=identity(row),branch=index.get(base)||index.get(JSON.stringify([base,Number(row.saldo)||0,date(row.dtValidade)]));
        if(!branch){stats.unmatchedRows++;return row;}
        changes++;return {...row,filial:branch};
      };
      const nextData=Array.isArray(data.registros)?{...data,registros:data.registros.map(enrich)}:enrich(data);
      if(!changes)return item;
      const chave=individual(item.tipo)?recordKey(nextData):item.chave;
      if(chave!==item.chave&&occupied.has(JSON.stringify([item.tipo,chave]))){stats.unmatchedRows+=changes;return item;}
      occupied.add(JSON.stringify([item.tipo,chave]));
      stats.updatedRows+=changes;stats.updatedFindings++;
      return {...item,chave,dados:nextData};
    });
    return {achados:updated,stats};
  }
  async function importPrepared(payload,send,onProgress=()=>{}){
    if(payload?.format==='sc9-sb8-filiais-v1'){
      if(!Array.isArray(payload.entries)||!payload.entries.length)throw new Error('Base de filiais inválida.');
      onProgress(0,payload.entries.length);
      const result=await send({acao:'completarFiliais',entries:payload.entries,source:payload.source||{}});
      onProgress(payload.entries.length,payload.entries.length);
      return {...result,branchOnly:true};
    }
    if(payload?.format!=='sc9-sb8-v1'||!Array.isArray(payload.achados)||!payload.achados.length)throw new Error('Base processada SB8 inválida.');
    const types=new Set(['duplicado','validadeVariavel','vencimento','saldoNegativo','multiFilial']);
    for(const item of payload.achados){
      if(!types.has(item?.tipo)||!item.dados||typeof item.dados!=='object'||!item.chave)throw new Error('Achado inválido na base processada.');
      if(!individual(item.tipo)&&!Array.isArray(item.dados.registros))throw new Error('Grupo sem registros na base processada.');
    }
    for(let offset=0;offset<payload.achados.length;offset+=2000){
      const chunk=payload.achados.slice(offset,offset+2000);
      await send({acao:'sincronizar',achados:chunk,completeGroups:true});
      onProgress(Math.min(offset+chunk.length,payload.achados.length),payload.achados.length);
    }
    return {records:Number(payload.source?.rows)||0,findings:payload.achados.length};
  }
  function allExpiryRecords(rows,now=new Date()){return rows.filter(row=>Number(row.saldo)>0&&row.dtValidade&&!isNaN(new Date(row.dtValidade))).map(row=>({...row,diasParaVencer:Math.round((new Date(row.dtValidade)-now)/86400000),jaVencido:new Date(row.dtValidade)<now}));}
  function LegacyNotes({notes}){
    const pending=notes.filter(note=>note.legacyUnscoped||note.legacyRecordFields?.length);if(!pending.length)return null;
    const h=root.React.createElement;
    return h('details',{className:'sc9-legacy-notes'},
      h('summary',null,pending.length+' observação(ões) antiga(s) para conferir'),
      h('p',null,'Dados preservados da base anterior. Confirme a filial e o registro antes de reaplicar uma escolha sem vínculo único.'),
      pending.map(note=>h('div',{key:note.id||note.chave},
        h('strong',null,note.chave+' · '+note.tipo),h('p',null,note.nota||'Sem texto'),
        note.legacyRecordFields?.length?h('p',null,'Conferir: '+note.legacyRecordFields.join(', ')):null,
        note.legacyRecordFields?.includes('produto correto')?h('p',null,'Escolha anterior: '+note.correto):null,
        Object.entries(note.fisico||{}).filter(([key])=>key.startsWith('|')).map(([key,value])=>h('p',{key},key+' · '+Object.entries(value).map(([field,text])=>field+': '+text).join(' · '))),
        h('small',null,'Situação anterior: '+(note.status||'pendente')))));
  }
  const api={enrichBranches,importPrepared,allExpiryRecords,individual,recordKey,currentFindings,findingKey,legacyKey,mergeFinding,canonicalizeFindings,migrateNotes,LegacyNotes};root.SC9Inventory=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
