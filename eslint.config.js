const eslint = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');
const prettierPlugin = require('eslint-plugin-prettier');
const sonarjsPlugin = require('eslint-plugin-sonarjs');

module.exports = [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjsPlugin.configs.recommended,
  {
    plugins: {
      prettier: prettierPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parser: tseslint.parser,
      parserOptions: {
        sourceType: 'module',
      },
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-return-await': 'error',
      'no-implicit-coercion': 'error',
      'no-magic-numbers': [
        'error',
        { ignore: [0, 1, -1], ignoreArrayIndexes: true, enforceConst: true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/function-return-type': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      'no-magic-numbers': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/__generated__/**',
      'coverage/**',
      'eslint.config.js',
    ],
  },
];
