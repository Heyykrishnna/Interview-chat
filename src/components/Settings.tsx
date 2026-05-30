import { useEffect } from 'react';
import { X, Palette, Type, Layout, Sliders, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Theme =
  | 'dark-blue'
  | 'dark-purple'
  | 'dark-slate'
  | 'midnight'
  | 'forest'
  | 'rose'
  | 'amber';

export type FontFamily = 'plus-jakarta' | 'inter' | 'outfit' | 'geist' | 'mono';
export type Section = 'appearance' | 'typography' | 'layout' | 'advanced';

export interface AppSettings {
  theme: Theme;
  bgOpacity: number;        // 0–1 (0 = fully transparent)
  blurStrength: number;     // 0–40 px
  fontSize: number;         // 11–18 px
  fontFamily: FontFamily;
  messageSpacing: 'compact' | 'normal' | 'relaxed';
  showTimestamps: boolean;
  showAvatars: boolean;
  compactMode: boolean;
  roundness: 'sharp' | 'normal' | 'round';
  accentColor: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark-blue',
  bgOpacity: 0.72,
  blurStrength: 20,
  fontSize: 13,
  fontFamily: 'plus-jakarta',
  messageSpacing: 'normal',
  showTimestamps: false,
  showAvatars: true,
  compactMode: false,
  roundness: 'round',
  accentColor: '#2563eb',
};

// ─── Theme & Font Definitions ─────────────────────────────────────────────────

const THEMES: { id: Theme; label: string; bg: string; accent: string; dot: string }[] = [
  { id: 'dark-blue',   label: 'Ocean',    bg: 'rgba(15,23,42,0.9)',   accent: '#2563eb', dot: '#3b82f6' },
  { id: 'dark-purple', label: 'Violet',   bg: 'rgba(20,10,40,0.9)',   accent: '#7c3aed', dot: '#a78bfa' },
  { id: 'dark-slate',  label: 'Slate',    bg: 'rgba(18,22,30,0.9)',   accent: '#0891b2', dot: '#22d3ee' },
  { id: 'midnight',    label: 'Midnight', bg: 'rgba(8,10,18,0.9)',    accent: '#6366f1', dot: '#818cf8' },
  { id: 'forest',      label: 'Forest',   bg: 'rgba(10,22,15,0.9)',   accent: '#059669', dot: '#34d399' },
  { id: 'rose',        label: 'Rose',     bg: 'rgba(25,10,15,0.9)',   accent: '#e11d48', dot: '#fb7185' },
  { id: 'amber',       label: 'Amber',    bg: 'rgba(22,16,5,0.9)',    accent: '#d97706', dot: '#fbbf24' },
];

const FONTS: { id: FontFamily; label: string; stack: string }[] = [
  { id: 'plus-jakarta', label: 'Plus Jakarta Sans', stack: '"Plus Jakarta Sans", system-ui, sans-serif' },
  { id: 'inter',        label: 'Inter',              stack: '"Inter", system-ui, sans-serif' },
  { id: 'outfit',       label: 'Outfit',             stack: '"Outfit", system-ui, sans-serif' },
  { id: 'geist',        label: 'Geist',              stack: '"Geist", system-ui, sans-serif' },
  { id: 'mono',         label: 'JetBrains Mono',     stack: '"JetBrains Mono", "Fira Code", monospace' },
];

// ─── CSS Variable Injection ───────────────────────────────────────────────────

export function applySettings(s: AppSettings) {
  const theme = THEMES.find(t => t.id === s.theme) ?? THEMES[0];
  const font  = FONTS.find(f => f.id === s.fontFamily) ?? FONTS[0];

  const opacity = Math.max(0.05, Math.min(1, s.bgOpacity));
  const bgRgb   = theme.bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  const r = bgRgb ? bgRgb[1] : '15';
  const g = bgRgb ? bgRgb[2] : '23';
  const b = bgRgb ? bgRgb[3] : '42';

  const accentRgb = hexToRgb(s.accentColor);
  const root = document.documentElement;
  const blurVal = `blur(${s.blurStrength}px) saturate(1.2)`;
  const radiusMap = { sharp: '8px', normal: '16px', round: '24px' } as const;

  // ── CSS Variables ─────────────────────────────────────────
  root.style.setProperty('--panel-bg',        `rgba(${r},${g},${b},${opacity})`);
  root.style.setProperty('--title-bar-bg',    `rgba(${r},${g},${b},${Math.max(0.05, opacity - 0.25)})`);
  root.style.setProperty('--panel-border',    `rgba(255,255,255,${0.06 + opacity * 0.06})`);
  root.style.setProperty('--accent',          s.accentColor);
  root.style.setProperty('--accent-hover',    shadeHex(s.accentColor, -20));
  root.style.setProperty('--accent-muted',    accentRgb ? `rgba(${accentRgb},0.15)` : 'rgba(37,99,235,0.15)');
  root.style.setProperty('--accent-2',        theme.dot);
  root.style.setProperty('--user-bubble',     s.accentColor);
  root.style.setProperty('--font-sans',       font.stack);
  root.style.setProperty('--font-size-base',  `${s.fontSize}px`);
  root.style.setProperty('--panel-radius',    radiusMap[s.roundness]);
  root.style.setProperty('--msg-spacing',     { compact: '10px', normal: '16px', relaxed: '22px' }[s.messageSpacing]);
  root.style.setProperty('--backdrop-filter', blurVal);

  // ── Direct DOM overrides (vars alone not enough in some contexts) ──
  // Font family — force onto body so all elements inherit it
  document.body.style.fontFamily = font.stack;

  // Blur — force directly onto every .copilot-panel element
  document.querySelectorAll<HTMLElement>('.copilot-panel').forEach(el => {
    el.style.backdropFilter = blurVal;
    (el.style as unknown as Record<string,string>)['-webkit-backdrop-filter'] = blurVal;
    el.style.background = `rgba(${r},${g},${b},${opacity})`;
    el.style.borderRadius = radiusMap[s.roundness];
  });

  // Border-radius — also force collapsed bar
  document.querySelectorAll<HTMLElement>('.collapsed-bar').forEach(el => {
    el.style.backdropFilter = blurVal;
    (el.style as unknown as Record<string,string>)['-webkit-backdrop-filter'] = blurVal;
    el.style.background = `rgba(${r},${g},${b},${opacity})`;
  });
}

function hexToRgb(hex: string): string | null {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function shadeHex(hex: string, amount: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const clamp = (x: number) => Math.max(0, Math.min(255, x));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8)  & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'copilot-settings-v1';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) as Partial<AppSettings> };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

