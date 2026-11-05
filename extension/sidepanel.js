'use strict';

const SAMPLE_PAPER_URL = 'https://arxiv.org/html/1706.03762';

// ── Accent presets ────────────────────────────────────────────────────────────

const ACCENTS = [
  { id: 'ink',     name: 'Ink',     light: '#2f4f73', dark: '#a9c1dc', dot: '#2f4f73' },
  { id: 'blue',    name: 'Ocean',   light: '#2563eb', dark: '#60a5fa', dot: '#3b82f6' },
  { id: 'amber',   name: 'Amber',   light: '#b45309', dark: '#fbbf24', dot: '#f59e0b' },
  { id: 'emerald', name: 'Emerald', light: '#047857', dark: '#34d399', dot: '#10b981' },
  { id: 'violet',  name: 'Violet',  light: '#6d28d9', dark: '#a78bfa', dot: '#8b5cf6' },
  { id: 'rose',    name: 'Rose',    light: '#be123c', dark: '#fb7185', dot: '#f43f5e' },
  { id: 'slate',   name: 'Slate',   light: '#334155', dark: '#94a3b8', dot: '#64748b' },
];

const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function applyAccent(accentId, notify = false) {
  const preset = ACCENTS.find(a => a.id === accentId) || ACCENTS[0];
  const hex    = isDark() ? preset.dark : preset.light;
  const root = document.documentElement;

  distillApplyAccentCssVars(root, hex);

  // Update swatch selection ring
  document.querySelectorAll('.accent-swatch').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === accentId);
  });

  if (notify) {
    chrome.storage.local.set({ accentId });
    port?.postMessage({ type: 'SET_ACCENT', accentId, tabId: currentTabId });
  }
}

// Build swatch UI
const swatchContainer = document.getElementById('accentSwatches');
ACCENTS.forEach(preset => {
  const div = document.createElement('div');
  div.className = 'accent-swatch';
  div.dataset.id = preset.id;
  div.title = preset.name;
  div.style.background = preset.dot;
  div.addEventListener('click', () => applyAccent(preset.id, true));
  swatchContainer.appendChild(div);
});

// Re-apply when system theme changes so light/dark variant updates
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  chrome.storage.local.get('accentId', r => applyAccent(r.accentId || 'ink'));
});

// ── Port connection ───────────────────────────────────────────────────────────

let port = null;
let currentTabId = null;

function connect() {
  port = chrome.runtime.connect({ name: 'sidepanel' });
  port.onMessage.addListener(handleMessage);
  port.onDisconnect.addListener(() => { port = null; clearThinking(); failValidation('Connection interrupted. Reopen the panel or retry.'); setTimeout(connect, 600); });
}
connect();

function wireActiveTab(tabId) {
  if (tabId == null) return;
  currentTabId = tabId;
  clearThinking(); // the other tab's DONE/ERROR is dropped, so its streams would never end
  handleMessage({ type: 'ARTICLE_NAVIGATING', tabId }); // clear the old paper while GET_STATE restores the new one
  port?.postMessage({ type: 'GET_STATE', tabId: currentTabId });
  port?.postMessage({ type: 'GET_USAGE', tabId: currentTabId });
}

// wireActiveTab calls into sidepanelPaper.js, which loads after this file: wait until every script has run.
document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    wireActiveTab(tabs[0].id);
  });
});

chrome.tabs.onActivated.addListener(act => {
  wireActiveTab(act.tabId);
  void refreshSitePrefsUi();
});

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

