(function (root) {
  root.SC9OperationalDocumentViews = function ({ y, z, Pn, C, zn, _n, Vj, storage, loadDocuments, readSD3 }) {
    function LegacyTransferImport(){
      const [count,setCount]=y.useState(0), [busy,setBusy]=y.useState(false);
      const [message,setMessage]=y.useState(''), [complete,setComplete]=y.useState(false);
      y.useEffect(()=>{
        let active=true;
        storage.legacyCount().then(value=>{if(active)setCount(value)}).catch(()=>{});
        return ()=>{active=false};
      },[]);
      if(!count)return null;
      async function migrate(){
        setBusy(true);setMessage('');
        let copied=0;
        try{
          for(;copied<count;copied++)await storage.migrateLegacy(copied);
          setComplete(true);
          setMessage('Documentos antigos disponíveis na lista.');
        }catch(error){setMessage('Importação interrompida após '+copied+' documento(s). '+error.message)}
        finally{await loadDocuments(true);setBusy(false)}
      }
      return z.jsxs('section',{className:'space-y-2 rounded-md border border-border bg-card p-4 text-sm',children:[
        z.jsx('p',{children:count+' documento(s) antigo(s) neste navegador. A autoria original não foi registrada.'}),
        !complete&&z.jsx('button',{type:'button',disabled:busy,onClick:()=>void migrate(),className:'rounded-sm border border-border px-3 py-2 font-semibold',children:busy?'Importando…':'Importar documentos antigos'}),
        message&&z.jsx('p',{role:'status',children:message})
      ]});
    }

    function DailyTransferComparison(){
      const {documentos,armazens}=Pn();
      const go=C(), receiving=window.SC9Receiving;
      const [sd3,setSD3]=y.useState(null), [date,setDate]=y.useState('');
      const [busy,setBusy]=y.useState(false), [error,setError]=y.useState('');
      const [filter,setFilter]=y.useState('todos'), [page,setPage]=y.useState(1);
      const docs=y.useMemo(()=>documentos.filter(doc=>doc.status==='finalizado'&&receiving.spDay(doc.finalizadoEm)===date),[documentos,date]);
      const rows=y.useMemo(()=>{
        if(!sd3)return [];
        const sources=docs.map(doc=>({
          id:doc.id,filial:doc.registros.find(row=>row.conferido>0)?.filial,
          lines:_n(doc,doc.armazens||armazens).map(row=>({produto:row.produto,lote:row.lote,origem:row.origem,destino:row.armDestino,qtd:row.qtde}))
        }));
        return window.SC9TransferenciaInventory.compareDaily(sources,sd3.rows,date);
      },[sd3,date,docs,armazens]);
      async function importSD3(file){
        if(!file)return;
        setBusy(true);setError('');setSD3(null);setFilter('todos');setPage(1);
        try{
          const parsed=await readSD3(file);
          if(!parsed.hasBranch)throw Error('Inclua a coluna Filial no SD3 para comparar os documentos por filial.');
          const days=[...new Set(parsed.rows.map(row=>row.dt))].sort().reverse();
          if(!days.length)throw Error('O SD3 não contém movimentos de transferência para comparar.');
          setDate(days[0]);setSD3({rows:parsed.rows,days});
        }catch(error){setError(error.message)}
        finally{setBusy(false)}
      }
      const visible=rows.filter(row=>filter==='todos'||row.situacao===filter);
      const maxPage=Math.max(1,Math.ceil(visible.length/50)), currentPage=Math.min(page,maxPage);
      const control='rounded-sm border border-border bg-card px-3 py-2 text-sm disabled:opacity-50';
      const headings=['Filial','Produto','Lote','Origem → destino','Conferido','Saída SD3','Entrada SD3','Documentos SC9','Situação'];
      const table=z.jsxs('table',{className:'w-full text-left text-sm',children:[
        z.jsx('thead',{children:z.jsx('tr',{children:headings.map(label=>z.jsx('th',{scope:'col',className:'whitespace-nowrap border-b border-border px-3 py-2',children:label},label))})}),
        z.jsx('tbody',{children:visible.slice((currentPage-1)*50,currentPage*50).map(row=>{
          const detail=z.jsxs('div',{children:[Vj[row.situacao].label,row.detalhe&&z.jsx('p',{className:'text-xs text-muted-foreground',children:row.detalhe})]});
          const cells=[row.filial,row.produto,row.lote,row.origem+' → '+row.destino,row.qtdDocumento,row.saidaSd3,row.entradaSd3,row.documentos.join(', '),detail];
          return z.jsx('tr',{className:'border-b border-border',children:cells.map((value,index)=>z.jsx('td',{className:'px-3 py-2 align-top',children:value},index))},JSON.stringify([row.filial,row.produto,row.lote,row.origem,row.destino]));
        })})
      ]});
      return z.jsxs('div',{className:'flex min-h-screen flex-col',children:[
        z.jsx(zn,{subtitulo:'Comparativo com SD3',voltar:{label:'Documentos',onClick:()=>go({tela:'documentos'})}}),
        z.jsx('main',{className:'flex-1 bg-grid-paper',children:z.jsxs('div',{className:'mx-auto max-w-6xl space-y-5 px-6 py-8',children:[
          z.jsx('h1',{className:'text-3xl font-extrabold',children:'Comparativo diário com SD3'}),
          z.jsx('p',{className:'text-sm text-muted-foreground',children:'Importe o SD3 para comparar os documentos de todos os usuários finalizados na data escolhida.'}),
          z.jsxs('section',{className:'flex flex-wrap items-end gap-4 rounded-md border border-border bg-card p-4',children:[
            z.jsxs('label',{className:'grid gap-2 text-sm font-semibold',children:['Arquivo SD3',z.jsx('input',{type:'file',accept:'.xlsx,.xls,.xlsm',disabled:busy,onChange:event=>{void importSD3(event.target.files[0]);event.target.value=''}})]}),
            sd3&&z.jsxs('label',{className:'grid gap-2 text-sm font-semibold',children:['Data do movimento',z.jsx('select',{className:control,value:date,onChange:event=>{setDate(event.target.value);setPage(1)},children:sd3.days.map(day=>z.jsx('option',{value:day,children:day.split('-').reverse().join('/')},day))})]}),
            busy&&z.jsx('p',{role:'status',children:'Lendo SD3…'}),
            error&&z.jsx('p',{role:'alert',className:'text-destructive',children:error})
          ]}),
          sd3&&z.jsxs('section',{className:'space-y-4 rounded-md border border-border bg-card p-4',children:[
            z.jsxs('details',{children:[
              z.jsx('summary',{className:'cursor-pointer font-semibold',children:docs.length+' documentos finalizados na data'}),
              z.jsx('ul',{className:'mt-2 space-y-1 text-sm',children:docs.map(doc=>z.jsx('li',{children:doc.id+' · '+doc.operador},doc.id))})
            ]}),
            !rows.length&&z.jsx('p',{className:'text-sm text-muted-foreground',children:'Nenhum documento finalizado para comparar nesta data.'}),
            rows.length>0&&z.jsxs('div',{className:'space-y-3',children:[
              z.jsxs('label',{className:'flex items-center gap-2 text-sm',children:['Situação',z.jsx('select',{className:control,value:filter,onChange:event=>{setFilter(event.target.value);setPage(1)},children:[
                ['todos','Todas'],['confere','Confere'],['divergente','Divergente'],['nao_encontrado','Sem movimento no SD3']
              ].map(([value,label])=>z.jsx('option',{value,children:label+' ('+(value==='todos'?rows.length:rows.filter(row=>row.situacao===value).length)+')'},value))})]}),
              z.jsx('div',{className:'overflow-x-auto',children:table}),
              lastPageControls()
            ]})
          ]})
        ]})})
      ]});
      function lastPageControls(){
        if(maxPage===1)return null;
        return z.jsxs('nav',{className:'flex items-center gap-3 text-sm','aria-label':'Páginas do comparativo',children:[
          z.jsx('button',{className:control,disabled:currentPage===1,onClick:()=>setPage(currentPage-1),children:'Anterior'}),
          z.jsx('span',{children:'Página '+currentPage+' de '+maxPage}),
          z.jsx('button',{className:control,disabled:currentPage===maxPage,onClick:()=>setPage(currentPage+1),children:'Próxima'})
        ]});
      }
    }
    return { LegacyTransferImport, DailyTransferComparison };
  };
})(window);
