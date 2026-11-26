(() => {
  if (location.origin !== 'https://mono.windows.local' || window.top !== window) return;
  const bridge = window.chrome.webview;
  const pending = new Map();
  let sequence = 0;

  bridge.addEventListener('message', ({ data }) => {
    if (data?.channel !== 'mono-vault' || !pending.has(data.id)) return;
    pending.get(data.id)(data.result);
  });

  function request(operation, payload = null) {
    return new Promise((resolve) => {
      const id = ++sequence;
      const finish = (value) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), 5000);
      pending.set(id, finish);
      try { bridge.postMessage({ channel: 'mono-vault', id, operation, payload }); }
      catch { finish(null); }
    });
  }

  Object.defineProperty(globalThis, 'MonoNative', {
    value: Object.freeze({
      platform: 'windows',
      loadAlpaca: () => request('load'),
      saveAlpaca: (json) => request('save', json),
      clearAlpaca: () => request('clear'),
    }),
  });
})();