/** Visual on/off for toolbar action buttons (click again to toggle off). */
function setActionActive(btn, on) {
  if (!btn) return;
  btn.classList.toggle('action-active', !!on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

const settingsBtn      = $('settingsBtn');
const settingsPanel    = $('settingsPanel');
const viewRead         = $('viewRead');
const viewSettings     = $('viewSettings');
const tabReadBtn       = $('tabReadBtn');
const apiKeyInput      = $('apiKeyInput');
const aiProviderSelect = $('aiProviderSelect');
const getKeyLink       = $('getKeyLink');
const getKeyNote       = $('getKeyNote');
const quotaDashLink    = $('quotaDashLink');
const validateKeyBtn   = $('validateKeyBtn');
const keyStatusLine    = $('keyStatusLine');
const saveKeyBtn       = $('saveKeyBtn');
const removeKeyBtn     = $('removeKeyBtn');
const localFields      = $('localFields');
const localBaseUrlInput = $('localBaseUrlInput');
const localModelInput  = $('localModelInput');
const localOriginsCmd  = $('localOriginsCmd');
const copyLocalCmdBtn  = $('copyLocalCmdBtn');
const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434';
const DEFAULT_LOCAL_MODEL = 'qwen3:4b';
const onboardGetKeyLink = $('onboardGetKeyLink');
const onboardSubstep   = $('onboardSubstep');
const onboardKeyInput  = $('onboardKeyInput');
const onboardConnectBtn = $('onboardConnectBtn');
const onboardStatusLine = $('onboardStatusLine');
const advancedBackendDetails = $('advancedBackendDetails');
// BYOK-only production builds compile out the hosted-backend option entirely.
const backendUiEnabled = !(typeof DISTILL_INCLUDE_BACKEND !== 'undefined' && !DISTILL_INCLUDE_BACKEND);
if (!backendUiEnabled && advancedBackendDetails) advancedBackendDetails.classList.add('hidden');
const useBackendProxyToggle = $('useBackendProxyToggle');
const backendTargetSelect = $('backendTargetSelect');
const backendUrlOverrideInput = $('backendUrlOverrideInput');
const backendStatusRow = $('backendStatusRow');
const backendStatusDot = $('backendStatusDot');
const backendStatusText = $('backendStatusText');
const testBackendBtn = $('testBackendBtn');
const fairUseText      = $('fairUseText');
const usageResetText   = $('usageResetText');
const clearAllHistoryBtn = $('clearAllHistoryBtn');
const noArticle        = $('noArticle');
const waiting          = $('waiting');
const mainContent      = $('mainContent');
const setupHintCard = $('setupHintCard');
const setupHintDismissBtn = $('setupHintDismissBtn');

/** Used to show a one-time-style banner when AI cannot run yet. */
let cachedHasApiKey = false;
let cachedSetupHintDismissed = false;
let cachedBackendAiReady = false;

const DEFAULT_PROVIDER = 'groq';
const PROVIDER_META = {
  groq: {
    keyLink: 'https://console.groq.com/keys',
    keyLinkText: 'Get a free Groq key →',
    keyNote: 'No credit card required.',
    keySource: 'Groq Console · no credit card',
    placeholder: 'Paste your Groq API key (gsk_…)',
    quotaLink: 'https://console.groq.com/settings/limits',
    quotaText: 'Check your Groq limits →'
  },
  openai: {
    keyLink: 'https://platform.openai.com/api-keys',
    keyLinkText: 'Get an OpenAI API key →',
    keyNote: 'OpenAI billing applies (no free tier).',
    keySource: 'OpenAI Platform · billing required',
    placeholder: 'Paste your OpenAI key (sk-…)',
    quotaLink: 'https://platform.openai.com/usage',
    quotaText: 'Check your OpenAI usage →'
  },
  gemini: {
    keyLink: 'https://aistudio.google.com/apikey',
    keyLinkText: 'Get a free Gemini key →',
    keyNote: 'No credit card required.',
    keySource: 'Google AI Studio · no credit card',
    placeholder: 'Paste your Gemini API key (AIza…)',
    quotaLink: 'https://aistudio.google.com/apikey',
    quotaText: 'Check your Gemini usage →'
  },
  anthropic: {
    keyLink: 'https://console.anthropic.com/settings/keys',
    keyLinkText: 'Get an Anthropic API key →',
    keyNote: 'Anthropic billing applies (no free tier).',
    keySource: 'Anthropic Console · billing required',
    placeholder: 'Paste your Anthropic key (sk-ant-…)',
    quotaLink: 'https://console.anthropic.com/settings/usage',
    quotaText: 'Check your Anthropic usage →'
  },
  local: {
    keyLink: 'https://ollama.com/download',
    keyLinkText: 'Get Ollama (free) →',
    keyNote: 'Or LM Studio (lmstudio.ai). Runs on your computer — no key, no quota.',
    keySource: 'Ollama / LM Studio · runs on your computer',
    placeholder: '',
    quotaLink: 'https://ollama.com/library/qwen3',
    quotaText: 'Browse local models →'
  }
};
const PROVIDER_STORAGE = { groq: 'groqApiKey', openai: 'openaiApiKey', gemini: 'geminiApiKey', anthropic: 'anthropicApiKey' };
let currentProvider = DEFAULT_PROVIDER;
const providerKeys = { groq: '', openai: '', gemini: '', anthropic: '' };
let pendingValidation = null; // snapshot of the provider and key being checked
let validationSequence = 0;

let validationTimer = null;
function clearValidation() {
  clearTimeout(validationTimer);
  validationTimer = null;
  pendingValidation = null;
  onboardConnectBtn.disabled = validateKeyBtn.disabled = saveKeyBtn.disabled = false;
}
function failValidation(message) {
  if (!pendingValidation) return;
  const line = pendingValidation.target === 'onboard' ? onboardStatusLine : keyStatusLine;
  clearValidation();
  setKeyStatus(line, 'err', message);
}
function validateProvider(target, key = '', intent = 'test') {
  if (!port) { setKeyStatus(target === 'onboard' ? onboardStatusLine : keyStatusLine, 'err', 'Connection unavailable. Reopen the panel and retry.'); return; }
  const requestId = ++validationSequence;
  const localSnapshot = currentProvider === 'local' ? distillLocalConnectionSnapshot(localFieldValues()) : null;
  pendingValidation = { target, provider: currentProvider, key, requestId, intent, localSnapshot };
  onboardConnectBtn.disabled = validateKeyBtn.disabled = saveKeyBtn.disabled = true;
  clearTimeout(validationTimer);
  validationTimer = setTimeout(() => failValidation('No connection result arrived. Check the server and retry.'), 35_000);
  try {
    port.postMessage({type:'VALIDATE_AI_KEY',provider:currentProvider,key,requestId,...(localSnapshot ? {local:localSnapshot} : {})});
  } catch { failValidation('Connection interrupted. Reopen the panel and retry.'); }
}
for (const field of [localModelInput, localBaseUrlInput]) field?.addEventListener('input', () => {
  if (pendingValidation?.provider === 'local') failValidation('Connection settings changed. Test or connect again.');
  else if (currentProvider === 'local') setKeyStatus(keyStatusLine, '', 'Settings changed; Save & connect to use them.');
});

function normProvider(p) { return Object.prototype.hasOwnProperty.call(PROVIDER_META, p) ? p : DEFAULT_PROVIDER; }
function providerMeta(p) { return PROVIDER_META[normProvider(p)]; }

/** Repaint the key UI (placeholder, links, stored key, hasKey flag) for the active provider. */
function applyProviderUi(provider) {
  currentProvider = normProvider(provider);
  const meta = providerMeta(currentProvider);
  if (aiProviderSelect) aiProviderSelect.value = currentProvider;
  if (apiKeyInput) {
    apiKeyInput.placeholder = meta.placeholder;
    apiKeyInput.value = providerKeys[currentProvider] || '';
  }
  if (getKeyLink) { getKeyLink.href = meta.keyLink; getKeyLink.textContent = meta.keyLinkText; }
  if (getKeyNote) getKeyNote.textContent = meta.keyNote;
  if (quotaDashLink) { quotaDashLink.href = meta.quotaLink; quotaDashLink.textContent = meta.quotaText; }
  if (onboardGetKeyLink) { onboardGetKeyLink.href = meta.keyLink; onboardGetKeyLink.textContent = meta.keyLinkText; }
  if (onboardSubstep) onboardSubstep.textContent = meta.keySource;
  if (onboardKeyInput) onboardKeyInput.placeholder = meta.placeholder;
  const isLocal = currentProvider === 'local';
  apiKeyInput?.classList.toggle('hidden', isLocal);
  removeKeyBtn?.classList.toggle('hidden', isLocal);
  localFields?.classList.toggle('hidden', !isLocal);
  if (validateKeyBtn) validateKeyBtn.textContent = isLocal ? 'Test connection' : 'Test key';
  if (localOriginsCmd) localOriginsCmd.textContent = `launchctl setenv OLLAMA_ORIGINS "chrome-extension://${chrome.runtime.id}"`;
  // Local needs no key; the URL/model fields always have defaults.
  cachedHasApiKey = isLocal || !!(providerKeys[currentProvider] && providerKeys[currentProvider].trim());
}

function localFieldValues() {
  return {
    baseUrl: (localBaseUrlInput?.value || '').trim() || DEFAULT_LOCAL_BASE_URL,
    model: (localModelInput?.value || '').trim() || DEFAULT_LOCAL_MODEL
  };
}

function setKeyStatus(el, kind, text) {
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('key-status-ok', 'key-status-err', 'key-status-pending');
  if (kind === 'ok') el.classList.add('key-status-ok');
  else if (kind === 'err') el.classList.add('key-status-err');
  else if (kind === 'pending') el.classList.add('key-status-pending');
}

const backendDownCard  = $('backendDownCard');
const backendDownTitle = $('backendDownTitle');
const backendDownHint  = $('backendDownHint');
const backendStartHelpBtn = $('backendStartHelpBtn');
const backendCopyCmdBtn = $('backendCopyCmdBtn');
const backendRetryBtn  = $('backendRetryBtn');
const progressLabel    = $('progressLabel');
const timeLabel        = $('timeLabel');
const paperCard        = $('paperCard');
const paperWhere       = $('paperWhere'); // the card's sticky last row; shown and hidden with it
const articleTitle     = $('articleTitle');
const fullTextLink     = $('fullTextLink');
const pdfCard          = $('pdfCard');
let fullTextUrl = '';
let pdfReaderUrl = '';
const openInTab = url => { if (url && currentTabId != null) chrome.tabs.update(currentTabId, { url }); };
fullTextLink.addEventListener('click', () => openInTab(fullTextUrl));
$('openInReaderBtn').addEventListener('click', () => openInTab(pdfReaderUrl));
const summaryText      = $('summaryText');
const summaryStatus    = $('summaryStatus');
const summarySection   = $('summarySection');
const highlightSection = $('highlightSection');
const selectedPreview  = $('selectedPreview');
const analyzeBtn       = $('analyzeBtn');
const analysisText     = $('analysisText');
const highlightNoteWrap = $('highlightNoteWrap');
const highlightNoteInput = $('highlightNoteInput');
const highlightNoteSaveBtn = $('highlightNoteSaveBtn');
let lastHighlightId = null;
let lastSelectedText = '';
const toast            = $('toast');
const highlightPrompt  = $('highlightPrompt');
const openHighlightBtn = $('openHighlightBtn');
const suggestionsCard  = $('suggestionsCard');
const suggestionsList  = $('suggestionsList');
const sitePrefsSection = $('sitePrefsSection');
const sitePrefsHostname = $('sitePrefsHostname');
const siteFontScale = $('siteFontScale');
const siteFontScaleLabel = $('siteFontScaleLabel');
const siteThemeSelect = $('siteThemeSelect');
const siteBackendOnlyToggle = $('siteBackendOnlyToggle');
const siteBackendOnlyRow = $('siteBackendOnlyRow');
if (!backendUiEnabled) hide(siteBackendOnlyRow);
let currentSiteOrigin = '';
let sitePrefsSaveTimer = null;
const SITE_PREFS_STORAGE_KEY = 'distillSitePrefsMap';

function setPanel(panel) {
  const views = { read: viewRead, ask: $('viewAsk'), glossary: $('viewGlossary'), settings: viewSettings };
  const tabs = { read: tabReadBtn, ask: $('tabAskBtn'), glossary: $('tabGlossaryBtn') };
  for (const [name, view] of Object.entries(views)) view?.classList.toggle('hidden', name !== panel);
  for (const [name, btn] of Object.entries(tabs)) {
    btn?.classList.toggle('tab-btn-active', name === panel);
    btn?.setAttribute('aria-selected', String(name === panel));
  }
}

setPanel('read');

let backendEndpointSaveTimer = null;

function schedulePersistBackendEndpoint() {
  clearTimeout(backendEndpointSaveTimer);
  backendEndpointSaveTimer = setTimeout(() => {
    backendEndpointSaveTimer = null;
    const sel = backendTargetSelect?.value;
    const target = sel === 'prod' || sel === 'staging' ? sel : 'dev';
    const raw = (backendUrlOverrideInput?.value || '').trim();
    const done = () => { void refreshBackendStatus(); };
    if (raw) {
      chrome.storage.local.set({ backendTarget: target, backendBaseUrlOverride: raw }, done);
    } else {
      chrome.storage.local.remove('backendBaseUrlOverride', () => {
        chrome.storage.local.set({ backendTarget: target }, done);
      });
    }
  }, 350);
}

// ── Backend status probe (no secrets) ─────────────────────────────────────────

function setBackendStatus(kind, text) {
  if (!backendStatusRow || !backendStatusDot || !backendStatusText) return;
  backendStatusRow.classList.toggle('hidden', false);
  backendStatusText.textContent = text;
  const color = kind === 'ok'
    ? 'var(--accent)'
    : (kind === 'warn' ? '#f59e0b' : '#ef4444');
  backendStatusDot.style.background = color;
}

function syncSetupHintCard() {
  if (!setupHintCard) return;
  if (!$('onboardDone').classList.contains('hidden')) return show(setupHintCard);
  const useBackend = useBackendProxyToggle ? useBackendProxyToggle.checked !== false : true;
  const cloudReady = useBackend && cachedBackendAiReady;
  const aiReady = cloudReady || cachedHasApiKey;
  if (aiReady || cachedSetupHintDismissed) {
    hide(setupHintCard);
    return;
  }
  show(setupHintCard);
}

async function refreshBackendStatus() {
  if (!useBackendProxyToggle) return;
  if (useBackendProxyToggle.checked === false) {
    cachedBackendAiReady = false;
    setBackendStatus('ok', 'Using your own AI key (direct)');
    syncSetupHintCard();
    return;
  }
  setBackendStatus('warn', 'Checking Distill cloud…');
  cachedBackendAiReady = false;
  try {
    const base = await distillResolveBackendBaseUrl();
    const r = await fetch(`${base}/v1/config`, { method: 'GET' });
    if (!r.ok) {
      setBackendStatus('error', `Distill cloud error (${r.status})`);
      syncSetupHintCard();
      return;
    }
    const body = await r.json().catch(() => ({}));
    if (!body?.ok) {
      setBackendStatus('error', 'Distill cloud not ready');
      syncSetupHintCard();
      return;
    }
    if (!body.aiReady && !body.anthropicKeyConfigured) {
      setBackendStatus('error', 'Distill cloud is not ready for AI yet.');
      syncSetupHintCard();
      return;
    }
    cachedBackendAiReady = true;
    setBackendStatus('ok', 'Distill cloud is connected.');
    syncSetupHintCard();
  } catch {
    const base = await distillResolveBackendBaseUrl().catch(() => '');
    const tail = base ? ` (${base})` : '';
    const hint =
      base && (base.includes('YOUR_PROD_BACKEND') || base.endsWith('.example'))
        ? ' — check Advanced settings.'
        : ' — check your connection or try again.';
    setBackendStatus('error', `Could not reach Distill cloud${tail}${hint}`);
    syncSetupHintCard();
  }
}

// ── Load saved settings ───────────────────────────────────────────────────────

function applySitePanelFromPrefs(p) {
  const scale = typeof p?.fontScale === 'number' && Number.isFinite(p.fontScale) ? p.fontScale : 1;
  const clamped = Math.max(0.85, Math.min(1.35, scale));
  document.documentElement.style.setProperty('--panel-zoom', String(clamped));
  const t = p?.theme;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}

function schedulePersistSitePrefs() {
  if (!currentSiteOrigin || currentTabId == null) return;
  clearTimeout(sitePrefsSaveTimer);
  sitePrefsSaveTimer = setTimeout(() => {
    sitePrefsSaveTimer = null;
    const raw = Number(siteFontScale?.value);
    const fontScale = Number.isFinite(raw) ? Math.max(0.85, Math.min(1.35, raw / 100)) : 1;
    const theme = siteThemeSelect?.value || 'system';
    port?.postMessage({
      type: 'SAVE_SITE_PREFS',
      tabId: currentTabId,
      origin: currentSiteOrigin,
      fontScale,
      theme,
      backendOnly: !!siteBackendOnlyToggle?.checked
    });
    applySitePanelFromPrefs({
      fontScale,
      theme,
      backendOnly: !!siteBackendOnlyToggle?.checked
    });
  }, 400);
}

async function refreshSitePrefsUi() {
  if (!sitePrefsSection) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
      hide(sitePrefsSection);
      hide(siteBackendOnlyRow);
      currentSiteOrigin = '';
      document.documentElement.style.removeProperty('--panel-zoom');
      document.documentElement.removeAttribute('data-theme');
      return;
    }
    currentSiteOrigin = new URL(tab.url).origin;
    if (sitePrefsHostname) sitePrefsHostname.textContent = new URL(tab.url).hostname;
    show(sitePrefsSection);
    if (backendUiEnabled) show(siteBackendOnlyRow);
    chrome.storage.local.get(SITE_PREFS_STORAGE_KEY, bag => {
      const map = bag[SITE_PREFS_STORAGE_KEY];
      const prefs = map && typeof map === 'object' && map[currentSiteOrigin] && typeof map[currentSiteOrigin] === 'object'
        ? map[currentSiteOrigin]
        : {};
      const pct = Math.min(135, Math.max(85, Math.round(((prefs.fontScale ?? 1) * 100) / 5) * 5));
      if (siteFontScale) siteFontScale.value = String(pct);
      if (siteFontScaleLabel) siteFontScaleLabel.textContent = `${pct}%`;
      if (siteThemeSelect) siteThemeSelect.value = prefs.theme === 'light' || prefs.theme === 'dark' ? prefs.theme : 'system';
      if (siteBackendOnlyToggle) siteBackendOnlyToggle.checked = !!prefs.backendOnly;
      applySitePanelFromPrefs(prefs);
    });
  } catch {
    hide(sitePrefsSection);
    hide(siteBackendOnlyRow);
    currentSiteOrigin = '';
  }
}

