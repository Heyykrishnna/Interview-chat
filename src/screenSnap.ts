import Tesseract from 'tesseract.js';
import type { CaptureScreenResult, ElectronIpcRenderer } from './types/electron';

export type SnapAction = 'solve' | 'fix' | 'optimize' | 'explain' | 'ocr-only';
export type SnapStage = 'capturing' | 'preprocessing' | 'ocr' | 'solving';

export type SnapPreset = {
  id: SnapAction;
  label: string;
  shortLabel: string;
  hint: string;
};

export type SnapCaptureResult = {
  imageDataUrl: string;
  previewDataUrl: string;
  extractedText: string;
  width: number;
  height: number;
  lineCount: number;
  charCount: number;
  darkModeInverted: boolean;
  durationMs: number;
};

export type SnapMessageMeta = {
  action: SnapAction;
  previewDataUrl: string;
  extractedText: string;
  charCount: number;
  lineCount: number;
  darkModeInverted: boolean;
  durationMs: number;
};

export const SNAP_PRESETS: SnapPreset[] = [
  {
    id: 'solve',
    label: 'Snap & Solve',
    shortLabel: 'Snap & Solve',
    hint: 'Capture the entire screen, extract all text, and generate the complete answer.',
  },
  {
    id: 'fix',
    label: 'Fix Error',
    shortLabel: 'Fix Error',
    hint: 'Capture the screen and diagnose bugs, stack traces, or failing test cases.',
  },
  {
    id: 'optimize',
    label: 'Optimize',
    shortLabel: 'Optimize',
    hint: 'Capture code on screen, analyze Big-O complexity, and provide an optimal solution.',
  },
  {
    id: 'explain',
    label: 'Talk Track',
    shortLabel: 'Talk Track',
    hint: 'Capture the screen and craft clear spoken talking points for your interviewer.',
  },
  {
    id: 'ocr-only',
    label: 'Extract Text',
    shortLabel: 'Extract Text',
    hint: 'Capture the full screen, extract clean text, and copy it to your clipboard.',
  },
];

let ocrWorkerPromise: Promise<Tesseract.Worker> | null = null;
let activeProgressCallback: ((progress: number, status: string) => void) | null = null;

async function getOcrWorker(): Promise<Tesseract.Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: msg => {
          if (activeProgressCallback && typeof msg.progress === 'number') {
            activeProgressCallback(Math.round(msg.progress * 100), msg.status || 'recognizing');
          }
        },
      });
      await worker.setParameters({
        preserve_interword_spaces: '1',
      });
      return worker;
    })().catch(err => {
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}

export function normalizeOcrText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode screenshot image'));
    img.src = dataUrl;
  });
}

async function preprocessImageForOcr(
  dataUrl: string,
  autoInvertDark: boolean,
): Promise<{
  ocrDataUrl: string;
  previewDataUrl: string;
  width: number;
  height: number;
  darkModeInverted: boolean;
}> {
  const img = await loadImage(dataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const previewScale = Math.min(1, 520 / Math.max(1, srcW));
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = Math.max(1, Math.round(srcW * previewScale));
  previewCanvas.height = Math.max(1, Math.round(srcH * previewScale));
  const previewCtx = previewCanvas.getContext('2d');
  if (previewCtx) {
    previewCtx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
  }
  const previewDataUrl = previewCanvas.toDataURL('image/jpeg', 0.8);

  const ocrScale = Math.min(1, 2200 / Math.max(1, srcW));
  const ocrW = Math.max(1, Math.round(srcW * ocrScale));
  const ocrH = Math.max(1, Math.round(srcH * ocrScale));

  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = ocrW;
  ocrCanvas.height = ocrH;
  const ctx = ocrCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { ocrDataUrl: dataUrl, previewDataUrl, width: srcW, height: srcH, darkModeInverted: false };
  }

  ctx.drawImage(img, 0, 0, ocrW, ocrH);
  const imageData = ctx.getImageData(0, 0, ocrW, ocrH);
  const pixels = imageData.data;

  let lumSum = 0;
  let sampleCount = 0;
  for (let i = 0; i < pixels.length; i += 64) {
    lumSum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    sampleCount += 1;
  }
  const avgLum = sampleCount > 0 ? lumSum / sampleCount : 255;
  const darkModeInverted = autoInvertDark && avgLum < 120;
  const contrast = darkModeInverted ? 1.24 : 1.15;

  for (let i = 0; i < pixels.length; i += 4) {
    const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    const base = darkModeInverted ? 255 - lum : lum;
    const adjusted = Math.max(0, Math.min(255, (base - 128) * contrast + 128));
    pixels[i] = adjusted;
    pixels[i + 1] = adjusted;
    pixels[i + 2] = adjusted;
  }

  ctx.putImageData(imageData, 0, 0);
  const ocrDataUrl = ocrCanvas.toDataURL('image/png');

  return {
    ocrDataUrl,
    previewDataUrl,
    width: srcW,
    height: srcH,
    darkModeInverted,
  };
}

