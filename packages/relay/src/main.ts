// Starts the relay: `node dist/main.js` (settings from the environment, see config.ts).

import { loadConfig } from './config.js';
import { buildRelay } from './server.js';

const config = loadConfig();

// The owner's commands, run inside the relay's container next to the running relay:
//   node /app/relay.mjs invite "<who it is for>"   a single-use invite code for one account
//   node /app/relay.mjs invites                    the invites and whether they were used
const command = process.argv[2];
if (command === 'invite' || command === 'invites') {
  const url = `http://127.0.0.1:${config.port}/r/v1/admin/invites`;
  const res =
    command === 'invite'
      ? await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: process.argv.slice(3).join(' ') }),
        })
      : await fetch(url);
  const body = (await res.json()) as unknown;
  if (!res.ok) {
    console.error(JSON.stringify(body));
    process.exit(1);
  }
  if (command === 'invite') console.log((body as { code: string }).code);
  else console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

const relay = await buildRelay(config);
await relay.app.listen({ host: config.host, port: config.port });
console.log(`Enclave relay listening on ${config.host}:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void relay.close().finally(() => process.exit(0));
  });
}
