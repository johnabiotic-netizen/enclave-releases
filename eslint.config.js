import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-bundle/**',
      '**/node_modules/**',
      '**/coverage/**',
      'profiles/**',
      '**/release/**',
      '**/e2e-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      'packages/mobile/src/**',
      'packages/mobile/static/**',
      'packages/desktop/src/renderer/**',
      'scripts/phone/pages/**',
    ],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
