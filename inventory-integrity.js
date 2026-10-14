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
  const api={allExpiryRecords,individual,recordKey,currentFindings,findingKey,legacyKey,mergeFinding,canonicalizeFindings,migrateNotes,LegacyNotes};root.SC9Inventory=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
