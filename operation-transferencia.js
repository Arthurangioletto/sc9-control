(function (root) {
  function openDocumentStore() {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open('sc9-transferencia', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function Panel({ onBack }) {
    const React = root.React;
    const h = React.createElement;
    const frame = React.useRef(null);
    React.useEffect(() => {
      let store;
      async function browserStoreRequest(key, write, value) {
        store ||= openDocumentStore();
        const db = await store;
        return new Promise((resolve, reject) => {
          const transaction = db.transaction('documents', write ? 'readwrite' : 'readonly');
          const items = transaction.objectStore('documents');
          const request = write ? items.put(value, key) : items.get(key);
          transaction.oncomplete = () => resolve(request.result);
          transaction.onabort = () => reject(transaction.error);
        });
      }
      const url = '/api/transferencia-documentos';
      async function api(path = url, body) {
        const response = await fetch(path, body ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-SC9-App': '1' },
          body: JSON.stringify(body)
        } : { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Não foi possível acessar a Transferência.');
        return result;
      }
      async function receive(event) {
        const message = event.data;
        if (event.source !== frame.current?.contentWindow || message?.type !== 'sc9-transferencia-storage') return;
        const { requestId, action, id, value } = message;
        if (!Number.isSafeInteger(requestId)) return;
        const reply = { type: 'sc9-transferencia-storage-result', requestId };
        try {
          if (action === 'readSettings' || action === 'writeSettings') {
            reply.value = await browserStoreRequest('settings', action === 'writeSettings', value);
          } else if (action === 'legacyCount') {
            if (!(await api()).administrador) throw Error('Somente o administrador pode importar documentos antigos.');
            reply.value = (await browserStoreRequest('index'))?.documentos?.length || 0;
          } else if (action === 'migrateLegacy') {
            if (!Number.isSafeInteger(id) || id < 0) return;
            const doc = (await browserStoreRequest('index'))?.documentos?.[id];
            if (!doc || !/^base:[a-f0-9-]{36}$/i.test(doc.baseKey)) throw Error('Documento antigo indisponível.');
            const base = await browserStoreRequest(doc.baseKey);
            await api(url, { acao: 'importarLegado', documento: doc, base });
          } else {
            const post = ['criar', 'atualizar', 'excluir'].includes(action);
            if (action === 'base' && !/^TRF-\d+$/.test(id)) return;
            if (!post && !['list', 'base'].includes(action)) return;
            const result = await api(action === 'base' ? url + '/' + id + '/base' : url, post ? { ...value, acao: action } : undefined);
            reply.value = action === 'list' ? result : action === 'base' ? result.base : result.documento;
          }
        } catch (error) {
          reply.error = error.message || 'Não foi possível acessar os documentos da Transferência.';
        }
        event.source.postMessage(reply, '*');
      }
      root.addEventListener('message', receive);
      return () => {
        root.removeEventListener('message', receive);
        store?.then(db => db.close()).catch(() => {});
      };
    }, []);
    return h('main', { className: 'sc9-retem-screen', 'aria-label': 'Transferência entre armazéns' },
      h('div', { className: 'sc9-retem-return' },
        h('button', { type: 'button', onClick: onBack, autoFocus: true }, '← Voltar ao SC9')),
      h('iframe', {
        ref: frame,
        className: 'sc9-retem-prototype',
        title: 'Transferência de lotes',
        src: '/transferencia-de-lotes.html',
        sandbox: 'allow-scripts allow-downloads allow-forms'
      }));
  }

  const api = { Panel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SC9Transferencia = api;
})(typeof window === 'undefined' ? globalThis : window);
