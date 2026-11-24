export interface AudioSettings {
  muted: boolean;
  master: number;
  music: number;
  effects: number;
}
export const defaultAudio: AudioSettings = {
  muted: false,
  master: 0.55,
  music: 0.22,
  effects: 0.7,
};
export function audioSettings(value: unknown): AudioSettings {
  const data = value && typeof value === "object" ? (value as Partial<AudioSettings>) : {};
  const level = (key: "master" | "music" | "effects") =>
    typeof data[key] === "number" && Number.isFinite(data[key])
      ? Math.max(0, Math.min(1, data[key]))
      : defaultAudio[key];
  return {
    muted: data.muted === true,
    master: level("master"),
    music: level("music"),
    effects: level("effects"),
  };
}

/** The quietest, oldest low-priority voice yields to an important cue. */
export class VoiceBudget {
  private active = new Map<number, { priority: number; until: number }>();
  private id = 0;
  claim(priority: number, until: number, now: number) {
    for (const [id, item] of this.active) if (item.until <= now) this.active.delete(id);
    let victim: number | undefined;
    if (this.active.size >= 8) {
      for (const [id, item] of this.active) {
        const previous = victim === undefined ? undefined : this.active.get(victim);
        if (!previous || item.priority < previous.priority) victim = id;
      }
      if (victim === undefined || (this.active.get(victim)?.priority ?? Infinity) > priority)
        return;
      this.active.delete(victim);
    }
    const id = ++this.id;
    this.active.set(id, { priority, until });
    return { id, victim };
  }
  release(id: number) {
    this.active.delete(id);
  }
  has(id: number) {
    return this.active.has(id);
  }
  clear() {
    this.active.clear();
  }
  get size() {
    return this.active.size;
  }
}
