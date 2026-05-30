import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import {
  Mic, Monitor, EyeOff, Send, MicOff, Trash2,
  ChevronDown, ChevronUp, Eye, Loader2, Sparkles, Fan, Settings,
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
} from './components/Settings';
import type { AppSettings } from './components/Settings';

const PANEL_DEFAULT_W = 440;
const PANEL_DEFAULT_H = 520;
const PANEL_MIN_W = 300;
const PANEL_MIN_H = 360;
const PANEL_MAX_W = 720;
const PANEL_MAX_H = 900;
const COLLAPSED_H = 48;

type WindowBounds = { x: number; y: number; width: number; height: number };
type ResizeEdge = 'e' | 's' | 'se' | 'w';
type PanelSize = { width: number; height: number };

function clampPanelSize(w: number, h: number): PanelSize {
  return {
    width: Math.round(Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, w))),
    height: Math.round(Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, h))),
  };
}

const IS_ELECTRON = (() => {
  try {
    window.require?.('electron');
    return true;
  } catch {
    return false;
  }
})();

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY || '',
  dangerouslyAllowBrowser: true,
});

type Message = { role: 'user' | 'assistant'; content: string };

const WELCOME =
  "Your real-time AI interview assistant for coding rounds, system design, debugging, behavioral questions, and live problem solving.";

const DEFAULT_FOLLOW_UPS = [
  'Summarize what is on my screen',
  'Help me structure my answer',
  'What follow-up questions might they ask?',
];

const SYSTEM_PROMPT = `You are an elite AI interview copilot — sharp, confident, and technically precise.

Formatting rules (follow strictly):
- Use **markdown** for structure: bold for emphasis, numbered lists for steps, bullet lists for options.
- Wrap all code, commands, SQL, regex, and config in fenced blocks with the correct language tag (e.g. \`\`\`python, \`\`\`sql, \`\`\`bash).
- Use \`inline code\` for identifiers, function names, keys, and short snippets.
- Keep answers focused: 80–150 words unless the user asks for depth.
- Sound like a senior engineer in a live interview — direct, no fluff.

Screen context (OCR snapshot):
`;

