(() => {
  if (location.origin !== 'https://mono.windows.local' || window.top !== window) return;
  const bridge = window.chrome.webview;
  const pending = new Map();
  let sequence = 0;
  let backupRequest = null;
  const maxBackupBytes = 5 * 1024 * 1024;

  bridge.addEventListener('message', ({ data }) => {
    if (data?.channel === 'mono-workspace' && backupRequest && data.id === backupRequest) {
      backupRequest = null;
      const result = ['saved', 'cancelled'].includes(data.result) ? data.result : 'error';
      window.dispatchEvent(new CustomEvent('mono-backup-saved', { detail: result }));
      return;
    }
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
  Object.defineProperty(globalThis, 'MonoWorkspace', {
    value: Object.freeze({
      saveBackup(filename, json) {
        if (backupRequest || typeof filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,89}\.json$/.test(filename) ||
            typeof json !== 'string' || !json.length || json.length > maxBackupBytes || new TextEncoder().encode(json).length > maxBackupBytes)
          return false;
        backupRequest = crypto.randomUUID();
        try {
          bridge.postMessage(`mono-workspace\n${backupRequest}\n${filename}\n${json}`);
          return true;
        } catch {
          backupRequest = null;
          return false;
        }
      },
    }),
  });
})();
