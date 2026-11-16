class BowlingSoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private rollOsc: OscillatorNode | null = null;
  private rollGain: GainNode | null = null;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.stopRollSound();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public playChargeTick(powerRatio: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180 + powerRatio * 240, now);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.045);
  }

  public startRollSound(powerRatio: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.stopRollSound();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(52 + powerRatio * 28, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140 + powerRatio * 100, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.06 + powerRatio * 0.05, now + 0.08);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    this.rollOsc = osc;
    this.rollGain = gain;
  }

  public stopRollSound() {
    if (this.rollGain && this.ctx) {
      try {
        const now = this.ctx.currentTime;
        this.rollGain.gain.cancelScheduledValues(now);
        this.rollGain.gain.setValueAtTime(this.rollGain.gain.value, now);
        this.rollGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      } catch {
        // ignore
      }
    }
    if (this.rollOsc) {
      const osc = this.rollOsc;
      setTimeout(() => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // ignore
        }
      }, 90);
    }
    this.rollOsc = null;
    this.rollGain = null;
  }

  public playPinImpact(pinsKnocked: number) {
    const ctx = this.ensureContext();
    if (!ctx || pinsKnocked <= 0) return;

    const hits = Math.min(pinsKnocked, 6);
    const now = ctx.currentTime;

    for (let i = 0; i < hits; i++) {
      const delay = i * 0.032 + Math.random() * 0.018;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Maple pin clack frequencies
      osc.type = i % 2 === 0 ? 'triangle' : 'square';
      const baseFreq = 580 + Math.random() * 440;
      osc.frequency.setValueAtTime(baseFreq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.45, now + delay + 0.09);

      const vol = Math.min(0.14, 0.05 + pinsKnocked * 0.009) * (1 - i * 0.1);
      gain.gain.setValueAtTime(0.001, now + delay);
      gain.gain.linearRampToValueAtTime(vol, now + delay + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.11);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.12);
    }
  }

  public playGutterThud() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  public playStrikeFanfare() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [261.63, 329.63, 392.0, 523.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const start = now + idx * 0.065;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.09, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.36);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.38);
    });
  }

  public playSpareChime() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [329.63, 440.0];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const start = now + idx * 0.08;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.08, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }
}

export const soundEngine = new BowlingSoundEngine();