chrome.storage.local.get(['localBaseUrl', 'localModel', 'aiProvider', 'geminiApiKey', 'groqApiKey', 'openaiApiKey', 'anthropicApiKey', 'accentId', 'readingAssistance', 'useBackendProxy', 'backendTarget', 'backendBaseUrlOverride', 'distillSetupHintDismissed'], r => {
  providerKeys.gemini = typeof r.geminiApiKey === 'string' ? r.geminiApiKey : '';
  providerKeys.groq = typeof r.groqApiKey === 'string' ? r.groqApiKey : '';
  providerKeys.openai = typeof r.openaiApiKey === 'string' ? r.openaiApiKey : '';
  providerKeys.anthropic = typeof r.anthropicApiKey === 'string' ? r.anthropicApiKey : '';
  if (localBaseUrlInput) localBaseUrlInput.value = typeof r.localBaseUrl === 'string' ? r.localBaseUrl : '';
  if (localModelInput) localModelInput.value = typeof r.localModel === 'string' ? r.localModel : '';
  applyProviderUi(normProvider(r.aiProvider));
  cachedSetupHintDismissed = !!r.distillSetupHintDismissed;
  if (useBackendProxyToggle) useBackendProxyToggle.checked = r.useBackendProxy === true;
  if (backendTargetSelect) {
    const t = r.backendTarget;
    backendTargetSelect.value = t === 'dev' || t === 'staging' ? t : 'prod';
  }
  if (backendUrlOverrideInput) backendUrlOverrideInput.value = typeof r.backendBaseUrlOverride === 'string' ? r.backendBaseUrlOverride : '';
  applyAccent(r.accentId || 'ink');
  applyAssistance(distillReadingAssistance(r));
  if (r.readingAssistance?.schemaVersion !== 1) {
    chrome.storage.local.set({readingAssistance:distillReadingAssistance(r)});
    show($('assistanceMigration'));
  }
  void refreshBackendStatus();
  void refreshSitePrefsUi();
});

