import { useState, useCallback } from 'react';
import {
  X, Copy, Check, Loader2, Cpu, Database, Zap, Globe, BarChart3,
  ChevronRight, RefreshCw, ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'WS';
  endpoint: string;
  payload?: string;
  response?: string;
  description: string;
}

export interface DbColumn {
  name: string;
  type: string;
  note?: string;
}

export interface DbTable {
  table: string;
  engine: string;
  columns: DbColumn[];
  indexes?: string[];
  note?: string;
}

export interface ScalingData {
  dau: string;
  storage: string;
  bandwidth?: string;
  qps?: string;
  strategies: string[];
  technologies: string[];
  tradeoffs?: string[];
}

export interface SystemDesignData {
  system: string;
  overview: string;
  diagram: string;
  apis: ApiEndpoint[];
  database: DbTable[];
  scaling: ScalingData;
}

type WhiteboardTab = 'overview' | 'architecture' | 'apis' | 'database' | 'scale';

// ─── Quick Launch Systems ──────────────────────────────────────────────────────

const QUICK_SYSTEMS = [
  { name: 'WhatsApp',  emoji: '💬', color: '#25D366' },
  { name: 'Uber',      emoji: '🚗', color: '#000000' },
  { name: 'YouTube',   emoji: '📺', color: '#FF0000' },
  { name: 'Netflix',   emoji: '🎬', color: '#E50914' },
  { name: 'Instagram', emoji: '📷', color: '#E1306C' },
  { name: 'Twitter',   emoji: '🐦', color: '#1DA1F2' },
  { name: 'Airbnb',    emoji: '🏠', color: '#FF5A5F' },
  { name: 'Spotify',   emoji: '🎵', color: '#1DB954' },
];

const TABS: { id: WhiteboardTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',      label: 'Overview',      icon: <Globe className="w-3.5 h-3.5" /> },
  { id: 'architecture',  label: 'Architecture',  icon: <Cpu className="w-3.5 h-3.5" /> },
  { id: 'apis',          label: 'APIs',          icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'database',      label: 'Database',      icon: <Database className="w-3.5 h-3.5" /> },
  { id: 'scale',         label: 'Scale',         icon: <BarChart3 className="w-3.5 h-3.5" /> },
];

const METHOD_COLORS: Record<string, string> = {
  GET:    'method-get',
  POST:   'method-post',
  PUT:    'method-put',
  DELETE: 'method-delete',
  PATCH:  'method-patch',
  WS:     'method-ws',
};

// ─── Sub-components ────────────────────────────────────────────────────────────

function CopyButton({ text, small = false }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`wb-copy-btn ${small ? 'wb-copy-btn--sm' : ''}`}
      title="Copy to clipboard"
    >
      {copied
        ? <><Check className="w-3 h-3" />{!small && ' Copied!'}</>
        : <><Copy className="w-3 h-3" />{!small && ' Copy'}</>}
    </button>
  );
}

function SectionHeader({ title, copyText }: { title: string; copyText?: string }) {
  return (
    <div className="wb-section-header">
      <span className="wb-section-title">{title}</span>
      {copyText && <CopyButton text={copyText} small />}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="wb-loading">
      {[80, 60, 90, 55, 75].map((w, i) => (
        <div
          key={i}
          className="wb-skeleton-line"
          style={{ width: `${w}%`, animationDelay: `${i * 0.1}s` }}
        />
      ))}
      <div className="wb-loading-center">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--accent-2)]" />
        <span className="wb-loading-text">Architecting system…</span>
      </div>
    </div>
  );
}

