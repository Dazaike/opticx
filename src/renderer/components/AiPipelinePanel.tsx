import React from 'react';
import { AlertTriangle, RotateCcw, Cpu } from 'lucide-react';
import {
  PipelineHud,
  PipelineRisk,
  PipelineSettings,
  PipelineStageId,
  SuperResScale
} from '../../shared/types';

interface AiPipelinePanelProps {
  pipeline: PipelineSettings;
  hud: PipelineHud;
  sourceWidth: number;
  sourceHeight: number;
  safeMode: boolean;
  onChange: (next: Partial<PipelineSettings>) => void;
  onPanicReset: () => void;
  onUseAiResolution: () => void;
}

const SCALES: SuperResScale[] = [1.33, 1.5, 2, 3, 4];

function stageRisk(
  id: PipelineStageId,
  pipeline: PipelineSettings,
  sourceWidth: number,
  sourceHeight: number
): PipelineRisk {
  const is4k = sourceWidth * sourceHeight > 1920 * 1080;
  const enabled =
    id === 'artifactReduction'
      ? pipeline.artifactReduction.enabled
      : id === 'denoise'
        ? pipeline.denoise.enabled
        : id === 'superRes'
          ? pipeline.superRes.enabled
          : id === 'fastUpscale'
            ? pipeline.fastUpscale.enabled
            : id === 'rife'
              ? pipeline.rife.enabled
              : pipeline.fsr.enabled;
  if (!enabled) return 'green';
  if ((id === 'artifactReduction' || id === 'denoise' || id === 'superRes' || id === 'rife') && is4k) {
    return 'red';
  }
  if (id === 'rife' || id === 'superRes' || (id === 'fastUpscale' && is4k)) return 'amber';
  if (id === 'artifactReduction' || id === 'denoise') return 'amber';
  return 'green';
}

const RISK_DOT: Record<PipelineRisk, string> = {
  green: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]',
  amber: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]',
  red: 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]'
};

const StageToggle: React.FC<{
  id: PipelineStageId;
  label: string;
  enabled: boolean;
  risk: PipelineRisk;
  costMs: number;
  error?: string;
  warning?: string;
  onToggle: () => void;
  children?: React.ReactNode;
}> = ({ id, label, enabled, risk, costMs, error, warning, onToggle, children }) => {
  const showRedWarning = enabled && risk === 'red';
  return (
    <div className="space-y-1.5 bg-black/40 p-2.5 rounded-lg border border-white/[0.06]">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 min-w-0 text-left"
          title={id}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${RISK_DOT[risk]}`} />
          <span className="text-xs font-medium text-neutral-200 truncate">{label}</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {enabled && costMs > 0 && (
            <span className="text-[10px] font-mono text-neutral-400">{costMs.toFixed(1)} ms</span>
          )}
          <button
            onClick={onToggle}
            className={`w-9 h-5 rounded-full border transition-colors relative ${
              enabled ? 'bg-white border-white' : 'bg-neutral-800 border-white/10'
            }`}
            aria-pressed={enabled}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                enabled ? 'right-0.5 bg-black' : 'left-0.5 bg-neutral-400'
              }`}
            />
          </button>
        </div>
      </div>
      {showRedWarning && (
        <div className="flex items-start gap-1.5 text-[10px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>may drop frames / may fail — attempting anyway</span>
        </div>
      )}
      {warning && !error && (
        <div className="text-[10px] text-amber-200/90 font-mono">{warning}</div>
      )}
      {error && (
        <div className="text-[10px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1 font-mono break-all">
          {error}
        </div>
      )}
      {enabled && children}
    </div>
  );
};

