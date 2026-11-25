export type DesktopCaptureConstraints = MediaStreamConstraints & {
  audio?: boolean | { mandatory: Record<string, unknown> };
  video?: { mandatory: Record<string, unknown> };
};

export type CaptureScreenResult = {
  dataUrl?: string;
  width?: number;
  height?: number;
  displayName?: string;
  error?: string;
};

export type ElectronIpcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (event: string, fn: (...args: unknown[]) => void) => void;
  removeListener: (event: string, fn: (...args: unknown[]) => void) => void;
};
