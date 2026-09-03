import React, { useEffect, useRef, useState } from 'react';
import { H264Decoder } from './decoder';
import { WebGLRenderer } from './webgl-renderer';
import { Nv12Encoder } from './nv12-encoder';
import { ControlPanel } from './components/ControlPanel';
import { playDingSound } from './audio';
import opticxIcon from '../assets/opticx-icon.png';
import {
  Camera,
  RotateCw,
  RotateCcw,
  Maximize2,
  Minimize2,
  Crosshair,
  Check,
  FlipHorizontal,
  FlipVertical,
  Trash2,
  Copy,
  Sliders,
  Move,
  X
} from 'lucide-react';
import {
  FilterSettings,
  TransformSettings,
  BatteryInfo,
  OverlayItem,
  OverlayFilters,
  DEFAULT_OVERLAY_FILTERS,
  StreamConfig
} from '../shared/types';

type OutputFps = 30 | 60;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const overlayFilterCss = (f: OverlayFilters): string =>
  `brightness(${1 + f.brightness}) contrast(${f.contrast}) saturate(${f.saturation}) hue-rotate(${f.hue}deg)${f.blur && f.blur > 0 ? ` blur(${f.blur}px)` : ''}`;
const quadToPointsString = (pts: Array<{ x: number; y: number }>, fw: number, fh: number): string =>
  pts
    .map((p) => `${(((p.x + 1) / 2) * fw).toFixed(1)},${(((1 - p.y) / 2) * fh).toFixed(1)}`)
    .join(' ');


const DEFAULT_FILTERS: FilterSettings = {
  sharpen: 0.46,
  brightness: 0.0,
  contrast: 1.0,
  saturation: 1.0,
  hue: 0.0,
  gamma: 1.0,
  opacity: 1.0
};