export const AiPipelinePanel: React.FC<AiPipelinePanelProps> = ({
  pipeline,
  hud,
  sourceWidth,
  sourceHeight,
  safeMode,
  onChange,
  onPanicReset,
  onUseAiResolution
}) => {
  const riskOf = (id: PipelineStageId): PipelineRisk =>
    stageRisk(id, pipeline, sourceWidth, sourceHeight);
  const is4k = sourceWidth * sourceHeight > 1920 * 1080;

  return (
    <div className="space-y-3.5 animate-tab-enter">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
          AI Pipeline
        </span>
        <button
          onClick={onPanicReset}
          className="flex items-center gap-1 text-[10px] font-mono text-neutral-400 hover:text-white uppercase tracking-wider transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Panic reset
        </button>
      </div>

      {safeMode && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>Safe mode — previous launch crashed. AI stages stay off until you enable them.</span>
        </div>
      )}

      {hud.fxError && (
        <div className="text-[10px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5 font-mono break-all">
          {hud.fxError}
        </div>
      )}

      {is4k && (
        <div className="space-y-1.5 text-[10px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              Source is {sourceWidth}x{sourceHeight}. Maxine caps AI input at 1080p, so
              Artifact Reduction, Denoise, Super Resolution and RIFE will fail and switch
              themselves back off. FSR/RCAS still works at 4K.
            </span>
          </div>
          <button
            onClick={onUseAiResolution}
            className="w-full py-1.5 rounded bg-white text-black text-[10px] font-semibold hover:bg-neutral-200 transition-colors"
          >
            Switch source to 1080p for AI
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono bg-black/40 p-2.5 rounded-lg border border-white/[0.06]">
        <HudChip label="SRC" value={`${hud.sourceFps.toFixed(0)} fps`} />
        <HudChip label="OUT" value={`${hud.outputFps.toFixed(0)} fps`} />
        <HudChip label="GPU" value={`${hud.totalGpuMs.toFixed(1)} ms`} />
        <HudChip label="E2E" value={`${hud.e2eLatencyMs.toFixed(0)} ms`} />
        <HudChip label="DROP" value={String(hud.droppedFrames)} />
        <HudChip
          label="FX"
          value={hud.fxReady ? 'ready' : hud.rifeModelReady ? 'rife' : 'off'}
        />
      </div>

      <StageToggle
        id="fsr"
        label="FSR / RCAS"
        enabled={pipeline.fsr.enabled}
        risk={riskOf('fsr')}
        costMs={hud.stageMs.fsr}
        error={hud.errors.fsr}
        onToggle={() => onChange({ fsr: { enabled: !pipeline.fsr.enabled } })}
      />

      <StageToggle
        id="artifactReduction"
        label="Artifact Reduction"
        enabled={pipeline.artifactReduction.enabled}
        risk={riskOf('artifactReduction')}
        costMs={hud.stageMs.artifactReduction}
        error={hud.errors.artifactReduction}
        warning={pipeline.artifactReduction.enabled && !hud.fxReady ? 'Maxine FX worker not ready' : undefined}
        onToggle={() =>
          onChange({
            artifactReduction: {
              ...pipeline.artifactReduction,
              enabled: !pipeline.artifactReduction.enabled
            }
          })
        }
      >
        <ModeSwitch
          value={pipeline.artifactReduction.mode}
          onChange={(mode) => onChange({ artifactReduction: { ...pipeline.artifactReduction, mode } })}
        />
      </StageToggle>

      <StageToggle
        id="denoise"
        label="Denoise"
        enabled={pipeline.denoise.enabled}
        risk={riskOf('denoise')}
        costMs={hud.stageMs.denoise}
        error={hud.errors.denoise}
        warning={pipeline.denoise.enabled && !hud.fxReady ? 'Maxine FX worker not ready' : undefined}
        onToggle={() =>
          onChange({ denoise: { ...pipeline.denoise, enabled: !pipeline.denoise.enabled } })
        }
      >
        <div className="flex items-center justify-between text-[10px] text-neutral-400">
          <span>Strength</span>
          <div className="grid grid-cols-2 gap-1 bg-black/40 p-0.5 rounded border border-white/[0.06]">
            <button
              onClick={() => onChange({ denoise: { ...pipeline.denoise, strength: 0 } })}
              className={`px-2 py-0.5 rounded ${pipeline.denoise.strength === 0 ? 'bg-white text-black' : 'text-neutral-400'}`}
            >
              con
            </button>
            <button
              onClick={() => onChange({ denoise: { ...pipeline.denoise, strength: 1 } })}
              className={`px-2 py-0.5 rounded ${pipeline.denoise.strength === 1 ? 'bg-white text-black' : 'text-neutral-400'}`}
            >
              agg
            </button>
          </div>
        </div>
      </StageToggle>

      <StageToggle
        id="rife"
        label="RIFE 2x"
        enabled={pipeline.rife.enabled}
        risk={riskOf('rife')}
        costMs={hud.stageMs.rife}
        error={hud.errors.rife}
        warning={pipeline.rife.enabled && !hud.rifeModelReady ? 'model not downloaded' : undefined}
        onToggle={() => onChange({ rife: { ...pipeline.rife, enabled: !pipeline.rife.enabled } })}
      >
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-neutral-400">
            <span>Interp sensitivity</span>
            <span className="font-mono text-neutral-200">{pipeline.rife.sensitivity.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.05}
            max={0.8}
            step={0.01}
            value={pipeline.rife.sensitivity}
            onChange={(e) =>
              onChange({ rife: { ...pipeline.rife, sensitivity: parseFloat(e.target.value) } })
            }
            className="studio-slider"
          />
        </div>
      </StageToggle>

      <StageToggle
        id="superRes"
        label="Super Resolution"
        enabled={pipeline.superRes.enabled}
        risk={riskOf('superRes')}
        costMs={hud.stageMs.superRes}
        error={hud.errors.superRes}
        warning={pipeline.superRes.enabled && !hud.fxReady ? 'Maxine FX worker not ready' : undefined}
        onToggle={() =>
          onChange({ superRes: { ...pipeline.superRes, enabled: !pipeline.superRes.enabled } })
        }
      >
        <ModeSwitch
          value={pipeline.superRes.mode}
          onChange={(mode) => onChange({ superRes: { ...pipeline.superRes, mode } })}
        />
        <ScaleSwitch
          value={pipeline.superRes.scale}
          onChange={(scale) => onChange({ superRes: { ...pipeline.superRes, scale } })}
        />
      </StageToggle>

      <StageToggle
        id="fastUpscale"
        label="Fast Upscale"
        enabled={pipeline.fastUpscale.enabled}
        risk={riskOf('fastUpscale')}
        costMs={hud.stageMs.upscale}
        error={hud.errors.fastUpscale}
        warning={pipeline.fastUpscale.enabled && !hud.fxReady ? 'Maxine FX worker not ready' : undefined}
        onToggle={() =>
          onChange({
            fastUpscale: { ...pipeline.fastUpscale, enabled: !pipeline.fastUpscale.enabled }
          })
        }
      >
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-neutral-400">
            <span>Strength</span>
            <span className="font-mono text-neutral-200">
              {pipeline.fastUpscale.strength.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={pipeline.fastUpscale.strength}
            onChange={(e) =>
              onChange({
                fastUpscale: { ...pipeline.fastUpscale, strength: parseFloat(e.target.value) }
              })
            }
            className="studio-slider"
          />
        </div>
        <ScaleSwitch
          value={pipeline.fastUpscale.scale}
          onChange={(scale) => onChange({ fastUpscale: { ...pipeline.fastUpscale, scale } })}
        />
      </StageToggle>

      <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
        <Cpu className="w-3 h-3" />
        <span>Maxine stays on the installed local runtime. Nothing is bundled.</span>
      </div>
    </div>
  );
};

const HudChip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-neutral-500">{label}</span>
    <span className="text-neutral-200">{value}</span>
  </div>
);

const ModeSwitch: React.FC<{
  value: 'con' | 'agg';
  onChange: (mode: 'con' | 'agg') => void;
}> = ({ value, onChange }) => (
  <div className="flex items-center justify-between text-[10px] text-neutral-400">
    <span>Mode</span>
    <div className="grid grid-cols-2 gap-1 bg-black/40 p-0.5 rounded border border-white/[0.06]">
      <button
        onClick={() => onChange('con')}
        className={`px-2 py-0.5 rounded ${value === 'con' ? 'bg-white text-black' : 'text-neutral-400'}`}
      >
        con
      </button>
      <button
        onClick={() => onChange('agg')}
        className={`px-2 py-0.5 rounded ${value === 'agg' ? 'bg-white text-black' : 'text-neutral-400'}`}
      >
        agg
      </button>
    </div>
  </div>
);

const ScaleSwitch: React.FC<{
  value: SuperResScale;
  onChange: (scale: SuperResScale) => void;
}> = ({ value, onChange }) => (
  <div className="flex flex-wrap gap-1 pt-1">
    {SCALES.map((scale) => (
      <button
        key={scale}
        onClick={() => onChange(scale)}
        className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
          value === scale
            ? 'bg-white text-black border-white'
            : 'text-neutral-400 border-white/10 hover:text-white'
        }`}
      >
        {scale}x
      </button>
    ))}
  </div>
);
