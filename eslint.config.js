import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'public/wasm/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      // Domain code should remain framework-agnostic and independent of app layers.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'domain/ must stay framework-agnostic.' },
            { name: 'react-dom', message: 'domain/ must stay framework-agnostic.' },
            {
              name: '@tanstack/react-router',
              message: 'domain/ must not depend on routing frameworks.',
            },
          ],
          patterns: [
            {
              group: ['@/app/**', '@/features/**', '@/routes/**', '@/components/**'],
              message:
                'domain/ must not depend on app/routes/features/components.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/infrastructure/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/**', '@/routes/**'],
              message:
                'infrastructure/ provides adapters and should not depend on features/routes.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/**', '@/features/**', '@/routes/**'],
              message: 'shared/ must remain reusable and independent of app layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/effects/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/editor/**'],
              message:
                'effects/ must use shared property controls or local components instead of editor internals.',
            },
            {
              group: ['@/features/timeline/**'],
              message:
                'effects/ must import timeline dependencies through effects/deps/* adapters.',
            },
            {
              group: ['@/features/preview/**'],
              message:
                'effects/ must import preview dependencies through effects/deps/* adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/effects/deps/**/*.{ts,tsx}'],
    rules: {
      // Adapter modules are the allowed integration points.
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/features/timeline/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/editor/**'],
              message:
                'timeline/ must use shared state modules instead of editor feature internals.',
            },
            {
              group: ['@/features/preview/**'],
              message:
                'timeline/ must not depend on preview feature internals; use shared state/services.',
            },
            {
              group: ['@/features/media-library/**'],
              message:
                'timeline/ must import media-library dependencies through timeline/deps/* adapters.',
            },
            {
              group: ['@/features/timeline/deps/media-library'],
              message:
                'timeline/ should use granular media-library adapters (media-library-store/service/resolver/drag-data).',
            },
            {
              group: ['@/features/keyframes/**'],
              message:
                'timeline/ must import keyframes dependencies through timeline/deps/* adapters.',
            },
            {
              group: ['@/features/projects/**'],
              message:
                'timeline/ must import projects dependencies through timeline/deps/* adapters.',
            },
            {
              group: ['@/features/composition-runtime/**'],
              message:
                'timeline/ must import composition-runtime dependencies through timeline/deps/* adapters.',
            },
            {
              group: ['@/features/settings/**'],
              message:
                'timeline/ must import settings dependencies through timeline/deps/* adapters.',
            },
            {
              group: ['@/features/export/**'],
              message:
                'timeline/ must import export dependencies through timeline/deps/* adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/timeline/deps/**/*.{ts,tsx}'],
    rules: {
      // Adapter modules are the allowed integration points.
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/features/preview/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/timeline/**'],
              message:
                'preview/ must import timeline dependencies through preview/deps/* adapters.',
            },
            {
              group: ['@/features/media-library/**'],
              message:
                'preview/ must import media-library dependencies through preview/deps/* adapters.',
            },
            {
              group: ['@/features/player/**'],
              message:
                'preview/ must import player dependencies through preview/deps/* adapters.',
            },
            {
              group: ['@/features/preview/deps/player'],
              message:
                'preview/ should use granular player adapters (player-core/context/pool).',
            },
            {
              group: ['@/features/export/**'],
              message:
                'preview/ must import export dependencies through preview/deps/* adapters.',
            },
            {
              group: ['@/features/keyframes/**'],
              message:
                'preview/ must import keyframes dependencies through preview/deps/* adapters.',
            },
            {
              group: ['@/features/composition-runtime/**'],
              message:
                'preview/ must import composition-runtime dependencies through preview/deps/* adapters.',
            },
            {
              group: ['@/features/preview/deps/timeline'],
              message:
                'preview/ should use granular timeline adapters (timeline-store/edit-preview/utils/source-edit).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/editor/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/timeline/**'],
              message:
                'editor/ must import timeline dependencies through editor/deps/* adapters.',
            },
            {
              group: ['@/features/media-library/**'],
              message:
                'editor/ must import media-library dependencies through editor/deps/* adapters.',
            },
            {
              group: ['@/features/preview/**'],
              message:
                'editor/ must import preview dependencies through editor/deps/* adapters.',
            },
            {
              group: ['@/features/editor/deps/timeline'],
              message:
                'editor/ should use granular timeline adapters (timeline-store/ui/hooks/utils/cache/subscriptions).',
            },
            {
              group: ['@/features/project-bundle/**'],
              message:
                'editor/ must import project-bundle dependencies through editor/deps/* adapters.',
            },
            {
              group: ['@/features/keyframes/**'],
              message:
                'editor/ must import keyframes dependencies through editor/deps/* adapters.',
            },
            {
              group: ['@/features/projects/**'],
              message:
                'editor/ must import projects dependencies through editor/deps/* adapters.',
            },
            {
              group: ['@/features/settings/**'],
              message:
                'editor/ must import settings dependencies through editor/deps/* adapters.',
            },
            {
              group: ['@/features/effects/**'],
              message:
                'editor/ must import effects dependencies through editor/deps/* adapters.',
            },
            {
              group: ['@/features/export/**'],
              message:
                'editor/ must import export dependencies through editor/deps/* adapters.',
            },
            {
              group: ['@/features/composition-runtime/**'],
              message:
                'editor/ must import composition-runtime dependencies through editor/deps/* adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/media-library/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/timeline/**'],
              message:
                'media-library/ must import timeline dependencies through media-library/deps/* adapters.',
            },
            {
              group: ['@/features/projects/**'],
              message:
                'media-library/ must import projects dependencies through media-library/deps/* adapters.',
            },
            {
              group: ['@/features/media-library/deps/timeline'],
              message:
                'media-library/ should use granular timeline adapters (timeline-stores/actions/utils/services).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/media-library/deps/**/*.{ts,tsx}'],
    rules: {
      // Adapter modules are the allowed integration points.
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/features/editor/deps/**/*.{ts,tsx}'],
    rules: {
      // Adapter modules are the allowed integration points.
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/features/preview/deps/**/*.{ts,tsx}'],
    rules: {
      // Adapter modules are the allowed integration points.
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/features/export/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/media-library/**'],
              message:
                'export/ must import media-library dependencies through export/deps/* adapters.',
            },
            {
              group: ['@/features/composition-runtime/**'],
              message:
                'export/ must import composition-runtime dependencies through export/deps/* adapters.',
            },
            {
              group: ['@/features/keyframes/**'],
              message:
                'export/ must import keyframes dependencies through export/deps/* adapters.',
            },
            {
              group: ['@/features/timeline/**'],
              message:
                'export/ must import timeline dependencies through export/deps/* adapters.',
            },
            {
              group: ['@/features/projects/**'],
              message:
                'export/ must import projects dependencies through export/deps/* adapters.',
            },
            {
              group: ['@/features/player/**'],
              message:
                'export/ must import player dependencies through export/deps/* adapters.',
            },
            {
              group: [
                '../composition-runtime/**',
                '../../composition-runtime/**',
                '../../../composition-runtime/**',
                '../keyframes/**',
                '../../keyframes/**',
                '../../../keyframes/**',
                '../timeline/**',
                '../../timeline/**',
                '../../../timeline/**',
                '../projects/**',
                '../../projects/**',
                '../../../projects/**',
                '../player/**',
                '../../player/**',
                '../../../player/**',
                '../media-library/**',
                '../../media-library/**',
                '../../../media-library/**',
              ],
              message:
                'export/ must import external feature modules through export/deps/* adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/export/deps/**/*.{ts,tsx}'],
    rules: {
      // Adapter modules are the allowed integration points.
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/features/keyframes/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/timeline/**'],
              message:
                'keyframes/ must import timeline dependencies through keyframes/deps/* adapters.',
            },
            {
              group: ['@/features/preview/**'],
              message:
                'keyframes/ must import preview dependencies through keyframes/deps/* adapters.',
            },
            {
              group: ['@/features/composition-runtime/**'],
              message:
                'keyframes/ must import composition-runtime dependencies through keyframes/deps/* adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/keyframes/deps/**/*.{ts,tsx}'],
    rules: {
      // Adapter modules are the allowed integration points.
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/features/projects/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/settings/**'],
              message:
                'projects/ must import settings dependencies through projects/deps/* adapters.',
            },
            {
              group: ['@/features/media-library/**'],
              message:
                'projects/ must import media-library dependencies through projects/deps/* adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/projects/deps/**/*.{ts,tsx}'],
    rules: {
      // Adapter modules are the allowed integration points.
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/features/project-bundle/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/media-library/**'],
              message:
                'project-bundle/ must import media-library dependencies through project-bundle/deps/* adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/project-bundle/deps/**/*.{ts,tsx}'],
    rules: {
      // Adapter modules are the allowed integration points.
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/features/composition-runtime/**/*.{ts,tsx}'],
    rules: {
      // Composition runtime should access external feature modules only via local deps/* adapters.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features/editor/**',
                '@/features/effects/**',
                '@/features/export/**',
                '@/features/keyframes/**',
                '@/features/media-library/**',
                '@/features/player/**',
                '@/features/preview/**',
                '@/features/project-bundle/**',
                '@/features/projects/**',
                '@/features/settings/**',
                '@/features/timeline/**',
              ],
              message:
                'Import external feature modules through composition-runtime/deps/* adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/composition-runtime/deps/**/*.{ts,tsx}'],
    rules: {
      // Adapter modules are the allowed integration points.
      'no-restricted-imports': 'off',
    },
  },
)