siteFontScale?.addEventListener('input', () => {
  if (siteFontScaleLabel) siteFontScaleLabel.textContent = `${siteFontScale.value}%`;
  schedulePersistSitePrefs();
});
siteThemeSelect?.addEventListener('change', schedulePersistSitePrefs);
siteBackendOnlyToggle?.addEventListener('change', schedulePersistSitePrefs);

// ── Settings panel ────────────────────────────────────────────────────────────

settingsBtn.addEventListener('click', () => {
  const settingsOpen = viewSettings && !viewSettings.classList.contains('hidden');
  setPanel(settingsOpen ? 'read' : 'settings');
  if (!settingsOpen) void refreshSitePrefsUi();
});

for (const name of ['read', 'ask', 'glossary']) {
  $(`tab${name[0].toUpperCase()}${name.slice(1)}Btn`)?.addEventListener('click', () => setPanel(name));
}

/** Persist a key for the active provider and mark it the selected provider. */
function saveProviderKey(key, { closePanel = false } = {}) {
  if (currentProvider === 'local') {
    setKeyStatus(keyStatusLine, 'pending', 'Checking the selected model before connecting…');
    validateProvider('settings', '', 'connect');
    return;
  }
  const trimmed = String(key || '').trim();
  if (!trimmed) {
    showToast('Paste your API key first.');
    return;
  }
  const storageKey = PROVIDER_STORAGE[currentProvider];
  chrome.storage.local.set({ [storageKey]: trimmed, aiProvider: currentProvider }, () => {
    providerKeys[currentProvider] = trimmed;
    cachedHasApiKey = true;
    if (apiKeyInput) apiKeyInput.value = trimmed;
    setKeyStatus(keyStatusLine, 'ok', 'Key saved.');
    syncSetupHintCard();
    if (closePanel) setPanel('read');
    showToast('AI key saved!', 'success');
  });
}

saveKeyBtn.addEventListener('click', () => saveProviderKey(apiKeyInput.value, { closePanel: true }));

removeKeyBtn?.addEventListener('click', () => {
  const storageKey = PROVIDER_STORAGE[currentProvider];
  chrome.storage.local.remove(storageKey, () => {
    providerKeys[currentProvider] = '';
    if (apiKeyInput) apiKeyInput.value = '';
    cachedHasApiKey = false;
    setKeyStatus(keyStatusLine, '', '');
    syncSetupHintCard();
    showToast('AI key removed.', 'success');
  });
});

aiProviderSelect?.addEventListener('change', () => {
  clearValidation();
  setKeyStatus(onboardStatusLine, '', '');
  const provider = normProvider(aiProviderSelect.value);
  applyProviderUi(provider);
  setKeyStatus(keyStatusLine, '', '');
  chrome.storage.local.set({ aiProvider: provider }, () => {
    syncSetupHintCard();
  });
});

validateKeyBtn?.addEventListener('click', () => {
  if (currentProvider === 'local') {
    setKeyStatus(keyStatusLine, 'pending', 'Connecting to your local model… (first load can take ~30s)');
    validateProvider('settings');
    return;
  }
  const key = (apiKeyInput?.value || '').trim();
  if (!key) {
    setKeyStatus(keyStatusLine, 'err', 'Paste your API key first.');
    return;
  }
  setKeyStatus(keyStatusLine, 'pending', 'Testing key…');
  validateProvider('settings', key);
});

onboardConnectBtn?.addEventListener('click', () => {
  const key = (onboardKeyInput?.value || '').trim();
  if (!key) {
    setKeyStatus(onboardStatusLine, 'err', 'Paste your key first.');
    return;
  }
  setKeyStatus(onboardStatusLine, 'pending', 'Checking your key…');
  validateProvider('onboard', key);
});

copyLocalCmdBtn?.addEventListener('click', () => {
  navigator.clipboard.writeText(localOriginsCmd?.textContent || '')
    .then(() => showToast('Copied — paste it in Terminal, then restart Ollama.', 'success'))
    .catch(() => showToast('Copy failed — select the command and copy it manually.'));
});

useBackendProxyToggle?.addEventListener('change', () => {
  const useBackendProxy = !!useBackendProxyToggle.checked;
  chrome.storage.local.set({ useBackendProxy }, () => {
    showToast(useBackendProxy ? 'Using Distill cloud backend' : 'Using your own AI key', 'success');
    void refreshBackendStatus();
  });
});

$('onboardLocalBtn').addEventListener('click', () => {
  aiProviderSelect.value = 'local';
  aiProviderSelect.dispatchEvent(new Event('change'));
  setPanel('settings');
});
$('onboardSampleBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: SAMPLE_PAPER_URL });
});

clearAllHistoryBtn?.addEventListener('click', () => {
  const ok = typeof confirm === 'function'
    ? confirm('Clear all saved reading progress, summaries, highlights and check-ins for every page? This only affects this device and cannot be undone.')
    : true;
  if (!ok) return;
  port?.postMessage({ type: 'CLEAR_ALL_HISTORY', tabId: currentTabId });
});

setupHintDismissBtn?.addEventListener('click', () => {
  cachedSetupHintDismissed = true;
  hide($('onboardDone'));
  chrome.storage.local.set({ distillSetupHintDismissed: true }, () => {
    syncSetupHintCard();
    showToast('You can change AI setup anytime in Settings.', 'success');
  });
});

backendTargetSelect?.addEventListener('change', () => {
  schedulePersistBackendEndpoint();
  showToast('Server setting updated', 'success');
});

backendUrlOverrideInput?.addEventListener('input', () => schedulePersistBackendEndpoint());
backendUrlOverrideInput?.addEventListener('change', () => schedulePersistBackendEndpoint());

testBackendBtn?.addEventListener('click', async () => {
  const wasOn = !!useBackendProxyToggle?.checked;
  if (!wasOn) {
    showToast('Turn on Distill cloud under Advanced first.');
    return;
  }
  await refreshBackendStatus();
  const msg = backendStatusText?.textContent || '';
  if (msg.includes('connected')) showToast('Distill cloud OK', 'success');
  else showToast(msg || 'Connection check failed');
});

// ── Focus mode ────────────────────────────────────────────────────────────────

let focusOn = false;
const focusBtn = $('focusBtn');
focusBtn.addEventListener('click', () => {
  focusOn = !focusOn;
  setActionActive(focusBtn, focusOn);
  port?.postMessage({ type: 'SET_FOCUS_MODE', on: focusOn, tabId: currentTabId });
});

// ── Copy notes menu ───────────────────────────────────────────────────────────

for (const btn of document.querySelectorAll('#copyMenu [data-format]')) {
  btn.addEventListener('click', () => {
    $('copyMenu').open = false;
    port?.postMessage({ type: 'GET_NOTES', tabId: currentTabId, format: btn.dataset.format });
  });
}

// ── Learn Mode ────────────────────────────────────────────────────────────────

let learnOn = false;
const learnBtn = $('learnBtn');

