export type DesktopCaptureConstraints = MediaStreamConstraints & {
  audio?: boolean | { mandatory: Record<string, unknown> };
  video?: { mandatory: Record<string, unknown> };
};

export type ElectronIpcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (event: string, fn: () => void) => void;
  removeListener: (event: string, fn: () => void) => void;
};
