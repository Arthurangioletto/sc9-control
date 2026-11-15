(function (root) {
  const scope = root.document.currentScript.dataset.scope || 'transferencia';
  const channel = 'sc9-' + scope + '-storage';
  const requests = new Map();
  let sequence = 0;
  root.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== root.parent || message?.type !== (channel + '-result')) return;
    const request = requests.get(message.requestId);
    if (!request) return;
    requests.delete(message.requestId);
    clearTimeout(request.timeout);
    if (message.error) request.reject(Error(message.error));
    else request.resolve(message.value);
  });

  function request(action, value, id) {
    return new Promise((resolve, reject) => {
      const requestId = ++sequence;
      const timeout = setTimeout(() => {
        requests.delete(requestId);
        reject(Error('O armazenamento de documentos não respondeu. Abra a conferência pelo SC9 e tente novamente.'));
      }, 40000);
      requests.set(requestId, { resolve, reject, timeout });
      root.parent.postMessage({type: channel, requestId, action, value, id}, '*');
    });
  }

  const storage = {
    list: () => request('list'),
    base: id => request('base', undefined, id),
    readSettings: () => request('readSettings'),
    writeSettings: value => request('writeSettings', value),
    readReturns: () => request('readReturns'),
    writeReturns: value => request('writeReturns', value),
    legacyCount: () => request('legacyCount'),
    migrateLegacy: index => request('migrateLegacy', undefined, index),
    save: (action, value) => request(action, value)
  };

  function createStore(y, Tn, onState) {
    let En = Tn;
    let loading, writes=Promise.resolve();
    const On=new Set();
    function publish(patch){
      En={...En,...patch};
      onState(En);
      On.forEach(listener=>listener());
    }
    function loadDocuments(force=false){
      if(loading)return loading;
      if(En.pronto&&!force)return;
      loading=writes.then(()=>Promise.all([storage.list(),storage.readSettings().catch(()=>null)]))
        .then(([index,armazens])=>publish({pronto:true,documentos:index.documentos,administrador:index.administrador,usuario:index.usuario,armazens:armazens||En.armazens,erro:''}))
        .catch(error=>publish({erro:error.message}))
        .finally(()=>{loading=null});
      return loading;
    }
    const Nn=listener=>(On.add(listener),()=>On.delete(listener));
    function Pn(){
      y.useEffect(()=>{loadDocuments()},[]);
      return y.useSyncExternalStore(Nn,()=>En,()=>Tn);
    }
    function persist(change){
      const refresh=loading;
      const write=writes.then(async()=>{
        await refresh;
        if(!En.pronto)throw Error('O armazenamento de documentos está indisponível.');
        const patch=await change();
        publish({...patch,erro:''});
        return patch;
      }).catch(error=>{publish({erro:error.message});return null});
      writes=write;
      return write;
    }
    const Ln={
      async criarDocumento(){
        let doc;
        const saved=await persist(async()=>{
          doc=await storage.save('criar');
          return {documentos:[doc,...En.documentos]};
        });
        return saved?doc.id:null;
      },
      atualizar(id,update,base){
        return persist(async()=>{
          const current=En.documentos.find(doc=>doc.id===id&&doc.editavel);
          if(!current||current.status==='finalizado')throw Error('Este documento não está disponível para edição.');
          const {status,registros,armazens}=update(current);
          const doc=await storage.save('atualizar',{id,versao:current.versao,status,registros,armazens,base});
          return {documentos:En.documentos.map(row=>row.id===id?doc:row)};
        });
      },
      mudarStatus(id,status){
        return this.atualizar(id,doc=>({...doc,status}));
      },
      salvarRegistros(id,registros,base){
        return this.atualizar(id,doc=>({...doc,registros}),base);
      },
      finalizar(id,registros){
        return this.atualizar(id,doc=>({...doc,registros,status:'finalizado',armazens:{...En.armazens}}));
      },
      excluirDocumento(id){
        return persist(async()=>{
          const doc=En.documentos.find(row=>row.id===id&&row.editavel);
          if(!doc)throw Error('Documento indisponível.');
          await storage.save('excluir',{id,versao:doc.versao});
          return {documentos:En.documentos.filter(row=>row.id!==id)};
        });
      },
      definirArmazens(armazens){
        publish({armazens});
        persist(async()=>{await storage.writeSettings(armazens);return {}});
      }
    };
    return { useDocuments: Pn, actions: Ln, load: loadDocuments };
  }

  root.SC9OperationalDocumentStorage = { storage, createStore };
})(window);