function applyAssistance(prefs) {
  learnOn = prefs.checkins;
  $('automaticHelpToggle').checked = prefs.automaticHelp;
  $('checkinsToggle').checked = prefs.checkins;
  setActionActive(learnBtn, learnOn);
  $('assistanceStatus').textContent = !prefs.automaticHelp && !prefs.checkins ? 'Quiet reading' :
    `Assisted reading · ${[prefs.automaticHelp && 'automatic help', prefs.checkins && 'check-ins'].filter(Boolean).join(' + ')}`;
}
function saveAssistance(prefs) {
  applyAssistance(prefs);
  chrome.storage.local.set({readingAssistance:prefs});
  if (!prefs.checkins && quizActive) {
    dismissQuiz();
    port?.postMessage({type:'LATER_QUIZ',tabId:currentTabId});
  }
}
function assistanceFields() {
  return {schemaVersion:1,automaticHelp:$('automaticHelpToggle').checked,checkins:$('checkinsToggle').checked};
}
$('automaticHelpToggle').addEventListener('change',()=>saveAssistance(assistanceFields()));
$('checkinsToggle').addEventListener('change',()=>saveAssistance(assistanceFields()));
$('quietReadingBtn').addEventListener('click',()=>saveAssistance({schemaVersion:1,automaticHelp:false,checkins:false}));
learnBtn.addEventListener('click',()=>saveAssistance({...assistanceFields(),checkins:!learnOn}));

// ── Comprehension quiz ────────────────────────────────────────────────────────

let currentQuestion     = '';
let submittedAnswer     = '';
let quizActive          = false;
let paragraphsUntilNextQuiz = 5;
let highlightHistoryForPage = [];
let quizDismissTimer = null;
let quizArchiveCountdownTimer = null;
let skippedReviewPending = false;

function dismissQuiz() {
  quizActive = false;
  if (quizDismissTimer) {
    clearTimeout(quizDismissTimer);
    quizDismissTimer = null;
  }
  if (quizArchiveCountdownTimer) {
    clearInterval(quizArchiveCountdownTimer);
    quizArchiveCountdownTimer = null;
  }
  skippedReviewPending = false;
  hide(quizStateText);
  quizStateText.textContent = '';
  skipQuizBtn.disabled = false;
  skipQuizBtn.textContent = 'Skip →';
  hide(quizSection);
}
const quizSection       = $('quizSection');
const quizQuestion      = $('quizQuestion');
const quizAnswerWrap    = $('quizAnswerWrap');
const quizAnswer        = $('quizAnswer');
const submitAnswerBtn   = $('submitAnswerBtn');
const quizAnswerDisplay = $('quizAnswerDisplay');
const quizAnswerText    = $('quizAnswerText');
const quizFeedback      = $('quizFeedback');
const quizNext          = $('quizNext');
const skipQuizBtn       = $('skipQuizBtn');
const quizStateText     = $('quizStateText');

function setQuizState(text = '') {
  if (!text) {
    hide(quizStateText);
    quizStateText.textContent = '';
    return;
  }
  quizStateText.textContent = text;
  show(quizStateText);
}

$('laterQuizBtn').addEventListener('click',()=>{dismissQuiz();port?.postMessage({type:'LATER_QUIZ',tabId:currentTabId});});

skipQuizBtn.addEventListener('click', () => {
  skipQuizBtn.disabled = true;
  skipQuizBtn.textContent = 'Skipping...';
  port?.postMessage({ type: 'SKIP_QUIZ', tabId: currentTabId });
});

submitAnswerBtn.addEventListener('click', () => {
  const answer = quizAnswer.value.trim();
  if (!answer) return;
  submittedAnswer = answer;
  submitAnswerBtn.disabled = true;
  submitAnswerBtn.textContent = 'Checking...';
  port?.postMessage({ type: 'SUBMIT_ANSWER', question: currentQuestion, answer, tabId: currentTabId });
});

let analysisForSelection = '';

function findCachedAnalysisForSelection(selection) {
  return distillFindCachedHighlight(highlightHistoryForPage, selection);
}

function applyAnalysisToPanel(entry, selection) {
  const sel = selection || entry?.selection || '';
  analysisBuffer = entry?.analysis || '';
  analysisForSelection = distillNormalizeSelection(sel);
  lastSelectedText = sel;
  lastHighlightId = entry?.id || null;
  if (sel) {
    selectedPreview.textContent = `"${sel.length > 130 ? sel.slice(0, 130) + '…' : sel}"`;
  }
  if (analysisBuffer.trim()) {
    analysisText.textContent = analysisBuffer;
    show(analysisText);
  } else {
    analysisText.textContent = '';
    hide(analysisText);
  }
  if (highlightNoteInput) highlightNoteInput.value = entry?.note || '';
  if (entry?.note) show(highlightNoteWrap);
  analyzeBtn.disabled = !sel || sel.length < 10;
  analyzeBtn.textContent = 'Explain';
}

const ANALYZE_EMPTY_HINT = 'Select text on the page, then tap Explain.';

function resetAnalyzeWorkspace() {
  analysisBuffer = '';
  analysisForSelection = '';
  lastSelectedText = '';
  lastHighlightId = null;
  analysisText.textContent = '';
  hide(analysisText);
  if (highlightNoteInput) highlightNoteInput.value = '';
  hide(highlightNoteWrap);
  analyzeBtn.textContent = 'Explain';
  analyzeBtn.disabled = true;
  selectedPreview.textContent = ANALYZE_EMPTY_HINT;
}

function collapseAnalyzePanel() {
  hide(highlightSection);
  hide(highlightPrompt);
  clearSuggestions();
  resetAnalyzeWorkspace();
}

function exitAnalyzeMode() {
  collapseAnalyzePanel();
}

/** Open the Highlight section with an empty workspace. */
function enterAnalyzeMode({ fresh = true } = {}) {
  show(highlightSection);
  hide(highlightPrompt);
  clearSuggestions();
  if (fresh) resetAnalyzeWorkspace();
  else if (analysisBuffer.trim()) show(analysisText);
}

/** Keep the current in-panel result visible (e.g. right after streaming finishes). */
function showAnalyzePanelKeepingResult() {
  show(highlightSection);
  hide(highlightPrompt);
  if (analysisBuffer.trim()) show(analysisText);
}

function analyzePanelVisible() {
  return highlightSection && !highlightSection.classList.contains('hidden');
}

openHighlightBtn?.addEventListener('click', () => {
  enterAnalyzeMode();
});

function clearSuggestions() {
  if (!suggestionsCard || !suggestionsList) return;
  suggestionsList.innerHTML = '';
  hide(suggestionsCard);
}

function showSuggestionOnce(text, cta, onClick) {
  if (!suggestionsCard || !suggestionsList) return;
  suggestionsList.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'suggestion-item';
  const t = document.createElement('div');
  t.className = 'suggestion-text';
  t.textContent = text;
  const b = document.createElement('button');
  b.className = 'suggestion-cta';
  b.type = 'button';
  b.textContent = cta || 'Open';
  b.addEventListener('click', () => {
    try { onClick?.(); } catch {}
    clearSuggestions();
  });
  row.appendChild(t);
  row.appendChild(b);
  suggestionsList.appendChild(row);
  show(suggestionsCard);
}

backendStartHelpBtn?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('backend-help.html') });
});

backendCopyCmdBtn?.addEventListener('click', () => {
  const cmd = 'npm start --prefix backend';
  navigator.clipboard.writeText(cmd).then(() => showToast('Start command copied.', 'success'));
});

backendRetryBtn?.addEventListener('click', () => {
  hide(backendDownCard);
  port?.postMessage({ type: 'RETRY_LAST_AI', tabId: currentTabId });
});

// ── Highlight analysis ────────────────────────────────────────────────────────

analyzeBtn.addEventListener('click', () => {
  if (!lastSelectedText || lastSelectedText.trim().length < 10) {
    showToast('Select at least a few words on the page first.');
    return;
  }
  const cached = findCachedAnalysisForSelection(lastSelectedText);
  if (cached) {
    applyAnalysisToPanel(cached, lastSelectedText);
    enterAnalyzeMode({ fresh: false });
    showToast('Showing saved analysis (no new AI call).', 'success');
    return;
  }
  analysisText.textContent = '';
  hide(analysisText);
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing...';
  port?.postMessage({ type: 'ANALYZE_SELECTION', tabId: currentTabId, force: false });
});

