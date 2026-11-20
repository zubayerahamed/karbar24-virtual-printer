/** The only bridge from the screen to the app: a fixed list of actions and events. */
const { contextBridge, ipcRenderer } = require('electron');

const events = ['vp:state', 'vp:drawer', 'vp:job-added', 'vp:job-updated', 'vp:notice'];

contextBridge.exposeInMainWorld('vp', {
  getState: () => ipcRenderer.invoke('vp:get-state'),
  getJob: (id) => ipcRenderer.invoke('vp:get-job', id),
  updateSettings: (patch) => ipcRenderer.invoke('vp:update-settings', patch),
  sendTest: () => ipcRenderer.invoke('vp:send-test'),
  setDrawer: (open) => ipcRenderer.invoke('vp:set-drawer', open),
  openFolder: () => ipcRenderer.invoke('vp:open-folder'),
  pickFolder: () => ipcRenderer.invoke('vp:pick-folder'),
  clearJobs: () => ipcRenderer.invoke('vp:clear-jobs'),
  copy: (text) => ipcRenderer.invoke('vp:copy', text),
  openPdf: (id) => ipcRenderer.invoke('vp:open-pdf', id),
  showPdf: (id) => ipcRenderer.invoke('vp:show-pdf', id),
  retryPdf: (id) => ipcRenderer.invoke('vp:retry-pdf', id),
  on: (channel, listener) => {
    if (events.includes(channel)) ipcRenderer.on(channel, (_event, payload) => listener(payload));
  },
});
