import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import {
  Mic, Monitor, EyeOff, Send, MicOff, Trash2,
  ChevronDown, ChevronUp, Eye, Loader2, Fan, Settings,
  BookmarkPlus, Bookmark, Timer, Copy, Check, Play, Pause, RotateCcw, Cpu,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Tesseract from 'tesseract.js';
import Groq from 'groq-sdk';
import type { DesktopCaptureConstraints } from './types/electron';
import { createRecordingCapture } from './audioCapture';
import { MessageContent } from './components/MessageContent';
import {
  SettingsPanel,
  loadSettings,
  saveSettings,
  applySettings,
  DEFAULT_SETTINGS,
  type Section,
  type InterviewMode,
} from './components/Settings';
import type { AppSettings } from './components/Settings';
import {
  SystemDesignWhiteboard,
  type SystemDesignData,
} from './components/SystemDesignWhiteboard';
import { IconTooltip } from './components/IconTooltip';

const PANEL_DEFAULT_W = 440;
const PANEL_DEFAULT_H = 540;
const PANEL_MIN_W = 300;
const PANEL_MIN_H = 380;
const PANEL_MAX_W = 720;
const PANEL_MAX_H = 900;
const COLLAPSED_H = 48;
const PINS_KEY = 'copilot-pins-v1';

type WindowBounds = { x: number; y: number; width: number; height: number };
type ResizeEdge = 'e' | 's' | 'se' | 'w';
type PanelSize = { width: number; height: number };
type Message = { id: string; role: 'user' | 'assistant'; content: string };
type PinnedMessage = { id: string; content: string; pinnedAt: number; mode: InterviewMode };

function clampPanelSize(w: number, h: number): PanelSize {
  return {
    width: Math.round(Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, w))),
    height: Math.round(Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, h))),
  };
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatTimer(secs: number): string {
  const abs = Math.max(0, secs);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const IS_ELECTRON = (() => {
  try {
    window.require?.('electron');
    return true;
  } catch {
    return false;
  }
})();

const GROQ_CHAT_MODEL = 'openai/gpt-oss-120b';

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY || '',
  dangerouslyAllowBrowser: true,
});

const groqWorkflow = new Groq({
  apiKey: import.meta.env.VITE_GROQ_WORKFLOW_API_KEY || '',
  dangerouslyAllowBrowser: true,
});

// ─── Interview Modes ─────────────────────────────────────────────────────────

const INTERVIEW_MODES: {
  id: InterviewMode;
  label: string;
  emoji: string;
  addendum: string;
}[] = [
  {
    id: 'general',
    label: 'General',
    emoji: '✨',
    addendum: '',
  },
  {
    id: 'coding',
    label: 'Coding',
    emoji: '🖥',
    addendum: `Interview Mode — CODING / DSA:
- Analyze brute force first, then optimize. Always state time & space complexity (Big-O).
- Mention edge cases: empty input, duplicates, integer overflow, null pointers.
- Provide clean, runnable code with brief inline comments.
- Walk through an example trace for non-trivial algorithms.`,
  },
  {
    id: 'system-design',
    label: 'System Design',
    emoji: '🏗',
    addendum: `Interview Mode — SYSTEM DESIGN:
- Default to 10M+ DAU scale unless specified otherwise.
- Cover: functional requirements, capacity estimation, high-level design, deep dives, trade-offs.
- Cite concrete technologies (Kafka, Redis, S3, CDN, consistent hashing) where appropriate.
- Use back-of-envelope math for capacity estimates.`,
  },
  {
    id: 'behavioral',
    label: 'Behavioral',
    emoji: '🎭',
    addendum: `Interview Mode — BEHAVIORAL (STAR):
- Structure every answer: Situation → Task → Action → Result.
- Aim for 2–3 minutes when spoken aloud (~300–400 words).
- Emphasize leadership, ownership, conflict resolution, and measurable impact.
- Suggest follow-up probing questions the interviewer might ask next.`,
  },
  {
    id: 'debugging',
    label: 'Debug',
    emoji: '🐛',
    addendum: `Interview Mode — DEBUGGING:
- Follow: Reproduce → Isolate → Hypothesize → Verify → Fix → Prevent.
- Ask about environment, recent deploys, logs, and reproduction steps.
- Show methodical, systematic thinking — no random guessing.
- Suggest monitoring or alerting improvements to prevent recurrence.`,
  },
  {
    id: 'sql',
    label: 'SQL / Data',
    emoji: '🧮',
    addendum: `Interview Mode — SQL & DATA:
- Default to ANSI SQL; note dialect differences (PostgreSQL, MySQL, BigQuery) where relevant.
- Prefer CTEs and window functions over correlated subqueries for readability.
- Explain query plan impact: indexes, join order, GROUP BY / ORDER BY.
- Format SQL with clear indentation and meaningful table/column aliases.`,
  },
];

// ─── System Prompt ────────────────────────────────────────────────────────────

type MsgForHistory = { role: 'user' | 'assistant'; content: string };

const WELCOME =
  'Your real-time AI interview assistant for coding rounds, system design, debugging, behavioral questions, and live problem solving.';

const DEFAULT_FOLLOW_UPS = [
  'Summarize what is on my screen',
  'Help me structure my answer',
  'What follow-up questions might they ask?',
];

const BASE_SYSTEM_PROMPT = `You are an elite AI interview copilot — sharp, confident, and technically precise.

Formatting rules (follow strictly):
- Use **markdown** for structure: bold for emphasis, numbered lists for steps, bullet lists for options.
- Wrap all code, commands, SQL, regex, and config in fenced blocks with the correct language tag (e.g. \`\`\`python, \`\`\`sql, \`\`\`bash).
- Use \`inline code\` for identifiers, function names, keys, and short snippets.
- Keep answers focused: 80–150 words unless the user asks for depth.
- Sound like a senior engineer in a live interview — direct, no fluff.`;