highlightNoteSaveBtn?.addEventListener('click', () => {
  const note = (highlightNoteInput?.value || '').trim();
  if (!note) return;
  if (lastHighlightId) {
    port?.postMessage({ type: 'UPDATE_HIGHLIGHT_NOTE', tabId: currentTabId, highlightId: lastHighlightId, note });
    return;
  }
  if (!lastSelectedText) {
    showToast('Select text first.');
    return;
  }
  port?.postMessage({ type: 'SAVE_SELECTION_NOTE', tabId: currentTabId, selection: lastSelectedText, note });
});

// ── Message handler ───────────────────────────────────────────────────────────

let nowBuffer      = '';
let summaryBuffer  = '';
let summaryBulletSections = {};
let analysisBuffer = '';
let summaryRenderScheduled = false;
let summaryLastRenderAt = 0;
const SUMMARY_RENDER_MIN_INTERVAL_MS = 120;

function scheduleSummaryRender() {
  if (summaryRenderScheduled) return;
  summaryRenderScheduled = true;
  requestAnimationFrame(() => {
    summaryRenderScheduled = false;
    const now = performance.now();
    if (now - summaryLastRenderAt < SUMMARY_RENDER_MIN_INTERVAL_MS) {
      setTimeout(scheduleSummaryRender, SUMMARY_RENDER_MIN_INTERVAL_MS - (now - summaryLastRenderAt));
      return;
    }
    summaryLastRenderAt = performance.now();
    renderSummary(summaryBuffer, summaryText);
  });
}