// ─── Settings Panel Component ─────────────────────────────────────────────────

interface SettingsPanelProps {
  open: boolean;
  settings: AppSettings;
  activeSection: Section;
  onSectionChange: (s: Section) => void;
  onClose: () => void;
  onChange: (s: AppSettings) => void;
  onReset: () => void;
}

export function SettingsPanel({
  open, settings, activeSection, onSectionChange, onClose, onChange, onReset,
}: SettingsPanelProps) {

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: 'appearance', label: 'Appearance', icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'typography', label: 'Typography', icon: <Type className="w-3.5 h-3.5" /> },
    { id: 'layout',     label: 'Layout',     icon: <Layout className="w-3.5 h-3.5" /> },
    { id: 'advanced',   label: 'Advanced',   icon: <Sliders className="w-3.5 h-3.5" /> },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="settings-panel"
          onMouseDown={e => e.stopPropagation()}
        >
          {/* ── Header ─────────────────────────────────── */}
          <div className="settings-header">
            <div className="settings-title">
              <div className="settings-title-icon">
                <Sliders className="w-3.5 h-3.5" />
              </div>
              <span>Settings</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={onReset} className="settings-reset-btn" title="Reset to defaults">
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
              <button type="button" onClick={onClose} className="settings-close-btn" title="Close">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ── Section tabs ────────────────────────────── */}
          <div className="settings-tabs">
            {SECTIONS.map(sec => (
              <button
                key={sec.id}
                type="button"
                className={`settings-tab ${activeSection === sec.id ? 'settings-tab--active' : ''}`}
                onClick={() => onSectionChange(sec.id)}
              >
                {sec.icon}
                {sec.label}
              </button>
            ))}
          </div>

          {/* ── Body ────────────────────────────────────── */}
          <div className="settings-body">

            {/* APPEARANCE */}
            {activeSection === 'appearance' && (
              <div className="settings-section-content">
                <SettingsGroup label="Color Theme">
                  <div className="theme-grid">
                    {THEMES.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        title={t.label}
                        className={`theme-swatch ${settings.theme === t.id ? 'theme-swatch--active' : ''}`}
                        onClick={() => set('theme', t.id)}
                        style={{ background: t.bg }}
                      >
                        <span className="theme-dot" style={{ background: t.dot }} />
                        <span className="theme-swatch-label">{t.label}</span>
                        {settings.theme === t.id && <span className="theme-check">✓</span>}
                      </button>
                    ))}
                  </div>
                </SettingsGroup>

                <SettingsGroup label="Accent Color">
                  <div className="accent-row">
                    {['#2563eb','#7c3aed','#0891b2','#059669','#e11d48','#d97706','#ec4899'].map(c => (
                      <button
                        key={c}
                        type="button"
                        className={`accent-swatch ${settings.accentColor === c ? 'accent-swatch--active' : ''}`}
                        style={{ background: c }}
                        onClick={() => set('accentColor', c)}
                        title={c}
                      />
                    ))}
                    <label className="accent-custom" title="Pick custom color">
                      <input
                        type="color"
                        value={settings.accentColor}
                        onChange={e => set('accentColor', e.target.value)}
                        className="accent-color-input"
                      />
                      <span className="accent-custom-label">Custom</span>
                    </label>
                  </div>
                </SettingsGroup>

                <SettingsGroup label={`Background Opacity — ${Math.round(settings.bgOpacity * 100)}%`}>
                  <RangeInput
                    value={settings.bgOpacity} min={0.05} max={1} step={0.01}
                    onChange={v => set('bgOpacity', v)}
                    leftLabel="Transparent" rightLabel="Solid"
                  />
                </SettingsGroup>

                <SettingsGroup label={`Blur Strength — ${settings.blurStrength}px`}>
                  <RangeInput
                    value={settings.blurStrength} min={0} max={40} step={1}
                    onChange={v => set('blurStrength', v)}
                    leftLabel="None" rightLabel="Heavy"
                  />
                </SettingsGroup>

                <SettingsGroup label="Panel Corners">
                  <SegmentedControl
                    options={[
                      { value: 'sharp',  label: 'Sharp' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'round',  label: 'Round' },
                    ]}
                    value={settings.roundness}
                    onChange={v => set('roundness', v as AppSettings['roundness'])}
                  />
                </SettingsGroup>
              </div>
            )}

            {/* TYPOGRAPHY */}
            {activeSection === 'typography' && (
              <div className="settings-section-content">
                <SettingsGroup label="Font Family">
                  <div className="font-list">
                    {FONTS.map(f => (
                      <button
                        key={f.id}
                        type="button"
                        className={`font-option ${settings.fontFamily === f.id ? 'font-option--active' : ''}`}
                        style={{ fontFamily: f.stack }}
                        onClick={() => set('fontFamily', f.id)}
                      >
                        <span className="font-name">{f.label}</span>
                        <span className="font-preview">Aa 0Oo</span>
                        {settings.fontFamily === f.id && <span className="font-check">✓</span>}
                      </button>
                    ))}
                  </div>
                </SettingsGroup>

                <SettingsGroup label={`Font Size — ${settings.fontSize}px`}>
                  <RangeInput
                    value={settings.fontSize} min={11} max={18} step={1}
                    onChange={v => set('fontSize', v)}
                    leftLabel="Tiny" rightLabel="Large"
                  />
                  <div className="font-size-preview" style={{ fontSize: settings.fontSize }}>
                    The quick brown fox jumps over the lazy dog.
                  </div>
                </SettingsGroup>
              </div>
            )}

            {/* LAYOUT */}
            {activeSection === 'layout' && (
              <div className="settings-section-content">
                <SettingsGroup label="Message Spacing">
                  <SegmentedControl
                    options={[
                      { value: 'compact',  label: 'Compact' },
                      { value: 'normal',   label: 'Normal' },
                      { value: 'relaxed',  label: 'Relaxed' },
                    ]}
                    value={settings.messageSpacing}
                    onChange={v => set('messageSpacing', v as AppSettings['messageSpacing'])}
                  />
                </SettingsGroup>

                <SettingsGroup label="Interface">
                  <div className="toggle-list">
                    <ToggleRow
                      label="Show message avatars"
                      description="Display AI avatar icon next to responses"
                      checked={settings.showAvatars}
                      onChange={v => set('showAvatars', v)}
                    />
                    <ToggleRow
                      label="Compact mode"
                      description="Reduce padding for a denser layout"
                      checked={settings.compactMode}
                      onChange={v => set('compactMode', v)}
                    />
                    <ToggleRow
                      label="Show timestamps"
                      description="Display time next to each message"
                      checked={settings.showTimestamps}
                      onChange={v => set('showTimestamps', v)}
                    />
                  </div>
                </SettingsGroup>
              </div>
            )}

            {/* ADVANCED */}
            {activeSection === 'advanced' && (
              <div className="settings-section-content">
                <SettingsGroup label="About">
                  <div className="about-card">
                    {[
                      { k: 'Version',  v: '1.0.0' },
                      { k: 'Engine',   v: 'Groq · LLaMA 3.3 70B' },
                      { k: 'OCR',      v: 'Tesseract.js' },
                      { k: 'Platform', v: 'Electron + React' },
                    ].map(row => (
                      <div key={row.k} className="about-row">
                        <span className="about-key">{row.k}</span>
                        <span className="about-val">{row.v}</span>
                      </div>
                    ))}
                  </div>
                </SettingsGroup>

                <SettingsGroup label="Keyboard Shortcuts">
                  <div className="shortcuts-list">
                    {[
                      { keys: ['⌘', '⇧', 'Space'], action: 'Toggle hide/show' },
                      { keys: ['⌘', '⇧', 'G'],     action: 'Ghost mode (click-through)' },
                      { keys: ['Enter'],             action: 'Send message' },
                      { keys: ['Esc'],               action: 'Close settings' },
                    ].map(sc => (
                      <div key={sc.action} className="shortcut-row">
                        <span className="shortcut-action">{sc.action}</span>
                        <div className="shortcut-keys">
                          {sc.keys.map(k => <kbd key={k} className="kbd">{k}</kbd>)}
                        </div>
                      </div>
                    ))}
                  </div>
                </SettingsGroup>

                <SettingsGroup label="Danger Zone">
                  <button type="button" className="danger-btn" onClick={onReset}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                    Reset all settings to defaults
                  </button>
                </SettingsGroup>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-group">
      <p className="settings-group-label">{label}</p>
      {children}
    </div>
  );
}

interface RangeInputProps {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
  leftLabel?: string; rightLabel?: string;
}
function RangeInput({ value, min, max, step, onChange, leftLabel, rightLabel }: RangeInputProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="range-wrap">
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="range-input"
        style={{ '--range-pct': `${pct}%` } as React.CSSProperties}
      />
      {(leftLabel || rightLabel) && (
        <div className="range-labels">
          {leftLabel && <span>{leftLabel}</span>}
          {rightLabel && <span>{rightLabel}</span>}
        </div>
      )}
    </div>
  );
}

interface SegmentedOption { value: string; label: string }
function SegmentedControl({ options, value, onChange }: {
  options: SegmentedOption[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className={`segmented-btn ${value === o.value ? 'segmented-btn--active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-text">
        <span className="toggle-label">{label}</span>
        <span className="toggle-desc">{description}</span>
      </div>
      <button
        type="button" role="switch" aria-checked={checked}
        className={`toggle-switch ${checked ? 'toggle-switch--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}
