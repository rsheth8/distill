import js from '@eslint/js';
import globals from 'globals';

const extGlobals = {
  ...globals.browser,
  chrome: 'readonly',
  distillReadingAssistance: 'readonly', distillMayAutoRun: 'readonly', distillLocalConnectionSnapshot: 'readonly', distillSameLocalConnection: 'readonly'
};

/** CI lint scope: service worker, side panel, shared utils, tests, and the smoke runner. */
export default [
  { files: ['extension/utils/readingAssistance.js', 'extension/utils/localConnection.js', 'extension/utils/sourceReturn.js'], languageOptions: {sourceType:'script',globals:{module:'readonly',crypto:'readonly',TextEncoder:'readonly'}}, rules:{'no-unused-vars':'off'} },
  { ignores: ['node_modules/**', 'backend/node_modules/**'] },
  js.configs.recommended,
  {
    files: ['extension/background.js', 'extension/sidepanel.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...extGlobals, guideDwellTimers:'readonly',
        distillPageUrlKey: 'readonly',
        distillPaperText: 'readonly',
        distillSectionKind: 'readonly',
        distillBuildPrompt: 'readonly', distillPaperNotesText: 'readonly',
        distillResolveBackendBaseUrl: 'readonly',
        distillFormatExportCaptured: 'readonly',
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
        distillMakeThinkFilter: 'readonly',
        distillClassifyLocalError: 'readonly',
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
        distillPaperHelpFields: 'readonly',
        DISTILL_INCLUDE_BACKEND: 'readonly',
        distillApplyAccentCssVars: 'readonly',
        distillNormalizeSelection: 'readonly',
        distillFindCachedHighlight: 'readonly',
        importScripts: 'readonly',
        queuePaperHelp: 'readonly', runOverview: 'readonly', publishPaperHelp: 'readonly', clearPaperHelp: 'readonly',
        runSectionGuide: 'readonly', runAsk: 'readonly', onSectionChanged: 'readonly', resendTerms: 'readonly', onReadingLevelChanged: 'readonly',
        handlePaperMessage: 'readonly', resetPaperView: 'readonly', renderAll: 'readonly', distillTrustFacts: 'readonly', distillParseLabelled: 'readonly', distillGroupBullets: 'readonly', distillBulletKey: 'readonly', paperView: 'readonly'
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
    files: ['extension/paperFeatures.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...extGlobals,
        assistanceEpoch: 'readonly', tabState: 'readonly', toPanel: 'readonly', streamTask: 'readonly', schedulePersistTab: 'readonly',
        readingLevel: 'readonly', distillPaperExcerpt: 'readonly', distillTrustFacts: 'readonly',
        distillParseLabelled: 'readonly', distillParseTerms: 'readonly', distillFindSection: 'readonly',
        distillMergeGlossary: 'readonly', distillPickSections: 'readonly', distillPickPassages: 'readonly', distillUnsupportedDemographicCounts: 'readonly', distillByline: 'readonly'
      }
    },
    rules: { 'no-unused-vars': 'off' }
  },
  {
    files: ['extension/sidepanelPaper.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...extGlobals,
        $: 'readonly', thinkingStreams:'readonly', port: 'readonly', currentTabId: 'readonly', show: 'readonly', hide: 'readonly',
        setStatus: 'readonly', setThinking: 'readonly', setPanel: 'readonly', lastSelectedText: 'readonly',
        distillParseLabelled: 'readonly', distillParseTerms: 'readonly',
        distillBrowserModelAvailability: 'readonly', distillCitedPassages: 'readonly', distillSectionMap: 'readonly', distillRenderSectionMap: 'readonly'
      }
    },
    rules: { 'no-unused-vars': 'off' }
  },
  {
    files: ['extension/reader.js', 'extension/readAlong.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, chrome: 'readonly', distillPdfPaper: 'readonly', distillPaperText: 'readonly' }
    }
  },
  {
    files: ['extension/utils/pdfPaper.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'writable', distillSectionKind: 'readonly', DISTILL_SKIP_SECTION_RE: 'readonly', DISTILL_PREPRINT_HOST_RE: 'readonly' }
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
  distillReadingAssistance: 'readonly', distillMayAutoRun: 'readonly', distillLocalConnectionSnapshot: 'readonly', distillSameLocalConnection: 'readonly',
        browser: 'readonly',
        extractArticle: 'readonly',
        distillExtractPaper: 'readonly',
        distillPaperText: 'readonly',
        distillNodeText: 'readonly', distillCleanHeading: 'readonly',
        distillSectionAtLine: 'readonly',
        distillNodeText: 'readonly',
        distillMarkTerms: 'readonly',
        distillUnmarkTerms: 'readonly'
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
  distillReadingAssistance: 'readonly', distillMayAutoRun: 'readonly', distillLocalConnectionSnapshot: 'readonly', distillSameLocalConnection: 'readonly',
        module: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['extension/utils/exportClip.js', 'extension/utils/accentColor.js', 'extension/utils/articleExtractor.js', 'extension/utils/paperExtractor.js', 'extension/utils/prompts.js', 'extension/utils/paperHelp.js', 'extension/utils/geminiAdapter.js', 'extension/utils/openaiCompatAdapter.js', 'extension/utils/browserModel.js', 'extension/utils/pageStore.js', 'extension/utils/buildConfig.js', 'extension/utils/termMarks.js', 'extension/utils/sectionMap.js'],
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
      'scripts/pack-extension.mjs',
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
        distillFindCachedHighlight: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    // Browser-evaluation callbacks execute in Chrome; orchestration executes in Node.
    files: ['scripts/eval/research/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022, sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, chrome: 'readonly', validateLocal: 'readonly', LanguageModel: 'readonly', wireActiveTab: 'readonly', paperView: 'readonly', __evalRequests: 'readonly', __copiedNotes: 'readonly' }
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
