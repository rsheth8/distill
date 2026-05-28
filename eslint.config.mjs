import js from '@eslint/js';
import globals from 'globals';

const extGlobals = {
  ...globals.browser,
  chrome: 'readonly'
};

/** CI lint scope: service worker, side panel, shared utils, tests, and the smoke runner. */
export default [
  { ignores: ['node_modules/**', 'backend/node_modules/**'] },
  js.configs.recommended,
  {
    files: ['extension/background.js', 'extension/sidepanel.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...extGlobals,
        distillPageUrlKey: 'readonly',
        distillResolveBackendBaseUrl: 'readonly',
        distillFormatExportCaptured: 'readonly',
        distillBuildExplainExportMarkdown: 'readonly',
        distillBuildExplainExportPlain: 'readonly',
        distillBuildAnalysisExportMarkdown: 'readonly',
        distillBuildAnalysisExportPlain: 'readonly',
        distillBuildPinnedAnalysisMarkdown: 'readonly',
        distillBuildGeminiRequestBody: 'readonly',
        distillParseGeminiChunk: 'readonly',
        distillIsGeminiHardStop: 'readonly',
        distillGeminiBlockedMessage: 'readonly',
        distillParseGeminiRetrySeconds: 'readonly',
        distillClassifyGeminiError: 'readonly',
        distillBuildChatRequestBody: 'readonly',
        distillParseChatChunk: 'readonly',
        distillClassifyChatError: 'readonly',
        DISTILL_HISTORY_PREFIX: 'readonly',
        DISTILL_PAGE_STATE_PREFIX: 'readonly',
        DISTILL_PAGE_STATE_VERSION: 'readonly',
        DISTILL_MAX_SAVED_PAGES: 'readonly',
        DISTILL_PAGE_STATE_TTL_MS: 'readonly',
        distillStableHash: 'readonly',
        distillPageStateKey: 'readonly',
        distillHistoryKey: 'readonly',
        distillBuildPageStatePayload: 'readonly',
        distillPagePayloadToState: 'readonly',
        distillHistoryPayloadToState: 'readonly',
        distillSelectPrunedKeys: 'readonly',
        DISTILL_INCLUDE_BACKEND: 'readonly',
        distillApplyAccentCssVars: 'readonly',
        distillNormalizeSelection: 'readonly',
        distillStableStringHash: 'readonly',
        distillExplainContentHash: 'readonly',
        distillFindCachedHighlight: 'readonly',
        importScripts: 'readonly'
      }
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': 'off',
      'no-useless-escape': 'error',
      'no-duplicate-case': 'error'
    }
  },
  {
    files: ['extension/content.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        chrome: 'readonly',
        browser: 'readonly',
        extractArticle: 'readonly'
      }
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': 'off',
      'no-useless-escape': 'error',
      'no-duplicate-case': 'error'
    }
  },
  {
    files: ['extension/utils/pageUrlKey.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        module: 'readonly',
        URL: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['extension/utils/aiResultCache.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { module: 'readonly' }
    },
    rules: { 'no-unused-vars': 'off' }
  },
  {
    files: ['extension/utils/backendEnv.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        chrome: 'readonly',
        module: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['extension/utils/exportClip.js', 'extension/utils/accentColor.js', 'extension/utils/articleExtractor.js', 'extension/utils/geminiAdapter.js', 'extension/utils/openaiCompatAdapter.js', 'extension/utils/pageStore.js', 'extension/utils/buildConfig.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        module: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['tests/front/**/*.mjs', 'vitest.front.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.vitest, chrome: 'readonly' }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: [
      'scripts/smoke.mjs',
      'scripts/check-api-doc.mjs',
      'tests/unit/**/*.test.mjs',
      'tests/backend/**/*.test.mjs',
      'vitest.config.mjs',
      'backend/scripts/check-remote.mjs'
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.vitest,
        distillNormalizeSelection: 'readonly',
        distillFindCachedHighlight: 'readonly',
        distillExplainContentHash: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['backend/server.js', 'backend/lib/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
];
