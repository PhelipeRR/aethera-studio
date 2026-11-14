import { describe, expect, it, vi } from 'vitest';
import { SceneController, type CameraFlightGoal, type SceneCommands } from '../src/renderer/src/features/brain3d/controller';

const goal: CameraFlightGoal = { position: [2.75, 0.18, 0.12], target: [0, -0.16, 0] };

function runtime(flying: CameraFlightGoal | null) {
  const commands = { reset: vi.fn(), flightGoal: () => flying, resumeFlight: vi.fn() };
  return commands as unknown as SceneCommands & typeof commands;
}

describe('SceneController', () => {
  it('moves a flight under way to the runtime that replaces this one', () => {
    const controller = new SceneController();
    const detach = controller.attach(runtime(goal));
    detach();
    const next = runtime(null);
    controller.attach(next);
    expect(next.resumeFlight).toHaveBeenCalledWith(goal);
  });

  it('resumes nothing when the camera was still, and only once', () => {
    const controller = new SceneController();
    controller.attach(runtime(null))();
    const still = runtime(null);
    const detach = controller.attach(still);
    expect(still.resumeFlight).not.toHaveBeenCalled();
    detach();
    const later = runtime(null);
    controller.attach(later);
    expect(later.resumeFlight).not.toHaveBeenCalled();
  });
});
