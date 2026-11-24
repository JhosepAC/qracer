import { type Input, neutral } from "@qracer/session-core/wire";

export type Control = "left" | "right" | "wheel" | "throttle" | "brake" | "boost";

export class TouchInput {
  private readonly palms = new Map<number, { control: Control; steer: number }>();

  down(id: number, control: Control, steer = 0) {
    if (control === "wheel" && this.held("wheel")) return false;
    this.palms.set(id, { control, steer });
    return true;
  }

  turn(id: number, steer: number) {
    const pointer = this.palms.get(id);
    if (pointer?.control !== "wheel" || pointer.steer === steer) return false;
    pointer.steer = steer;
    return true;
  }

  up(id: number) {
    return this.palms.delete(id);
  }

  clear() {
    this.palms.clear();
  }

  held(control: Control) {
    for (const pointer of this.palms.values()) if (pointer.control === control) return true;
    return false;
  }

  snapshot(steering = 0, assist = false): Input {
    const left = this.held("left");
    const right = this.held("right");
    if (left || right) steering = Number(right) - Number(left);
    else
      for (const pointer of this.palms.values())
        if (pointer.control === "wheel") steering = pointer.steer;
    const brake = Number(this.held("brake"));
    return {
      ...neutral,
      steer: Math.max(-1, Math.min(1, steering)),
      throttle: brake === 0 && this.held("throttle") ? 1 : 0,
      brake,
      boost: brake === 0 && this.held("boost"),
      assist,
    };
  }
}
