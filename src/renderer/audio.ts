declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

let audioCtx: AudioContext | null = null;

/**
 * Plays a crystal-clear, high-fidelity camera chime / ding sound
 * synthesized via Web Audio API.
 */
export function playDingSound(): void {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContextClass();
    }

    const ctx = audioCtx;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;

    // Dual-tone chime: A6 (1760 Hz) + E7 (2637 Hz) with instant attack & gentle exponential ring
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    const gain2 = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1760, now);
    osc1.frequency.exponentialRampToValueAtTime(1740, now + 0.9);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2637, now);
    osc2.frequency.exponentialRampToValueAtTime(2610, now + 0.6);

    // High attack for clean "ping", followed by smooth exponential decay
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.linearRampToValueAtTime(0.35, now + 0.008);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

    gain2.gain.setValueAtTime(0.0001, now);
    gain2.gain.linearRampToValueAtTime(0.18, now + 0.008);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    osc1.connect(gain1);
    osc2.connect(gain2);
    gain1.connect(ctx.destination);
    gain2.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.85);
    osc2.stop(now + 0.55);
  } catch (err) {
    console.warn('Audio ding playback error:', err);
  }
}
