import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot, Mic, Monitor, EyeOff, Send, MicOff, Trash2,
  ChevronDown, ChevronUp, Zap, Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Tesseract from 'tesseract.js';
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY || '',
  dangerouslyAllowBrowser: true,
});

type Message = { role: 'user' | 'assistant'; content: string };

// ── IPC helper ──────────────────────────────────────────────────────────────
function ipc() {
  try { return (window as any).require('electron').ipcRenderer; } catch { return null; }
}

export default function App() {
  // ── state ────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! I am your AI Interview Copilot. Ask me anything or enable Screen Context to let me read what is on your screen.' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isGhost, setIsGhost] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [ocrStatus, setOcrStatus] = useState('');

  // ── dragging state ───────────────────────────────────────────────────────
  const [pos, setPos] = useState({ x: window.innerWidth - 440, y: 20 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // ── refs ─────────────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ocrIntervalRef = useRef<number | null>(null);
  const latestOcr = useRef('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── listen for ghost toggle from main process ────────────────────────────
  useEffect(() => {
    const renderer = ipc();
    if (!renderer) return;
    const handler = () => setIsGhost(prev => {
      renderer.invoke('TOGGLE_MOUSE_EVENTS', !prev);
      return !prev;
    });
    renderer.on('TOGGLE_GHOST_MODE_FROM_MAIN', handler);
    return () => renderer.removeListener('TOGGLE_GHOST_MODE_FROM_MAIN', handler);
  }, []);

  // ── drag handlers ────────────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 420, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffset.current.y)),
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── ghost mode ───────────────────────────────────────────────────────────
  const toggleGhost = () => {
    const renderer = ipc();
    setIsGhost(prev => {
      renderer?.invoke('TOGGLE_MOUSE_EVENTS', !prev);
      return !prev;
    });
  };

  // ── screen capture ───────────────────────────────────────────────────────
  const startScanning = async () => {
    const renderer = ipc();
    if (!renderer) { addMsg('assistant', 'Screen capture requires the Electron app.'); return; }
    try {
      const sources = await renderer.invoke('GET_SOURCES', ['screen']);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sources[0].id,
            minWidth: 1280, maxWidth: 1920, minHeight: 720, maxHeight: 1080,
          }
        } as any
      });
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
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
      const { data: { text } } = await Tesseract.recognize(imgData, 'eng');
      if (text.trim().length > 10) {
        latestOcr.current = text.trim();
        setOcrStatus('Context ready');
      }
    } catch (e) { console.error('OCR error', e); }
  };

  // ── chat ─────────────────────────────────────────────────────────────────
  const addMsg = (role: 'user' | 'assistant', content: string) =>
    setMessages(prev => [...prev, { role, content }]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
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
    } catch (err) {
      console.error(err);
      addMsg('assistant', 'Error connecting to Groq. Check your API key in .env file.');
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isLoading, messages]);

  // ── quick prompts ─────────────────────────────────────────────────────────
  const quickPrompts = [
    'Explain this code',
    'What is this error?',
    'Give me a hint',
    'Summarize the screen',
  ];

  // ── mic ───────────────────────────────────────────────────────────────────
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
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const file = new File([blob], 'audio.webm', { type: 'audio/webm' });
        setIsLoading(true);
        try {
          const result = await groq.audio.transcriptions.create({ file, model: 'whisper-large-v3-turbo' });
          if (result.text) sendMessage(result.text);
        } catch (err) {
          console.error(err);
          addMsg('assistant', 'Could not transcribe audio.');
        } finally { setIsLoading(false); }
      };
      mr.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      addMsg('assistant', 'Microphone access denied or unavailable.');
    }
  };

  // ── clear ─────────────────────────────────────────────────────────────────
  const clearChat = () => setMessages([
    { role: 'assistant', content: 'Chat cleared. Ask me anything!' }
  ]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Full-screen pass-through layer */}
      <div className="fixed inset-0 pointer-events-none" />

      {/* Floating panel */}
      <div
        className="fixed z-50 pointer-events-auto"
        style={{ left: pos.x, top: pos.y, width: 400 }}
      >
        <div className={`flex flex-col rounded-2xl overflow-hidden shadow-2xl border border-white/10 transition-opacity duration-300 ${isGhost ? 'opacity-20 pointer-events-none' : 'opacity-100'}`}
          style={{ background: 'rgba(10, 10, 20, 0.88)', backdropFilter: 'blur(24px)' }}
        >

          {/* ── Title bar (draggable) ── */}
          <div
            className="flex items-center justify-between px-4 py-3 cursor-grab active:cursor-grabbing select-none shrink-0"
            style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
            onMouseDown={onDragStart}
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-white text-sm font-medium tracking-wide">AI Copilot</span>
              {isScanning && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                  {ocrStatus}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1" onMouseDown={e => e.stopPropagation()}>
              {/* Ghost mode */}
              <button
                onClick={toggleGhost}
                title={isGhost ? 'Disable Ghost Mode (Cmd+Shift+G)' : 'Enable Ghost Mode (Cmd+Shift+G)'}
                className={`p-1.5 rounded-lg transition-all ${isGhost ? 'text-blue-400 bg-blue-500/20' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
              >
                {isGhost ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              {/* Screen scan */}
              <button
                onClick={isScanning ? stopScanning : startScanning}
                title={isScanning ? 'Stop Screen Context' : 'Start Screen Context'}
                className={`p-1.5 rounded-lg transition-all ${isScanning ? 'text-green-400 bg-green-500/20' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
              >
                <Monitor className="w-4 h-4" />
              </button>
              {/* Clear */}
              <button
                onClick={clearChat}
                title="Clear chat"
                className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {/* Collapse */}
              <button
                onClick={() => setIsCollapsed(p => !p)}
                title={isCollapsed ? 'Expand' : 'Collapse'}
                className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-all"
              >
                {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* ── Collapsible body ── */}
          <AnimatePresence initial={false}>
            {!isCollapsed && (
              <motion.div
                key="body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                {/* Quick prompts */}
                <div className="flex gap-2 px-3 pt-3 pb-1 flex-wrap" onMouseDown={e => e.stopPropagation()}>
                  {quickPrompts.map(p => (
                    <button
                      key={p}
                      onClick={() => sendMessage(p)}
                      disabled={isLoading}
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-white/10 text-white/50 hover:text-white hover:border-blue-400/50 hover:bg-blue-500/10 transition-all disabled:opacity-40"
                    >
                      <Zap className="w-3 h-3" />
                      {p}
                    </button>
                  ))}
                </div>

                {/* Messages */}
                <div
                  className="overflow-y-auto px-3 py-2 space-y-3 scrollbar-hide"
                  style={{ maxHeight: 340 }}
                >
                  {messages.map((msg, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center mr-2 mt-1 shrink-0">
                          <Bot className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                      )}
                      <div
                        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white rounded-tr-none'
                            : 'bg-white/8 text-white/90 rounded-tl-none border border-white/5'
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
                      className="flex items-center gap-2 pl-8"
                    >
                      <div className="flex gap-1">
                        {[0, 1, 2].map(i => (
                          <div
                            key={i}
                            className="w-1.5 h-1.5 rounded-full bg-blue-400"
                            style={{ animation: `bounce 0.9s ${i * 0.15}s infinite` }}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-white/30">Thinking…</span>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input row */}
                <div
                  className="px-3 pb-3 pt-2 flex items-center gap-2"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <button
                    onClick={toggleRecording}
                    title={isRecording ? 'Stop recording' : 'Record voice'}
                    className={`shrink-0 p-2 rounded-xl transition-all ${
                      isRecording
                        ? 'bg-red-500/25 text-red-400 ring-1 ring-red-400/40'
                        : 'bg-white/6 text-white/50 hover:bg-white/12 hover:text-white'
                    }`}
                  >
                    {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                    placeholder={isRecording ? 'Recording… click mic to stop' : 'Ask me anything…'}
                    disabled={isRecording || isLoading}
                    className="flex-1 bg-white/6 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-blue-500/60 transition-all disabled:opacity-50"
                  />

                  <button
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim() || isLoading || isRecording}
                    title="Send"
                    className="shrink-0 p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl transition-all text-white"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>

      {/* Hidden media elements */}
      <video ref={videoRef} className="hidden" muted />
      <canvas ref={canvasRef} className="hidden" />

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .bg-white\\/8 { background: rgba(255,255,255,0.08); }
        .bg-white\\/6 { background: rgba(255,255,255,0.06); }
        .bg-white\\/12 { background: rgba(255,255,255,0.12); }
      `}</style>
    </>
  );
}
