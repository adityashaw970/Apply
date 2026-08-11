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
  on: {
    // Called by main.js when setWindowOpenHandler intercepts a new-tab request.
    // The renderer listens to this and opens it as an in-app tab.
    openInNewTab: (callback) => {
      const listener = (_, url) => callback(url);
      ipcRenderer.on('open-in-new-tab', listener);
      return () => ipcRenderer.removeListener('open-in-new-tab', listener);
    }
  },
  webview: {
    openDevTools: (webContentsId) => ipcRenderer.invoke('webview:openDevTools', webContentsId),
    inspectElement: (webContentsId, x, y) => ipcRenderer.invoke('webview:inspectElement', { webContentsId, x, y }),
    nativeMouse:    (wcId, x, y) => ipcRenderer.invoke('webview-native-mouse',    { webContentsId: wcId, x, y }),
  },
  history: {
    get: () => ipcRenderer.invoke('history:get'),
    clear: () => ipcRenderer.invoke('history:clear'),
    add: (entry) => ipcRenderer.invoke('history:add', entry)
  },
  appData: {
    getSiteData: () => ipcRenderer.invoke('app:getSiteData'),
    clearAllSiteData: () => ipcRenderer.invoke('app:clearAllSiteData'),
    clearSiteData: (domain) => ipcRenderer.invoke('app:clearSiteData', domain)
  },
  watcher: {
    getStats: () => ipcRenderer.invoke('watcher:getStats'),
    getPostings: (filter) => ipcRenderer.invoke('watcher:getPostings', filter),
    getCompanies: () => ipcRenderer.invoke('watcher:getCompanies'),
    addCompany: (comp) => ipcRenderer.invoke('watcher:addCompany', comp),
    toggleCompany: (id, active) => ipcRenderer.invoke('watcher:toggleCompany', { id, active }),
    removeCompany: (id) => ipcRenderer.invoke('watcher:removeCompany', id),
    triggerPollNow: () => ipcRenderer.invoke('watcher:triggerPollNow'),
    markApplied: (id) => ipcRenderer.invoke('watcher:markApplied', id),
    dismissPosting: (id) => ipcRenderer.invoke('watcher:dismissPosting', id),
    onUpdate: (callback) => {
      const listener = (_, data) => callback(data);
      ipcRenderer.on('watcher:update', listener);
      return () => ipcRenderer.removeListener('watcher:update', listener);
    }
  }
});