// ─── Tab Content Panels ────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: SystemDesignData }) {
  const { overview, scaling } = data;
  return (
    <div className="wb-tab-content">
      <SectionHeader title="System Overview" copyText={overview} />
      <div className="wb-overview-text">{overview}</div>

      <div className="wb-metrics-grid">
        {[
          { label: 'Daily Active Users', value: scaling.dau,       icon: '👥' },
          { label: 'Storage Required',   value: scaling.storage,   icon: '💾' },
          { label: 'Target QPS',         value: scaling.qps ?? 'Varies', icon: '⚡' },
          { label: 'Bandwidth',          value: scaling.bandwidth ?? 'TBD', icon: '📡' },
        ].map(m => (
          <div key={m.label} className="wb-metric-card">
            <span className="wb-metric-icon">{m.icon}</span>
            <span className="wb-metric-value">{m.value}</span>
            <span className="wb-metric-label">{m.label}</span>
          </div>
        ))}
      </div>

      <SectionHeader title="Key Technologies" />
      <div className="wb-tech-tags">
        {scaling.technologies.map(tech => (
          <span key={tech} className="wb-tech-tag">{tech}</span>
        ))}
      </div>
    </div>
  );
}

function ArchitectureTab({ data }: { data: SystemDesignData }) {
  return (
    <div className="wb-tab-content">
      <SectionHeader title="System Architecture Diagram" copyText={data.diagram} />
      <div className="wb-diagram-wrap">
        <pre className="wb-diagram">{data.diagram}</pre>
      </div>
    </div>
  );
}

