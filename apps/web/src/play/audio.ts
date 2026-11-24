import type { DriveInput, Race } from "@qracer/game-core";
import { audioSettings, defaultAudio, type AudioSettings, VoiceBudget } from "./audio-settings.ts";
import { bass, beatSeconds, noteFrequency, score } from "./music.ts";

/** PC-only Web Audio. Nodes and scheduling stop on pause/visibility loss. */
export class RaceAudio {
  settings: AudioSettings = defaultAudio;
  private context?: AudioContext;
  private master?: GainNode;
  private music?: GainNode;
  private effects?: GainNode;
  private engine?: GainNode;
  private motor?: OscillatorNode;
  private harmonic?: OscillatorNode;
  private filter?: BiquadFilterNode;
  private noise?: AudioBuffer;
  private running = false;
  private timer = 0;
  private menuTimer = 0;
  private generation = 0;
  private nextNote = 0;
  private note = 0;
  private lastTick = -1;
  private countdown = -1;
  private boosted = false;
  private budget = new VoiceBudget();
  private voices = new Map<number, { stop: () => void }>();
  readonly diagnostics = { state: "sin activar", peakVoices: 0, effects: 0 };

  async unlock() {
    if (this.settings.muted || this.settings.master === 0) return;
    try {
      if (!this.context) {
        const context = new AudioContext({ latencyHint: "interactive" });
        this.context = context;
        const master = context.createGain();
        this.master = master;
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -16;
        limiter.knee.value = 20;
        limiter.ratio.value = 4;
        master.connect(limiter).connect(context.destination);
        this.music = context.createGain();
        this.effects = context.createGain();
        this.music.connect(master);
        this.effects.connect(master);
        this.engine = context.createGain();
        this.engine.gain.value = 0;
        this.filter = context.createBiquadFilter();
        this.filter.type = "lowpass";
        this.filter.connect(this.engine).connect(this.effects);
        this.motor = context.createOscillator();
        this.motor.type = "sawtooth";
        this.harmonic = context.createOscillator();
        this.harmonic.type = "triangle";
        const overtone = context.createGain();
        overtone.gain.value = 0.23;
        this.motor.connect(this.filter);
        this.harmonic.connect(overtone).connect(this.filter);
        this.motor.start();
        this.harmonic.start();
        const buffer = context.createBuffer(1, context.sampleRate / 2, context.sampleRate);
        const samples = buffer.getChannelData(0);
        let seed = 721;
        for (let i = 0; i < samples.length; i++) {
          seed = Math.imul(seed, 1664525) + 1013904223;
          samples[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
        }
        this.noise = buffer;
      }
      this.configure(this.settings);
      await this.context.resume();
      this.diagnostics.state = this.context.state;
      if (this.running) this.startMusic();
      else await this.context.suspend();
    } catch {
      this.diagnostics.state = "no disponible";
    }
  }

  configure(value: AudioSettings) {
    this.settings = audioSettings(value);
    const now = this.context?.currentTime ?? 0;
    this.master?.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, now, 0.02);
    this.music?.gain.setTargetAtTime(this.settings.music, now, 0.02);
    this.effects?.gain.setTargetAtTime(this.settings.effects, now, 0.02);
    if (this.settings.muted || this.settings.master === 0) this.clearVoices();
  }

  setActive(active: boolean) {
    this.generation++;
    clearTimeout(this.menuTimer);
    this.running = active;
    if (active) {
      this.lastTick = -1;
      this.countdown = -1;
      void this.unlock();
      return;
    }
    clearInterval(this.timer);
    this.timer = 0;
    this.clearVoices();
    if (this.context) {
      this.engine?.gain.setValueAtTime(0, this.context.currentTime);
      void this.context.suspend().catch(() => {});
    }
  }

  private startMusic() {
    if (this.timer || !this.context) return;
    this.nextNote = this.context.currentTime + 0.03;
    this.timer = window.setInterval(() => {
      const context = this.context;
      if (!context || !this.running) return;
      if (this.nextNote < context.currentTime) this.nextNote = context.currentTime + 0.02;
      while (this.nextNote < context.currentTime + 0.12) {
        if (!this.settings.muted && this.settings.music > 0) {
          const midi = score[this.note % score.length] ?? 69;
          this.tone(noteFrequency(midi), 0.18, 0.12, 0, this.nextNote, true);
          if (this.note % 4 === 0)
            this.tone(
              noteFrequency(bass[Math.floor(this.note / 8) % 4] ?? 45),
              0.32,
              0.22,
              0,
              this.nextNote,
              true,
            );
        }
        this.note++;
        this.nextNote += beatSeconds / 2;
      }
    }, 50);
  }

