import type { EnclaveBridge } from '../shared/bridge';

declare global {
  interface Window {
    enclave: EnclaveBridge;
  }
}
