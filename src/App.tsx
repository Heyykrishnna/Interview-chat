import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot, Mic, Monitor, EyeOff, Send, MicOff, Trash2,
  ChevronDown, ChevronUp, Eye, Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Tesseract from 'tesseract.js';
import Groq from 'groq-sdk';

const PANEL_W = 420;

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY || '',
  dangerouslyAllowBrowser: true,
});

type Message = { role: 'user' | 'assistant'; content: string };

const DEFAULT_FOLLOW_UPS = [
  'Summarize what is on my screen',
  'Help me structure my answer',
  'What follow-up questions might they ask?',
];

function ipc(): { invoke: (c: string, ...a: unknown[]) => Promise<unknown>; on: (e: string, fn: () => void) => void; removeListener: (e: string, fn: () => void) => void } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).require('electron').ipcRenderer;
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
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Hi! I am your AI Interview Copilot. Ask me anything or enable Screen Context to let me read what is on your screen.',
    },
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

  const [pos, setPos] = useState({ x: typeof window !== 'undefined' ? window.innerWidth - PANEL_W - 24 : 24, y: 20 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const followUpReq = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ocrIntervalRef = useRef<number | null>(null);
  const latestOcr = useRef('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const renderer = ipc();
    if (!renderer) return;
    const handler = () =>
      setIsGhost(prev => {
        renderer.invoke('TOGGLE_MOUSE_EVENTS', !prev);
        return !prev;
      });
    renderer.on('TOGGLE_GHOST_MODE_FROM_MAIN', handler);
    return () => renderer.removeListener('TOGGLE_GHOST_MODE_FROM_MAIN', handler);
  }, []);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      e.preventDefault();
    },
    [pos],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, e.clientX - dragOffset.current.x)),
        y: Math.max(8, Math.min(window.innerHeight - 72, e.clientY - dragOffset.current.y)),
      });
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const toggleGhost = () => {
    const renderer = ipc();
    setIsGhost(prev => {
      renderer?.invoke('TOGGLE_MOUSE_EVENTS', !prev);
      return !prev;
    });
  };

  const startScanning = async () => {
    const renderer = ipc();
    if (!renderer) {
      addMsg('assistant', 'Screen capture requires the Electron app.');
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
          // Electron desktopCapture — not in standard MediaTrackConstraints
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
      setIsScanning(true);
      setOcrStatus('Scanning…');
      ocrIntervalRef.current = window.setInterval(runOcr, 6000);
    } catch (err) {
      console.error(err);
      addMsg('assistant', 'Could not start screen capture. Check permissions.');
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
      const {
        data: { text },
      } = await Tesseract.recognize(imgData, 'eng');
      if (text.trim().length > 10) {
        latestOcr.current = text.trim();
        setOcrStatus('Context ready');
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
        const systemPrompt = `You are a concise AI interview copilot. Answer clearly and directly in plain text. No markdown, no bullet points with asterisks, no bold text. Use numbered lists only when listing steps. Keep answers under 120 words unless the user asks for more.

Screen context (OCR snapshot):
${latestOcr.current || '(none available)'}`;

        const history = [...messages, { role: 'user' as const, content: trimmed }].slice(-12);

        const completion = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.25,
          max_completion_tokens: 250,
          messages: [
            { role: 'system', content: systemPrompt },
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
        addMsg('assistant', 'Error connecting to Groq. Check your API key in .env file.');
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
    setMessages([
      {
        role: 'assistant',
        content: 'Chat cleared. Ask me anything!',
      },
    ]);
    setFollowUps(DEFAULT_FOLLOW_UPS);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunks.current = [];
      mr.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const file = new File([blob], 'audio.webm', { type: 'audio/webm' });
        setIsLoading(true);
        try {
          const result = await groq.audio.transcriptions.create({ file, model: 'whisper-large-v3-turbo' });
          if (result.text) await sendMessage(result.text);
        } catch (err) {
          console.error(err);
          addMsg('assistant', 'Could not transcribe audio.');
        } finally {
          setIsLoading(false);
        }
      };
      mr.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      addMsg('assistant', 'Microphone access denied or unavailable.');
    }
  };

  return (
    <>
      <div className="fixed inset-0 pointer-events-none" />

      <div className="fixed z-50 pointer-events-auto text-slate-900" style={{ left: pos.x, top: pos.y, width: PANEL_W }}>
        <div
          className={`flex flex-col rounded-[28px] overflow-hidden transition-opacity duration-300 ${
            isGhost ? 'opacity-[0.18] pointer-events-none' : 'opacity-100'
          }`}
          style={{
            background: '#ffffff',
            boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.06)',
          }}
        >
          {/* Title bar */}
          <div
            className="flex items-center justify-between px-4 py-3.5 cursor-grab active:cursor-grabbing select-none shrink-0 bg-[#fafbfc] border-b border-slate-200/80"
            onMouseDown={onDragStart}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full bg-[#2563eb] shrink-0" />
              <span className="text-[15px] font-semibold text-slate-800 tracking-tight truncate">Interview Copilot</span>
              {isScanning && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 shrink-0">
                  {ocrStatus}
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0" onMouseDown={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={toggleGhost}
                title={isGhost ? 'Disable Ghost Mode (Cmd+Shift+G)' : 'Enable Ghost Mode (Cmd+Shift+G)'}
                className={`p-2 rounded-xl transition-colors ${
                  isGhost ? 'text-[#2563eb] bg-blue-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                {isGhost ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={isScanning ? stopScanning : startScanning}
                title={isScanning ? 'Stop Screen Context' : 'Start Screen Context'}
                className={`p-2 rounded-xl transition-colors ${
                  isScanning ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Monitor className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={clearChat}
                title="Clear chat"
                className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsCollapsed(p => !p)}
                title={isCollapsed ? 'Expand' : 'Collapse'}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {!isCollapsed && (
              <motion.div
                key="body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeInOut' }}
                className="overflow-hidden flex flex-col"
              >
                <div className="overflow-y-auto px-4 py-3 space-y-3 scrollbar-hide bg-white" style={{ maxHeight: 260 }}>
                  {messages.map((msg, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                      className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0 mt-0.5 border border-blue-100">
                          <Bot className="w-4 h-4 text-[#2563eb]" />
                        </div>
                      )}
                      <div
                        className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-[#2563eb] text-white rounded-tr-md shadow-sm'
                            : 'bg-slate-100 text-slate-800 rounded-tl-md border border-slate-200/60'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}

                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-2 pl-10"
                    >
                      <div className="flex gap-1">
                        {[0, 1, 2].map(i => (
                          <div
                            key={i}
                            className="w-1.5 h-1.5 rounded-full bg-[#2563eb]"
                            style={{ animation: `fuBounce 0.9s ${i * 0.15}s infinite` }}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-slate-400">Thinking…</span>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Follow-up card (reference layout) */}
                <div className="px-4 pb-3 pt-1 bg-white border-t border-slate-100" onMouseDown={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Most commonly asked follow-ups
                    </p>
                    {followUpsLoading && <Loader2 className="w-4 h-4 text-[#2563eb] animate-spin shrink-0" />}
                  </div>

                  <div className="flex gap-3 mb-4">
                    <div
                      className="w-[100px] shrink-0 rounded-2xl min-h-[112px] border border-sky-100/80 overflow-hidden"
                      style={{
                        background: 'linear-gradient(145deg, #bae6fd 0%, #e0f2fe 45%, #cffafe 100%)',
                        filter: 'saturate(1.05)',
                      }}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0 flex flex-col justify-center gap-2.5 py-0.5">
                      {followUps.map((line, i) => (
                        <button
                          key={`${line}-${i}`}
                          type="button"
                          disabled={isLoading || followUpsLoading}
                          onClick={() => void sendMessage(line)}
                          className={`text-left rounded-xl px-0 transition-opacity disabled:opacity-45 ${
                            i === 0 ? 'text-slate-900 font-semibold text-[14px]' : 'text-slate-500 text-[13px] font-medium'
                          } hover:text-[#2563eb]`}
                        >
                          <span className="text-slate-300 font-normal">"</span>
                          {line}
                          <span className="text-slate-300 font-normal">"</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={clearChat}
                      className="flex-1 py-3 rounded-full text-[13px] font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200/90 transition-colors border border-slate-200/80"
                    >
                      Start over
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        inputRef.current?.focus();
                        inputRef.current?.select();
                      }}
                      className="flex-1 py-3 rounded-full text-[13px] font-semibold text-white bg-[#2563eb] hover:bg-[#1d4ed8] shadow-sm transition-colors"
                    >
                      Ask another question
                    </button>
                  </div>
                </div>

                <div className="px-4 pb-4 pt-2 flex items-center gap-2 bg-[#fafbfc] border-t border-slate-200/80" onMouseDown={e => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={toggleRecording}
                    title={isRecording ? 'Stop recording' : 'Record voice'}
                    className={`shrink-0 p-2.5 rounded-full transition-all ${
                      isRecording
                        ? 'bg-red-50 text-red-600 ring-2 ring-red-200'
                        : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200'
                    }`}
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
                    placeholder={isRecording ? 'Recording… tap mic to stop' : 'Type your question…'}
                    disabled={isRecording || isLoading}
                    className="flex-1 bg-white border border-slate-200 rounded-full px-4 py-2.5 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563eb]/25 focus:border-[#2563eb] transition-all disabled:opacity-50"
                  />

                  <button
                    type="button"
                    onClick={() => void sendMessage(input)}
                    disabled={!input.trim() || isLoading || isRecording}
                    title="Send"
                    className="shrink-0 p-2.5 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-35 disabled:cursor-not-allowed rounded-full transition-colors text-white shadow-sm"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      <style>{`
        @keyframes fuBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </>
  );
}
