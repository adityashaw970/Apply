const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    screenshot: () => ipcRenderer.invoke('window:screenshot')
  },
 tabs: {
  getAll: () => ipcRenderer.invoke('tabs:getAll'),
  save: (tabs) => ipcRenderer.invoke('tabs:save', tabs),
  openInNewTab: (url) => ipcRenderer.invoke('tabs:openInNewTab', url),
  onTabCreate: (callback) => {
    const listener = (_, tab) => callback(tab);
    ipcRenderer.on('tab:create', listener);
    // Return cleanup function
    return () => ipcRenderer.removeListener('tab:create', listener);
  }
},
  profile: {
    get: () => ipcRenderer.invoke('profile:get'),
    save: (data) => ipcRenderer.invoke('profile:save', data),
    getFieldMap: () => ipcRenderer.invoke('profile:getFieldMap')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (s) => ipcRenderer.invoke('settings:save', s)
  },
  ai: {
    answerQuestions: (data) => ipcRenderer.invoke('ai:answerQuestions', data)
  },
  engine: {
    getInjectorScript: () => ipcRenderer.invoke('engine:getInjectorScript'),
    getLinkedInInjector: () => ipcRenderer.invoke('engine:getLinkedInInjector'),
    smartUploadFile: (data) => ipcRenderer.invoke('engine:smartUploadFile', data),
    uploadFile: (data) => ipcRenderer.invoke('engine:uploadFile', data),
    googleFormsUpload: (data) => ipcRenderer.invoke('engine:googleFormsUpload', data),
    nativeClick: (data) => ipcRenderer.invoke('engine:nativeClick', data)
  },
  shortcuts: {
    get: () => ipcRenderer.invoke('shortcuts:get'),
    save: (data) => ipcRenderer.invoke('shortcuts:save', data)
  },
  webview: {
    openDevTools: (webContentsId) => ipcRenderer.invoke('webview:openDevTools', webContentsId),
    inspectElement: (webContentsId, x, y) => ipcRenderer.invoke('webview:inspectElement', { webContentsId, x, y })
  },
  history: {
    get: () => ipcRenderer.invoke('history:get'),
    clear: () => ipcRenderer.invoke('history:clear'),
    add: (entry) => ipcRenderer.invoke('history:add', entry)
  }
});
