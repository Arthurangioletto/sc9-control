(function(root){
  async function request(body){const r=await fetch('/api/cadastro-saldos',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Sc9-App':'1'}:{},body:body?JSON.stringify(body):undefined,cache:'no-cache'});const data=await r.json();if(!r.ok)throw Error(data.error||'Falha ao consultar saldos.');return data;}
  function usePosition(){
    const R=root.React,[position,setPosition]=R.useState(null),[error,setError]=R.useState('');
    const reload=async()=>{try{setPosition(await request());setError('');}catch(e){setError(e.message);}};
    R.useEffect(()=>{reload();},[]);
    const rows=R.useMemo(()=>position?.rows?root.SC9Stock.hydrate(position):null,[position]);
    return {position,rows,error,reload};
  }
  function Importer({readFile,onUpdated,position,isAdmin=false}){
    const R=root.React,h=R.createElement;
    const mode='present';
    const [busy,setBusy]=R.useState(false),[message,setMessage]=R.useState(''),[preview,setPreview]=R.useState(null),[id,setId]=R.useState('');
    const [backups,setBackups]=R.useState(null),[selected,setSelected]=R.useState(''),[recovery,setRecovery]=R.useState(null);
    async function listBackups(){setBusy(true);setRecovery(null);try{const r=await fetch('/api/cadastro-saldos/backups',{cache:'no-cache'}),data=await r.json();if(!r.ok)throw Error(data.error||'Falha ao consultar backups.');setBackups(data.backups);setSelected(data.backups[0]?.name||'');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
    async function previewRecovery(){setBusy(true);setRecovery(null);try{setRecovery(await request({acao:'preverRestauracao',backup:selected}));}catch(e){setMessage(e.message);}finally{setBusy(false);}}
    async function restore(){setBusy(true);try{const result=await request({acao:'restaurar',backup:recovery.backup,version:recovery.version});setRecovery(null);setBackups(null);await cancel();await onUpdated();setMessage('Posição anterior restaurada. '+result.positive.toLocaleString('pt-BR')+' registros com saldo positivo. Observações e marcações preservadas.');}catch(e){setRecovery(null);setMessage(e.message);}finally{setBusy(false);}}
    async function cancel(){if(id)try{await request({acao:'cancelar',id});}catch{}setId('');setPreview(null);}
    async function load(file){
      if(!file)return;setBusy(true);setMessage('Lendo o SB8…');setPreview(null);let uploadId='';
      try{
        await cancel();const rows=await readFile(file,p=>setMessage(p));
        // Validate the complete file before sending any chunk.
        const normalized=rows.map(root.SC9Stock.normalize);if(!normalized.length)throw Error('O arquivo não contém registros válidos.');
        const upload=await request({acao:'iniciar',mode,name:file.name});uploadId=upload.id;setId(uploadId);
        for(let i=0;i<normalized.length;i+=2000){await request({acao:'lote',id:uploadId,sequence:i/2000,rows:normalized.slice(i,i+2000)});setMessage('Preparando '+Math.min(i+2000,normalized.length).toLocaleString('pt-BR')+' de '+normalized.length.toLocaleString('pt-BR')+' linhas…');}
        const result=await request({acao:'prever',id:uploadId});setPreview(result);setMessage('Prévia pronta. O saldo ainda não foi alterado.');
      }catch(e){if(uploadId)try{await request({acao:'cancelar',id:uploadId});}catch{}setId('');setMessage(e.message);}finally{setBusy(false);}
    }
    async function apply(){setBusy(true);try{await request({acao:'aplicar',id});setId('');setPreview(null);await onUpdated();setMessage('Saldo atualizado. Análises anteriores, observações e conferências preservadas.');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
    const s=preview?.stats,fmt=v=>Number(v||0).toLocaleString('pt-BR');
    return h('section',{className:'sc9-stock-import','aria-label':'Atualizar saldo atual do SB8'},
      h('h3',null,'Atualizar saldo atual do SB8'),
      h('p',null,'Atualize as quantidades usadas nos vencimentos. Os achados antigos, marcações, finalizações e conferências físicas permanecem guardados.'),
      h('p',null,'Atualização dos registros presentes: produtos e lotes ausentes no arquivo mantêm o saldo anterior. Para zerar um item, inclua a linha correspondente com saldo 0. A substituição total foi desativada.'),
      h('input',{type:'file',accept:'.xlsx,.xls,.csv',disabled:busy,onChange:e=>{const file=e.target.files[0];e.target.value='';return load(file);},'aria-label':'SB8 para atualizar saldo atual'}),
      h('p',{role:'status'},message|| (position?.updatedAt?'Última atualização: '+new Date(position.updatedAt).toLocaleString('pt-BR'):'Ainda não há uma posição atual separada. A tela usa os achados já salvos.')),
      s&&h('div',{className:'sc9-stock-preview'},h('strong',null,'Prévia da atualização'),h('p',null,fmt(s.added)+' novos · '+fmt(s.changed)+' saldos alterados · '+fmt(s.unchanged)+' iguais · '+fmt(s.retained)+' registros ausentes preservados'),s.emptyRows>0&&h('p',null,fmt(s.emptyRows)+' registros já zerados, sem posição anterior, não entram nos indicadores.'),h('p',null,'Locais: '+s.scopes.map(([f,a])=>'Filial '+f.padStart(2,'0')+' / '+a).join(', ')),preview.baselineAmbiguous>0&&h('p',null,fmt(preview.baselineAmbiguous)+' registros antigos têm saldos conflitantes. Somente os encontrados neste arquivo terão saldo atual confiável.'),h('button',{type:'button',disabled:busy,onClick:apply},'Aplicar atualização do saldo'),h('button',{type:'button',disabled:busy,onClick:cancel},'Cancelar')),
      isAdmin&&h('details',null,h('summary',null,'Recuperar posição anterior'),h('p',null,'Restaure um backup dos saldos do Cadastro de Lotes. A base global, observações e marcações permanecem preservadas.'),h('button',{type:'button',disabled:busy,onClick:listBackups},'Consultar backups'),backups&&h('div',null,backups.length?h('label',null,'Backup anterior',h('select',{'aria-label':'Backup anterior',value:selected,disabled:busy,onChange:e=>{setSelected(e.target.value);setRecovery(null);}},...backups.map((backup,index)=>h('option',{key:backup.name,value:backup.name},new Date(backup.savedAt).toLocaleString('pt-BR')+' · '+(index===0?'mais recente':backup.name.slice(-13,-5)))))):h('p',null,'Nenhum backup disponível.'),backups.length>0&&h('button',{type:'button',disabled:busy||!selected,onClick:previewRecovery},'Conferir backup')),recovery&&h('div',null,h('p',null,'Backup de '+new Date(recovery.savedAt).toLocaleString('pt-BR')+': '+fmt(recovery.positive)+' registros com saldo positivo.'+(recovery.legacy?' Retorna à base de achados preservada antes da primeira atualização.':'')),h('button',{type:'button',disabled:busy,onClick:restore},'Restaurar este backup'))));
  }
  root.SC9StockUI={usePosition,Importer};
})(window);
