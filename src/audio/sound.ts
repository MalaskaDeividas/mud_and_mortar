// Synthesized Web Audio WW2 Sound Effects (zero external assets required)

class SoundEngine {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  playExplosion(power = 1.0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Deep sub-bass artillery thump
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(115 * Math.min(1.2, power), now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.55);
    oscGain.gain.setValueAtTime(0.45 * Math.min(1.3, power), now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.68);

    // Mud & earth blast roar (lowpass noise)
    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 0.9);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(880, now);
    filter.frequency.exponentialRampToValueAtTime(140, now + 0.8);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.42 * Math.min(1.3, power), now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    noise.connect(filter).connect(nGain).connect(ctx.destination);
    noise.start(now);
  }

  playMudSplat(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Wet squelchy mud impact
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220 + Math.random() * 90, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.09);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  playLaunch(heavy = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = heavy ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(heavy ? 180 : 320, now);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 65 : 140, now + 0.18);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);

    // Rocket whoosh
    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(heavy ? 500 : 1200, now);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.14, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    noise.connect(bp).connect(nGain).connect(ctx.destination);
    noise.start(now);
  }

  playBounce(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.05);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playSplash(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 0.55);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(950, now);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
  }

  playPickup(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.065);
      gain.gain.setValueAtTime(0.15, now + i * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.065);
      osc.stop(now + i * 0.065 + 0.22);
    });
  }

  playVictory(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const notes = [392, 523.25, 659.25, 783.99];
    const now = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.14);
      gain.gain.setValueAtTime(0.16, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.38);
    });
  }
}

export const sound = new SoundEngine();
