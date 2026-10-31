import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'profiles/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/mobile/src/**', 'packages/mobile/static/**', 'packages/desktop/src/renderer/**'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