  private tone(
    frequency: number,
    duration: number,
    volume: number,
    priority: number,
    at?: number,
    music = false,
    noise = false,
  ) {
    const context = this.context;
    const output = music ? this.music : this.effects;
    if (
      !context ||
      !output ||
      this.settings.muted ||
      this.settings.master === 0 ||
      context.state !== "running"
    )
      return;
    const start = at ?? context.currentTime;
    const slot = this.budget.claim(priority, start + duration + 0.02, context.currentTime);
    if (!slot) return;
    if (slot.victim !== undefined) this.voices.get(slot.victim)?.stop();
    for (const [id, voice] of this.voices) if (!this.budget.has(id)) voice.stop();
    const gain = context.createGain();
    gain.connect(output);
    const source = noise ? context.createBufferSource() : context.createOscillator();
    if (source instanceof OscillatorNode) {
      source.type = music ? "triangle" : "sine";
      source.frequency.setValueAtTime(frequency, start);
      source.frequency.exponentialRampToValueAtTime(
        Math.max(35, frequency * 0.65),
        start + duration,
      );
    } else source.buffer = this.noise ?? null;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = frequency * 3;
    source.connect(filter).connect(gain);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      this.voices.delete(slot.id);
      this.budget.release(slot.id);
    };
    this.voices.set(slot.id, {
      stop: () => {
        try {
          source.stop();
        } catch {
          /* Already ended. */
        }
        cleanup();
      },
    });
    source.onended = cleanup;
    source.start(start);
    source.stop(start + duration + 0.02);
    this.diagnostics.peakVoices = Math.max(this.diagnostics.peakVoices, this.voices.size);
  }

  update(race: Race, input?: DriveInput) {
    const context = this.context;
    if (!this.running || !context || context.state !== "running") return;
    const now = context.currentTime;
    const speed = race.driver.speed;
    const gear = Math.floor(speed / 12);
    const pitch = 48 + (speed % 12) * 5 + gear * 12;
    this.motor?.frequency.setTargetAtTime(pitch, now, 0.09);
    this.harmonic?.frequency.setTargetAtTime(pitch * 2, now, 0.09);
    this.filter?.frequency.setTargetAtTime(300 + speed * 28, now, 0.08);
    this.engine?.gain.setTargetAtTime(
      race.phase === "racing" ? 0.1 + (input?.throttle ?? 0) * 0.04 : 0.025,
      now,
      0.05,
    );
    const count = race.phase === "countdown" ? Math.ceil(race.countdown / 60) : 0;
    if (count !== this.countdown) {
      if (count >= 0) this.tone(count ? 660 : 990, 0.12, 0.18, 3);
      this.countdown = count;
    }
    if (race.tick === this.lastTick) return;
    this.lastTick = race.tick;
    const event =
      race.events.find((value) => value.type === "impact") ??
      race.events.find((value) => value.type === "near" || value.type === "graze");
    if (event) {
      this.tone(
        event.type === "impact" ? 90 : event.type === "near" ? 880 : 260,
        0.2,
        event.type === "impact" ? 0.32 : 0.15,
        event.type === "impact" ? 3 : 2,
        undefined,
        false,
        event.type !== "near",
      );
      this.diagnostics.effects++;
    }
    if (race.driver.boosting && !this.boosted) this.tone(420, 0.28, 0.2, 2, undefined, false, true);
    if ((input?.brake ?? 0) > 0 && race.tick % 18 === 0)
      this.tone(220, 0.12, 0.035, 1, undefined, false, true);
    this.boosted = race.driver.boosting;
  }

  async menu() {
    const context = this.context;
    if (!context || this.settings.muted || this.settings.master === 0) return;
    const generation = this.generation;
    try {
      await context.resume();
      if (document.hidden) {
        await context.suspend();
        return;
      }
      if (generation !== this.generation) return;
      this.tone(740, 0.055, 0.06, 1);
      clearTimeout(this.menuTimer);
      this.menuTimer = window.setTimeout(() => {
        if (!this.running && generation === this.generation) {
          this.clearVoices();
          void context.suspend().catch(() => {});
        }
      }, 120);
    } catch {
      /* Optional menu cue; the silent route remains available. */
    }
  }
  private clearVoices() {
    for (const voice of [...this.voices.values()]) voice.stop();
    this.voices.clear();
    this.budget.clear();
  }
  async dispose() {
    this.setActive(false);
    await this.context?.close();
    delete this.context;
  }
}
