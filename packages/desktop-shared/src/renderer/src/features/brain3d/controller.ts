// Kept apart from the scene so the page can hold a controller without loading three.js eagerly.

export interface SceneStats {
  fps: number;
  frames: number;
  impulses: number;
  realImpulses: number;
  particles: number;
  connections: number;
  geometries: number;
  textures: number;
  /** 1 while a camera flight runs. dt is capped per frame, so at low fps a flight outlasts its nominal 0.9 s. */
  flying: number;
  /** Camera position and target, rounded: what "the camera stopped here" means, without reading pixels. */
  camera: string;
}

/** Where a camera flight was going, in plain numbers so it can outlive the runtime that started it. */
export interface CameraFlightGoal {
  position: [number, number, number];
  target: [number, number, number];
}

/** What the page can ask of the scene: camera moves and real activations. */
export interface SceneCommands {
  reset(): void;
  focus(index: number): void;
  orbit(azimuth: number, polar: number): void;
  zoom(factor: number): void;
  activate(index: number): void;
}

type FlightCommands = SceneCommands & { flightGoal(): CameraFlightGoal | null; resumeFlight(goal: CameraFlightGoal): void };

/** Page ↔ scene bridge: the scene attaches itself when mounted; commands before that are ignored. */
export class SceneController implements SceneCommands {
  private target: FlightCommands | null = null;
  private goal: CameraFlightGoal | null = null;

  /**
   * Changing quality replaces the runtime, and automatic quality does it a few seconds after the page opens:
   * a flight under way moves to the next runtime instead of leaving the user's Center click without effect.
   */
  attach(target: FlightCommands): () => void {
    this.target = target;
    if (this.goal) target.resumeFlight(this.goal);
    this.goal = null;
    return () => {
      this.goal = target.flightGoal();
      if (this.target === target) this.target = null;
    };
  }

  reset(): void {
    this.target?.reset();
  }

  focus(index: number): void {
    this.target?.focus(index);
  }

  orbit(azimuth: number, polar: number): void {
    this.target?.orbit(azimuth, polar);
  }

  zoom(factor: number): void {
    this.target?.zoom(factor);
  }

  activate(index: number): void {
    this.target?.activate(index);
  }
}
