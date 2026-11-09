'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  service: (method, parameters) => ipcRenderer.invoke('desktop:service', method, parameters),
  fullscreen: (flag) => ipcRenderer.invoke('desktop:fullscreen', flag),
  info: () => ipcRenderer.invoke('desktop:info'),
  onAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('desktop:action', listener);
    return () => ipcRenderer.removeListener('desktop:action', listener);
  },
  onFullscreenChanged: (callback) => {
    const listener = (_event, isFull) => callback(Boolean(isFull));
    ipcRenderer.on('desktop:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('desktop:fullscreen-changed', listener);
  }
});
