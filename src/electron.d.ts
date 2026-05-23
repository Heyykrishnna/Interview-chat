import type { ElectronIpcRenderer } from './types/electron';

declare global {
  interface Window {
    require?: (module: 'electron') => { ipcRenderer: ElectronIpcRenderer };
  }
}

export {};