function handleMessage(msg) {
  if (msg.tabId && msg.tabId !== currentTabId) return;
  if (typeof handlePaperMessage === 'function') handlePaperMessage(msg); // connect() runs before sidepanelPaper.js loads

  switch (msg.type) {
    case 'LOCAL_MODELS_RESULT': {
      $('discoverModelsBtn').disabled = false;
      if (msg.baseUrl !== $('localBaseUrlInput').value) {
        $('localModelsStatus').textContent = 'Server address changed. List models again.';
        break;
      }
      const list = $('localModelsList');
      list.replaceChildren();
      for (const model of msg.models || []) {
        const option = document.createElement('option'); option.value = model; list.append(option);
      }
      $('localModelsStatus').textContent = msg.message || '';
      break;
    }
    case 'ARTICLE_NAVIGATING':
      clearThinking();
      dismissQuiz();
      highlightHistoryForPage = [];
      analysisBuffer = '';
      analysisForSelection = '';
      hide(paperCard); hide(paperWhere);
      articleTitle.textContent = '';
      hide(fullTextLink);
      hide(pdfCard);
      summaryText.innerHTML = '';
      summaryBuffer = '';
      summaryBulletSections = {};
      progressLabel.textContent = '0 paragraphs read';
      timeLabel.textContent = '';
      hide(highlightPrompt);
      clearSuggestions();
      hide(highlightSection);
      // No full-screen waiting page: keep main UI visible.
      hide(waiting); show(mainContent); hide(noArticle);
      break;

    case 'ARTICLE_DETECTED':
      show(mainContent); hide(waiting); hide(noArticle); hide(pdfCard);
      if (msg.title) { articleTitle.textContent = msg.title; show(paperCard); show(paperWhere); }
      fullTextUrl = msg.fullTextUrl || '';
      fullTextLink.classList.toggle('hidden', !fullTextUrl);
      if (typeof msg.paragraphsUntilNextQuiz === 'number') {
        paragraphsUntilNextQuiz = msg.paragraphsUntilNextQuiz;
      }
      port?.postMessage({ type: 'GET_USAGE', tabId: currentTabId });
      break;

    case 'PDF_DETECTED':
      pdfReaderUrl = msg.readerUrl || '';
    // falls through
    case 'NO_ARTICLE':
      clearThinking();
      dismissQuiz();
      hide(backendDownCard);
      hide(highlightPrompt);
      clearSuggestions();
      hide(highlightSection);
      hide(waiting); hide(mainContent); hide(paperCard); hide(paperWhere); // the card holds the progress line, which mainContent used to hide
      if (msg.type === 'PDF_DETECTED') { show(pdfCard); hide(noArticle); } else { show(noArticle); hide(pdfCard); }
      break;

    case 'PROGRESS_UPDATE': {
      progressLabel.textContent =
        `${msg.readCount} paragraph${msg.readCount !== 1 ? 's' : ''} read`;
      timeLabel.textContent = formatTimeLeft(msg.wordsRead, msg.totalWords);
      if (typeof msg.paragraphsUntilNextQuiz === 'number') {
        paragraphsUntilNextQuiz = msg.paragraphsUntilNextQuiz;
      }
      break;
    }

    // ── So far ──
    case 'SUMMARY_START':
      setThinking('summary', true);
      summaryText.classList.remove('muted');
      summarySection.classList.add('summary-section-streaming');
      summaryText.classList.add('summary-text-streaming');
      setStatus('summaryStatus', 'Updating…', 'updating');
      break;

    case 'SUMMARY_CHUNK':
      summaryBuffer += msg.chunk;
      scheduleSummaryRender();
      break;

    case 'SUMMARY_REWRITE':
      summaryBuffer = (msg.text || '').trim();
      renderSummary(summaryBuffer, summaryText);
      break;

    case 'SUMMARY_DONE':
      setThinking('summary', false);
      summaryBulletSections = msg.bulletSections || {};
      renderSummary(summaryBuffer, summaryText);
      summarySection.classList.remove('summary-section-streaming');
      summaryText.classList.remove('summary-text-streaming');
      setStatus('summaryStatus', 'Done', 'done');
      setTimeout(() => setStatus('summaryStatus', '', ''), 2000);
      break;

    // ── Selection ──
    case 'SELECTION_CHANGED':
      if (msg.selectedText && msg.selectedText.length > 0) {
        const t = msg.selectedText;
        const norm = distillNormalizeSelection(t);
        lastSelectedText = t;
        if (norm !== analysisForSelection) {
          analysisBuffer = '';
          analysisForSelection = '';
          analysisText.textContent = '';
          hide(analysisText);
          lastHighlightId = null;
          if (highlightNoteInput) highlightNoteInput.value = '';
        }
        selectedPreview.textContent = `"${t.length > 130 ? t.slice(0, 130) + '…' : t}"`;
        analyzeBtn.disabled = t.length < 10;
        analyzeBtn.textContent = 'Explain';
        show(highlightNoteWrap);
        show(highlightSection);
        hide(highlightPrompt);
      } else {
        hide(highlightPrompt);
        // Keep the card while an Explain result is streaming or showing; otherwise it goes away.
        const explaining = analyzeBtn.textContent === 'Analyzing...' || analysisBuffer.trim();
        if (!explaining) {
          resetAnalyzeWorkspace();
          hide(highlightSection);
        }
      }
      break;

    case 'ANALYSIS_CACHED':
      applyAnalysisToPanel(
        {
          id: msg.highlightId,
          selection: msg.selection,
          analysis: msg.analysis,
          note: msg.note
        },
        msg.selection
      );
      enterAnalyzeMode({ fresh: false });
      if (msg.fromCache) showToast('Showing saved analysis (no new AI call).', 'success');
      break;

    case 'ANALYSIS_START':
      setThinking('analysis', true);
      analysisBuffer = '';
      analysisText.textContent = '';
      show(analysisText);
      break;

    case 'ANALYSIS_CHUNK':
      analysisBuffer += msg.chunk;
      analysisText.textContent = analysisBuffer;
      break;

    case 'ANALYSIS_DONE':
      setThinking('analysis', false);
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Explain';
      if (msg.highlightId) lastHighlightId = msg.highlightId;
      analysisForSelection = distillNormalizeSelection(lastSelectedText);
      if (highlightNoteInput) highlightNoteInput.value = '';
      show(highlightNoteWrap);
      showAnalyzePanelKeepingResult();
      showToast('Analysis saved.', 'success');
      break;

    case 'HIGHLIGHT_NOTE_SAVED':
      if (msg.highlightId) lastHighlightId = msg.highlightId;
      showToast('Note saved.', 'success');
      break;

    // ── Comprehension quiz ──
    case 'QUIZ_START':
      setThinking('quiz', true);
      if (quizDismissTimer) {
        clearTimeout(quizDismissTimer);
        quizDismissTimer = null;
      }
      if (quizArchiveCountdownTimer) {
        clearInterval(quizArchiveCountdownTimer);
        quizArchiveCountdownTimer = null;
      }
      skippedReviewPending = false;
      quizActive = true;
      currentQuestion = '';
      submittedAnswer = '';
      quizQuestion.textContent = '';
      quizAnswer.value = '';
      hide(quizAnswerWrap);
      hide(quizAnswerDisplay);
      hide(quizFeedback);
      hide(quizNext);
      skipQuizBtn.disabled = false;
      skipQuizBtn.textContent = 'Skip →';
      setQuizState('Check-in active');
      show(quizSection);
      break;

    case 'QUIZ_CHUNK':
      currentQuestion += msg.chunk;
      quizQuestion.textContent = currentQuestion;
      break;

    case 'QUIZ_DONE':
      setThinking('quiz', false);
      setQuizState('Answer to continue');
      show(quizAnswerWrap);
      quizAnswer.focus();
      break;

    case 'FEEDBACK_START':
      setThinking('quiz', true);
      quizFeedback.textContent = '';
      show(quizFeedback);
      submitAnswerBtn.disabled = false;
      submitAnswerBtn.textContent = 'Submit';
      setQuizState('Reviewing your answer...');
      break;

    case 'FEEDBACK_CHUNK':
      quizFeedback.textContent += msg.chunk;
      break;

    case 'FEEDBACK_DONE': {
      setThinking('quiz', false);
      quizActive = false;
      const n = typeof msg.paragraphsUntilNextQuiz === 'number' ? msg.paragraphsUntilNextQuiz : QUIZ_EVERY;
      paragraphsUntilNextQuiz = n;
      // Keep feedback visible briefly so readers can finish it before archiving.
      if (quizDismissTimer) clearTimeout(quizDismissTimer);
      if (quizArchiveCountdownTimer) clearInterval(quizArchiveCountdownTimer);
      let secondsLeft = 7;
      setQuizState(`Closing in ${secondsLeft}s`);
      quizArchiveCountdownTimer = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) {
          clearInterval(quizArchiveCountdownTimer);
          quizArchiveCountdownTimer = null;
          return;
        }
        setQuizState(`Closing in ${secondsLeft}s`);
      }, 1000);
      quizDismissTimer = setTimeout(() => {
        quizDismissTimer = null;
        if (quizArchiveCountdownTimer) {
          clearInterval(quizArchiveCountdownTimer);
          quizArchiveCountdownTimer = null;
        }
        dismissQuiz();
      }, 7000);
      break;
    }

    case 'QUIZ_HISTORY_UPDATE':
      if (skippedReviewPending) {
        skippedReviewPending = false;
        dismissQuiz();
      }
      if (skipQuizBtn.disabled) dismissQuiz();
      break;

    case 'QUIZ_SKIPPED':
      skippedReviewPending = true;
      quizActive = false;
      show(quizSection);
      quizQuestion.textContent = '';
      hide(quizAnswerWrap);
      hide(quizAnswerDisplay);
      hide(quizFeedback);
      hide(quizNext);
      skipQuizBtn.disabled = true;
      skipQuizBtn.textContent = 'Skipped';
      setQuizState('Skipped. Generating a quick model review...');
      break;

    case 'QUIZ_RESTORE': {
      const status = msg.status || 'idle';
      const question = msg.question || '';
      const answer = msg.answer || '';
      const feedback = msg.feedback || '';
      if (typeof msg.paragraphsUntilNextQuiz === 'number') {
        paragraphsUntilNextQuiz = msg.paragraphsUntilNextQuiz;
      }

      if (status === 'idle') {
        dismissQuiz();
        break;
      }

      show(quizSection);
      currentQuestion = question;
      quizQuestion.textContent = question;
      quizAnswer.value = answer;
      quizAnswerText.textContent = answer;
      quizFeedback.textContent = feedback;
      submitAnswerBtn.disabled = false;
      submitAnswerBtn.textContent = 'Submit';
      quizActive = status === 'loading' || status === 'question' || status === 'feedback_loading';

      hide(quizNext);
      hide(quizAnswerDisplay);
      hide(quizAnswerWrap);
      hide(quizFeedback);

      if (status === 'loading') {
        setQuizState('Preparing your check-in...');
        quizQuestion.textContent = question || 'Preparing your check-in...';
      } else if (status === 'question') {
        setQuizState('Check-in active');
        show(quizAnswerWrap);
      } else if (status === 'feedback_loading') {
        setQuizState('Reviewing your answer...');
        show(quizAnswerDisplay);
        show(quizFeedback);
      } else if (status === 'feedback_done') {
        setQuizState('Closing shortly');
        show(quizAnswerDisplay);
        show(quizFeedback);
        if (quizDismissTimer) clearTimeout(quizDismissTimer);
        quizDismissTimer = setTimeout(() => {
          quizDismissTimer = null;
          dismissQuiz();
        }, 2500);
      }
      break;
    }

    case 'ERROR':
      clearThinking();
      if (msg.code === 'BACKEND_DOWN') {
        backendDownTitle.textContent = "Can't reach Distill cloud.";
        backendDownHint.textContent = msg.message || 'Check your connection, then tap Retry.';
        show(backendDownCard);
      } else if (msg.code === 'NO_AI_KEY') {
        hide(backendDownCard);
        cachedHasApiKey = false;
        cachedSetupHintDismissed = false;
        chrome.storage.local.remove('distillSetupHintDismissed');
        syncSetupHintCard();
        showToast(msg.message || 'Add a free AI key in Settings to start.');
      } else {
        hide(backendDownCard);
        showToast(msg.message);
      }
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Explain';
      break;

    case 'BACKEND_RETRYING':
      showToast(msg.message || 'Reconnecting session…', 'success');
      break;

    case 'BACKEND_STATUS': {
      // Keep the settings status indicator in sync with actual routing.
      if (!useBackendProxyToggle?.checked) break;
      const status = msg.status || '';
      if (status === 'ok') {
        cachedBackendAiReady = true;
        setBackendStatus('ok', 'Distill cloud connected');
        syncSetupHintCard();
      }
      else if (status === 'missing_key') setBackendStatus('error', 'Distill cloud is not ready for AI yet.');
      else if (status === 'ai_disabled') setBackendStatus('error', 'Distill cloud is up, but AI is temporarily disabled');
      else if (status === 'fallback_direct') setBackendStatus('warn', 'Distill cloud unavailable — using your API key');
      else if (status === 'direct_forced') setBackendStatus('warn', 'Using your own API key (cloud off)');
      else if (status.startsWith('error_')) setBackendStatus('error', `Distill cloud error (${status.slice('error_'.length)})`);
      else setBackendStatus('error', 'Distill cloud not reachable');
      break;
    }

    case 'RESTORED':
      showToast('Restored your progress from last time.', 'success');
      break;

    case 'ALL_HISTORY_CLEARED': {
      const n = Number(msg.removed) || 0;
      showToast(n > 0 ? `Cleared saved progress for ${n} page${n === 1 ? '' : 's'}.` : 'No saved progress to clear.', 'success');
      break;
    }

    case 'NOTES_DATA': {
      const text = (msg.format === 'plain' ? (msg.plain || '') : (msg.markdown || '')).trim();
      if (!text) {
        showToast('No notes available yet.');
        break;
      }
      const kind = msg.format === 'plain' ? 'plain text' : 'Markdown';
      navigator.clipboard.writeText(text).then(() => {
        showToast(`Notes copied (${kind})!`, 'success');
      });
      break;
    }

    case 'HIGHLIGHT_HISTORY_UPDATE':
      highlightHistoryForPage = Array.isArray(msg.items) ? msg.items : [];
      break;

    case 'USAGE_UPDATE': {
      fairUseText.textContent = 'Fair use: lightweight tasks cost fewer credits than deep analysis.';
      usageResetText.textContent = formatResetText(msg.resetAt);
      break;
    }

    case 'USAGE_UNAVAILABLE':
      fairUseText.textContent = 'You use your own provider’s free quota — Distill adds no limits of its own.';
      if (quotaDashLink) {
        const meta = providerMeta(currentProvider);
        quotaDashLink.href = meta.quotaLink;
        quotaDashLink.textContent = meta.quotaText;
      }
      break;

    case 'KEY_VALIDATION_RESULT': {
      const validation = pendingValidation;
      if (!validation || msg.requestId !== validation.requestId || msg.provider !== validation.provider) break;
      if (validation.provider === 'local' && !distillSameLocalConnection(validation.localSnapshot, localFieldValues())) {
        failValidation('Connection settings changed. Test or connect again.');
        break;
      }
      clearValidation();
      const { target, provider, key } = validation;
      if (provider === 'local') {
        if (!msg.ok) setKeyStatus(keyStatusLine, 'err', msg.message || 'Connection failed. Check the server and model, then retry.');
        else if (validation.intent === 'test') setKeyStatus(keyStatusLine, 'ok', 'Test passed; connection settings are not saved. Use Save & connect to apply them.');
        else {
          const {baseUrl,model} = validation.localSnapshot;
          chrome.storage.local.set({localBaseUrl:baseUrl,localModel:model,aiProvider:'local'}, () => {
            setKeyStatus(keyStatusLine, 'ok', `Connected to ${model}.`);
            syncSetupHintCard(); setPanel('read'); showToast(`Connected to ${model}.`, 'success');
          });
        }
        break;
      }
      if (target === 'onboard') {
        if (msg.ok) {
          providerKeys[provider] = key;
          chrome.storage.local.set({ [PROVIDER_STORAGE[provider]]: key, aiProvider: provider }, () => {
            cachedHasApiKey = true;
            if (apiKeyInput) apiKeyInput.value = key;
            for (const el of [setupHintCard.querySelector('.onboard-row'), $('onboardLocalBtn'), $('onboardGetKeyLink'), $('onboardSubstep'), onboardStatusLine]) hide(el);
            show($('onboardDone'));
            cachedSetupHintDismissed = true;
            chrome.storage.local.set({ distillSetupHintDismissed: true });
          });
        } else {
          setKeyStatus(onboardStatusLine, 'err', msg.message || 'That key didn’t work.');
        }
      } else {
        setKeyStatus(keyStatusLine, msg.ok ? 'ok' : 'err', msg.message || (msg.ok ? 'Key works.' : 'Key check failed.'));
      }
      break;
    }

    case 'FOCUS_SYNC':
      if (msg.tabId !== currentTabId) break;
      focusOn = !!msg.on;
      setActionActive(focusBtn, focusOn);
      break;

    case 'SITE_PREFS':
      if (msg.tabId !== currentTabId) break;
      if (msg.origin && sitePrefsSection) {
        currentSiteOrigin = msg.origin;
        try {
          if (sitePrefsHostname) sitePrefsHostname.textContent = new URL(msg.origin).hostname;
        } catch {}
        show(sitePrefsSection);
        if (backendUiEnabled) show(siteBackendOnlyRow);
        const prefs = msg.prefs && typeof msg.prefs === 'object' ? msg.prefs : {};
        const pct = Math.min(135, Math.max(85, Math.round(((prefs.fontScale ?? 1) * 100) / 5) * 5));
        if (siteFontScale) siteFontScale.value = String(pct);
        if (siteFontScaleLabel) siteFontScaleLabel.textContent = `${pct}%`;
        if (siteThemeSelect) siteThemeSelect.value = prefs.theme === 'light' || prefs.theme === 'dark' ? prefs.theme : 'system';
        if (siteBackendOnlyToggle) siteBackendOnlyToggle.checked = !!prefs.backendOnly;
        applySitePanelFromPrefs(prefs);
      } else {
        currentSiteOrigin = '';
        hide(sitePrefsSection);
        hide(siteBackendOnlyRow);
        document.documentElement.style.removeProperty('--panel-zoom');
        document.documentElement.removeAttribute('data-theme');
      }
      break;

    case 'TOAST':
      if (msg.tabId && msg.tabId !== currentTabId) break;
      showToast(
        msg.message || '',
        msg.variant === 'success' ? 'success' : (msg.variant === 'info' ? 'info' : 'error')
      );
      break;

    case 'OFFLINE_SYNC':
      if (msg.processed > 0) {
        showToast(`Synced ${msg.processed} offline action(s).`, 'success');
      }
      break;

  }
}

