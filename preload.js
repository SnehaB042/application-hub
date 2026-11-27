'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  loadData: () => inv('data:load'),
  saveData: (data) => inv('data:save', data),
  saveCred: (cred) => inv('cred:save', cred),
  deleteCred: (id) => inv('cred:delete', id),
  revealPassword: (id) => inv('cred:reveal', id),
  copyCred: (id, field) => inv('cred:copy', id, field),
  autofill: (id, webContentsId) => inv('cred:autofill', id, webContentsId),
  googleStatus: () => inv('google:status'),
  googleSwitch: () => inv('google:switch'),
  browseFile: () => inv('file:browse'),
  openFile: (p) => inv('file:open', p),
  revealFile: (p) => inv('file:reveal', p),
  openExternal: (url) => inv('shell:external', url),
  exportBackup: (opts) => inv('backup:export', opts),
  importBackup: (passphrase) => inv('backup:import', passphrase),
  onOpenTab: (cb) => ipcRenderer.on('open-tab', (_e, url) => cb(url)),
  onNavigate: (cb) => ipcRenderer.on('navigate', (_e, view) => cb(view))
});