function getLanguageInstruction(language: AppSettings['responseLanguage']): string {
  if (language === 'hinglish') {
    return [
      'Language preference:',
      '- Write explanations in Hinglish (Roman script, easy conversational tone).',
      '- Keep all code blocks, commands, SQL, config keys, identifiers, and code comments in proper English only.',
      '- Do not translate programming syntax or keywords.',
    ].join('\n');
  }
  return [
    'Language preference:',
    '- Write the full response in clear professional English.',
  ].join('\n');
}

function getApproachInstruction(includeApproach: boolean): string {
  if (includeApproach) {
    return [
      'Approach preference:',
      '- Start with a short approach (2-4 bullets), then provide the final answer.',
    ].join('\n');
  }
  return [
    'Approach preference:',
    '- Skip approach and reasoning steps.',
    '- Provide direct actionable answer only unless the user explicitly asks for explanation.',
  ].join('\n');
}

function getModeAddendum(mode: InterviewMode): string {
  return INTERVIEW_MODES.find(m => m.id === mode)?.addendum ?? '';
}

function buildSystemPrompt(settings: AppSettings): string {
  const parts = [
    BASE_SYSTEM_PROMPT,
    getLanguageInstruction(settings.responseLanguage),
    getApproachInstruction(settings.includeApproach),
  ];
  const modeAdd = getModeAddendum(settings.interviewMode ?? 'general');
  if (modeAdd) parts.push(modeAdd);
  parts.push('\nScreen context (OCR snapshot):\n');
  return parts.join('\n\n');
}

function ipc(): {
  invoke: (c: string, ...a: unknown[]) => Promise<unknown>;
  on: (e: string, fn: () => void) => void;
  removeListener: (e: string, fn: () => void) => void;
} | null {
  try {
    return window.require?.('electron')?.ipcRenderer ?? null;
  } catch {
    return null;
  }
}

function parseFollowUpArray(raw: string): string[] {
  const t = raw.trim();
  const block = t.match(/\[[\s\S]*?\]/);
  const jsonStr = block ? block[0] : t.startsWith('[') ? t : '';
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 3);
  } catch {
    return [];
  }
}