function ApisTab({ data }: { data: SystemDesignData }) {
  const allText = data.apis
    .map(a => `${a.method} ${a.endpoint}\n  → ${a.description}${a.payload ? `\n  Payload: ${a.payload}` : ''}`)
    .join('\n\n');

  return (
    <div className="wb-tab-content">
      <SectionHeader title="Core API Endpoints" copyText={allText} />
      <div className="wb-api-list">
        {data.apis.map((api, i) => (
          <div key={i} className="wb-api-row">
            <div className="wb-api-top">
              <span className={`wb-method ${METHOD_COLORS[api.method] ?? 'method-get'}`}>
                {api.method}
              </span>
              <code className="wb-endpoint">{api.endpoint}</code>
              <CopyButton text={`${api.method} ${api.endpoint}`} small />
            </div>
            <p className="wb-api-desc">{api.description}</p>
            {api.payload && (
              <div className="wb-api-meta">
                <span className="wb-api-meta-label">Payload:</span>
                <code className="wb-api-meta-value">{api.payload}</code>
              </div>
            )}
            {api.response && (
              <div className="wb-api-meta">
                <span className="wb-api-meta-label">Response:</span>
                <code className="wb-api-meta-value">{api.response}</code>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DatabaseTab({ data }: { data: SystemDesignData }) {
  return (
    <div className="wb-tab-content">
      <SectionHeader title="Database Schema" />
      <div className="wb-db-grid">
        {data.database.map((table, i) => (
          <div key={i} className="wb-db-card">
            <div className="wb-db-card-header">
              <div className="wb-db-table-icon">
                <Database className="w-3 h-3" />
              </div>
              <div className="wb-db-table-info">
                <span className="wb-db-table-name">{table.table}</span>
                <span className="wb-db-engine">{table.engine}</span>
              </div>
              <CopyButton
                text={`Table: ${table.table}\nEngine: ${table.engine}\n${table.columns.map(c => `  ${c.name}: ${c.type}${c.note ? ` (${c.note})` : ''}`).join('\n')}`}
                small
              />
            </div>

            {table.note && <p className="wb-db-note">{table.note}</p>}

            <div className="wb-db-columns">
              {table.columns.map((col, j) => (
                <div key={j} className="wb-db-col-row">
                  <span className="wb-col-name">{col.name}</span>
                  <span className="wb-col-type">{col.type}</span>
                  {col.note && <span className="wb-col-note">{col.note}</span>}
                </div>
              ))}
            </div>

            {table.indexes && table.indexes.length > 0 && (
              <div className="wb-db-indexes">
                <span className="wb-db-indexes-label">Indexes:</span>
                {table.indexes.map((idx, j) => (
                  <span key={j} className="wb-db-index-tag">{idx}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScaleTab({ data }: { data: SystemDesignData }) {
  const { scaling } = data;
  return (
    <div className="wb-tab-content">
      <SectionHeader title="Scaling Strategies" />
      <div className="wb-scale-list">
        {scaling.strategies.map((s, i) => (
          <div key={i} className="wb-scale-item">
            <ChevronRight className="w-3.5 h-3.5 text-[var(--accent-2)] shrink-0 mt-0.5" />
            <span>{s}</span>
          </div>
        ))}
      </div>

      {scaling.tradeoffs && scaling.tradeoffs.length > 0 && (
        <>
          <SectionHeader title="Trade-offs" />
          <div className="wb-tradeoffs">
            {scaling.tradeoffs.map((t, i) => (
              <div key={i} className="wb-tradeoff-item">
                <span className="wb-tradeoff-bullet">⚖️</span>
                <span>{t}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionHeader title="Technology Stack" />
      <div className="wb-tech-tags">
        {scaling.technologies.map(tech => (
          <span key={tech} className="wb-tech-tag">{tech}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface SystemDesignWhiteboardProps {
  open: boolean;
  loading: boolean;
  data: SystemDesignData | null;
  onClose: () => void;
  onDesign: (system: string) => void;
}

export function SystemDesignWhiteboard({
  open, loading, data, onClose, onDesign,
}: SystemDesignWhiteboardProps) {
  const [activeTab, setActiveTab] = useState<WhiteboardTab>('overview');
  const [customInput, setCustomInput] = useState('');

  const handleCustomDesign = useCallback(() => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    onDesign(trimmed);
    setCustomInput('');
  }, [customInput, onDesign]);

  const handleChipClick = useCallback((name: string) => {
    onDesign(name);
    setActiveTab('overview');
  }, [onDesign]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="wb-panel"
          onMouseDown={e => e.stopPropagation()}
        >
          {/* ── Header ─────────────────────────────── */}
          <div className="wb-header">
            <div className="wb-header-left">
              <div className="wb-header-icon">
                <Cpu className="w-3.5 h-3.5" />
              </div>
              <div>
                <p className="wb-header-title">
                  System Design Whiteboard
                  {data && <span className="wb-header-system"> — {data.system}</span>}
                </p>
                <p className="wb-header-sub">Architecture · APIs · Database · Scale</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {data && !loading && (
                <button
                  type="button"
                  className="wb-action-btn"
                  onClick={() => onDesign(data.system)}
                  title="Regenerate"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                className="settings-close-btn"
                onClick={onClose}
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ── Quick-launch chips ──────────────────── */}
          <div className="wb-chips-row">
            {QUICK_SYSTEMS.map(sys => (
              <button
                key={sys.name}
                type="button"
                className={`wb-chip ${data?.system === sys.name && !loading ? 'wb-chip--active' : ''}`}
                onClick={() => handleChipClick(sys.name)}
                disabled={loading}
                title={`Design ${sys.name}`}
              >
                <span>{sys.name}</span>
              </button>
            ))}
          </div>

          {/* ── Custom input ────────────────────────── */}
          <div className="wb-custom-row">
            <input
              type="text"
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCustomDesign(); }}
              placeholder='Or type any system… e.g. "Design TikTok"'
              className="wb-custom-input"
              disabled={loading}
            />
            <button
              type="button"
              className="wb-custom-btn"
              onClick={handleCustomDesign}
              disabled={!customInput.trim() || loading}
              title="Generate Design"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* ── Content ─────────────────────────────── */}
          {loading ? (
            <LoadingSkeleton />
          ) : data ? (
            <>
              {/* Tabs */}
              <div className="wb-tabs">
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`wb-tab ${activeTab === tab.id ? 'wb-tab--active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Tab Body */}
              <div className="wb-body">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    style={{ height: '100%' }}
                  >
                    {activeTab === 'overview'     && <OverviewTab     data={data} />}
                    {activeTab === 'architecture' && <ArchitectureTab data={data} />}
                    {activeTab === 'apis'         && <ApisTab         data={data} />}
                    {activeTab === 'database'     && <DatabaseTab     data={data} />}
                    {activeTab === 'scale'        && <ScaleTab        data={data} />}
                  </motion.div>
                </AnimatePresence>
              </div>
            </>
          ) : (
            <div className="wb-empty">
              <div className="wb-empty-icon">🏗️</div>
              <p className="wb-empty-title">Design any system at scale</p>
              <p className="wb-empty-sub">
                Click a chip above or type a system name to generate a complete
                architecture — diagrams, APIs, schemas, and scaling strategies.
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