function ipc(): { invoke: (c: string, ...a: unknown[]) => Promise<unknown>; on: (e: string, fn: () => void) => void; removeListener: (e: string, fn: () => void) => void } | null {
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

export default function App() {
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: WELCOME }]);
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
  const [activeSettingsSection, setActiveSettingsSection] = useState<'appearance' | 'typography' | 'layout' | 'advanced'>('appearance');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Apply settings on mount and on every change
  useEffect(() => {
    applySettings(settings);
    saveSettings(settings);
  }, [settings]);

  const handleSettingsChange = useCallback((next: AppSettings) => {
    setSettings(next);
  }, []);

  const handleSettingsReset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  // Close settings on Escape handled inside SettingsPanel

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
    x: 0,
    y: 0,
    width: PANEL_DEFAULT_W,
    height: PANEL_DEFAULT_H,
  });
  const expandedPanelSizeRef = useRef<PanelSize>({
    width: PANEL_DEFAULT_W,
    height: PANEL_DEFAULT_H,
  });
  const followUpReq = useRef(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ocrIntervalRef = useRef<number | null>(null);
  const latestOcr = useRef('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingCleanupRef = useRef<(() => void) | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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
    const ro = new ResizeObserver(() => {
      void syncWindowBounds();
    });
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
        active: true,
        edge,
        startX: e.screenX,
        startY: e.screenY,
        startW: panelSize.width,
        startH: panelSize.height,
        startPosX: pos.x,
        startBoundsX: boundsX,
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

        let nextW = startW;
        let nextH = startH;
        let nextX = startPosX;
        let nextBoundsX = startBoundsX;

        if (edge.includes('e')) nextW = startW + dx;
        if (edge.includes('s')) nextH = startH + dy;
        if (edge.includes('w')) {
          nextW = startW - dx;
          nextBoundsX = startBoundsX + dx;
          nextX = startPosX + dx;
        }

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
            y: b.y,
            width: clamped.width,
            height: clamped.height,
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
          width: b.width,
          height: b.height,
        });
      } else {
        setPos({
          x: Math.max(8, Math.min(window.innerWidth - panelSize.width - 8, e.clientX - dragOffset.current.x)),
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
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [panelSize.height, panelSize.width, syncWindowBounds]);

  const toggleGhost = () => {
    const renderer = ipc();
    setIsGhost(prev => {
      const next = !prev;
      void renderer?.invoke('TOGGLE_MOUSE_EVENTS', next);
      return next;
    });
  };

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
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080,
          },
        },
      } as DesktopCaptureConstraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
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
      if (text.trim().length > 10) {
        latestOcr.current = text.trim();
        setOcrStatus('Synced');
      }
    } catch (e) {
      console.error('OCR error', e);
    }
  };

  const addMsg = (role: 'user' | 'assistant', content: string) =>
    setMessages(prev => [...prev, { role, content }]);

  const fetchFollowUps = useCallback(async (assistantText: string, userText: string): Promise<string[]> => {
    const key = import.meta.env.VITE_GROQ_API_KEY;
    if (!key) return [...DEFAULT_FOLLOW_UPS];
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.35,
        max_completion_tokens: 200,
        messages: [
          {
            role: 'system',
            content:
              'Reply with ONLY a JSON array of exactly 3 short follow-up questions (strings) the user might ask next in an interview prep chat. No markdown, no keys, no explanation — only the JSON array.',
          },
          {
            role: 'user',
            content: `User: ${userText.slice(0, 400)}\nAssistant: ${assistantText.slice(0, 800)}`,
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? '';
      let next = parseFollowUpArray(raw);
      if (next.length < 3) {
        next = [...next, ...DEFAULT_FOLLOW_UPS].slice(0, 3);
      }
      return next;
    } catch (e) {
      console.error(e);
      return [...DEFAULT_FOLLOW_UPS];
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;
      followUpReq.current += 1;
      setFollowUpsLoading(false);
      addMsg('user', trimmed);
      setInput('');
      setIsLoading(true);

      try {
        const history = [...messages, { role: 'user' as const, content: trimmed }].slice(-12);

        const completion = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.3,
          max_completion_tokens: 400,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + (latestOcr.current || '(none — enable Screen Context)') },
            ...history.map(m => ({ role: m.role, content: m.content })),
          ],
        });

        const reply = completion.choices[0]?.message?.content ?? "I couldn't generate a response.";
        addMsg('assistant', reply);

        const req = ++followUpReq.current;
        setFollowUpsLoading(true);
        const lines = await fetchFollowUps(reply, trimmed);
        if (followUpReq.current === req) {
          setFollowUps(lines);
          setFollowUpsLoading(false);
        }
      } catch (err) {
        console.error(err);
        addMsg('assistant', '**Connection error** — add your `VITE_GROQ_API_KEY` to `.env` and restart.');
      } finally {
        setIsLoading(false);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    },
    [isLoading, messages, fetchFollowUps],
  );

  const clearChat = () => {
    followUpReq.current += 1;
    setFollowUpsLoading(false);
    setMessages([{ role: 'assistant', content: 'Fresh slate. Fire away — technical, behavioral, or system design.' }]);
    setFollowUps(DEFAULT_FOLLOW_UPS);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const { stream, cleanup } = await createRecordingCapture(ipc());
      recordingCleanupRef.current = cleanup;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunks.current = [];
      mr.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };
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
        } finally {
          setIsLoading(false);
        }
      };
      mr.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      addMsg('assistant', 'Microphone access denied. Grant permission in **System Settings → Privacy**.');
    }
  };

  const expandedShellStyle: React.CSSProperties = IS_ELECTRON
    ? { width: panelSize.width, height: panelSize.height }
    : { left: pos.x, top: pos.y, width: panelSize.width, height: panelSize.height };

  const collapsedShellStyle: React.CSSProperties = IS_ELECTRON
    ? { width: 'max-content', height: COLLAPSED_H }
    : { left: pos.x, top: pos.y, width: 'max-content', height: COLLAPSED_H };

  if (isCollapsed) {
    return (
      <>
        <div
          ref={panelRef}
          className="copilot-shell copilot-shell--collapsed z-50"
          style={collapsedShellStyle}
        >
          <div
            className="collapsed-bar flex items-center gap-2 px-3.5 h-full cursor-grab active:cursor-grabbing select-none"
            onMouseDown={onDragStart}
          >
            <div className="w-7 h-7 rounded-lg avatar-ring flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-blue-300" />
            </div>
            <span className="text-[13px] font-semibold text-[var(--text)] tracking-tight whitespace-nowrap">
              Copilot
            </span>
            {isScanning && <span className="status-pill shrink-0">{ocrStatus}</span>}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); handleExpand(); }}
              className="icon-btn ml-0.5 shrink-0"
              title="Expand"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>
        <video ref={videoRef} className="hidden" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
      </>
    );
  }

  return (
    <>
      <div
        ref={panelRef}
        className={`copilot-shell z-50 transition-opacity duration-300 ${
          isGhost ? 'opacity-[0.15] pointer-events-none' : 'opacity-100'
        }`}
        style={expandedShellStyle}
      >
        <div className="copilot-panel relative flex flex-col h-full rounded-[24px] overflow-hidden">
          <div
            className="title-bar flex items-center justify-between px-4 py-3 cursor-grab active:cursor-grabbing select-none shrink-0"
            onMouseDown={onDragStart}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-[var(--text)] tracking-tight leading-none truncate">
                  Interview Copilot
                </p>
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5 font-medium">⌘⇧Space hide · ⌘⇧G ghost</p>
              </div>
              {isScanning && (
                <span className="status-pill shrink-0">{ocrStatus}</span>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0" onMouseDown={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={toggleGhost}
                title={isGhost ? 'Disable Ghost Mode (⌘⇧G)' : 'Ghost Mode — click-through (⌘⇧G)'}
                className={`icon-btn ${isGhost ? 'icon-btn--active' : ''}`}
              >
                {isGhost ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={isScanning ? stopScanning : startScanning}
                title={isScanning ? 'Stop Screen Context' : 'Start Screen Context'}
                className={`icon-btn ${isScanning ? 'icon-btn--active' : ''}`}
              >
                <Monitor className="w-4 h-4" />
              </button>
              <button type="button" onClick={clearChat} title="Clear chat" className="icon-btn icon-btn--danger">
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => { setIsSettingsOpen(prev => !prev); setActiveSettingsSection('appearance'); }}
                title="Settings"
                className={`icon-btn ${isSettingsOpen ? 'icon-btn--active' : ''}`}
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleCollapse}
                title="Collapse"
                className="icon-btn"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Settings Panel */}
          <SettingsPanel
            open={isSettingsOpen}
            settings={settings}
            activeSection={activeSettingsSection}
            onSectionChange={setActiveSettingsSection}
            onClose={() => setIsSettingsOpen(false)}
            onChange={handleSettingsChange}
            onReset={handleSettingsReset}
          />

          <div
            className="flex-1 min-h-0 overflow-y-auto px-4 scrollbar-hide"
            style={{ paddingTop: settings.compactMode ? 8 : 16, paddingBottom: settings.compactMode ? 8 : 16 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: settings.messageSpacing === 'compact' ? 8 : settings.messageSpacing === 'relaxed' ? 20 : 14 }}>
            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
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
                  className={`max-w-[85%] px-3.5 py-2.5 ${
                    msg.role === 'user' ? 'msg-bubble--user' : 'msg-bubble--assistant'
                  } ${!settings.showAvatars && msg.role === 'assistant' ? 'ml-0' : ''}`}
                >
                  <MessageContent content={msg.content} variant={msg.role} />
                  {settings.showTimestamps && (
                    <p style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, opacity: 0.6 }}>
                      {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
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
                aria-label={isFollowUpsExpanded ? 'Minimize follow-ups' : 'Maximize follow-ups'}
              >
                {isFollowUpsExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
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

                  <div className="flex gap-2">
                    <button type="button" onClick={clearChat} className="action-btn action-btn--secondary">
                      Start over
                    </button>
                    <button
                      type="button"
                      onClick={() => { inputRef.current?.focus(); }}
                      className="action-btn action-btn--primary"
                    >
                      Ask another
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

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
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(input);
                }
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

          <div
            className="resize-handle resize-handle--w"
            onMouseDown={e => void onResizeStart('w', e)}
            aria-hidden
          />
          <div
            className="resize-handle resize-handle--e"
            onMouseDown={e => void onResizeStart('e', e)}
            aria-hidden
          />
          <div
            className="resize-handle resize-handle--s"
            onMouseDown={e => void onResizeStart('s', e)}
            aria-hidden
          />
          <div
            className="resize-handle resize-handle--se"
            onMouseDown={e => void onResizeStart('se', e)}
            aria-hidden
          />
        </div>
      </div>

      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />
    </>
  );
}
