'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  service: (method, parameters) => ipcRenderer.invoke('desktop:service', method, parameters),
  fullscreen: (flag) => ipcRenderer.invoke('desktop:fullscreen', flag),
  info: () => ipcRenderer.invoke('desktop:info'),
  // Height of the window's own title bar strip (the page draws it).
  titleBar: { height: 36 },
  // Windows master volume: ('get') | ('set', 0..1) | ('mute', bool) -> { volume, muted } | { error }
  systemVolume: (command, value) => ipcRenderer.invoke('desktop:system-volume', command, value),
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
