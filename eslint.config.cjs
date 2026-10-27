const js = require('@eslint/js');
const parser = require('@typescript-eslint/parser');
const typescript = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'coverage/**', '.cache/**'] },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: {
      parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': typescript },
    rules: {
      ...js.configs.recommended.rules,
      ...typescript.configs['eslint-recommended'].overrides[0].rules,
      ...typescript.configs.recommended.rules,
      // Existing provider and IPC boundaries accept heterogeneous JSON;
      // runtime validation and strict tsc cover those boundary types.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
];
