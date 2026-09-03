import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Camera,
  Battery,
  BatteryCharging,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Copy,
  Clipboard,
  Zap,
  Focus,
  RefreshCw,
  Layers,
  Trash2,
  Eye,
  EyeOff,
  Video,
  VideoOff,
  Settings2,
  Sparkles,
  Move,
  ChevronDown,
  ArrowDown,
  Cpu
} from 'lucide-react';
import {
  FilterSettings,
  TransformSettings,
  BatteryInfo,
  OverlayItem,
  OverlayFilters,
  PipelineSettings,
  PipelineHud
} from '../../shared/types';
import opticxIcon from '../../assets/opticx-icon.png';
import { AiPipelinePanel } from './AiPipelinePanel';
import { CustomSelect } from './CustomSelect';

interface ControlPanelProps {
  phoneName: string;
  battery: BatteryInfo | null;
  batteryTrend: 'up' | 'down' | 'none';
  isConnected: boolean;
  filters: FilterSettings;
  transform: TransformSettings;
  overlays: OverlayItem[];
  resolution: string;
  onResolutionChange: (res: string) => void;
  switchingRes: string | null;
  fps: 30 | 60;
  onFpsChange: (fps: 30 | 60) => void;
  zoom: number;
  zoomRange: { min: number; max: number };
  ev: number;
  evRange: { min: number; max: number };
  torch: boolean;
  activeCamera: number;
  cameras: Array<{ id: number; name: string }>;
  onConnect: () => void;
  onDisconnect: () => void;
  onFilterChange: (filters: Partial<FilterSettings>) => void;
  onResetFilters: () => void;
  onTransformChange: (transform: Partial<TransformSettings>) => void;
  onResetTransform: () => void;
  onSnapCenter: () => void;
  onZoomChange: (val: number) => void;
  onEvChange: (val: number) => void;
  onTorchToggle: () => void;
  onAutofocus: () => void;
  onCameraChange: (camId: number) => void;
  onCaptureScreenshot: () => void;
  vcamActive: boolean;
  vcamFrames: number;
  vcamError: string | null;
  onVcamToggle: () => void;
  onOverlayUpdate: (id: string, update: Partial<OverlayItem>) => void;
  onOverlayDelete: (id: string) => void;
  selectedOverlayId: string | null;
  onOverlaySelect: (id: string | null) => void;
  focusOverlaysSignal: number;
  pipeline: PipelineSettings;
  pipelineHud: PipelineHud;
  sourceWidth: number;
  sourceHeight: number;
  pipelineSafeMode: boolean;
  onPipelineChange: (next: Partial<PipelineSettings>) => void;
  onPanicReset: () => void;
}

