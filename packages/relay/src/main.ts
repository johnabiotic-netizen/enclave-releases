// Starts the relay: `node dist/main.js` (settings from the environment, see config.ts).

import { loadConfig } from './config.js';
import { buildRelay } from './server.js';

const config = loadConfig();
const relay = await buildRelay(config);
await relay.app.listen({ host: config.host, port: config.port });
console.log(`Enclave relay listening on ${config.host}:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void relay.close().finally(() => process.exit(0));
  });
}
