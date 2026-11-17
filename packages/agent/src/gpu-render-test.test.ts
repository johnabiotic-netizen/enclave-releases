import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GPU_RENDER_TEST } from './gpu-render-test.js';

describe('GPU drawing test', () => {
  it('is the script in images/browser, unchanged', () => {
    const source = readFileSync(
      new URL('../../../images/browser/gl_probe.py', import.meta.url),
      'utf8',
    );
    expect(GPU_RENDER_TEST).toBe(source);
  });
});
