import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROFILE_STATES, PROXY_TYPES, WEBRTC_POLICIES } from './index.js';

// Keeps the TypeScript enums in step with the authoritative JSON Schema.
const schema = JSON.parse(
  readFileSync(new URL('../../../specs/schemas/profile.schema.json', import.meta.url), 'utf8'),
);

describe('shared types match specs/schemas/profile.schema.json', () => {
  it('proxy types', () => {
    expect([...PROXY_TYPES]).toEqual(schema.properties.proxy.properties.type.enum);
  });

  it('profile states', () => {
    expect([...PROFILE_STATES]).toEqual(schema.properties.status.properties.state.enum);
  });

  it('webrtc policies', () => {
    expect([...WEBRTC_POLICIES]).toEqual(schema.properties.fingerprint.properties.webrtc.enum);
  });
});
