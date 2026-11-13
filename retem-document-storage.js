(function (root) {
  const requests = new Map();
  let sequence = 0;
  root.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== root.parent || message?.type !== 'sc9-retem-storage-result') return;
    const request = requests.get(message.requestId);
    if (!request) return;
    requests.delete(message.requestId);
    clearTimeout(request.timeout);
    if (message.error) request.reject(Error(message.error));
    else request.resolve(message.value);
  });

  function request(action, key, value, revision, base) {
    return new Promise((resolve, reject) => {
      const requestId = ++sequence;
      const timeout = setTimeout(() => {
        requests.delete(requestId);
        reject(Error('O armazenamento do Retem não respondeu. Abra a conferência pelo SC9 e tente novamente.'));
      }, 5000);
      requests.set(requestId, { resolve, reject, timeout });
      root.parent.postMessage({type: 'sc9-retem-storage', requestId, action, key, value, revision, base}, '*');
    });
  }

  root.SC9RetemDocumentStorage = {
    read: key => request('read', key),
    write: (key, value) => request('write', key, value),
    commit: (value, revision, base) => request('commit', 'index', value, revision, base)
  };
})(window);
