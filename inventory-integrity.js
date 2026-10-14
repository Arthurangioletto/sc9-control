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
  function migrateNotes(notes,findings){
    const byLegacy=new Map(),explicit=new Set(notes.map(note=>JSON.stringify([note.tipo,note.chave])));
    for(const item of findings){if(!individual(item.tipo))continue;const key=JSON.stringify([item.tipo,legacyKey(item.tipo,item.dados||{})]);if(!byLegacy.has(key))byLegacy.set(key,new Set());byLegacy.get(key).add(item.chave);}
    return notes.map(note=>{
      if(!individual(note.tipo)||String(note.chave).startsWith('v2:'))return note;
      const matches=byLegacy.get(JSON.stringify([note.tipo,note.chave]))||new Set();
      if(matches.size!==1)return {...note,legacyUnscoped:true};
      const chave=[...matches][0];
      // An explicit scoped note wins; retain the old note separately for consultation.
      if(explicit.has(JSON.stringify([note.tipo,chave])))return {...note,legacyUnscoped:true};
      return {...note,chave,legacyKey:note.chave,legacyUnscoped:false};
    });
  }
  function allExpiryRecords(rows,now=new Date()){return rows.filter(row=>Number(row.saldo)>0&&row.dtValidade&&!isNaN(new Date(row.dtValidade))).map(row=>({...row,diasParaVencer:Math.round((new Date(row.dtValidade)-now)/86400000),jaVencido:new Date(row.dtValidade)<now}));}
  function LegacyNotes({notes}){const pending=notes.filter(note=>note.legacyUnscoped);if(!pending.length)return null;const h=root.React.createElement;return h('details',{className:'sc9-legacy-notes'},h('summary',null,`${pending.length} observação(ões) antiga(s) sem vínculo único`),h('p',null,'Preservadas para consulta. Confirme filial e armazém antes de aplicar a nota ou finalização a um registro.'),pending.map(note=>h('div',{key:note.id||note.chave},h('strong',null,note.chave+' · '+note.tipo),h('p',null,note.nota||'Sem texto'),h('small',null,'Situação anterior: '+(note.status||'pendente')))));}
  const api={allExpiryRecords,individual,recordKey,findingKey,legacyKey,mergeFinding,canonicalizeFindings,migrateNotes,LegacyNotes};root.SC9Inventory=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
