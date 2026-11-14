import type { NeuralBridgeApi } from '@neuralbridge/shared/channels';

declare global {
  interface Window {
    neuralbridge: NeuralBridgeApi;
  }
}
