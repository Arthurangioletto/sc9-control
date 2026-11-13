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
      async function receive(event) {
        const message = event.data;
        if (event.source !== frame.current?.contentWindow || message?.type !== 'sc9-transferencia-storage') return;
        const { requestId, action, key, value, revision, base } = message;
        if (!Number.isSafeInteger(requestId) || !['read','write','commit'].includes(action) ||
            !/^(index|settings|base:[a-f0-9-]+)$/.test(key)) return;
        const reply = { type: 'sc9-transferencia-storage-result', requestId };
        try {
          store ||= openDocumentStore();
          const db = await store;
          const result = await new Promise((resolve, reject) => {
            const transaction = db.transaction('documents', action === 'read' ? 'readonly' : 'readwrite');
            const items = transaction.objectStore('documents');
            if (action === 'commit') {
              const request = items.get('index');
              let conflict = false;
              request.onsuccess = () => {
                if ((request.result?.revision || 0) !== revision) {
                  conflict = true;
                  transaction.abort();
                  return;
                }
                if (base && /^base:[a-f0-9-]+$/.test(base.key)) {
                  if (base.remove) items.delete(base.key);
                  else items.put(base.value, base.key);
                }
                items.put({...value, revision: revision + 1}, 'index');
              };
              transaction.oncomplete = () => resolve(revision + 1);
              transaction.onabort = () => conflict ? resolve(null) : reject(transaction.error);
              return;
            }
            const request = action === 'read' ? items.get(key) : items.put(value, key);
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error);
          });
          reply.value = result;
        } catch {
          reply.error = 'Não foi possível acessar os documentos neste navegador.';
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
