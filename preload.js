'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['shortcut', 'win:state']);

contextBridge.exposeInMainWorld('api', {
  getInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseDir: () => ipcRenderer.invoke('dir:choose'),
  openDir: () => ipcRenderer.invoke('dir:open'),

  listSources: () => ipcRenderer.invoke('sources:list'),
  selectSource: (id) => ipcRenderer.invoke('source:select', id),

  startRec: (ext) => ipcRenderer.invoke('rec:start', ext),
  writeChunk: (data) => ipcRenderer.invoke('rec:chunk', data),
  stopRec: () => ipcRenderer.invoke('rec:stop'),
  setRecState: (state) => ipcRenderer.send('rec:state', state),

  listFiles: () => ipcRenderer.invoke('files:list'),
  openFile: (file) => ipcRenderer.invoke('files:open', file),
  revealFile: (file) => ipcRenderer.invoke('files:reveal', file),
  trashFile: (file) => ipcRenderer.invoke('files:trash', file),

  setTitle: (title) => ipcRenderer.send('win:title', title),
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    closeNow: () => ipcRenderer.send('win:close-now'),
  },

  on: (channel, fn) => {
    if (!EVENTS.has(channel)) return () => {};
    const listener = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