type TabType = 'camera' | 'filters' | 'transform' | 'overlays' | 'ai';
export const ControlPanel: React.FC<ControlPanelProps> = ({
  phoneName,
  battery,
  batteryTrend,
  isConnected,
  filters,
  transform,
  overlays,
  resolution,
  onResolutionChange,
  switchingRes,
  fps,
  onFpsChange,
  zoom,
  zoomRange,
  ev,
  evRange,
  torch,
  activeCamera,
  cameras,
  onConnect,
  onDisconnect,
  onFilterChange,
  onResetFilters,
  onTransformChange,
  onResetTransform,
  onSnapCenter,
  onZoomChange,
  onEvChange,
  onTorchToggle,
  onAutofocus,
  onCameraChange,
  onCaptureScreenshot,
  vcamActive,
  vcamFrames,
  vcamError,
  onVcamToggle,
  onOverlayUpdate,
  onOverlayDelete,
  selectedOverlayId,
  onOverlaySelect,
  focusOverlaysSignal,
  pipeline,
  pipelineHud,
  sourceWidth,
  sourceHeight,
  pipelineSafeMode,
  onPipelineChange,
  onPanicReset
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('camera');

  useEffect(() => {
    if (focusOverlaysSignal > 0) setActiveTab('overlays');
  }, [focusOverlaysSignal]);

  const copyTransformJson = () => {
    navigator.clipboard.writeText(JSON.stringify(transform, null, 2));
  };

  const pasteTransformJson = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      onTransformChange(parsed);
    } catch (e) {
      console.warn('Failed to parse transform from clipboard', e);
    }
  };

  return (
    <aside className="w-80 glass-panel border-l border-white/[0.08] flex flex-col h-full text-neutral-200 select-none z-20 transition-all duration-300 ease-out">
      {/* Monochrome Brand Header */}
      <div className="p-4 pb-3 border-b border-white/[0.08] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg overflow-hidden border border-white/20 flex items-center justify-center bg-black/60 shadow-inner transition-transform duration-200 hover:scale-105">
              <img src={opticxIcon} alt="OpticX" className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-bold text-sm tracking-tight text-white font-mono">Optic X Studio</span>
                <span className="text-[9px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-neutral-300 border border-white/10 font-semibold">
                  PRO
                </span>
              </div>
              <span className="text-[10px] text-neutral-500 font-mono tracking-widest">
                STUDIO • 4K
              </span>
            </div>
          </div>

          {battery && (
            <div
              className={`flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-full border transition-colors ${
                battery.level <= 20
                  ? 'bg-red-600 text-white border-red-400'
                  : batteryTrend === 'up' || battery.charging
                    ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40'
                    : 'text-neutral-300 bg-white/[0.05] border-white/10'
              }`}
            >
              {battery.charging || batteryTrend === 'up' ? (
                <BatteryCharging className="w-3.5 h-3.5" />
              ) : (
                <Battery className="w-3.5 h-3.5" />
              )}
              <span>{battery.level}%</span>
              {batteryTrend === 'down' && battery.level > 20 && (
                <ArrowDown className="w-3 h-3 text-sky-400" />
              )}
            </div>
          )}
        </div>

        {/* Device Status & Connect Button */}
        <div className="flex items-center justify-between bg-black/40 border border-white/[0.06] p-2 rounded-lg transition-colors">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <div
              className={`w-2 h-2 rounded-full shrink-0 transition-all duration-300 ${
                isConnected
                  ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)] animate-pulse-subtle'
                  : 'bg-neutral-600 shadow-none'
              }`}
            />
            <span className="text-xs font-medium text-neutral-300 truncate">
              {phoneName || 'Android Device'}
            </span>
          </div>

          <button
            onClick={isConnected ? onDisconnect : onConnect}
            className={`text-xs px-3 py-1 rounded-md font-medium transition-all duration-200 active:scale-95 shrink-0 ${
              isConnected
                ? 'bg-white/10 hover:bg-white/20 text-neutral-300 border border-white/15'
                : 'bg-white hover:bg-neutral-200 text-black shadow-sm font-semibold'
            }`}
          >
            {isConnected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </div>
      {/* KokonutUI Expandable Navigation Sub-Tabs with Smooth Lockstep Slide-Out */}
      <div className="flex items-center justify-between p-1.5 mx-3 mt-2 rounded-xl bg-neutral-900/70 border border-white/[0.08] relative">
        {(
          [
            { id: 'camera', label: 'Camera', icon: Settings2 },
            { id: 'filters', label: 'Filters', icon: Sparkles },
            { id: 'transform', label: 'Transform', icon: Move },
            { id: 'overlays', label: 'Overlays', icon: Layers, badge: overlays.length > 0 },
            { id: 'ai', label: 'AI', icon: Cpu }
          ] as const
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <motion.button
              key={tab.id}
              layout
              type="button"
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', bounce: 0.15, duration: 0.38 }}
              className={`relative flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition-colors z-10 select-none cursor-pointer ${
                isActive
                  ? 'text-black font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebarActiveTabPill"
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.38 }}
                  className="absolute inset-0 bg-white rounded-lg shadow-[0_2px_10px_rgba(255,255,255,0.25)] z-0"
                />
              )}
              <Icon className="w-3.5 h-3.5 shrink-0 relative z-10" />
              <AnimatePresence mode="popLayout" initial={false}>
                {isActive && (
                  <motion.span
                    initial={{ opacity: 0, x: -8, width: 0 }}
                    animate={{ opacity: 1, x: 0, width: 'auto' }}
                    exit={{ opacity: 0, x: -6, width: 0 }}
                    transition={{
                      opacity: { duration: 0.2, ease: 'easeOut' },
                      x: { type: 'spring', bounce: 0.15, duration: 0.38 },
                      width: { type: 'spring', bounce: 0.15, duration: 0.38 }
                    }}
                    className="relative z-10 whitespace-nowrap text-[11px] font-semibold overflow-hidden"
                  >
                    {tab.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {'badge' in tab && tab.badge && (
                <span
                  className={`w-1.5 h-1.5 rounded-full relative z-10 ${
                    isActive ? 'bg-black' : 'bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]'
                  }`}
                />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Main Tab Content Viewport with Motion */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {/* ==================== CAMERA TAB ==================== */}
        {activeTab === 'camera' && (
          <div className="space-y-4 animate-tab-enter">
            {/* Stream Settings */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
                Resolution
              </span>
              <CustomSelect
                value={resolution}
                onChange={(val) => onResolutionChange(val)}
                disabled={Boolean(switchingRes)}
                options={[
                  { value: '3840x2160', label: '4K UHD (3840x2160)' },
                  { value: '1920x1080', label: '1080p FHD (1920x1080)' },
                  { value: '1280x720', label: '720p HD (1280x720)' },
                  { value: '640x480', label: '480p SD (640x480)' }
                ]}
              />

              {switchingRes && (
                <div className="flex items-center gap-2 text-[11px] text-neutral-300 bg-white/[0.05] border border-white/10 px-2.5 py-1.5 rounded-md animate-pulse-subtle">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-white shrink-0" />
                  <span>Configuring {switchingRes}...</span>
                </div>
              )}
            </div>

            {/* Target Output Rate (FPS) */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
                Pacing
              </span>
              <div className="grid grid-cols-2 gap-2 bg-black/40 p-1 rounded-lg border border-white/[0.06]">
                <button
                  onClick={() => onFpsChange(30)}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                    fps === 30
                      ? 'bg-white text-black shadow-sm'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  30 FPS
                </button>
                <button
                  onClick={() => onFpsChange(60)}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                    fps === 60
                      ? 'bg-white text-black shadow-sm'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  60 FPS
                </button>
              </div>
            </div>

            {/* Camera Hardware Controls */}
            <div className="pt-2 border-t border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400 shrink-0">
                  Lens
                </span>
                <div className="w-44">
                  <CustomSelect
                    size="sm"
                    value={activeCamera}
                    onChange={(val) => onCameraChange(val)}
                    options={cameras.map((c) => ({
                      value: c.id,
                      label: c.name
                    }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onTorchToggle}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium border transition-all duration-200 active:scale-95 ${
                    torch
                      ? 'bg-white text-black border-white'
                      : 'bg-neutral-900 border-white/10 text-neutral-300 hover:bg-neutral-800 hover:text-white'
                  }`}
                >
                  <Zap className={`w-3.5 h-3.5 ${torch ? 'fill-black' : ''}`} />
                  <span>{torch ? 'Torch On' : 'Torch Off'}</span>
                </button>

                <button
                  onClick={onAutofocus}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium bg-neutral-900 border border-white/10 text-neutral-300 hover:bg-neutral-800 hover:text-white transition-all duration-200 active:scale-95"
                >
                  <Focus className="w-3.5 h-3.5 text-white" />
                  <span>Autofocus</span>
                </button>
              </div>

              {/* Hardware Zoom Slider */}
              <div className="space-y-1.5 bg-black/40 p-2.5 rounded-lg border border-white/[0.06]">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-400">Digital Zoom</span>
                  <span className="font-mono text-white">{zoom.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min={zoomRange.min}
                  max={zoomRange.max}
                  step={0.1}
                  value={zoom}
                  onChange={(e) => onZoomChange(parseFloat(e.target.value))}
                  className="studio-slider"
                />
              </div>

              {/* Exposure Compensation (EV) */}
              <div className="space-y-1.5 bg-black/40 p-2.5 rounded-lg border border-white/[0.06]">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-400">Exposure (EV)</span>
                  <span className="font-mono text-white">
                    {ev > 0 ? `+${ev}` : ev}
                  </span>
                </div>
                <input
                  type="range"
                  min={evRange.min}
                  max={evRange.max}
                  step={1}
                  value={ev}
                  onChange={(e) => onEvChange(parseInt(e.target.value))}
                  className="studio-slider"
                />
              </div>
            </div>
          </div>
        )}

        {/* ==================== FILTERS TAB ==================== */}
        {activeTab === 'filters' && (
          <div className="space-y-3.5 animate-tab-enter">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
                GPU Post-Processing
              </span>
              <button
                onClick={onResetFilters}
                className="text-[10px] font-mono text-neutral-400 hover:text-white uppercase tracking-wider transition-colors"
              >
                Reset All
              </button>
            </div>

            <div className="space-y-1.5 bg-black/40 p-2.5 rounded-lg border border-white/[0.06]">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-200 font-medium">RCAS Sharpen</span>
                <span className="font-mono text-white font-semibold">{filters.sharpen.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={filters.sharpen}
                onChange={(e) => onFilterChange({ sharpen: parseFloat(e.target.value) })}
                className="studio-slider"
              />
            </div>

            {/* Color Sliders */}
            <div className="space-y-2.5 bg-black/40 p-2.5 rounded-lg border border-white/[0.06]">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-400">Brightness</span>
                  <span className="font-mono text-neutral-200">{filters.brightness.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.02"
                  value={filters.brightness}
                  onChange={(e) => onFilterChange({ brightness: parseFloat(e.target.value) })}
                  className="studio-slider"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-400">Contrast</span>
                  <span className="font-mono text-neutral-200">{filters.contrast.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.02"
                  value={filters.contrast}
                  onChange={(e) => onFilterChange({ contrast: parseFloat(e.target.value) })}
                  className="studio-slider"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-400">Saturation</span>
                  <span className="font-mono text-neutral-200">{filters.saturation.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.02"
                  value={filters.saturation}
                  onChange={(e) => onFilterChange({ saturation: parseFloat(e.target.value) })}
                  className="studio-slider"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-400">Gamma Lift</span>
                  <span className="font-mono text-neutral-200">{filters.gamma.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="3"
                  step="0.05"
                  value={filters.gamma}
                  onChange={(e) => onFilterChange({ gamma: parseFloat(e.target.value) })}
                  className="studio-slider"
                />
              </div>
            </div>
          </div>
        )}

        {/* ==================== TRANSFORM TAB ==================== */}
        {activeTab === 'transform' && (
          <div className="space-y-3.5 animate-tab-enter">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
                Matrix &amp; Orientation
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyTransformJson}
                  title="Copy Transform JSON"
                  className="p-1 hover:bg-white/10 rounded text-neutral-400 hover:text-white transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={pasteTransformJson}
                  title="Paste Transform JSON"
                  className="p-1 hover:bg-white/10 rounded text-neutral-400 hover:text-white transition-colors"
                >
                  <Clipboard className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onResetTransform}
                  className="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-black uppercase tracking-wider"
                >
                  Reset
                </button>
              </div>
            </div>

            <button
              onClick={onSnapCenter}
              className="w-full py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white transition-colors"
            >
              Snap to Center
            </button>

            <div className="space-y-1.5 bg-black/40 p-2.5 rounded-lg border border-white/[0.06]">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-300 font-medium">Rotation</span>
                <span className="font-mono text-white">{Math.round(transform.rotation)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="359"
                step="1"
                value={((transform.rotation % 360) + 360) % 360}
                onChange={(e) => onTransformChange({ rotation: parseInt(e.target.value, 10) })}
                className="studio-slider"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() =>
                  onTransformChange({ rotation: (transform.rotation + 90) % 360 })
                }
                className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-black/40 border border-white/[0.06] hover:bg-white/[0.06] text-neutral-300 hover:text-white transition-all duration-200 active:scale-95 gap-1"
              >
                <RotateCw className="w-4 h-4" />
                <span className="text-[11px] font-mono">+90°</span>
              </button>

              <button
                onClick={() => onTransformChange({ flipH: !transform.flipH })}
                className={`flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all duration-200 active:scale-95 gap-1 ${
                  transform.flipH
                    ? 'bg-white text-black border-white'
                    : 'bg-black/40 border-white/[0.06] hover:bg-white/[0.06] text-neutral-300 hover:text-white'
                }`}
              >
                <FlipHorizontal className="w-4 h-4" />
                <span className="text-[11px] font-mono">Flip H</span>
              </button>

              <button
                onClick={() => onTransformChange({ flipV: !transform.flipV })}
                className={`flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all duration-200 active:scale-95 gap-1 ${
                  transform.flipV
                    ? 'bg-white text-black border-white'
                    : 'bg-black/40 border-white/[0.06] hover:bg-white/[0.06] text-neutral-300 hover:text-white'
                }`}
              >
                <FlipVertical className="w-4 h-4" />
                <span className="text-[11px] font-mono">Flip V</span>
              </button>
            </div>

            {/* Fit Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">Viewport Fitting</span>
              <div className="grid grid-cols-3 gap-1.5 bg-black/40 p-1 rounded-lg border border-white/[0.06]">
                {(['contain', 'cover', 'stretch'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => onTransformChange({ fitMode: mode })}
                    className={`py-1 text-[11px] capitalize font-medium rounded transition-all duration-200 ${
                      transform.fitMode === mode
                        ? 'bg-white text-black font-semibold shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Gesture Hint */}
            <div className="bg-white/[0.03] border border-white/[0.06] p-2.5 rounded-lg text-[11px] text-neutral-400 space-y-1">
              <div className="flex items-center gap-1.5 text-neutral-200 font-medium">
                <Move className="w-3.5 h-3.5 text-white" />
                <span>Gestures</span>
              </div>
              <p className="text-[10px] leading-relaxed text-neutral-400">
                Drag to pan. Scroll to zoom. Double-click canvas to center and reset scale.
              </p>
            </div>
          </div>
        )}

        {/* ==================== OVERLAYS TAB ==================== */}
        {activeTab === 'overlays' && (
          <div className="space-y-3.5 animate-tab-enter">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
                Graphic Overlays
              </span>
              <span className="text-[10px] font-mono text-neutral-500">
                {overlays.length} active
              </span>
            </div>

            <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-2.5 text-[11px] text-neutral-300 space-y-1">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Clipboard className="w-3 h-3" /> Clipboard Integration
              </span>
              <p className="text-neutral-400 text-[10px] leading-relaxed">
                Copy any PNG/image and press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white font-mono text-[9px] border border-white/10">Ctrl+V</kbd> to place it into the broadcast scene.
              </p>
            </div>

            {overlays.length === 0 ? (
              <div className="border border-dashed border-white/10 rounded-lg p-6 text-center text-neutral-500 text-xs font-mono">
                NO ACTIVE LAYERS
              </div>
            ) : (
              <div className="space-y-2">
                {overlays.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => onOverlaySelect(item.id)}
                    className={`p-2.5 rounded-lg border transition-all duration-200 space-y-2 ${
                      selectedOverlayId === item.id
                        ? 'bg-white/[0.08] border-white shadow-[0_0_12px_rgba(255,255,255,0.1)]'
                        : 'bg-black/40 border-white/[0.06] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={item.imageDataUrl}
                          alt={item.name}
                          className="w-6 h-6 object-contain rounded bg-black/60 border border-white/10 shrink-0"
                        />
                        <span className="text-xs font-medium text-neutral-200 truncate">
                          {item.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOverlayUpdate(item.id, { visible: !item.visible });
                          }}
                          className="p-1 text-neutral-400 hover:text-white transition-colors"
                        >
                          {item.visible ? (
                            <Eye className="w-3.5 h-3.5 text-white" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5 text-neutral-600" />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOverlayDelete(item.id);
                          }}
                          className="p-1 text-neutral-400 hover:text-white transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Opacity slider */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-neutral-400 font-mono">
                        <span>Opacity</span>
                        <span>{Math.round(item.opacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={item.opacity}
                        onChange={(e) =>
                          onOverlayUpdate(item.id, { opacity: parseFloat(e.target.value) })
                        }
                        className="studio-slider"
                      />
                    </div>

                    {selectedOverlayId === item.id && (
                      <>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-neutral-400 font-mono">
                            <span>Blend Mode</span>
                          </div>
                          <CustomSelect
                            size="sm"
                            value={item.blendMode}
                            onChange={(val) =>
                              onOverlayUpdate(item.id, {
                                blendMode: val as OverlayItem['blendMode']
                              })
                            }
                            options={[
                              { value: 'normal', label: 'Normal' },
                              { value: 'multiply', label: 'Multiply' },
                              { value: 'screen', label: 'Screen' },
                              { value: 'overlay', label: 'Overlay' }
                            ]}
                          />
                        </div>

                        {/* Image Transforms */}
                        <div className="space-y-1.5 pt-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                              Transform
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOverlayUpdate(item.id, { rotation: 0, flipH: false, flipV: false });
                              }}
                              className="text-[10px] text-neutral-500 hover:text-white transition-colors"
                            >
                              Reset
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOverlayUpdate(item.id, { rotation: ((item.rotation || 0) + 90) % 360 });
                              }}
                              className="py-1 px-2 bg-white/[0.05] hover:bg-white/10 text-neutral-300 hover:text-white text-[10px] font-mono rounded border border-white/10 flex items-center justify-center gap-1"
                              title="Rotate 90°"
                            >
                              <RotateCw className="w-3 h-3" />
                              <span>{item.rotation || 0}°</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOverlayUpdate(item.id, { flipH: !item.flipH });
                              }}
                              className={`py-1 px-2 text-[10px] font-mono rounded border transition-colors flex items-center justify-center gap-1 ${
                                item.flipH
                                  ? 'bg-white text-black border-white font-semibold'
                                  : 'bg-white/[0.05] hover:bg-white/10 text-neutral-300 hover:text-white border-white/10'
                              }`}
                              title="Flip Horizontally"
                            >
                              <FlipHorizontal className="w-3 h-3" />
                              <span>Flip H</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOverlayUpdate(item.id, { flipV: !item.flipV });
                              }}
                              className={`py-1 px-2 text-[10px] font-mono rounded border transition-colors flex items-center justify-center gap-1 ${
                                item.flipV
                                  ? 'bg-white text-black border-white font-semibold'
                                  : 'bg-white/[0.05] hover:bg-white/10 text-neutral-300 hover:text-white border-white/10'
                              }`}
                              title="Flip Vertically"
                            >
                              <FlipVertical className="w-3 h-3" />
                              <span>Flip V</span>
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                            Image Adjustments
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOverlayUpdate(item.id, {
                                filters: { brightness: 0, contrast: 1, saturation: 1, hue: 0, blur: 0 }
                              });
                            }}
                            className="text-[10px] text-neutral-500 hover:text-white transition-colors"
                          >
                            Reset
                          </button>
                        </div>

                        {(
                          [
                            ['brightness', -1, 1, 0.02],
                            ['contrast', 0, 2, 0.02],
                            ['saturation', 0, 2, 0.02],
                            ['hue', -180, 180, 1],
                            ['blur', 0, 20, 0.5]
                          ] as const
                        ).map(([key, min, max, step]) => {
                          const filterKey = key as keyof OverlayFilters;
                          const val = item.filters[filterKey] ?? 0;
                          return (
                            <div className="space-y-1" key={key}>
                              <div className="flex justify-between text-[10px] text-neutral-400 font-mono capitalize">
                                <span>{key}</span>
                                <span>{val.toFixed(key === 'hue' || key === 'blur' ? 0 : 2)}{key === 'blur' ? 'px' : ''}</span>
                              </div>
                              <input
                                type="range"
                                min={min}
                                max={max}
                                step={step}
                                value={val}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  onOverlayUpdate(item.id, {
                                    filters: { ...item.filters, [filterKey]: parseFloat(e.target.value) }
                                  })
                                }
                                className="studio-slider"
                              />
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'ai' && (
          <AiPipelinePanel
            pipeline={pipeline}
            hud={pipelineHud}
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
            safeMode={pipelineSafeMode}
            onChange={onPipelineChange}
            onPanicReset={onPanicReset}
          />
        )}
      </div>

      {/* Persistent Virtual Camera Monochrome Output Deck */}
      {/* Persistent Virtual Camera Output Deck with KokonutUI animated pulse beacon */}
      <div className="p-4 border-t border-white/[0.08] bg-black/50 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <div className="relative flex items-center justify-center w-2 h-2">
              {vcamActive && (
                <motion.span
                  className="absolute w-4 h-4 rounded-full bg-white/40"
                  animate={{ scale: [1, 1.8, 2.2], opacity: [0.8, 0.3, 0] }}
                  transition={{ repeat: Infinity, duration: 1.8, ease: 'easeOut' }}
                />
              )}
              <span
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  vcamActive
                    ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]'
                    : 'bg-neutral-600'
                }`}
              />
            </div>
            <span className="font-semibold text-neutral-200">Optic X Virtual Cam</span>
          </div>
          <span className="text-[10px] font-mono text-neutral-400">
            {vcamActive ? `${vcamFrames} frames` : 'Offline'}
          </span>
        </div>

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={onVcamToggle}
          className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold border transition-all duration-200 ${
            vcamActive
              ? 'bg-white/10 hover:bg-white/15 text-white border-white/20'
              : 'bg-white hover:bg-neutral-200 text-black border-transparent shadow-[0_0_16px_rgba(255,255,255,0.2)]'
          }`}
        >
          {vcamActive ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
          <span>{vcamActive ? 'Stop Broadcast' : 'Broadcast Virtual Cam'}</span>
        </motion.button>
        {vcamError && (
          <div className="text-[10px] text-neutral-300 bg-white/[0.05] border border-white/15 rounded px-2 py-1 font-mono">
            {vcamError}
          </div>
        )}
      </div>
    </aside>
  );
};
