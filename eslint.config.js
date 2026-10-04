import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const architecture = {
  files: ['apps/*/src/**/*.{ts,tsx}'],
  plugins: { boundaries },
  settings: {
    'import/resolver': {
      typescript: {
        project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        noWarnOnMultipleProjects: true,
      },
    },
    'boundaries/legacy-templates': false,
    'boundaries/elements': [
      { type: 'app', pattern: 'apps/*/src/app', capture: ['app'] },
      { type: 'page', pattern: 'apps/*/src/pages', capture: ['app'] },
      { type: 'feature', pattern: 'apps/*/src/features/*', capture: ['app', 'feature'] },
      { type: 'shared', pattern: 'apps/*/src/shared', capture: ['app'] },
    ],
  },
  rules: {
    'boundaries/dependencies': [
      'error',
      {
        default: 'allow',
        policies: [
          {
            from: { element: { type: 'shared' } },
            disallow: { to: { element: { types: { anyOf: ['feature', 'page', 'app'] } } } },
          },
          {
            from: { element: { type: 'feature' } },
            disallow: { to: { element: { types: { anyOf: ['page', 'app'] } } } },
          },
          {
            from: { element: { type: 'page' } },
            disallow: { to: { element: { type: 'app' } } },
          },
          {
            // Entre features distintas solo se entra por index.ts.
            disallow: {
              to: {
                element: {
                  type: 'feature',
                  captured: { feature: '!{{ from.element.captured.feature }}' },
                  fileInternalPath: '!index.ts',
                },
              },
            },
          },
          {
            disallow: {
              to: { element: { type: 'feature', fileInternalPath: '!index.ts' } },
            },
            from: { element: { types: { anyOf: ['page', 'app', 'shared'] } } },
          },
          {
            disallow: { to: { element: { captured: { app: '!{{ from.element.captured.app }}' } } } },
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  architecture,
);