const QUIZ_EVERY = 5;

// ── Summary renderer ──────────────────────────────────────────────────────────

function renderSummary(text, container) {
  container.replaceChildren();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const gist = lines.find(l => l.toLowerCase().startsWith('the gist:'));
  const bullets = lines.filter(l => l.startsWith('•')).map(l => l.slice(1).trim());
  const other = lines.filter(l => l !== gist && !l.startsWith('•'));
  if (gist) {
    const p = document.createElement('p');
    p.className = 'gist-line summary-line';
    const label = document.createElement('span');
    label.className = 'gist-label';
    label.textContent = 'The gist: ';
    p.append(label, document.createTextNode(gist.slice('the gist:'.length).trim()));
    container.append(p);
  }
  const order = (paperView.state?.sections || []).map(sec => sec.heading);
  for (const group of distillGroupBullets(bullets, summaryBulletSections, order)) {
    if (group.heading) {
      const h = document.createElement('p');
      h.className = 'summary-group';
      h.textContent = group.heading;
      container.append(h);
    }
    for (const b of group.bullets) {
      const div = document.createElement('div');
      div.className = 'bullet-line summary-line';
      const dot = document.createElement('span');
      dot.className = 'bullet-dot';
      dot.textContent = '•';
      const span = document.createElement('span');
      span.textContent = b;
      div.append(dot, span);
      container.append(div);
    }
  }
  for (const t of other) {
    const p = document.createElement('p');
    p.className = 'body-text summary-line';
    p.style.marginBottom = '4px';
    p.textContent = t;
    container.append(p);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimeLeft(wordsRead, totalWords) {
  if (!totalWords) return '';
  const left = Math.max(0, totalWords - wordsRead);
  const mins = left / 200;
  if (mins < 0.5) return 'almost done';
  if (mins < 1.5) return '~1 min left';
  return `~${Math.round(mins)} min left`;
}

const thinkingStreams = new Set();
/** Logo waves drift while any AI stream runs. */
function setThinking(key, on) {
  if (on) thinkingStreams.add(key); else thinkingStreams.delete(key);
  document.body.classList.toggle('is-thinking', thinkingStreams.size > 0);
}
function clearThinking() { thinkingStreams.clear(); document.body.classList.remove('is-thinking'); }

function show(el) { if (!el) return; el.classList.remove('hidden'); }
function hide(el) { if (!el) return; el.classList.add('hidden'); }

function setStatus(id, text, cls) {
  const el = $(id);
  el.textContent = text;
  el.className = `status-badge ${cls}`.trim();
}

function formatResetText(resetAt) {
  if (!resetAt) return 'Daily credits reset every day.';
  const parsed = new Date(resetAt);
  if (Number.isNaN(parsed.getTime())) return 'Daily credits reset every day.';
  return `Resets at ${parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
}

let toastTimer;
function showToast(msg, type = 'error') {
  toast.textContent = msg;
  toast.className = 'toast';
  if (type === 'success') toast.classList.add('success');
  else if (type === 'info') toast.classList.add('info');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast hidden'; }, 4500);
}
