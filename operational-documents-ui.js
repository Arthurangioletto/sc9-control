(function (root) {
  root.SC9OperationalDocumentViews = function ({ y, z, Pn, C, zn, _n, storage, loadDocuments, readSD3, readTransfer, exportDocument, comparisonUI }) {
    function ConsolidatedExport() {
      const { administrador, documentos } = Pn();
      const [selection, setSelection] = y.useState([]);
      const [busy, setBusy] = y.useState(false);
      const [error, setError] = y.useState('');
      if (!administrador) return null;
      const finalized = documentos.filter(doc => doc.status === 'finalizado');
      const ids = finalized.filter(doc => selection.includes(doc.id)).map(doc => doc.id);
      async function exportSelected() {
        setBusy(true);
        setError('');
        try {
          const doc = await storage.save('consolidar', { ids });
          await exportDocument(doc, doc.armazens);
        } catch (error) {
          setError(error.message);
        } finally {
          setBusy(false);
        }
      }
      return z.jsxs('details', { className:'space-y-3 rounded-md border border-border bg-card p-4', children:[
        z.jsx('summary', { className:'cursor-pointer font-semibold', children:'Aglutinar documentos' }),
        z.jsx('p', { className:'text-sm text-muted-foreground',
          children:'Selecione dois ou mais documentos finalizados da mesma filial e rota compatível para gerar um Excel consolidado.' }),
        finalized.length < 2 ? z.jsx('p', { className:'text-sm', children:'São necessários pelo menos dois documentos finalizados.' }) :
          z.jsx('fieldset', { disabled:busy, className:'grid gap-2 overflow-y-auto', style:{maxHeight:'16rem'},
            'aria-label':'Documentos a aglutinar', children:finalized.map(doc=>z.jsxs('label', {
              className:'flex items-center gap-2 rounded-sm border border-border px-3 py-2 text-sm', children:[
                z.jsx('input', { type:'checkbox', checked:selection.includes(doc.id), onChange:event=>{
                  const checked=event.target.checked;
                  setSelection(current=>checked?[...current,doc.id]:current.filter(id=>id!==doc.id));
                  setError('');
                } }),
                doc.id+' · '+doc.operador+' · '+new Date(doc.finalizadoEm).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})
              ]
            },doc.id)) }),
        z.jsx('button', { type:'button', disabled:ids.length<2||busy, onClick:()=>void exportSelected(),
          className:'rounded-sm bg-foreground px-3 py-2 text-sm font-semibold text-background disabled:opacity-50',
          children:busy?'Gerando Excel…':'Exportar consolidado ('+ids.length+')' }),
        error&&z.jsx('p', { role:'alert', className:'text-sm text-destructive', children:error })
      ] });
    }

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

    function DailyTransferComparison() {
      const { documentos, armazens, administrador } = Pn();
      const go = C(), receiving = root.SC9Receiving, inventory = root.SC9TransferenciaInventory;
      const { Panel, FileZone, Result, Loading, CompareIcon, ResetIcon, loadingDuration } = comparisonUI;
      const [selection, setSelection] = y.useState([]), [daily, setDaily] = y.useState(false);
      const [transfer, setTransfer] = y.useState(null), [sd3File, setSD3File] = y.useState(null);
      const [sd3, setSD3] = y.useState(null), [date, setDate] = y.useState('');
      const [numbers, setNumbers] = y.useState(''), [branch, setBranch] = y.useState('');
      const [importing, setImporting] = y.useState(false), [busy, setBusy] = y.useState(false);
      const [error, setError] = y.useState(''), [result, setResult] = y.useState(null);
      const [filter, setFilter] = y.useState('todos'), [page, setPage] = y.useState(1);
      const upload = y.useRef(0);
      if (!administrador) return null;
      const finalizados = documentos.filter(doc => doc.status === 'finalizado');
      const selected = finalizados.filter(doc => selection.includes(doc.id));
      const dates = sd3?.movementDates ?? [...new Set(sd3?.rows.map(row => row.dt) || [])].sort();
      const docDay = doc => Number.isFinite(Date.parse(doc.finalizadoEm)) ? receiving.spDay(doc.finalizadoEm) : '';
      const dailyDocs = daily && date ? finalizados.filter(doc => docDay(doc) === date) : [];
      const movementNumbers = numbers.trim().split(/[\s,;]+/).filter(Boolean);
      const hasDocument = !!transfer || daily || selected.length > 0;
      const canCompare = hasDocument && sd3 && !importing && (daily ? !!date : movementNumbers.length > 0);
      const control = 'rounded-sm border border-border bg-background px-3 py-2 text-sm disabled:opacity-50';
      const formatDay = day => day.split('-').reverse().join('/');

      function pickTransfer(file) {
        setTransfer(file);
        setError('');
        if (file) { setSelection([]); setDaily(false); }
      }

      function toggleDocument(id) {
        setTransfer(null);
        setDaily(false);
        setError('');
        setSelection(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
      }

      async function importSD3(file) {
        const request = ++upload.current;
        setSD3File(file);
        setSD3(null);
        setDate('');
        setError('');
        setImporting(Boolean(file));
        if (!file) return;
        try {
          const parsed = await readSD3(file);
          if (request !== upload.current) return;
          setSD3(parsed);
          setDate((parsed.movementDates ?? parsed.rows.map(row => row.dt).sort()).at(-1) || '');
        } catch (error) {
          if (request === upload.current) setError(error.message);
        } finally {
          if (request === upload.current) setImporting(false);
        }
      }

      function sourceFor(doc) {
        const counted = doc.registros.filter(row => row.conferido > 0);
        const branches = new Set(counted.map(row => receiving.code(row.filial)));
        if (branches.size !== 1 || branches.has('')) throw Error(doc.id + ' precisa ter uma única filial nos itens conferidos.');
        const lines = _n(doc, doc.armazens || armazens).map(row => ({
          produto:row.produto, lote:row.lote, origem:row.origem, destino:row.armDestino, qtd:row.qtde
        }));
        if (!lines.length) throw Error(doc.id + ' não tem itens para transferir.');
        return { id:doc.id, filial:[...branches][0], lines };
      }

      async function execute() {
        if (!canCompare || busy) return;
        const startedAt = Date.now();
        setBusy(true);
        setError('');
        try {
          await new Promise(resolve => setTimeout(resolve, 0));
          const enteredBranch = receiving.code(branch);
          if (!sd3.hasBranch && (!transfer || !enteredBranch)) {
            throw Error(transfer ? 'Informe a filial da planilha de transferência.' : 'Inclua a coluna Filial no SD3.');
          }
          const movements = sd3.hasBranch ? sd3.rows : sd3.rows.map(row => ({ ...row, filial:enteredBranch }));
          let sources = (daily ? dailyDocs : selected).map(sourceFor);
          if (transfer) {
            const numbersSet = new Set(movementNumbers.map(receiving.lot));
            const possible = new Set(movements.filter(row => numbersSet.has(receiving.lot(row.doc)) && !row.estornado).map(row => row.filial));
            const filial = enteredBranch || (possible.size === 1 ? [...possible][0] : '');
            if (!filial) throw Error('Informe a filial do documento transferido.');
            const lines = await readTransfer(transfer);
            if (!lines.length) throw Error('O documento não tem itens para transferir.');
            sources = [{ filial, lines }];
          }
          if (!sources.length) throw Error('Nenhum documento finalizado na data escolhida.');
          const rows = daily ? inventory.compareDaily(sources, movements, date)
            : inventory.compareSelectedDocuments(sources, movements, movementNumbers);
          const remaining = loadingDuration - (Date.now() - startedAt);
          if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
          setResult(rows);
          setFilter('todos');
          setPage(1);
        } catch (error) {
          setError(error.message);
        } finally {
          setBusy(false);
        }
      }

      const pageSize = 50;
      const totalVisible = result?.filter(row => filter === 'todos' || row.situacao === filter).length || 0;
      const totalPages = Math.max(1, Math.ceil(totalVisible / pageSize));
      return z.jsxs('div', { className:'flex min-h-screen flex-col', children:[
        z.jsx(zn, { subtitulo:'Comparativo com SD3', voltar:{label:'Documentos',onClick:()=>go({tela:'documentos'})} }),
        z.jsx('main', { className:'flex-1 bg-grid-paper', children:z.jsxs('div', {
          className:'mx-auto w-full max-w-6xl space-y-6 px-6 py-8', children:[
            z.jsxs('div', { className:'flex flex-wrap items-end justify-between gap-4', children:[
              z.jsxs('div', { children:[
                z.jsx('p', { className:'label-caps text-muted-foreground', children:'Transferido × Protheus' }),
                z.jsx('h1', { className:'mt-1 text-3xl font-extrabold tracking-tight text-foreground', children:'Comparativo com SD3' }),
                z.jsx('p', { className:'mt-1 max-w-2xl text-muted-foreground', children:'Compare a saída na origem e a entrada no destino por produto e lote.' })
              ] }),
              result && z.jsxs('button', { type:'button', onClick:()=>setResult(null),
                className:'flex h-10 items-center gap-2 rounded-sm border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:border-foreground',
                children:[z.jsx(ResetIcon,{className:'size-4'}),'Nova comparação'] })
            ] }),
            busy && z.jsx(Loading, { duracao:loadingDuration }),
            !busy && !result && z.jsxs(z.Fragment, { children:[
              z.jsxs('div', { className:'grid gap-4 md:grid-cols-2', children:[
                z.jsxs(Panel, { passo:'1', titulo:'Documento transferido', ok:hasDocument, children:[
                  z.jsx(FileZone, { arquivo:transfer, dica:'Planilha de transferência múltipla (.xlsx)', onArquivo:pickTransfer }),
                  z.jsxs('details', { className:'mt-3 text-sm', children:[
                    z.jsx('summary', { className:'cursor-pointer font-semibold', children:selected.length
                      ? 'Documentos finalizados · '+selected.length+' selecionados' : 'Selecionar documentos finalizados' }),
                    finalizados.length ? z.jsx('fieldset', {
                      className:'mt-2 grid gap-2 overflow-y-auto', style:{maxHeight:'16rem'}, 'aria-label':'Documentos finalizados para comparar',
                      children:finalizados.map(doc=>z.jsxs('label', { className:'flex min-w-0 items-center gap-2 rounded-sm border border-border px-3 py-2', children:[
                        z.jsx('input', { type:'checkbox', checked:selection.includes(doc.id), onChange:()=>toggleDocument(doc.id) }),
                        z.jsx('span', { children:[doc.id,doc.operador,formatDay(docDay(doc))].filter(Boolean).join(' · ') })
                      ] },doc.id))
                    }) : z.jsx('p', { className:'mt-2 text-muted-foreground', children:'Nenhum documento finalizado.' })
                  ] }),
                  z.jsxs('label', { className:'mt-3 flex items-center gap-2 text-sm', children:[
                    z.jsx('input', { type:'checkbox', checked:daily, onChange:event=>{
                      setDaily(event.target.checked);
                      setTransfer(null);setSelection([]);setError('');
                    } }), 'Usar todos os finalizados do dia'
                  ] })
                ] }),
                z.jsxs(Panel, { passo:'2', titulo:'SD3 do Protheus', ok:!!sd3, children:[
                  z.jsx(FileZone, { arquivo:sd3File, dica:'Exportação da tabela SD3 (.xlsx)', accept:'.xlsx,.xls,.xlsm,.csv', onArquivo:importSD3 }),
                  importing && z.jsx('p', { role:'status', className:'mt-2 text-sm', children:'Lendo SD3…' }),
                  daily && sd3 && z.jsxs('label', { className:'mt-3 grid gap-2 text-sm', children:['Data do movimento',
                    z.jsx('select', { className:control, value:date, onChange:event=>{setDate(event.target.value);setError('')},
                      children:dates.slice().reverse().map(day=>z.jsx('option',{value:day,children:formatDay(day)},day)) }),
                    z.jsx('span', { className:'text-xs text-muted-foreground', children:dates.length
                      ? dailyDocs.length+' documentos finalizados na data' : 'O SD3 não contém movimentos com data.' })
                  ] }),
                  !daily && z.jsxs('label', { className:'mt-3 grid gap-2 text-sm', children:['Número do movimento no Protheus',
                    z.jsx('input', { className:control, value:numbers, placeholder:'Ex.: ZB0001, ZB0002',
                      onChange:event=>{setNumbers(event.target.value);setError('')} })
                  ] }),
                  transfer && z.jsxs('label', { className:'mt-3 grid gap-2 text-sm', children:['Filial (quando necessário)',
                    z.jsx('input', { className:control, value:branch, onChange:event=>{setBranch(event.target.value);setError('')} })
                  ] })
                ] })
              ] }),
              error && z.jsx('p', { role:'alert', className:'rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive', children:error }),
              z.jsxs('button', { type:'button', disabled:!canCompare, onClick:()=>void execute(),
                className:'flex h-14 w-full items-center justify-center gap-3 rounded-sm bg-foreground text-base font-extrabold uppercase tracking-wide text-background transition hover:bg-foreground/90 disabled:opacity-40',
                children:[z.jsx(CompareIcon,{className:'size-5'}),'Comparar'] })
            ] }),
            result && z.jsxs(z.Fragment, { children:[
              z.jsx(Result,{linhas:result,filtro:filter,onFiltro:value=>{setFilter(value);setPage(1)},pagina:page,porPagina:pageSize}),
              totalPages>1 && z.jsxs('nav', { className:'flex items-center gap-3 text-sm', 'aria-label':'Páginas do comparativo', children:[
                z.jsx('button', { type:'button', className:control, disabled:page===1, onClick:()=>setPage(page-1), children:'Anterior' }),
                z.jsx('span', { children:'Página '+page+' de '+totalPages }),
                z.jsx('button', { type:'button', className:control, disabled:page===totalPages, onClick:()=>setPage(page+1), children:'Próxima' })
              ] })
            ] })
          ]
        }) })
      ] });
    }
    return { LegacyTransferImport, DailyTransferComparison, ConsolidatedExport };
  };
})(window);
