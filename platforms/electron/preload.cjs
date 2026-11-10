'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  service: (method, parameters) => ipcRenderer.invoke('desktop:service', method, parameters),
  fullscreen: (flag) => ipcRenderer.invoke('desktop:fullscreen', flag),
  pin: (flag) => ipcRenderer.invoke('desktop:pin', flag),
  info: () => ipcRenderer.invoke('desktop:info'),
  // Shows opentv.log (page errors and crashes) in the file explorer.
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
  // Profiles backup in DocumentsOpenTV (survives uninstalling the app).
  backup: { read: () => ipcRenderer.invoke('desktop:backup', 'read'), write: (data) => ipcRenderer.invoke('desktop:backup', 'write', data) },
  // Height of the window's own title bar strip (the page draws it).
  titleBar: { height: 36 },
  // Windows master volume: ('get') | ('set', 0..1) | ('mute', bool) -> { volume, muted } | { error }
  systemVolume: (command, value) => ipcRenderer.invoke('desktop:system-volume', command, value),
  // Automatic updates: status() / check() / install(), and live status events.
  updates: {
    status: () => ipcRenderer.invoke('desktop:update', 'status'),
    check: () => ipcRenderer.invoke('desktop:update', 'check'),
    install: () => ipcRenderer.invoke('desktop:update', 'install'),
    releases: () => ipcRenderer.invoke('desktop:update', 'releases'),
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('desktop:update-status', listener);
      return () => ipcRenderer.removeListener('desktop:update-status', listener);
    }
  },
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
