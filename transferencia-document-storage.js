(function (root) {
  const requests = new Map();
  let sequence = 0;
  root.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== root.parent || message?.type !== 'sc9-transferencia-storage-result') return;
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
        reject(Error('O armazenamento da Transferência não respondeu. Abra a conferência pelo SC9 e tente novamente.'));
      }, 40000);
      requests.set(requestId, { resolve, reject, timeout });
      root.parent.postMessage({type: 'sc9-transferencia-storage', requestId, action, value, id}, '*');
    });
  }

  root.SC9TransferenciaDocumentStorage = {
    list: () => request('list'),
    base: id => request('base', undefined, id),
    readSettings: () => request('readSettings'),
    writeSettings: value => request('writeSettings', value),
    legacyCount: () => request('legacyCount'),
    migrateLegacy: index => request('migrateLegacy', undefined, index),
    save: (action, value) => request(action, value)
  };
})(window);
