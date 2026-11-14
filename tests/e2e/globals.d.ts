import type { NeuralBridgeApi } from '@neuralbridge/shared/channels';

// page.evaluate callbacks run in the renderer, where the preload exposes this API.
declare global {
  interface Window {
    neuralbridge: NeuralBridgeApi;
  }
}
