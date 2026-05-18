/** Capture mic + system (speaker) audio and mix for transcription. */

type IpcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
};

export type RecordingCapture = {
  stream: MediaStream;
  cleanup: () => void;
};

async function getSystemAudioStream(ipcRenderer: IpcRenderer | null): Promise<MediaStream | null> {
  if (!ipcRenderer) return null;

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1, frameRate: 1 },
    });
    stream.getVideoTracks().forEach(t => t.stop());
    if (stream.getAudioTracks().length > 0) return stream;
    stream.getTracks().forEach(t => t.stop());
  } catch (err) {
    console.warn('System audio via getDisplayMedia unavailable:', err);
  }

  try {
    const sources = (await ipcRenderer.invoke('GET_SOURCES', ['screen'])) as { id: string }[];
    const sourceId = sources[0]?.id;
    if (!sourceId) return null;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 1,
          maxHeight: 1,
        },
      },
      // Electron desktopCapture — not in standard MediaTrackConstraints
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    stream.getVideoTracks().forEach(t => t.stop());
    if (stream.getAudioTracks().length > 0) return stream;
    stream.getTracks().forEach(t => t.stop());
  } catch (err) {
    console.warn('System audio via desktop capturer unavailable:', err);
  }

  return null;
}

function mixStreams(mic: MediaStream, system: MediaStream): RecordingCapture {
  const owned: MediaStream[] = [mic, system];
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  audioContext.createMediaStreamSource(mic).connect(destination);
  audioContext.createMediaStreamSource(system).connect(destination);

  return {
    stream: destination.stream,
    cleanup: () => {
      owned.forEach(s => s.getTracks().forEach(t => t.stop()));
      void audioContext.close();
    },
  };
}

/** Mic + device speaker output (when Electron loopback is available). */
export async function createRecordingCapture(ipcRenderer: IpcRenderer | null): Promise<RecordingCapture> {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const system = await getSystemAudioStream(ipcRenderer);
  if (system?.getAudioTracks().length) {
    return mixStreams(mic, system);
  }

  return {
    stream: mic,
    cleanup: () => mic.getTracks().forEach(t => t.stop()),
  };
}