const DEFAULT_TRANSFORM: TransformSettings = {
  rotation: 0,
  flipH: false,
  flipV: false,
  scaleX: 1.0,
  scaleY: 1.0,
  offsetX: 0.0,
  offsetY: 0.0,
  fitMode: 'contain'
};

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const decoderRef = useRef<H264Decoder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const encoderRef = useRef<Nv12Encoder | null>(null);
  const vcamActiveRef = useRef<boolean>(false);
  const lastVcamSendRef = useRef<number>(0);
  const encodeBusyRef = useRef<boolean>(false);
  const filtersRef = useRef<FilterSettings>(DEFAULT_FILTERS);
  const transformRef = useRef<TransformSettings>(DEFAULT_TRANSFORM);
  const fpsRef = useRef<OutputFps>(30);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const editorFrameRef = useRef<HTMLDivElement | null>(null);

  const overlaysRef = useRef<OverlayItem[]>([]);
  const overlayImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const compositionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositionContextRef = useRef<CanvasRenderingContext2D | null>(null);

  // States
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [phoneName, setPhoneName] = useState<string>('Galaxy Note 9');
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [activeCamera, setActiveCamera] = useState<number>(0);
  const [cameras, setCameras] = useState<Array<{ id: number; name: string }>>([
    { id: 0, name: 'Back Camera (4K)' },
    { id: 1, name: 'Front Camera' }
  ]);
  const [torch, setTorch] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1.0);
  const [zoomRange] = useState({ min: 1.0, max: 10.0 });
  const [ev, setEv] = useState<number>(0);
  const [evRange] = useState({ min: -4, max: 4 });

  // Virtual camera
  const [vcamActive, setVcamActive] = useState<boolean>(false);
  const [vcamFrames, setVcamFrames] = useState<number>(0);
  const [vcamError, setVcamError] = useState<string | null>(null);
  const [batteryTrend, setBatteryTrend] = useState<'up' | 'down' | 'none'>('none');
  const [lowBatteryWarning, setLowBatteryWarning] = useState<boolean>(false);
  const lastBatteryLevelRef = useRef<number | null>(null);
  const quadSeededRef = useRef(false);
  const [cameraQuad, setCameraQuad] = useState<Array<{ x: number; y: number }>>([]);
  const [centerQuad, setCenterQuad] = useState<Array<{ x: number; y: number }>>([]);
  const [isSnapped, setIsSnapped] = useState<{ x: boolean; y: boolean }>({ x: true, y: true });
  const [isDraggingCamera, setIsDraggingCamera] = useState<boolean>(false);
  const [fps, setFps] = useState<OutputFps>(30);
  const [switchingRes, setSwitchingRes] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterSettings>({ ...DEFAULT_FILTERS });
  const [transform, setTransform] = useState<TransformSettings>({ ...DEFAULT_TRANSFORM });

  // Overlays
  const [overlays, setOverlays] = useState<OverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);

  // Interaction dragging for pan / zoom
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rawOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isSnappedRef = useRef<{ x: boolean; y: boolean }>({ x: true, y: true });
  const overlayDragRef = useRef<{
    id: string;
    mode: 'move' | 'resize';
    pointerId: number;
    startX: number;
    startY: number;
    origin: { x: number; y: number; width: number; height: number };
    imageAspect: number;
    stageWidth: number;
    stageHeight: number;
  } | null>(null);

  // UI state
  // Camera Timer UI state
  const [timerMenuOpen, setTimerMenuOpen] = useState<boolean>(false);
  const [activeTimer, setActiveTimer] = useState<3 | 5 | 10 | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isCountingDown, setIsCountingDown] = useState<boolean>(false);
  const [shutterFlash, setShutterFlash] = useState<boolean>(false);
  const countdownTimerRef = useRef<number | null>(null);
  const timerMenuRef = useRef<HTMLDivElement | null>(null);
  const [snapSavedFeedback, setSnapSavedFeedback] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [focusOverlaysSignal, setFocusOverlaysSignal] = useState<number>(0);
  const [editorZoom, setEditorZoom] = useState<number>(1);
  const editorZoomRef = useRef(1);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number }>({
    width: 1280,
    height: 720
  });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    overlayId: string;
  } | null>(null);
  const composeVirtualFrame = (): HTMLCanvasElement | null => {
    const preview = canvasRef.current;
    if (!preview || preview.width === 0 || preview.height === 0) return null;

    let output = compositionCanvasRef.current;
    let context = compositionContextRef.current;
    const targetW = preview.width || 1920;
    const targetH = preview.height || 1080;

    if (!output || !context || output.width !== targetW || output.height !== targetH) {
      output = document.createElement('canvas');
      output.width = targetW;
      output.height = targetH;
      context = output.getContext('2d', { alpha: false });
      if (!context) return null;
      compositionCanvasRef.current = output;
      compositionContextRef.current = context;
    }

    context.globalAlpha = 1;
    context.globalCompositeOperation = 'copy';
    context.drawImage(preview, 0, 0, output.width, output.height);

    for (const overlay of overlaysRef.current) {
      if (!overlay.visible) continue;
      const image = overlayImagesRef.current.get(overlay.id);
      if (!image?.complete || image.naturalWidth === 0) continue;

      context.save();
      context.globalAlpha = overlay.opacity;
      context.filter = overlayFilterCss(overlay.filters);
      context.globalCompositeOperation =
        overlay.blendMode === 'normal' ? 'source-over' : overlay.blendMode;

      const boxWidth = overlay.width * output.width;
      const boxHeight = overlay.height * output.height;
      const scale = Math.min(boxWidth / image.naturalWidth, boxHeight / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      const cx = overlay.x * output.width + boxWidth / 2;
      const cy = overlay.y * output.height + boxHeight / 2;

      context.translate(cx, cy);
      if (overlay.rotation) {
        context.rotate((overlay.rotation * Math.PI) / 180);
      }
      context.scale(overlay.flipH ? -1 : 1, overlay.flipV ? -1 : 1);
      context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      context.restore();
    }
    context.filter = 'none';
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    return output;
  };
  useEffect(() => {
    if (!canvasRef.current) return;

    const renderer = new WebGLRenderer(canvasRef.current);
    rendererRef.current = renderer;
    setCameraQuad(renderer.getQuadNdc(DEFAULT_TRANSFORM));
    setCenterQuad(renderer.getCenterQuadNdc(DEFAULT_TRANSFORM));

    const gl = canvasRef.current.getContext('webgl2');
    const encoder = gl ? new Nv12Encoder(gl) : null;
    encoderRef.current = encoder;

    const decoder = new H264Decoder((frame: VideoFrame) => {
      renderer.render(frame, filtersRef.current, transformRef.current);
      if (!quadSeededRef.current) {
        quadSeededRef.current = true;
        setCameraQuad(renderer.getContentQuadNdc());
        setCenterQuad(renderer.getCenterQuadNdc(transformRef.current));
      }

      if (
        vcamActiveRef.current &&
        encoder &&
        !encodeBusyRef.current &&
        !isDraggingRef.current &&
        !overlayDragRef.current
      ) {
        const now = performance.now();
        if (now - lastVcamSendRef.current >= 1000 / fpsRef.current - 2) {
          lastVcamSendRef.current = now;
          encodeBusyRef.current = true;
          const filters = filtersRef.current;
          const transform = transformRef.current;
          const hasOverlays = overlaysRef.current.some((o) => o.visible) && !document.hidden;
          // Deferred via setTimeout (not requestAnimationFrame, which the
          // browser suspends while minimized) so the synchronous GPU
          // readback in encode/encodeTexture never runs inline inside the
          // VideoDecoder output callback. Blocking that callback stalls
          // decode of subsequent frames, and the backlog compounds the
          // longer broadcast stays active -> ever-growing latency.
          setTimeout(() => {
            try {
              if (hasOverlays) {
                const composition = composeVirtualFrame();
                if (composition) {
                  window.electronAPI.sendVcamFrame(
                    encoder.encode(composition, composition.width, composition.height)
                  );
                }
              } else {
                const texture = renderer.renderBroadcast(filters, transform);
                if (texture) {
                  window.electronAPI.sendVcamFrame(encoder.encodeTexture(texture, 3840, 2160));
                }
              }
            } finally {
              encodeBusyRef.current = false;
            }
          }, 0);
        }
      }
      frame.close();
    });
    decoderRef.current = decoder;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (event) => {
              const dataUrl = event.target?.result;
              if (typeof dataUrl !== 'string') return;
              const id = Date.now().toString();
              const probe = new Image();
              probe.onload = () => {
                const imageAspect = probe.naturalHeight / Math.max(probe.naturalWidth, 1);
                const frame = editorFrameRef.current;
                const stageAspect =
                  frame && frame.clientHeight > 0 ? frame.clientWidth / frame.clientHeight : 16 / 9;
                const width = 0.28;
                setOverlays((prev) => [
                  ...prev,
                  {
                    id,
                    name: `Pasted Image ${prev.length + 1}`,
                    imageDataUrl: dataUrl,
                    x: 0.05,
                    y: 0.05,
                    width,
                    height: width * stageAspect * imageAspect,
                    rotation: 0,
                    flipH: false,
                    flipV: false,
                    opacity: 1,
                    blendMode: 'normal',
                    visible: true,
                    filters: { ...DEFAULT_OVERLAY_FILTERS }
                  }
                ]);
                setSelectedOverlayId(id);
              };
              probe.src = dataUrl;
            };
            reader.readAsDataURL(blob);
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);

    const handleResize = () => {
      const stage = stageRef.current;
      const canvas = canvasRef.current;
      if (!stage) return;

      // Available stage area with margin so the 16:9 monitor always fits
      const margin = 32;
      const availW = Math.max(160, stage.clientWidth - margin);
      const availH = Math.max(90, stage.clientHeight - margin);
      const targetAspect = 16 / 9;

      let fw = availW;
      let fh = fw / targetAspect;
      if (fh > availH) {
        fh = availH;
        fw = fh * targetAspect;
      }

      fw = Math.round(fw);
      fh = Math.round(fh);
      setFrameSize({ width: fw, height: fh });

      if (canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cw = Math.max(1, Math.round(fw * dpr));
        const ch = Math.max(1, Math.round(fh * dpr));
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
          renderer.redraw(filtersRef.current, transformRef.current);
          setCameraQuad(renderer.getContentQuadNdc());
          setCenterQuad(renderer.getCenterQuadNdc(transformRef.current));
        }
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    const stageObserver = new ResizeObserver(handleResize);
    if (stageRef.current) stageObserver.observe(stageRef.current);

    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('resize', handleResize);
      stageObserver.disconnect();
      encoder?.destroy();
      renderer.destroy();
      decoder.close();
    };
  }, []);

  useEffect(() => {
    filtersRef.current = filters;
    transformRef.current = transform;
    rendererRef.current?.redraw(filters, transform);
    if (rendererRef.current) {
      setCameraQuad(rendererRef.current.getContentQuadNdc());
      setCenterQuad(rendererRef.current.getCenterQuadNdc(transform));
    }
  }, [filters, transform]);

  useEffect(() => {
    overlaysRef.current = overlays;
  }, [overlays]);

  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);

  useEffect(() => {
    if (!selectedOverlayId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      e.preventDefault();
      setOverlays((prev) => prev.filter((o) => o.id !== selectedOverlayId));
      setSelectedOverlayId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedOverlayId]);

  useEffect(() => {
    return window.electronAPI.onVcamStatus((status) => {
      setVcamFrames(status.frames);
      if (!status.active) {
        vcamActiveRef.current = false;
        setVcamActive(false);
      }
    });
  }, []);

  useEffect(() => {
    return window.electronAPI.onBatteryUpdate((info) => {
      const prev = lastBatteryLevelRef.current;
      if (prev !== null && info.level > prev) setBatteryTrend('up');
      else if (prev !== null && info.level < prev) setBatteryTrend('down');
      lastBatteryLevelRef.current = info.level;
      setBattery(info);
      setLowBatteryWarning(info.level <= 20);
    });
  }, []);

  const [resolution, setResolution] = useState<string>('3840x2160');

  useEffect(() => {
    const timer = setTimeout(() => {
      handleConnect('3840x2160');
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const handleConnect = async (customRes?: string) => {
    try {
      const resToUse = customRes || resolution;
      const [wStr, hStr] = resToUse.split('x');
      const width = parseInt(wStr, 10);
      const height = parseInt(hStr, 10);

      const streamConfig: StreamConfig = {
        host: '192.168.1.184',
        port: 4747,
        width,
        height,
        format: 'avc'
      };

      const result = await window.electronAPI.connect(streamConfig);
      if (!result.success) {
        console.error('Failed to connect:', result.error);
        return;
      }

      setIsConnected(true);

      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket('ws://localhost:8999');
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('[App] WebSocket video bridge connected');
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer && event.data.byteLength >= 9) {
          const view = new DataView(event.data);
          const isConfig = (view.getUint8(0) & 1) === 1;
          const pts = view.getBigUint64(1, false);
          const payload = new Uint8Array(event.data, 9);
          decoderRef.current?.feedPacket(isConfig, pts, payload);
        }
      };

      ws.onclose = () => {
        console.log('[App] WebSocket video bridge closed');
      };

      wsRef.current = ws;

      try {
        const pName = await window.electronAPI.getPhoneName();
        if (pName) setPhoneName(pName);

        const bInfo = await window.electronAPI.getBatteryInfo();
        if (bInfo) setBattery(bInfo);

        const cList = await window.electronAPI.getCameraList();
        if (cList && cList.length > 0) setCameras(cList);
      } catch (err) {
        console.warn('Failed to fetch initial device state:', err);
      }
    } catch (err) {
      console.error('Connection error:', err);
      setIsConnected(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await window.electronAPI.disconnect();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      decoderRef.current?.reset();
      rendererRef.current?.clear();
      setIsConnected(false);
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  };

  const handleAutofocus = async () => {
    await window.electronAPI.triggerAutofocus();
  };

  const handleZoomChange = async (val: number) => {
    setZoom(val);
    await window.electronAPI.setZoom(val);
  };

  const handleEvChange = async (val: number) => {
    setEv(val);
    await window.electronAPI.setEv(val);
  };

  const handleTorchToggle = async () => {
    const nextState = !torch;
    setTorch(nextState);
    await window.electronAPI.toggleTorch();
  };

  const handleCameraChange = async (camId: number) => {
    setActiveCamera(camId);
    await window.electronAPI.setActiveCamera(camId);
  };

  const handleVcamToggle = async () => {
    if (vcamActive) {
      vcamActiveRef.current = false;
      setVcamActive(false);
      setVcamError(null);
      await window.electronAPI.stopVirtualCam();
      return;
    }

    const result = await window.electronAPI.startVirtualCam(fps);
    if (!result.ok) {
      setVcamError(result.error ?? 'Failed to start OpticX Cam');
      return;
    }
    setVcamError(null);
    setVcamFrames(0);
    lastVcamSendRef.current = 0;
    vcamActiveRef.current = true;
    setVcamActive(true);
  };

  const handleFpsChange = async (next: OutputFps) => {
    setFps(next);
    fpsRef.current = next;
    if (!vcamActive) return;
    await window.electronAPI.stopVirtualCam();
    const result = await window.electronAPI.startVirtualCam(next);
    if (result.ok) {
      lastVcamSendRef.current = 0;
      vcamActiveRef.current = true;
      setVcamActive(true);
      return;
    }
    vcamActiveRef.current = false;
    setVcamActive(false);
    setVcamError(result.error ?? 'Failed to restart OpticX Cam');
  };

  const handleResolutionChange = async (newRes: string) => {
    setResolution(newRes);
    if (!isConnected) return;

    setSwitchingRes(newRes);
    try {
      await handleDisconnect();
      const settle = Promise.withResolvers<void>();
      setTimeout(settle.resolve, 700);
      await settle.promise;
      await handleConnect(newRes);
    } finally {
      setSwitchingRes(null);
    }
  };

  const handleCaptureScreenshot = async () => {
    const composition = composeVirtualFrame();
    if (!composition) return;
    const res = await window.electronAPI.saveScreenshot(composition.toDataURL('image/png'));
    if (res.success) {
      setSnapSavedFeedback(res.path);
      setTimeout(() => setSnapSavedFeedback(null), 3500);
    }
  };

  const cancelCountdown = () => {
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setIsCountingDown(false);
    setCountdown(null);
  };

  const startTimedCapture = (seconds: 3 | 5 | 10) => {
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    setIsCountingDown(true);
    setCountdown(seconds);

    let remaining = seconds;
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setCountdown(remaining);
      } else {
        if (countdownTimerRef.current !== null) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        setCountdown(0);

        // Play ding sound at the exact moment the timed photo is captured
        playDingSound();

        // Shutter flash effect
        setShutterFlash(true);
        setTimeout(() => setShutterFlash(false), 350);

        // Take the photo
        void handleCaptureScreenshot();

        // Return to normal camera controls smoothly
        setTimeout(() => {
          setIsCountingDown(false);
          setCountdown(null);
          setTimerMenuOpen(false);
          setActiveTimer(null);
        }, 300);
      }
    }, 1000);
  };

  const handleCameraButtonClick = () => {
    if (isCountingDown) {
      cancelCountdown();
      return;
    }

    if (!timerMenuOpen) {
      setTimerMenuOpen(true);
      return;
    }

    if (activeTimer === null) {
      // Instant photo without ding sound
      setShutterFlash(true);
      setTimeout(() => setShutterFlash(false), 350);
      void handleCaptureScreenshot();
      setTimerMenuOpen(false);
      return;
    }

    // Timed photo with active timer
    startTimedCapture(activeTimer);
  };

  const handleTimerSelect = (seconds: 3 | 5 | 10) => {
    setActiveTimer((prev) => (prev === seconds ? null : seconds));
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        timerMenuOpen &&
        !isCountingDown &&
        timerMenuRef.current &&
        !timerMenuRef.current.contains(e.target as Node)
      ) {
        setTimerMenuOpen(false);
        setActiveTimer(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isCountingDown) {
          cancelCountdown();
        } else if (timerMenuOpen) {
          setTimerMenuOpen(false);
          setActiveTimer(null);
        }
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [timerMenuOpen, isCountingDown]);

  useEffect(() => {
    return () => {
      clearInterval(countdownTimerRef.current as number);
    };
  }, []);

  // Canvas Pan & Zoom
  const applyLiveTransform = (
    next: TransformSettings,
    snapStatus?: { snappedX: boolean; snappedY: boolean }
  ) => {
    transformRef.current = next;
    rendererRef.current?.redraw(filtersRef.current, next);

    const pts = rendererRef.current?.getContentQuadNdc();
    if (!pts || pts.length !== 4) return;

    const fw = frameSize.width;
    const fh = frameSize.height;

    // 1. Update active camera bounds polygon
    const poly = document.getElementById('opticx-camera-bounds');
    if (poly) {
      poly.setAttribute('points', quadToPointsString(pts, fw, fh));
    }

    // 2. Update corner handles
    for (let i = 0; i < 4; i++) {
      const handle = document.getElementById(`opticx-corner-${i}`);
      if (handle) {
        const px = ((pts[i].x + 1) / 2) * fw;
        const py = ((1 - pts[i].y) / 2) * fh;
        handle.setAttribute('cx', px.toFixed(1));
        handle.setAttribute('cy', py.toFixed(1));
      }
    }

    // 3. Update center outline visibility and snap highlighting
    const isMoved = Math.abs(next.offsetX) > 0.002 || Math.abs(next.offsetY) > 0.002;
    const centerGroup = document.getElementById('opticx-center-group');
    if (centerGroup) {
      centerGroup.style.opacity = isMoved || isDraggingRef.current ? '1' : '0';
    }

    const centerPoly = document.getElementById('opticx-center-bounds');
    const snapGuideX = document.getElementById('opticx-snap-guide-x');
    const snapGuideY = document.getElementById('opticx-snap-guide-y');
    const snapBadge = document.getElementById('opticx-snap-badge');

    const bothSnapped = snapStatus ? snapStatus.snappedX && snapStatus.snappedY : !isMoved;

    if (centerPoly) {
      if (bothSnapped) {
        centerPoly.setAttribute('stroke', '#38bdf8');
        centerPoly.setAttribute('stroke-dasharray', 'none');
        centerPoly.style.filter = 'drop-shadow(0 0 6px rgba(56, 189, 248, 0.8))';
      } else {
        centerPoly.setAttribute('stroke', 'rgba(255, 255, 255, 0.45)');
        centerPoly.setAttribute('stroke-dasharray', '6 4');
        centerPoly.style.filter = 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.8))';
      }
    }

    if (snapGuideX) {
      snapGuideX.style.display =
        snapStatus && snapStatus.snappedX && isDraggingRef.current ? 'block' : 'none';
    }
    if (snapGuideY) {
      snapGuideY.style.display =
        snapStatus && snapStatus.snappedY && isDraggingRef.current ? 'block' : 'none';
    }
    if (snapBadge) {
      snapBadge.style.display = bothSnapped && isDraggingRef.current ? 'flex' : 'none';
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (overlayDragRef.current) return;
    if (e.button === 0) {
      setSelectedOverlayId(null);
      isDraggingRef.current = true;
      setIsDraggingCamera(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      rawOffsetRef.current = {
        x: transformRef.current.offsetX,
        y: transformRef.current.offsetY
      };
      const initialSnappedX = Math.abs(transformRef.current.offsetX) < 0.001;
      const initialSnappedY = Math.abs(transformRef.current.offsetY) < 0.001;
      isSnappedRef.current = { x: initialSnappedX, y: initialSnappedY };
      setIsSnapped({ x: initialSnappedX, y: initialSnappedY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || overlayDragRef.current) return;
    const zoom = Math.max(editorZoomRef.current, 0.001);
    const dx = (e.clientX - dragStartRef.current.x) / (300 * zoom);
    const dy = -(e.clientY - dragStartRef.current.y) / (300 * zoom);
    dragStartRef.current = { x: e.clientX, y: e.clientY };

    rawOffsetRef.current.x += dx;
    rawOffsetRef.current.y += dy;

    // Magnetic snap threshold: snap to 0 when near center
    const SNAP_THRESHOLD = 0.055;

    const snappedX = Math.abs(rawOffsetRef.current.x) < SNAP_THRESHOLD;
    const snappedY = Math.abs(rawOffsetRef.current.y) < SNAP_THRESHOLD;

    const appliedOffsetX = snappedX ? 0 : rawOffsetRef.current.x;
    const appliedOffsetY = snappedY ? 0 : rawOffsetRef.current.y;

    isSnappedRef.current = { x: snappedX, y: snappedY };
    setIsSnapped({ x: snappedX, y: snappedY });

    applyLiveTransform(
      {
        ...transformRef.current,
        offsetX: appliedOffsetX,
        offsetY: appliedOffsetY
      },
      { snappedX, snappedY }
    );
  };

  const handleMouseUp = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDraggingCamera(false);
      if (isSnappedRef.current.x) rawOffsetRef.current.x = 0;
      if (isSnappedRef.current.y) rawOffsetRef.current.y = 0;
      setTransform({ ...transformRef.current });
      if (rendererRef.current) {
        setCameraQuad(rendererRef.current.getContentQuadNdc());
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const next = Math.max(0.35, Math.min(4, editorZoomRef.current * zoomFactor));
    editorZoomRef.current = next;
    setEditorZoom(next);
  };

  const handleDoubleClick = () => {
    rawOffsetRef.current = { x: 0, y: 0 };
    isSnappedRef.current = { x: true, y: true };
    setIsSnapped({ x: true, y: true });
    setTransform({ ...DEFAULT_TRANSFORM });
  };

  const handleSnapCenter = () => {
    rawOffsetRef.current = { x: 0, y: 0 };
    isSnappedRef.current = { x: true, y: true };
    setIsSnapped({ x: true, y: true });
    setTransform((prev) => ({ ...prev, offsetX: 0, offsetY: 0 }));
  };

  const handleOverlayPointerDown = (
    e: React.PointerEvent<HTMLElement>,
    item: OverlayItem,
    mode: 'move' | 'resize'
  ) => {
    const frame = editorFrameRef.current ?? stageRef.current;
    if (!frame || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = frame.getBoundingClientRect();
    const zoom = editorZoomRef.current;
    const image = overlayImagesRef.current.get(item.id);
    const imageAspect =
      image?.naturalWidth ? image.naturalHeight / image.naturalWidth : item.height / item.width;
    overlayDragRef.current = {
      id: item.id,
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: { x: item.x, y: item.y, width: item.width, height: item.height },
      imageAspect,
      stageWidth: rect.width / zoom,
      stageHeight: rect.height / zoom
    };
    setSelectedOverlayId(item.id);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleOverlayPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = overlayDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();

    const dx = (e.clientX - drag.startX) / drag.stageWidth;
    const dy = (e.clientY - drag.startY) / drag.stageHeight;

    if (drag.mode === 'move') {
      const x = clamp(drag.origin.x + dx, -0.5, 1.5);
      const y = clamp(drag.origin.y + dy, -0.5, 1.5);
      setOverlays((prev) => prev.map((o) => (o.id === drag.id ? { ...o, x, y } : o)));
      return;
    }

    // width/height are normalized to the (non-square) stage, so the image's
    // real pixel aspect ratio must be corrected by the stage's pixel aspect
    // ratio - otherwise the box no longer matches the object-contain image
    // and empty letterbox bars appear inside the selection.
    const width = clamp(drag.origin.width + dx, 0.02, 3);
    const height = clamp(
      width * drag.imageAspect * (drag.stageWidth / drag.stageHeight),
      0.02,
      3
    );
    setOverlays((prev) => prev.map((o) => (o.id === drag.id ? { ...o, width, height } : o)));
  };

  const handleOverlayPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const drag = overlayDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    overlayDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="flex w-screen h-screen bg-[#050505] text-neutral-100 overflow-hidden font-sans select-none">
      {/* Primary Workspace: Full-Bleed Video Canvas */}
      <div className="flex-1 relative flex flex-col h-full overflow-hidden bg-black">
        {/* Floating Monochrome Minimal HUD */}
        <header className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between pointer-events-none animate-hud-enter">
          <div className="glass-pill px-3.5 py-2 rounded-full flex items-center gap-3 pointer-events-auto">
            <div className="flex items-center gap-2">
              <img src={opticxIcon} alt="OpticX" className="w-4 h-4 rounded object-cover" />
              <span className="font-bold text-xs tracking-widest text-white font-mono">Optic X Studio</span>
            </div>
            <div className="h-3 w-[1px] bg-white/10" />
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-neutral-400">
              <span className="text-white font-semibold">{resolution}</span>
              <span>•</span>
              <span>{fps} FPS</span>
              <span>•</span>
              <span className="text-white">ROT {Math.round(transform.rotation)}°</span>
            </div>
            {vcamActive && (
              <>
                <div className="h-3 w-[1px] bg-white/10" />
                <div className="flex items-center gap-1.5 text-[10px] font-mono tracking-wider text-white">
                  <span className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
                  <span>BROADCASTING</span>
                </div>
              </>
            )}
          </div>

          <div className="glass-pill px-2 py-1.5 rounded-full flex items-center gap-1 pointer-events-auto">
            <button
              onClick={() =>
                setTransform((prev) => ({ ...prev, rotation: (prev.rotation + 90) % 360 }))
              }
              title="Rotate 90°"
              className="p-2 rounded-full hover:bg-white/10 text-neutral-300 hover:text-white transition-all duration-150 active:rotate-90"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowGrid((g) => !g)}
              title="Toggle Alignment Grid"
              className={`p-2 rounded-full transition-colors duration-150 ${
                showGrid ? 'bg-white text-black' : 'hover:bg-white/10 text-neutral-300 hover:text-white'
              }`}
            >
              <Crosshair className="w-4 h-4" />
            </button>
            {/* Camera Timer & Shutter Control Deck */}
            <div ref={timerMenuRef} className="relative flex items-center">
              {isCountingDown && countdown !== null ? (
                <div
                  onClick={cancelCountdown}
                  title="Click to cancel timer"
                  className="flex items-center justify-center gap-2 min-w-[76px] h-8 px-3.5 bg-neutral-900/90 border border-white/20 rounded-full cursor-pointer hover:bg-neutral-800/90 transition-all duration-150 select-none shadow-[0_0_16px_rgba(0,0,0,0.5)] animate-simple-fade ml-1"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-pulse shrink-0" />
                  <span
                    key={countdown}
                    className="text-sm font-mono font-bold text-white tracking-widest animate-countdown-number inline-block min-w-[14px] text-center"
                  >
                    {countdown}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 transition-all duration-300 ease-out">
                  <button
                    onClick={handleCameraButtonClick}
                    title={
                      !timerMenuOpen
                        ? 'Snap Photo / Open Timer Menu'
                        : activeTimer !== null
                        ? `Start ${activeTimer}s Timed Photo`
                        : 'Take Instant Photo'
                    }
                    className={`flex items-center justify-center rounded-full font-semibold text-xs transition-all duration-200 active:scale-95 ${
                      timerMenuOpen
                        ? `w-8 h-8 p-0 bg-white text-black ${
                            activeTimer !== null
                              ? 'shadow-[0_0_12px_2px_rgba(255,255,255,0.7)]'
                              : 'shadow-[0_0_8px_rgba(255,255,255,0.3)] hover:bg-neutral-200'
                          }`
                        : 'h-8 px-3.5 gap-1.5 bg-white hover:bg-neutral-200 text-black shadow-[0_0_12px_rgba(255,255,255,0.25)] ml-0.5'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5 shrink-0" />
                    {!timerMenuOpen && <span className="text-xs font-semibold leading-none">Snap</span>}
                  </button>

                  <div
                    className={`flex items-center gap-1.5 transition-all duration-300 ease-out ${
                      timerMenuOpen
                        ? 'max-w-[200px] opacity-100 ml-1'
                        : 'max-w-0 opacity-0 pointer-events-none overflow-hidden'
                    }`}
                  >
                    {([3, 5, 10] as const).map((secs, idx) => {
                      const isActive = activeTimer === secs;
                       return (
                         <button
                           key={secs}
                           onClick={() => handleTimerSelect(secs)}
                           title={`${secs} seconds timer`}
                           style={{
                             animationDelay: timerMenuOpen ? `${idx * 45}ms` : '0ms'
                           }}
                          className={`h-8 px-3 rounded-full text-xs font-mono font-medium transition-all duration-150 flex items-center justify-center select-none ${
                            timerMenuOpen ? 'animate-timer-enter' : ''
                          } ${
                            isActive
                              ? 'bg-white text-black font-bold border border-white shadow-[0_0_12px_rgba(255,255,255,0.6)]'
                              : 'bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white border border-white/10'
                          }`}
                        >
                          {secs}s
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="h-4 w-[1px] bg-white/10 mx-0.5" />
            <button
              onClick={() => setSidebarOpen((open) => !open)}
              title={sidebarOpen ? 'Collapse Studio Controls' : 'Expand Studio Controls'}
              className="p-2 rounded-full hover:bg-white/10 text-neutral-300 hover:text-white transition-colors duration-150"
            >
              {sidebarOpen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Minimalist Saved Feedback Toast */}
        {snapSavedFeedback && (
          <div className="absolute top-20 left-1/2 z-40 glass-pill px-4 py-2 rounded-xl flex items-center gap-2.5 text-xs font-mono text-white border-white/20 shadow-2xl animate-fade-in-up pointer-events-none">
            <Check className="w-4 h-4 text-white shrink-0" />
            <span>SAVED TO DOWNLOADS &amp; CLIPBOARD</span>
          </div>
        )}

        {lowBatteryWarning && (
          <div className="absolute top-20 left-1/2 z-40 px-4 py-2 rounded-xl flex items-center gap-2.5 text-xs font-mono text-red-100 bg-red-600/90 border border-red-400 shadow-2xl animate-fade-in-up pointer-events-none">
            <span>LOW BATTERY — {battery?.level ?? 0}%</span>
          </div>
        )}


        {/* Video Canvas Stage */}
        <div
          ref={stageRef}
          className="flex-1 w-full h-full relative flex items-center justify-center overflow-hidden"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        >
          {/* Shutter Flash Overlay */}
          {shutterFlash && (
            <div className="absolute inset-0 z-50 pointer-events-none bg-white animate-shutter-flash" />
          )}

          {/* Cinematic Viewfinder Countdown Overlay - Centered on Camera Stage */}
          {isCountingDown && countdown !== null && countdown > 0 && (
            <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center select-none">
              <div
                key={countdown}
                className="text-8xl md:text-9xl font-mono font-black text-white drop-shadow-[0_0_50px_rgba(255,255,255,0.85)] animate-countdown-number"
              >
                {countdown}
              </div>
            </div>
          )}
          <div
            ref={editorFrameRef}
            className="relative bg-[#1c1c1c] shadow-2xl rounded-sm overflow-hidden"
            style={{
              width: `${frameSize.width}px`,
              height: `${frameSize.height}px`,
              aspectRatio: '16 / 9'
            }}
          >
            <div
              className="absolute inset-0 origin-center"
              style={{ transform: `scale(${editorZoom})` }}
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
              />
          {/* Active Camera Frame, Center Home Outline & Magnetic Guides */}
          {cameraQuad.length === 4 && selectedOverlayId === null && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
              viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}
            >
              {/* 1. Center Home Outline (underneath active camera) */}
              {centerQuad.length === 4 && (
                <g
                  id="opticx-center-group"
                  style={{
                    opacity:
                      Math.abs(transform.offsetX) > 0.002 ||
                      Math.abs(transform.offsetY) > 0.002 ||
                      isDraggingCamera
                        ? 1
                        : 0,
                    transition: isDraggingCamera ? 'none' : 'opacity 0.2s ease'
                  }}
                >
                  <polygon
                    id="opticx-center-bounds"
                    points={quadToPointsString(centerQuad, frameSize.width, frameSize.height)}
                    fill="rgba(56, 189, 248, 0.04)"
                    stroke={isSnapped.x && isSnapped.y ? '#38bdf8' : 'rgba(255, 255, 255, 0.45)'}
                    strokeWidth="1.5"
                    strokeDasharray={isSnapped.x && isSnapped.y ? 'none' : '6 4'}
                    style={{
                      filter:
                        isSnapped.x && isSnapped.y
                          ? 'drop-shadow(0 0 6px rgba(56, 189, 248, 0.8))'
                          : 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.8))',
                      transition: 'stroke 0.15s, filter 0.15s'
                    }}
                  />
                  {/* Center crosshair */}
                  <line
                    x1={frameSize.width / 2 - 10}
                    y1={frameSize.height / 2}
                    x2={frameSize.width / 2 + 10}
                    y2={frameSize.height / 2}
                    stroke={isSnapped.x && isSnapped.y ? '#38bdf8' : 'rgba(255, 255, 255, 0.4)'}
                    strokeWidth="1.5"
                  />
                  <line
                    x1={frameSize.width / 2}
                    y1={frameSize.height / 2 - 10}
                    x2={frameSize.width / 2}
                    y2={frameSize.height / 2 + 10}
                    stroke={isSnapped.x && isSnapped.y ? '#38bdf8' : 'rgba(255, 255, 255, 0.4)'}
                    strokeWidth="1.5"
                  />
                </g>
              )}

              {/* 2. Magnetic Alignment Guide Lines */}
              <line
                id="opticx-snap-guide-x"
                x1={frameSize.width / 2}
                y1={0}
                x2={frameSize.width / 2}
                y2={frameSize.height}
                stroke="#38bdf8"
                strokeWidth="1"
                strokeDasharray="4 4"
                style={{
                  display: isDraggingCamera && isSnapped.x ? 'block' : 'none',
                  filter: 'drop-shadow(0 0 3px rgba(56, 189, 248, 0.9))'
                }}
              />
              <line
                id="opticx-snap-guide-y"
                x1={0}
                y1={frameSize.height / 2}
                x2={frameSize.width}
                y2={frameSize.height / 2}
                stroke="#38bdf8"
                strokeWidth="1"
                strokeDasharray="4 4"
                style={{
                  display: isDraggingCamera && isSnapped.y ? 'block' : 'none',
                  filter: 'drop-shadow(0 0 3px rgba(56, 189, 248, 0.9))'
                }}
              />

              {/* 3. Active Transformed Camera Output Box */}
              <polygon
                id="opticx-camera-bounds"
                points={quadToPointsString(cameraQuad, frameSize.width, frameSize.height)}
                fill="none"
                stroke="#ffffff"
                strokeWidth="1.5"
                style={{ filter: 'drop-shadow(0 0 2.5px rgba(0, 0, 0, 0.85))' }}
              />

              {/* 4. Corner Handles */}
              {cameraQuad.map((p, idx) => {
                const px = ((p.x + 1) / 2) * frameSize.width;
                const py = ((1 - p.y) / 2) * frameSize.height;
                return (
                  <circle
                    key={idx}
                    id={`opticx-corner-${idx}`}
                    cx={px.toFixed(1)}
                    cy={py.toFixed(1)}
                    r="3.5"
                    fill="#ffffff"
                    stroke="#0284c7"
                    strokeWidth="1.5"
                  />
                );
              })}
            </svg>
          )}

          {/* Magnetic Snap Badge Feedback */}
          <div
            id="opticx-snap-badge"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-400/60 shadow-[0_0_12px_rgba(6,182,212,0.4)] text-[11px] font-mono text-cyan-200 backdrop-blur-md transition-all duration-150"
            style={{
              display: isDraggingCamera && isSnapped.x && isSnapped.y ? 'flex' : 'none'
            }}
          >
            <Crosshair className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span>SNAPPED TO CENTER</span>
          </div>

          {/* Alignment Rule-of-Thirds Grid Overlay */}
          {showGrid && (
            <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 opacity-20 transition-opacity duration-200">
              <div className="border-r border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-b border-white" />
              <div className="border-r border-white" />
              <div className="border-r border-white" />
              <div />
            </div>
          )}

          {/* Graphic Overlays in Stage */}
          {overlays
            .filter((o) => o.visible)
            .map((overlay) => (
              <div
                key={overlay.id}
                tabIndex={0}
                onPointerDown={(e) => handleOverlayPointerDown(e, overlay, 'move')}
                onPointerMove={handleOverlayPointerMove}
                onPointerUp={handleOverlayPointerUp}
                onPointerCancel={handleOverlayPointerUp}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedOverlayId(overlay.id);
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    overlayId: overlay.id
                  });
                }}
                className={`outline-none absolute ${
                  selectedOverlayId === overlay.id
                    ? 'ring-1 ring-white/80 shadow-[0_0_12px_rgba(255,255,255,0.25)]'
                    : 'hover:ring-1 hover:ring-white/40'
                }`}
                style={{
                  left: `${overlay.x * 100}%`,
                  top: `${overlay.y * 100}%`,
                  width: `${overlay.width * 100}%`,
                  height: `${overlay.height * 100}%`,
                  opacity: overlay.opacity,
                  mixBlendMode: overlay.blendMode,
                  pointerEvents: 'auto',
                  cursor: 'move',
                  touchAction: 'none',
                  transition: 'none'
                }}
              >
                <img
                  ref={(element) => {
                    if (element) overlayImagesRef.current.set(overlay.id, element);
                    else overlayImagesRef.current.delete(overlay.id);
                  }}
                  src={overlay.imageDataUrl}
                  alt={overlay.name}
                  draggable={false}
                  className="w-full h-full object-contain pointer-events-none select-none"
                  style={{
                    filter: overlayFilterCss(overlay.filters),
                    transform: `rotate(${overlay.rotation ?? 0}deg) scaleX(${overlay.flipH ? -1 : 1}) scaleY(${overlay.flipV ? -1 : 1})`
                  }}
                />

                {selectedOverlayId === overlay.id && (
                  <>
                    {/* Subtle corner markers that don't obscure the image */}
                    <span className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 border-white pointer-events-none" />
                    <span className="absolute -top-1 -right-1 w-2 h-2 border-t-2 border-r-2 border-white pointer-events-none" />
                    <span className="absolute -bottom-1 -left-1 w-2 h-2 border-b-2 border-l-2 border-white pointer-events-none" />
                    <span className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-white pointer-events-none" />

                    {/* Corner resize handle */}
                    <div
                      onPointerDown={(e) => handleOverlayPointerDown(e, overlay, 'resize')}
                      onPointerMove={handleOverlayPointerMove}
                      onPointerUp={handleOverlayPointerUp}
                      onPointerCancel={handleOverlayPointerUp}
                      onMouseDown={(e) => e.stopPropagation()}
                      title="Drag to scale (or right-click image for resize presets)"
                      style={{
                        position: 'absolute',
                        right: -4,
                        bottom: -4,
                        width: 9,
                        height: 9,
                        cursor: 'nwse-resize',
                        touchAction: 'none'
                      }}
                      className="bg-white border border-neutral-900 rounded-[2px] shadow-sm hover:scale-125 transition-transform"
                    />
                  </>
                )}
              </div>
            ))}
            </div>
          </div>
        </div>
      </div>
      {sidebarOpen && (
        <ControlPanel
          phoneName={phoneName}
          battery={battery}
          batteryTrend={batteryTrend}
          isConnected={isConnected}
          filters={filters}
          transform={transform}
          overlays={overlays}
          resolution={resolution}
          onResolutionChange={handleResolutionChange}
          switchingRes={switchingRes}
          fps={fps}
          onFpsChange={handleFpsChange}
          zoom={zoom}
          zoomRange={zoomRange}
          ev={ev}
          evRange={evRange}
          torch={torch}
          activeCamera={activeCamera}
          cameras={cameras}
          onConnect={() => handleConnect()}
          onDisconnect={handleDisconnect}
          onFilterChange={(newFilters) => setFilters((prev) => ({ ...prev, ...newFilters }))}
          onResetFilters={() => setFilters({ ...DEFAULT_FILTERS })}
          onTransformChange={(newT) => setTransform((prev) => ({ ...prev, ...newT }))}
          onResetTransform={() => setTransform({ ...DEFAULT_TRANSFORM })}
          onSnapCenter={handleSnapCenter}
          onZoomChange={handleZoomChange}
          onEvChange={handleEvChange}
          onTorchToggle={handleTorchToggle}
          onAutofocus={handleAutofocus}
          onCameraChange={handleCameraChange}
          onCaptureScreenshot={handleCaptureScreenshot}
          vcamActive={vcamActive}
          vcamFrames={vcamFrames}
          vcamError={vcamError}
          onVcamToggle={handleVcamToggle}
          onOverlayUpdate={(id, update) =>
            setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...update } : o)))
          }
          onOverlayDelete={(id) => {
            setOverlays((prev) => prev.filter((o) => o.id !== id));
            setSelectedOverlayId(null);
          }}
          selectedOverlayId={selectedOverlayId}
          onOverlaySelect={setSelectedOverlayId}
          focusOverlaysSignal={focusOverlaysSignal}
        />
      )}

      {/* Overlay Right-Click Context Menu */}
      {contextMenu && (() => {
        const activeOverlay = overlays.find((o) => o.id === contextMenu.overlayId);
        if (!activeOverlay) return null;

        const handleActualSize = () => {
          const img = overlayImagesRef.current.get(activeOverlay.id);
          const frame = editorFrameRef.current;
          if (img?.naturalWidth && frame && frame.clientHeight > 0) {
            const stageW = frame.clientWidth;
            const stageH = frame.clientHeight;
            const width = clamp(img.naturalWidth / stageW, 0.04, 3);
            const height = clamp(img.naturalHeight / stageH, 0.04, 3);
            setOverlays((prev) =>
              prev.map((o) => (o.id === activeOverlay.id ? { ...o, width, height } : o))
            );
          }
          setContextMenu(null);
        };

        const handleFitFrame = () => {
          const img = overlayImagesRef.current.get(activeOverlay.id);
          const frame = editorFrameRef.current;
          const stageAspect =
            frame && frame.clientHeight > 0 ? frame.clientWidth / frame.clientHeight : 16 / 9;
          const imgAspect =
            img?.naturalWidth ? img.naturalHeight / img.naturalWidth : activeOverlay.height / activeOverlay.width;
          let w = 0.85;
          let h = w * stageAspect * imgAspect;
          if (h > 0.85) {
            h = 0.85;
            w = h / (stageAspect * imgAspect);
          }
          setOverlays((prev) =>
            prev.map((o) =>
              o.id === activeOverlay.id
                ? { ...o, width: w, height: h, x: (1 - w) / 2, y: (1 - h) / 2 }
                : o
            )
          );
          setContextMenu(null);
        };

        const handleFillFrame = () => {
          const img = overlayImagesRef.current.get(activeOverlay.id);
          const frame = editorFrameRef.current;
          const stageAspect =
            frame && frame.clientHeight > 0 ? frame.clientWidth / frame.clientHeight : 16 / 9;
          const imgAspect =
            img?.naturalWidth ? img.naturalHeight / img.naturalWidth : activeOverlay.height / activeOverlay.width;
          let w = 1.0;
          let h = w * stageAspect * imgAspect;
          if (h < 1.0) {
            h = 1.0;
            w = h / (stageAspect * imgAspect);
          }
          setOverlays((prev) =>
            prev.map((o) =>
              o.id === activeOverlay.id
                ? { ...o, width: w, height: h, x: (1 - w) / 2, y: (1 - h) / 2 }
                : o
            )
          );
          setContextMenu(null);
        };

        const handlePresetScale = (fraction: number) => {
          const img = overlayImagesRef.current.get(activeOverlay.id);
          const frame = editorFrameRef.current;
          const stageAspect =
            frame && frame.clientHeight > 0 ? frame.clientWidth / frame.clientHeight : 16 / 9;
          const imgAspect =
            img?.naturalWidth ? img.naturalHeight / img.naturalWidth : activeOverlay.height / activeOverlay.width;
          const w = fraction;
          const h = w * stageAspect * imgAspect;
          setOverlays((prev) =>
            prev.map((o) =>
              o.id === activeOverlay.id ? { ...o, width: w, height: h } : o
            )
          );
          setContextMenu(null);
        };

        const handleRotate = (deg: number) => {
          setOverlays((prev) =>
            prev.map((o) =>
              o.id === activeOverlay.id
                ? { ...o, rotation: (((o.rotation ?? 0) + deg) % 360 + 360) % 360 }
                : o
            )
          );
        };

        const handleFlipH = () => {
          setOverlays((prev) =>
            prev.map((o) => (o.id === activeOverlay.id ? { ...o, flipH: !o.flipH } : o))
          );
        };

        const handleFlipV = () => {
          setOverlays((prev) =>
            prev.map((o) => (o.id === activeOverlay.id ? { ...o, flipV: !o.flipV } : o))
          );
        };

        const handleCenter = () => {
          setOverlays((prev) =>
            prev.map((o) =>
              o.id === activeOverlay.id
                ? { ...o, x: (1 - o.width) / 2, y: (1 - o.height) / 2 }
                : o
            )
          );
          setContextMenu(null);
        };

        const handleResetTransform = () => {
          setOverlays((prev) =>
            prev.map((o) =>
              o.id === activeOverlay.id
                ? { ...o, rotation: 0, flipH: false, flipV: false }
                : o
            )
          );
        };

        const handleDuplicate = () => {
          const newId = Date.now().toString();
          setOverlays((prev) => [
            ...prev,
            {
              ...activeOverlay,
              id: newId,
              name: `${activeOverlay.name} (Copy)`,
              x: activeOverlay.x + 0.03,
              y: activeOverlay.y + 0.03
            }
          ]);
          setSelectedOverlayId(newId);
          setContextMenu(null);
        };

        const handleDelete = () => {
          setOverlays((prev) => prev.filter((o) => o.id !== activeOverlay.id));
          if (selectedOverlayId === activeOverlay.id) setSelectedOverlayId(null);
          setContextMenu(null);
        };

        return (
          <div
            className="fixed inset-0 z-50 pointer-events-auto"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          >
            <div
              className="absolute glass-panel bg-[#0d1117]/95 backdrop-blur-2xl border border-white/20 rounded-xl shadow-2xl p-3 z-50 w-72 text-xs font-mono select-none space-y-2.5 animate-scale-in"
              style={{
                left: Math.min(contextMenu.x, window.innerWidth - 300),
                top: Math.min(contextMenu.y, window.innerHeight - 440)
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Context Menu Header */}
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="font-semibold text-white truncate text-[11px] max-w-[180px]">
                  {activeOverlay.name}
                </span>
                <button
                  onClick={() => setContextMenu(null)}
                  className="text-neutral-400 hover:text-white p-0.5 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Resize in Editor */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-neutral-400 uppercase tracking-wider block">
                  Resize (Editor)
                </span>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    onClick={handleActualSize}
                    className="py-1 px-1.5 bg-white/[0.06] hover:bg-white/15 text-neutral-200 hover:text-white rounded text-[10px] transition-colors border border-white/10"
                    title="Resize to 1:1 original image pixel size in editor"
                  >
                    Actual (100%)
                  </button>
                  <button
                    onClick={handleFitFrame}
                    className="py-1 px-1.5 bg-white/[0.06] hover:bg-white/15 text-neutral-200 hover:text-white rounded text-[10px] transition-colors border border-white/10"
                    title="Fit image inside frame"
                  >
                    Fit Frame
                  </button>
                  <button
                    onClick={handleFillFrame}
                    className="py-1 px-1.5 bg-white/[0.06] hover:bg-white/15 text-neutral-200 hover:text-white rounded text-[10px] transition-colors border border-white/10"
                    title="Fill entire frame"
                  >
                    Fill Frame
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {[0.25, 0.5, 0.75, 1.0].map((frac) => (
                    <button
                      key={frac}
                      onClick={() => handlePresetScale(frac)}
                      className="py-1 bg-white/[0.04] hover:bg-white/10 text-neutral-300 hover:text-white rounded text-[10px] transition-colors border border-white/5"
                    >
                      {Math.round(frac * 100)}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Transform */}
              <div className="space-y-1.5 pt-1 border-t border-white/10">
                <span className="text-[10px] text-neutral-400 uppercase tracking-wider block">
                  Transform
                </span>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    onClick={() => handleRotate(90)}
                    className="py-1 px-1.5 bg-white/[0.06] hover:bg-white/15 text-neutral-200 hover:text-white rounded text-[10px] transition-colors border border-white/10 flex items-center justify-center gap-1"
                    title="Rotate 90 degrees clockwise"
                  >
                    <RotateCw className="w-3 h-3" />
                    <span>+90°</span>
                  </button>
                  <button
                    onClick={handleFlipH}
                    className={`py-1 px-1.5 rounded text-[10px] transition-colors border flex items-center justify-center gap-1 ${
                      activeOverlay.flipH
                        ? 'bg-white text-black font-semibold border-white'
                        : 'bg-white/[0.06] hover:bg-white/15 text-neutral-200 hover:text-white border-white/10'
                    }`}
                    title="Flip horizontal"
                  >
                    <FlipHorizontal className="w-3 h-3" />
                    <span>Flip H</span>
                  </button>
                  <button
                    onClick={handleFlipV}
                    className={`py-1 px-1.5 rounded text-[10px] transition-colors border flex items-center justify-center gap-1 ${
                      activeOverlay.flipV
                        ? 'bg-white text-black font-semibold border-white'
                        : 'bg-white/[0.06] hover:bg-white/15 text-neutral-200 hover:text-white border-white/10'
                    }`}
                    title="Flip vertical"
                  >
                    <FlipVertical className="w-3 h-3" />
                    <span>Flip V</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={handleCenter}
                    className="py-1 px-1.5 bg-white/[0.04] hover:bg-white/10 text-neutral-300 hover:text-white rounded text-[10px] transition-colors border border-white/5"
                  >
                    Center in Frame
                  </button>
                  <button
                    onClick={handleResetTransform}
                    className="py-1 px-1.5 bg-white/[0.04] hover:bg-white/10 text-neutral-300 hover:text-white rounded text-[10px] transition-colors border border-white/5"
                  >
                    Reset Angle/Flip
                  </button>
                </div>
              </div>

              {/* Adjustments & Effects */}
              <div className="space-y-1.5 pt-1 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-neutral-400 uppercase tracking-wider">
                    Adjustments
                  </span>
                  <button
                    onClick={() => {
                      setSidebarOpen(true);
                      setFocusOverlaysSignal((n) => n + 1);
                      setContextMenu(null);
                    }}
                    className="text-[9px] text-neutral-400 hover:text-white underline"
                  >
                    Studio Controls →
                  </button>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-neutral-400">
                    <span>Brightness</span>
                    <span>{activeOverlay.filters.brightness.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.02}
                    value={activeOverlay.filters.brightness}
                    onChange={(e) =>
                      setOverlays((prev) =>
                        prev.map((o) =>
                          o.id === activeOverlay.id
                            ? {
                                ...o,
                                filters: {
                                  ...o.filters,
                                   brightness: parseFloat(e.target.value)
                                 }
                               }
                             : o
                         )
                       )
                     }
                     className="studio-slider w-full"
                   />
                 </div>
                 <div className="space-y-1">
                   <div className="flex justify-between text-[10px] text-neutral-400">
                     <span>Saturation</span>
                     <span>{activeOverlay.filters.saturation.toFixed(2)}</span>
                   </div>
                   <input
                     type="range"
                     min={0}
                     max={2}
                     step={0.02}
                     value={activeOverlay.filters.saturation}
                     onChange={(e) =>
                       setOverlays((prev) =>
                         prev.map((o) =>
                           o.id === activeOverlay.id
                             ? {
                                 ...o,
                                 filters: {
                                   ...o.filters,
                                   saturation: parseFloat(e.target.value)
                                 }
                               }
                             : o
                         )
                       )
                     }
                     className="studio-slider w-full"
                   />
                 </div>
                 <div className="space-y-1">
                   <div className="flex justify-between text-[10px] text-neutral-400">
                     <span>Blur</span>
                     <span>{(activeOverlay.filters.blur ?? 0).toFixed(0)}px</span>
                   </div>
                   <input
                     type="range"
                     min={0}
                     max={20}
                     step={0.5}
                     value={activeOverlay.filters.blur ?? 0}
                     onChange={(e) =>
                       setOverlays((prev) =>
                         prev.map((o) =>
                           o.id === activeOverlay.id
                             ? {
                                 ...o,
                                 filters: {
                                   ...o.filters,
                                   blur: parseFloat(e.target.value)
                                 }
                               }
                             : o
                         )
                       )
                     }
                     className="studio-slider w-full"
                   />
                 </div>
               </div>

               {/* Actions */}
               <div className="flex items-center justify-between pt-1 border-t border-white/10">
                 <button
                   onClick={handleDuplicate}
                   className="py-1 px-2 bg-white/[0.06] hover:bg-white/15 text-neutral-300 hover:text-white rounded text-[10px] transition-colors border border-white/10 flex items-center gap-1"
                 >
                   <Copy className="w-3 h-3" />
                   <span>Duplicate</span>
                 </button>
                 <button
                   onClick={handleDelete}
                   className="py-1 px-2 bg-red-600/20 hover:bg-red-600/40 text-red-300 hover:text-red-100 rounded text-[10px] transition-colors border border-red-500/30 flex items-center gap-1"
                 >
                   <Trash2 className="w-3 h-3" />
                   <span>Delete</span>
                 </button>
               </div>
             </div>
           </div>
         );
       })()}
    </div>
  );
};
