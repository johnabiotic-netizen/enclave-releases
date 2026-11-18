// The owner's license tool, run on the owner's PC (specs/license.md):
//   node packages/relay/dist/license-cli.js keygen | issue --name <who> --days <n> | list | revoke <id>
// The private key and the list of issued keys live in ~/.enclave-license/ (never in the repo).
import { generateKeyPairSync, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { b64urlEncode, formatLicenseKey, type LicensePayload } from '@enclave/shared';

const dir = process.env.ENCLAVE_LICENSE_DIR ?? path.join(os.homedir(), '.enclave-license');
const keyFile = path.join(dir, 'private.pem');
const listFile = path.join(dir, 'issued.json');
interface Issued {
  id: string;
  name: string;
  issued: string;
  expires: string;
  revoked?: boolean;
}
const readList = (): Issued[] =>
  existsSync(listFile) ? (JSON.parse(readFileSync(listFile, 'utf8')) as Issued[]) : [];
const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const day = (d: Date) => d.toISOString().slice(0, 10);

function keygen(): void {
  if (existsSync(keyFile))
    throw new Error(
      `A key pair already exists (${keyFile}). Delete it only if you mean to invalidate every issued key.`,
    );
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  console.log(`Private key saved to ${keyFile}. Back it up somewhere safe and never share it.`);
  console.log('Public key (paste into LICENSE_PUBLIC_KEY in packages/agent/src/license.ts):');
  console.log(b64urlEncode(raw));
}

function issue(): void {
  const name = flag('name'),
    days = Number(flag('days'));
  if (!name || !Number.isInteger(days) || days < 1)
    throw new Error('Usage: issue --name <who> --days <n>');
  if (!existsSync(keyFile)) throw new Error('No key pair yet: run keygen first.');
  const now = new Date();
  const payload: LicensePayload = {
    v: 1,
    id: randomBytes(9).toString('base64url'),
    name,
    issued: day(now),
    expires: day(new Date(now.getTime() + days * 86400000)),
    pcs: 1,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = sign(null, bytes, createPrivateKey(readFileSync(keyFile)));
  writeFileSync(
    listFile,
    JSON.stringify(
      [...readList(), { id: payload.id, name, issued: payload.issued, expires: payload.expires }],
      null,
      2,
    ),
  );
  console.log(`Key for ${name}, valid to ${payload.expires} (id ${payload.id}):\n`);
  console.log(formatLicenseKey(bytes, sig));
}

function list(): void {
  const l = readList();
  if (!l.length) return void console.log('No keys issued yet.');
  for (const k of l)
    console.log(
      `${k.id}  ${k.name.padEnd(24)} ${k.issued} to ${k.expires}${k.revoked ? '  REVOKED' : ''}`,
    );
}

function revoke(): void {
  const id = process.argv[3];
  const l = readList(),
    k = l.find((x) => x.id === id);
  if (!k) throw new Error(`No issued key with id "${id}". Run list.`);
  k.revoked = true;
  writeFileSync(listFile, JSON.stringify(l, null, 2));
  console.log(
    `${k.name}'s key is marked revoked here. It takes effect for the user once the relay holds the list (not built yet).`,
  );
}

try {
  const cmd = process.argv[2];
  if (cmd === 'keygen') keygen();
  else if (cmd === 'issue') issue();
  else if (cmd === 'list') list();
  else if (cmd === 'revoke') revoke();
  else console.log('Commands: keygen | issue --name <who> --days <n> | list | revoke <id>');
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