function parseSystemDesignJson(raw: string): SystemDesignData {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const block = stripped.match(/\{[\s\S]*\}/);
  const jsonStr = block ? block[0] : stripped;
  const parsed = JSON.parse(jsonStr) as Partial<SystemDesignData>;
  const diagram =
    typeof parsed.diagram === 'string'
      ? parsed.diagram.replace(/\\n/g, '\n')
      : '';
  return {
    system: String(parsed.system ?? 'System'),
    overview: String(parsed.overview ?? ''),
    diagram,
    apis: Array.isArray(parsed.apis) ? parsed.apis : [],
    database: Array.isArray(parsed.database) ? parsed.database : [],
    scaling: {
      dau: parsed.scaling?.dau ?? '—',
      storage: parsed.scaling?.storage ?? '—',
      bandwidth: parsed.scaling?.bandwidth,
      qps: parsed.scaling?.qps,
      strategies: Array.isArray(parsed.scaling?.strategies) ? parsed.scaling.strategies : [],
      technologies: Array.isArray(parsed.scaling?.technologies) ? parsed.scaling.technologies : [],
      tradeoffs: Array.isArray(parsed.scaling?.tradeoffs) ? parsed.scaling.tradeoffs : [],
    },
  };
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Core chat state ────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', content: WELCOME },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isGhost, setIsGhost] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [ocrStatus, setOcrStatus] = useState('');
  const [followUps, setFollowUps] = useState<string[]>(DEFAULT_FOLLOW_UPS);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const [isFollowUpsExpanded, setIsFollowUpsExpanded] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<Section>('appearance');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // ── System Design Whiteboard ──────────────────────────────────────────────
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const [whiteboardData, setWhiteboardData] = useState<SystemDesignData | null>(null);
  const [whiteboardLoading, setWhiteboardLoading] = useState(false);

  // ── Saved Snippets (Pins) ─────────────────────────────────────────────────
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>(() => {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      return raw ? (JSON.parse(raw) as PinnedMessage[]) : [];
    } catch { return []; }
  });
  const [isPinsOpen, setIsPinsOpen] = useState(false);
  const [copiedPinId, setCopiedPinId] = useState<string | null>(null);

  // ── Interview Timer ────────────────────────────────────────────────────────
  const [timerMode, setTimerMode] = useState<'stopwatch' | 'countdown'>('stopwatch');
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [timerTotal, setTimerTotal] = useState(45 * 60);
  const [showTimerPopup, setShowTimerPopup] = useState(false);
  const timerIntervalRef = useRef<number | null>(null);

  // ── Settings sync ──────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    applySettings(settings);
    saveSettings(settings);
  }, [settings, isCollapsed, isSettingsOpen]);

  const handleSettingsChange = useCallback((next: AppSettings) => {
    setSettings(next);
  }, []);

  const handleSettingsReset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  // ── Persist pins ──────────────────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(PINS_KEY, JSON.stringify(pinnedMessages)); } catch { /* noop */ }
  }, [pinnedMessages]);

  // ── Timer interval ────────────────────────────────────────────────────────
  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (!timerRunning) return;
    timerIntervalRef.current = window.setInterval(() => {
      setTimerElapsed(prev => {
        if (timerMode === 'countdown' && prev >= timerTotal) {
          setTimerRunning(false);
          return timerTotal;
        }
        return prev + 1;
      });
    }, 1000);
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [timerRunning, timerMode, timerTotal]);

  // ── Panel position / resize / drag ────────────────────────────────────────
  const [pos, setPos] = useState({
    x: typeof window !== 'undefined' ? window.innerWidth - PANEL_DEFAULT_W - 24 : 24,
    y: 20,
  });
  const [panelSize, setPanelSize] = useState<PanelSize>({
    width: PANEL_DEFAULT_W,
    height: PANEL_DEFAULT_H,
  });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizing = useRef<{
    active: boolean;
    edge: ResizeEdge | null;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startPosX: number;
    startBoundsX: number;
  }>({
    active: false,
    edge: null,
    startX: 0,
    startY: 0,
    startW: PANEL_DEFAULT_W,
    startH: PANEL_DEFAULT_H,
    startPosX: 0,
    startBoundsX: 0,
  });
  const windowBounds = useRef<WindowBounds>({
    x: 0, y: 0,
    width: PANEL_DEFAULT_W,
    height: PANEL_DEFAULT_H,
  });
  const expandedPanelSizeRef = useRef<PanelSize>({
    width: PANEL_DEFAULT_W,
    height: PANEL_DEFAULT_H,
  });
  const followUpReq = useRef(0);

  const panelRef       = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const videoRef       = useRef<HTMLVideoElement>(null);
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const ocrIntervalRef = useRef<number | null>(null);
  const latestOcr      = useRef('');
  const mediaRecorderRef     = useRef<MediaRecorder | null>(null);
  const recordingCleanupRef  = useRef<(() => void) | null>(null);
  const audioChunks          = useRef<Blob[]>([]);
  const inputRef             = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const renderer = ipc();
    if (!renderer || !IS_ELECTRON) return;
    void renderer.invoke('TOGGLE_MOUSE_EVENTS', false);
  }, []);

  useEffect(() => {
    const renderer = ipc();
    if (!renderer) return;
    const handler = () =>
      setIsGhost(prev => {
        const next = !prev;
        void renderer.invoke('TOGGLE_MOUSE_EVENTS', next);
        return next;
      });
    renderer.on('TOGGLE_GHOST_MODE_FROM_MAIN', handler);
    return () => renderer.removeListener('TOGGLE_GHOST_MODE_FROM_MAIN', handler);
  }, []);

  useEffect(() => {
    if (!isCollapsed) {
      expandedPanelSizeRef.current = panelSize;
    }
  }, [panelSize, isCollapsed]);

  const handleCollapse = useCallback(() => {
    expandedPanelSizeRef.current = panelSize;
    setIsCollapsed(true);
  }, [panelSize]);

  const handleExpand = useCallback(() => {
    setPanelSize(expandedPanelSizeRef.current);
    setIsCollapsed(false);
  }, []);

  const syncWindowBounds = useCallback(async () => {
    const renderer = ipc();
    const el = panelRef.current;
    if (!renderer || !el || !IS_ELECTRON) return;
    const w = Math.ceil(el.offsetWidth);
    const h = Math.ceil(el.offsetHeight);
    if (w < 1 || h < 1) return;
    const current = (await renderer.invoke('GET_WINDOW_BOUNDS')) as WindowBounds;
    const next: WindowBounds = { x: current.x, y: current.y, width: w, height: h };
    await renderer.invoke('SET_WINDOW_BOUNDS', next);
    windowBounds.current = next;
  }, []);

  useLayoutEffect(() => {
    void syncWindowBounds();
  }, [syncWindowBounds, isCollapsed, panelSize.width, panelSize.height, messages.length, isLoading, followUps.length, followUpsLoading, isFollowUpsExpanded]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || !IS_ELECTRON) return;
    const ro = new ResizeObserver(() => { void syncWindowBounds(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncWindowBounds, isCollapsed]);

  const onDragStart = useCallback(
    async (e: React.MouseEvent) => {
      if (resizing.current.active) return;
      dragging.current = true;
      const renderer = ipc();
      if (renderer && IS_ELECTRON) {
        const b = (await renderer.invoke('GET_WINDOW_BOUNDS')) as WindowBounds;
        windowBounds.current = b;
        dragOffset.current = { x: e.screenX - b.x, y: e.screenY - b.y };
      } else {
        dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      }
      e.preventDefault();
    },
    [pos],
  );

  const onResizeStart = useCallback(
    async (edge: ResizeEdge, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragging.current = false;
      const renderer = ipc();
      let boundsX = pos.x;
      if (renderer && IS_ELECTRON) {
        const b = (await renderer.invoke('GET_WINDOW_BOUNDS')) as WindowBounds;
        windowBounds.current = b;
        boundsX = b.x;
      }
      resizing.current = {
        active: true, edge,
        startX: e.screenX, startY: e.screenY,
        startW: panelSize.width, startH: panelSize.height,
        startPosX: pos.x, startBoundsX: boundsX,
      };
    },
    [panelSize.height, panelSize.width, pos.x],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const renderer = ipc();
      if (resizing.current.active && resizing.current.edge) {
        const { edge, startX, startY, startW, startH, startPosX, startBoundsX } = resizing.current;
        const dx = e.screenX - startX;
        const dy = e.screenY - startY;
        let nextW = startW, nextH = startH, nextX = startPosX, nextBoundsX = startBoundsX;
        if (edge.includes('e')) nextW = startW + dx;
        if (edge.includes('s')) nextH = startH + dy;
        if (edge.includes('w')) { nextW = startW - dx; nextBoundsX = startBoundsX + dx; nextX = startPosX + dx; }
        const clamped = clampPanelSize(nextW, nextH);
        if (edge.includes('w')) {
          const appliedDx = startW - clamped.width;
          nextBoundsX = startBoundsX + appliedDx;
          nextX = startPosX + appliedDx;
        }
        setPanelSize(clamped);
        if (renderer && IS_ELECTRON) {
          const b = windowBounds.current;
          void renderer.invoke('SET_WINDOW_BOUNDS', {
            x: edge.includes('w') ? nextBoundsX : b.x,
            y: b.y, width: clamped.width, height: clamped.height,
          });
        } else if (edge.includes('w')) {
          setPos(prev => ({ ...prev, x: Math.max(8, nextX) }));
        }
        return;
      }
      if (!dragging.current) return;
      if (renderer && IS_ELECTRON) {
        const b = windowBounds.current;
        void renderer.invoke('SET_WINDOW_BOUNDS', {
          x: e.screenX - dragOffset.current.x,
          y: e.screenY - dragOffset.current.y,
          width: b.width, height: b.height,
        });
      } else {
        setPos({
          x: Math.max(8, Math.min(window.innerWidth  - panelSize.width  - 8, e.clientX - dragOffset.current.x)),
          y: Math.max(8, Math.min(window.innerHeight - panelSize.height - 8, e.clientY - dragOffset.current.y)),
        });
      }
    };
    const onUp = () => {
      dragging.current = false;
      resizing.current.active = false;
      resizing.current.edge = null;
      void syncWindowBounds();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [panelSize.height, panelSize.width, syncWindowBounds]);

  // ── Ghost mode ────────────────────────────────────────────────────────────
  const toggleGhost = () => {
    const renderer = ipc();
    setIsGhost(prev => {
      const next = !prev;
      void renderer?.invoke('TOGGLE_MOUSE_EVENTS', next);
      return next;
    });
  };

  // ── Screen OCR ────────────────────────────────────────────────────────────
  const startScanning = async () => {
    const renderer = ipc();
    if (!renderer) {
      addMsg('assistant', 'Screen capture requires the **Electron** desktop app.');
      return;
    }
    try {
      const sources = (await renderer.invoke('GET_SOURCES', ['screen'])) as { id: string }[];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sources[0].id,
            minWidth: 1280, maxWidth: 1920,
            minHeight: 720, maxHeight: 1080,
          },
        },
      } as DesktopCaptureConstraints);
      if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); }
      setIsScanning(true);
      setOcrStatus('Live');
      ocrIntervalRef.current = window.setInterval(runOcr, 6000);
    } catch (err) {
      console.error(err);
      addMsg('assistant', 'Could not start screen capture — check **System Settings → Privacy → Screen Recording**.');
    }
  };

  const stopScanning = () => {
    if (ocrIntervalRef.current) clearInterval(ocrIntervalRef.current);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
    setOcrStatus('');
    latestOcr.current = '';
  };

  const runOcr = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const imgData = canvas.toDataURL('image/jpeg', 0.8);
    try {
      const { data: { text } } = await Tesseract.recognize(imgData, 'eng');
      if (text.trim().length > 10) { latestOcr.current = text.trim(); setOcrStatus('Synced'); }
    } catch (e) { console.error('OCR error', e); }
  };

  // ── Message helpers ───────────────────────────────────────────────────────
  const addMsg = (role: 'user' | 'assistant', content: string) =>
    setMessages(prev => [...prev, { id: makeId(), role, content }]);

  // ── Pin helpers ───────────────────────────────────────────────────────────
  const pinMessage = useCallback((id: string, content: string) => {
    setPinnedMessages(prev => {
      if (prev.some(p => p.id === id)) return prev.filter(p => p.id !== id);
      return [
        { id, content, pinnedAt: Date.now(), mode: (settings.interviewMode ?? 'general') as InterviewMode },
        ...prev,
      ];
    });
  }, [settings.interviewMode]);

  const isPinned = useCallback(
    (id: string) => pinnedMessages.some(p => p.id === id),
    [pinnedMessages],
  );

  const copyPin = useCallback(async (pin: PinnedMessage) => {
    try {
      await navigator.clipboard.writeText(pin.content);
      setCopiedPinId(pin.id);
      setTimeout(() => setCopiedPinId(null), 1500);
    } catch { /* noop */ }
  }, []);

  // ── Timer helpers ─────────────────────────────────────────────────────────
  const timerRemaining = Math.max(0, timerTotal - timerElapsed);
  const timerDisplay   = timerMode === 'countdown' ? formatTimer(timerRemaining) : formatTimer(timerElapsed);
  const isTimerWarning = timerMode === 'countdown' && timerRunning && timerRemaining <= 300 && timerRemaining > 0;
  const isTimerFinished = timerMode === 'countdown' && timerElapsed >= timerTotal;

  const resetTimer = useCallback(() => { setTimerRunning(false); setTimerElapsed(0); }, []);

  const toggleTimer = useCallback(() => {
    if (isTimerFinished) { resetTimer(); return; }
    setTimerRunning(r => !r);
  }, [isTimerFinished, resetTimer]);

  // ── Follow-ups ────────────────────────────────────────────────────────────
  const fetchFollowUps = useCallback(async (assistantText: string, userText: string): Promise<string[]> => {
    const key = import.meta.env.VITE_GROQ_API_KEY;
    if (!key) return [...DEFAULT_FOLLOW_UPS];
    const currentMode = INTERVIEW_MODES.find(m => m.id === (settings.interviewMode ?? 'general'));
    try {
      const completion = await groq.chat.completions.create({
        model: GROQ_CHAT_MODEL,
        temperature: 0.35,
        max_completion_tokens: 400,
        messages: [
          {
            role: 'system',
            content: `Reply with ONLY a JSON array of exactly 3 short follow-up questions (strings) the user might ask next in an interview prep chat.
No markdown, no keys, no explanation — only the JSON array.
Language: ${settings.responseLanguage === 'hinglish' ? 'Hinglish (Roman script)' : 'English'}.
Interview mode: ${currentMode?.label ?? 'General'}.
Keep any code words and technical identifiers in proper English.`,
          },
          {
            role: 'user',
            content: `User: ${userText.slice(0, 400)}\nAssistant: ${assistantText.slice(0, 800)}`,
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? '';
      let next = parseFollowUpArray(raw);
      if (next.length < 3) next = [...next, ...DEFAULT_FOLLOW_UPS].slice(0, 3);
      return next;
    } catch (e) {
      console.error(e);
      return [...DEFAULT_FOLLOW_UPS];
    }
  }, [settings.responseLanguage, settings.interviewMode]);

  // ── System Design Generator ───────────────────────────────────────────────
  const generateSystemDesign = useCallback(async (system: string) => {
    const key = import.meta.env.VITE_GROQ_WORKFLOW_API_KEY;
    if (!key) {
      addMsg('assistant', '**API key missing** — add `VITE_GROQ_WORKFLOW_API_KEY` to `.env` and restart the dev server.');
      return;
    }
    setIsWhiteboardOpen(true);
    setWhiteboardLoading(true);
    setWhiteboardData(null);
    try {
      const completion = await groqWorkflow.chat.completions.create({
        model: GROQ_CHAT_MODEL,
        temperature: 0.25,
        max_completion_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a staff-level distributed systems architect. Generate a complete system design for the given product.
Return ONLY a single valid JSON object — no markdown, no prose, no code fences. The JSON must exactly match this schema:
{
  "system": "string — product name",
  "overview": "string — 3-4 sentence executive summary covering purpose, scale, and core technical decisions",
  "diagram": "string — ASCII art architecture diagram using box-drawing chars (┌─┐└┘│├┤┬┴┼▶◀); at least 12 logical lines; use \\n for line breaks inside this string (never insert raw newline characters inside JSON string values)",
  "apis": [
    {
      "method": "GET|POST|PUT|DELETE|PATCH|WS",
      "endpoint": "/path/to/resource",
      "payload": "optional — JSON shape or description",
      "response": "optional — JSON shape or description",
      "description": "one sentence explaining what this endpoint does"
    }
  ],
  "database": [
    {
      "table": "table_name",
      "engine": "e.g. PostgreSQL / Cassandra / Redis / DynamoDB / MongoDB",
      "columns": [
        { "name": "col_name", "type": "data type", "note": "optional — PK / FK / index / partition key" }
      ],
      "indexes": ["index_name (optional)"],
      "note": "optional — one sentence on why this storage was chosen"
    }
  ],
  "scaling": {
    "dau": "e.g. 2B",
    "storage": "e.g. 4.5 PB/year",
    "bandwidth": "e.g. 100 Gbps peak",
    "qps": "e.g. 500K reads/sec",
    "strategies": ["list of 6-8 concrete scaling strategies with specific numbers"],
    "technologies": ["list of 8-12 specific technology names"],
    "tradeoffs": ["list of 3-5 concrete trade-offs with reasoning"]
  }
}
Include at least 6 API endpoints, 4 database tables, and make all numbers realistic for production scale.`,
          },
          { role: 'user', content: `Design ${system}` },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? '';
      if (!raw.trim()) {
        throw new Error('Empty response from model');
      }
      setWhiteboardData(parseSystemDesignJson(raw));
    } catch (err) {
      console.error('Whiteboard error:', err);
      const status = err && typeof err === 'object' && 'status' in err ? (err as { status?: number }).status : undefined;
      const isAuth = status === 401 || status === 403;
      const detail =
        err instanceof Error && !isAuth && err.message !== 'Empty response from model'
          ? ' The response could not be parsed — try again.'
          : isAuth
            ? ' Check that `VITE_GROQ_WORKFLOW_API_KEY` is valid.'
            : status === 429
              ? ' Rate limited — wait a moment and try again.'
              : ' Try again or check `VITE_GROQ_WORKFLOW_API_KEY` in `.env`.';
      addMsg('assistant', `**Whiteboard error** — could not generate design for "${system}".${detail}`);
      setIsWhiteboardOpen(false);
    } finally {
      setWhiteboardLoading(false);
    }
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      // ── Intercept "Design X" / "Architect X" commands ──────────────────────
      const designMatch = trimmed.match(/^(?:design|architect|whiteboard)\s+(.+)/i);
      if (designMatch) {
        await generateSystemDesign(designMatch[1].trim());
        setInput('');
        return;
      }
      followUpReq.current += 1;
      setFollowUpsLoading(false);
      addMsg('user', trimmed);
      setInput('');
      setIsLoading(true);
      try {
        const history: MsgForHistory[] = [...messages, { role: 'user' as const, content: trimmed }].slice(-12);
        const completion = await groq.chat.completions.create({
          model: GROQ_CHAT_MODEL,
          temperature: 0.3,
          max_completion_tokens: 400,
          messages: [
            { role: 'system', content: buildSystemPrompt(settings) + (latestOcr.current || '(none — enable Screen Context)') },
            ...history.map(m => ({ role: m.role, content: m.content })),
          ],
        });
        const reply = completion.choices[0]?.message?.content ?? "I couldn't generate a response.";
        addMsg('assistant', reply);
        const req = ++followUpReq.current;
        setFollowUpsLoading(true);
        const lines = await fetchFollowUps(reply, trimmed);
        if (followUpReq.current === req) { setFollowUps(lines); setFollowUpsLoading(false); }
      } catch (err) {
        console.error(err);
        const status = err && typeof err === 'object' && 'status' in err ? (err as { status?: number }).status : undefined;
        const missing = !import.meta.env.VITE_GROQ_API_KEY;
        const detail = missing
          ? 'add `VITE_GROQ_API_KEY` to `.env` and restart the dev server.'
          : status === 401 || status === 403
            ? '`VITE_GROQ_API_KEY` was rejected. Check the key in `.env` and restart.'
            : status === 429
              ? 'Groq rate limited this request. Wait a moment and try again.'
              : err instanceof Error && err.message
                ? err.message
                : 'the request to Groq failed. Try again.';
        addMsg('assistant', `**Connection error** — ${detail}`);
      } finally {
        setIsLoading(false);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    },
    [isLoading, messages, fetchFollowUps, settings],
  );

  const clearChat = () => {
    followUpReq.current += 1;
    setFollowUpsLoading(false);
    setMessages([{ id: makeId(), role: 'assistant', content: 'Fresh slate. Fire away — technical, behavioral, or system design.' }]);
    setFollowUps(DEFAULT_FOLLOW_UPS);
  };

  // ── Voice recording ───────────────────────────────────────────────────────
  const toggleRecording = async () => {
    if (isRecording) { mediaRecorderRef.current?.stop(); setIsRecording(false); return; }
    try {
      const { stream, cleanup } = await createRecordingCapture(ipc());
      recordingCleanupRef.current = cleanup;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunks.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mr.onstop = async () => {
        recordingCleanupRef.current?.();
        recordingCleanupRef.current = null;
        const blob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const file = new File([blob], 'audio.webm', { type: 'audio/webm' });
        setIsLoading(true);
        try {
          const result = await groq.audio.transcriptions.create({ file, model: 'whisper-large-v3-turbo' });
          if (result.text) await sendMessage(result.text);
        } catch (err) {
          console.error(err);
          addMsg('assistant', 'Could not transcribe audio — try again or type your question.');
        } finally { setIsLoading(false); }
      };
      mr.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      addMsg('assistant', 'Microphone access denied. Grant permission in **System Settings → Privacy**.');
    }
  };

  // ── Shell styles ──────────────────────────────────────────────────────────
  const expandedShellStyle: React.CSSProperties = IS_ELECTRON
    ? { width: panelSize.width, height: panelSize.height }
    : { left: pos.x, top: pos.y, width: panelSize.width, height: panelSize.height };

  const collapsedShellStyle: React.CSSProperties = IS_ELECTRON
    ? { width: 'max-content', height: COLLAPSED_H }
    : { left: pos.x, top: pos.y, width: 'max-content', height: COLLAPSED_H };

  // ── Collapsed state ───────────────────────────────────────────────────────
  if (isCollapsed) {
    return (
      <>
        <div ref={panelRef} className="copilot-shell copilot-shell--collapsed z-50" style={collapsedShellStyle}>
          <div
            className="collapsed-bar flex items-center gap-2 px-3.5 h-full cursor-grab active:cursor-grabbing select-none"
            onMouseDown={onDragStart}
          >
            <span className="text-[13px] font-semibold text-[var(--text)] tracking-tight whitespace-nowrap">
              Interview Copilot
            </span>
            {isScanning && <span className="status-pill shrink-0">{ocrStatus}</span>}
            {/* Timer pill visible in collapsed state */}
            {(timerRunning || timerElapsed > 0) && (
              <span
                className={`timer-collapsed-pill shrink-0 ${isTimerWarning ? 'timer-warning' : ''} ${isTimerFinished ? 'timer-finished' : ''}`}
                onClick={toggleTimer}
                title={timerRunning ? 'Pause timer' : 'Resume timer'}
                style={{ cursor: 'pointer' }}
              >
                {timerDisplay}
              </span>
            )}
            <IconTooltip
              label="Expand Panel"
              hint="Open the full chat window with messages, input, and tools."
            >
              <button
                type="button"
                onClick={e => { e.stopPropagation(); handleExpand(); }}
                className="icon-btn ml-0.5 shrink-0"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </IconTooltip>
          </div>
        </div>
        <video ref={videoRef} className="hidden" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
      </>
    );
  }

  // ── Expanded state ────────────────────────────────────────────────────────
  return (
    <>
      <div
        ref={panelRef}
        className={`copilot-shell z-50 transition-opacity duration-300 ${
          isGhost ? 'opacity-[0.15] pointer-events-none' : 'opacity-100'
        }`}
        style={expandedShellStyle}
      >
        <div className="copilot-panel relative h-full">
          <div className="copilot-panel-inner">

            {/* ── Title Bar ──────────────────────────────── */}
            <div
              className="title-bar flex items-center px-4 py-2.5 cursor-grab active:cursor-grabbing select-none shrink-0 gap-2"
              onMouseDown={onDragStart}
            >
              {/* Left: branding */}
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-[var(--text)] tracking-tight leading-none truncate">
                  Interview Copilot
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-[var(--text-muted)] font-medium">⌘⇧Space · ⌘⇧G</span>
                  {isScanning && <span className="status-pill">{ocrStatus}</span>}
                </div>
              </div>

              {/* Center: Timer widget */}
              <div
                className="flex items-center gap-1 shrink-0"
                onMouseDown={e => e.stopPropagation()}
              >
                <div className="relative">
                  <IconTooltip
                    label="Interview Timer"
                    hint="Set countdown or count-up length and open timer controls for timed rounds."
                    align="center"
                  >
                    <button
                      type="button"
                      className={`timer-display-btn ${isTimerWarning ? 'timer-warning' : ''} ${isTimerFinished ? 'timer-finished' : ''}`}
                      onClick={() => setShowTimerPopup(p => !p)}
                    >
                      <Timer className="w-3 h-3 opacity-70 shrink-0" />
                      <span className="timer-display-text">{timerDisplay}</span>
                    </button>
                  </IconTooltip>
                </div>
                <IconTooltip
                  label={timerRunning ? 'Pause Timer' : isTimerFinished ? 'Restart Timer' : 'Start Timer'}
                  hint={
                    timerRunning
                      ? 'Pause the clock without resetting elapsed time.'
                      : isTimerFinished
                        ? 'Reset and start again from your configured duration.'
                        : 'Begin counting up or down based on your timer mode.'
                  }
                >
                  <button
                    type="button"
                    onClick={toggleTimer}
                    className={`icon-btn shrink-0 ${timerRunning ? 'icon-btn--active' : ''}`}
                  >
                    {timerRunning
                      ? <Pause className="w-3.5 h-3.5" />
                      : <Play className="w-3.5 h-3.5" />}
                  </button>
                </IconTooltip>
              </div>

              {/* Right: actions */}
              <div className="flex items-center gap-0.5 shrink-0" onMouseDown={e => e.stopPropagation()}>
                <IconTooltip
                  label={isGhost ? 'Disable Ghost Mode' : 'Ghost Mode'}
                  hint={
                    isGhost
                      ? 'Return to a normal, fully visible window that accepts clicks (⌘⇧G).'
                      : 'Fade the panel and pass clicks through so you can use apps underneath during a call (⌘⇧G).'
                  }
                >
                  <button
                    type="button"
                    onClick={toggleGhost}
                    className={`icon-btn ${isGhost ? 'icon-btn--active' : ''}`}
                  >
                    {isGhost ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </IconTooltip>
                <IconTooltip
                  label={isScanning ? 'Stop Screen Context' : 'Screen Context'}
                  hint={
                    isScanning
                      ? 'Stop OCR capture from your display.'
                      : 'Read on-screen text (LeetCode, docs, IDE) so answers match what you are looking at.'
                  }
                >
                  <button
                    type="button"
                    onClick={isScanning ? stopScanning : startScanning}
                    className={`icon-btn ${isScanning ? 'icon-btn--active' : ''}`}
                  >
                    <Monitor className="w-4 h-4" />
                  </button>
                </IconTooltip>
                <IconTooltip
                  label="Saved Snippets"
                  hint={`Bookmark strong answers to reopen later${pinnedMessages.length > 0 ? ` (${pinnedMessages.length} saved)` : ''}.`}
                >
                  <button
                    type="button"
                    onClick={() => { setIsPinsOpen(p => !p); setIsSettingsOpen(false); }}
                    className={`icon-btn relative ${isPinsOpen ? 'icon-btn--active' : ''}`}
                  >
                    <Bookmark className="w-4 h-4" />
                    {pinnedMessages.length > 0 && (
                      <span className="pin-badge">{pinnedMessages.length > 9 ? '9+' : pinnedMessages.length}</span>
                    )}
                  </button>
                </IconTooltip>
                <IconTooltip
                  label="Clear Chat"
                  hint="Remove all messages and start a fresh conversation."
                  align="end"
                >
                  <button
                    type="button"
                    onClick={clearChat}
                    className="icon-btn icon-btn--danger"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </IconTooltip>
                <IconTooltip
                  label="System Design Whiteboard"
                  hint='Generate architecture diagrams, APIs, DB schemas, and scaling (e.g. type "design Uber").'
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsWhiteboardOpen(p => !p);
                      setIsSettingsOpen(false);
                      setIsPinsOpen(false);
                    }}
                    className={`icon-btn ${isWhiteboardOpen ? 'icon-btn--active' : ''}`}
                  >
                    <Cpu className="w-4 h-4" />
                  </button>
                </IconTooltip>
                <IconTooltip
                  label="Settings"
                  hint="Theme, language, interview mode, compact layout, and response style."
                  align="end"
                >
                  <button
                    type="button"
                    onClick={() => { setIsSettingsOpen(prev => !prev); setIsPinsOpen(false); setActiveSettingsSection('appearance'); }}
                    className={`icon-btn ${isSettingsOpen ? 'icon-btn--active' : ''}`}
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </IconTooltip>
                <IconTooltip
                  label="Collapse Panel"
                  hint="Shrink to a minimal bar while keeping the app running in the background."
                  align="end"
                >
                  <button
                    type="button"
                    onClick={handleCollapse}
                    className="icon-btn"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                </IconTooltip>
              </div>
            </div>

            {/* ── Interview Mode Strip ────────────────────── */}
            <div className="mode-strip" onMouseDown={e => e.stopPropagation()}>
              {INTERVIEW_MODES.map(mode => (
                <button
                  key={mode.id}
                  type="button"
                  className={`mode-chip ${(settings.interviewMode ?? 'general') === mode.id ? 'mode-chip--active' : ''}`}
                  onClick={() => handleSettingsChange({ ...settings, interviewMode: mode.id })}
                  title={mode.label}
                >
                  <span>{mode.label}</span>
                </button>
              ))}
            </div>

            {/* ── Messages ────────────────────────────────── */}
            <div
              className="flex-1 min-h-0 overflow-y-auto px-4 scrollbar-hide"
              style={{
                paddingTop: settings.compactMode ? 8 : 16,
                paddingBottom: settings.compactMode ? 8 : 16,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: settings.messageSpacing === 'compact' ? 8 : settings.messageSpacing === 'relaxed' ? 20 : 14,
                }}
              >
                {messages.map(msg => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'assistant' && settings.showAvatars && (
                      <div className="w-8 h-8 rounded-xl avatar-ring flex items-center justify-center shrink-0 mt-0.5">
                        <Fan className="w-4 h-4 text-blue-300" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] px-3.5 py-2.5 group relative ${
                        msg.role === 'user' ? 'msg-bubble--user' : 'msg-bubble--assistant'
                      }`}
                    >
                      <MessageContent content={msg.content} variant={msg.role} />
                      {settings.showTimestamps && (
                        <p style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, opacity: 0.6 }}>
                          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                      {/* ── Pin button — assistant messages only ── */}
                      {msg.role === 'assistant' && msg.id !== 'welcome' && (
                        <button
                          type="button"
                          className={`pin-msg-btn ${isPinned(msg.id) ? 'pin-msg-btn--pinned' : ''}`}
                          onClick={() => pinMessage(msg.id, msg.content)}
                          title={isPinned(msg.id) ? 'Remove from saved snippets' : 'Save snippet'}
                        >
                          {isPinned(msg.id)
                            ? <Bookmark className="w-3 h-3" />
                            : <BookmarkPlus className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}

                {isLoading && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`flex items-center gap-2.5 ${settings.showAvatars ? 'pl-10' : 'pl-0'}`}
                  >
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="think-dot"
                          style={{ animation: `think-bounce 0.9s ${i * 0.14}s infinite` }}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-[var(--text-muted)] font-medium">Synthesizing…</span>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* ── Smart Follow-ups ─────────────────────────── */}
            <div className="px-4 border-t border-[var(--panel-border)]" onMouseDown={e => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-2 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Smart follow-ups
                  </p>
                  {followUpsLoading && (
                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsFollowUpsExpanded(prev => !prev)}
                  title={isFollowUpsExpanded ? 'Minimize follow-ups' : 'Maximize follow-ups'}
                  className="icon-btn shrink-0"
                  aria-expanded={isFollowUpsExpanded}
                >
                  {isFollowUpsExpanded
                    ? <ChevronUp className="w-4 h-4" />
                    : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>

              <AnimatePresence initial={false}>
                {isFollowUpsExpanded && (
                  <motion.div
                    key="followups-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeInOut' }}
                    className="overflow-hidden pb-2"
                  >
                    <div className="flex gap-3 mb-3">
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        {followUps.map((line, i) => (
                          <button
                            key={`${line}-${i}`}
                            type="button"
                            disabled={isLoading || followUpsLoading}
                            onClick={() => void sendMessage(line)}
                            className={`followup-btn ${
                              i === 0
                                ? 'text-[var(--text)] font-semibold text-[13px]'
                                : 'text-[var(--text-muted)] font-medium text-[12px]'
                            }`}
                          >
                            <span className="text-blue-400/60 mr-0.5">→</span>
                            {line}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Composer ─────────────────────────────────── */}
            <div
              className="composer-bar px-4 pb-4 pt-3 flex items-center gap-2 border-t border-[var(--panel-border)]"
              onMouseDown={e => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={toggleRecording}
                title={isRecording ? 'Stop recording' : 'Voice input'}
                className={`mic-btn shrink-0 ${isRecording ? 'mic-btn--recording' : ''}`}
              >
                {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(input); }
                }}
                placeholder={isRecording ? 'Listening… tap mic to finish' : 'Ask anything — code, design, behavior…'}
                disabled={isRecording || isLoading}
                className="input-field flex-1 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void sendMessage(input)}
                disabled={!input.trim() || isLoading || isRecording}
                title="Send"
                className="send-btn shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── Resize handles ────────────────────────────── */}
          <div className="resize-handle resize-handle--w" onMouseDown={e => void onResizeStart('w', e)} aria-hidden />
          <div className="resize-handle resize-handle--e" onMouseDown={e => void onResizeStart('e', e)} aria-hidden />
          <div className="resize-handle resize-handle--s" onMouseDown={e => void onResizeStart('s', e)} aria-hidden />
          <div className="resize-handle resize-handle--se" onMouseDown={e => void onResizeStart('se', e)} aria-hidden />
        </div>

        {/* ── Settings Panel ────────────────────────────── */}
        <SettingsPanel
          open={isSettingsOpen}
          settings={settings}
          activeSection={activeSettingsSection}
          onSectionChange={setActiveSettingsSection}
          onClose={() => setIsSettingsOpen(false)}
          onChange={handleSettingsChange}
          onReset={handleSettingsReset}
        />

        {/* ── System Design Whiteboard ───────────────────── */}
        <SystemDesignWhiteboard
          open={isWhiteboardOpen}
          loading={whiteboardLoading}
          data={whiteboardData}
          onClose={() => setIsWhiteboardOpen(false)}
          onDesign={generateSystemDesign}
        />

        {/* ── Timer Popup ───────────────────────────────── */}
        <AnimatePresence>
          {showTimerPopup && (
            <motion.div
              initial={{ opacity: 0, scale: 0.93, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: -6 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="timer-popup"
              onMouseDown={e => e.stopPropagation()}
            >
              <p className="timer-popup-label">Timer Mode</p>
              <div className="timer-mode-row">
                <button
                  className={`timer-mode-btn ${timerMode === 'stopwatch' ? 'timer-mode-btn--active' : ''}`}
                  onClick={() => { setTimerMode('stopwatch'); resetTimer(); }}
                >
                  Stopwatch
                </button>
                <button
                  className={`timer-mode-btn ${timerMode === 'countdown' ? 'timer-mode-btn--active' : ''}`}
                  onClick={() => { setTimerMode('countdown'); resetTimer(); }}
                >
                  Countdown
                </button>
              </div>

              {timerMode === 'countdown' && (
                <>
                  <p className="timer-popup-label" style={{ marginTop: 10 }}>Duration</p>
                  <div className="timer-presets">
                    {[15, 30, 45, 60].map(min => (
                      <button
                        key={min}
                        className={`timer-preset-btn ${timerTotal === min * 60 ? 'timer-preset-btn--active' : ''}`}
                        onClick={() => { setTimerTotal(min * 60); resetTimer(); }}
                      >
                        {min}m
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="timer-controls">
                <button className="timer-ctrl-btn" onClick={toggleTimer}>
                  {timerRunning
                    ? <><Pause className="w-3 h-3" /> Pause</>
                    : isTimerFinished
                      ? <><RotateCcw className="w-3 h-3" /> Restart</>
                      : <><Play className="w-3 h-3" /> Start</>}
                </button>
                <button className="timer-ctrl-btn timer-ctrl-btn--reset" onClick={resetTimer} title="Reset">
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Pins Panel ────────────────────────────────── */}
        <AnimatePresence>
          {isPinsOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="pins-panel"
              onMouseDown={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="pins-header">
                <div className="pins-title">
                  <div className="pins-title-icon">
                    <Bookmark className="w-3.5 h-3.5" />
                  </div>
                  <span>Saved Snippets</span>
                  {pinnedMessages.length > 0 && (
                    <span className="pins-count">{pinnedMessages.length}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsPinsOpen(false)}
                  className="settings-close-btn"
                  title="Close"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Body */}
              <div className="pins-body">
                {pinnedMessages.length === 0 ? (
                  <div className="pins-empty">
                    <BookmarkPlus className="w-8 h-8 opacity-20" />
                    <p>No saved snippets yet</p>
                    <p className="pins-empty-sub">
                      Hover over any AI response and click the bookmark icon to save it here.
                    </p>
                  </div>
                ) : (
                  <div className="snippets-list">
                    {pinnedMessages.map(pin => {
                      const modeInfo = INTERVIEW_MODES.find(m => m.id === pin.mode);
                      return (
                        <div key={pin.id} className="snippet-card">
                          <div className="snippet-meta">
                            {modeInfo && (
                              <span className="snippet-mode">
                                {modeInfo.emoji} {modeInfo.label}
                              </span>
                            )}
                            <span className="snippet-time">
                              {new Date(pin.pinnedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="snippet-preview">
                            {pin.content.slice(0, 140)}{pin.content.length > 140 ? '…' : ''}
                          </p>
                          <div className="snippet-actions">
                            <button
                              type="button"
                              className="snippet-copy-btn"
                              onClick={() => void copyPin(pin)}
                              title="Copy to clipboard"
                            >
                              {copiedPinId === pin.id
                                ? <><Check className="w-3 h-3" /> Copied!</>
                                : <><Copy className="w-3 h-3" /> Copy</>}
                            </button>
                            <button
                              type="button"
                              className="snippet-delete-btn"
                              onClick={() => pinMessage(pin.id, pin.content)}
                              title="Remove snippet"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />
    </>
  );
}