async function captureInBrowserFallback(): Promise<{ dataUrl: string; width: number; height: number }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    await video.play();
    if (video.readyState < 2) {
      await new Promise<void>(resolve => {
        video.onloadeddata = () => resolve();
      });
    }
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize capture canvas');
    ctx.drawImage(video, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  } finally {
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
}

export async function captureWholeScreenDataUrl(
  ipcRenderer: ElectronIpcRenderer | null,
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (ipcRenderer) {
    const res = (await ipcRenderer.invoke('CAPTURE_FULL_SCREEN')) as CaptureScreenResult | null;
    if (!res || res.error || !res.dataUrl) {
      throw new Error(res?.error || 'SCREEN_CAPTURE_UNAVAILABLE');
    }
    return {
      dataUrl: res.dataUrl,
      width: res.width ?? 1920,
      height: res.height ?? 1080,
    };
  }
  return captureInBrowserFallback();
}

export async function runOcrOnImageDataUrl(
  dataUrl: string,
  autoInvertDark = true,
  onProgress?: (progress: number, status: string) => void,
): Promise<{
  extractedText: string;
  previewDataUrl: string;
  width: number;
  height: number;
  darkModeInverted: boolean;
}> {
  const prep = await preprocessImageForOcr(dataUrl, autoInvertDark);
  const worker = await getOcrWorker();
  activeProgressCallback = onProgress ?? null;
  try {
    const result = await worker.recognize(prep.ocrDataUrl);
    return {
      extractedText: normalizeOcrText(result.data.text || ''),
      previewDataUrl: prep.previewDataUrl,
      width: prep.width,
      height: prep.height,
      darkModeInverted: prep.darkModeInverted,
    };
  } finally {
    activeProgressCallback = null;
  }
}

export async function runWholePageSnapOcr(
  ipcRenderer: ElectronIpcRenderer | null,
  options: {
    autoInvertDark?: boolean;
    onStage?: (stage: SnapStage, progress?: number) => void;
  } = {},
): Promise<SnapCaptureResult> {
  const started = performance.now();
  const { autoInvertDark = true, onStage } = options;

  onStage?.('capturing', 12);
  const raw = await captureWholeScreenDataUrl(ipcRenderer);

  onStage?.('preprocessing', 28);
  const prep = await preprocessImageForOcr(raw.dataUrl, autoInvertDark);

  onStage?.('ocr', 35);
  const worker = await getOcrWorker();
  activeProgressCallback = pct => {
    const mapped = Math.min(98, 35 + Math.round(pct * 0.63));
    onStage?.('ocr', mapped);
  };

  let extractedText: string;
  try {
    const result = await worker.recognize(prep.ocrDataUrl);
    extractedText = normalizeOcrText(result.data.text || '');
  } finally {
    activeProgressCallback = null;
  }

  const durationMs = Math.round(performance.now() - started);
  const lineCount = extractedText ? extractedText.split('\n').length : 0;

  return {
    imageDataUrl: raw.dataUrl,
    previewDataUrl: prep.previewDataUrl,
    extractedText,
    width: prep.width,
    height: prep.height,
    lineCount,
    charCount: extractedText.length,
    darkModeInverted: prep.darkModeInverted,
    durationMs,
  };
}

export function buildSnapPrompt(action: SnapAction, extractedText: string): string {
  const clipped = extractedText.slice(0, 12000);
  const baseContext = `Full-page screen capture OCR text (ignore browser tabs, bookmarks, navbars, or unrelated UI noise and focus on the main problem, question, code, error, or content):\n\n"""\n${clipped}\n"""`;

  switch (action) {
    case 'fix':
      return `${baseContext}\n\nTask: Identify the exact bug, error, or failing test case shown on screen, explain the root cause concisely, and provide the corrected code/fix ready to paste.`;
    case 'optimize':
      return `${baseContext}\n\nTask: Review the problem and code visible on screen. Give the time & space complexity (Big-O), highlight edge cases, and provide the cleanest optimal solution.`;
    case 'explain':
      return `${baseContext}\n\nTask: Summarize what is on the screen and give a crisp, confident spoken interview talk-track (bullet points I can say out loud naturally).`;
    case 'solve':
    default:
      return `${baseContext}\n\nTask: Detect what is on the screen (coding problem, multiple-choice question, SQL query, system design prompt, or technical question) and provide the complete, accurate, ready-to-use solution.`;
  }
}
