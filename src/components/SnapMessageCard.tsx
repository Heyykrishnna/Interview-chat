import { useState } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Maximize2,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import {
  SNAP_PRESETS,
  type SnapAction,
  type SnapMessageMeta,
} from '../screenSnap';

interface SnapMessageCardProps {
  meta: SnapMessageMeta;
  disabled?: boolean;
  onPreviewImage: (dataUrl: string) => void;
  onRerunAction: (action: SnapAction, editedText: string) => void;
}

export function SnapMessageCard({
  meta,
  disabled = false,
  onPreviewImage,
  onRerunAction,
}: SnapMessageCardProps) {
  const [expanded, setExpanded] = useState(meta.action === 'ocr-only');
  const [copied, setCopied] = useState(false);
  const [draftText, setDraftText] = useState(meta.extractedText);

  const preset = SNAP_PRESETS.find(p => p.id === meta.action) ?? SNAP_PRESETS[0];

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(draftText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="snap-card">
      <div className="snap-card-top">
        <div className="snap-card-badge">
          <Camera className="w-3 h-3 shrink-0" />
          <span>{preset.label}</span>
        </div>
        <div className="snap-card-stats">
          {meta.darkModeInverted && <span className="snap-stat-pill">Dark OCR</span>}
          <span className="snap-stat-pill">{meta.lineCount}L</span>
          <span className="snap-stat-pill">{(meta.durationMs / 1000).toFixed(1)}s</span>
        </div>
      </div>

      <div className="snap-card-preview-row">
        <button
          type="button"
          className="snap-thumb-btn"
          onClick={() => onPreviewImage(meta.previewDataUrl)}
          title="Inspect captured screen"
        >
          <img
            src={meta.previewDataUrl}
            alt="Captured page"
            className="snap-thumb-img"
          />
          <span className="snap-thumb-zoom">
            <Maximize2 className="w-3 h-3" />
          </span>
        </button>

        <div className="snap-card-summary">
          <p className="snap-snippet-preview">
            {meta.extractedText.slice(0, 140)}
            {meta.extractedText.length > 140 ? '…' : ''}
          </p>
          <div className="snap-card-actions">
            <button
              type="button"
              className="snap-mini-btn"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              <span>{expanded ? 'Hide Text' : 'View Text'}</span>
            </button>
            <button
              type="button"
              className="snap-mini-btn"
              onClick={() => void handleCopyText()}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy OCR'}</span>
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="snap-ocr-drawer">
          <textarea
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            rows={5}
            spellCheck={false}
            className="snap-ocr-textarea"
          />
          <div className="snap-rerun-row">
            {(['solve', 'fix', 'optimize', 'explain'] as SnapAction[]).map(actionId => {
              const item = SNAP_PRESETS.find(p => p.id === actionId);
              if (!item) return null;
              return (
                <button
                  key={actionId}
                  type="button"
                  disabled={disabled || !draftText.trim()}
                  onClick={() => onRerunAction(actionId, draftText.trim())}
                  className="snap-rerun-pill"
                >
                  {actionId === 'solve' ? (
                    <Sparkles className="w-2.5 h-2.5" />
                  ) : (
                    <RotateCw className="w-2.5 h-2.5" />
                  )}
                  <span>{item.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

