'use strict';

// ── Accent presets ────────────────────────────────────────────────────────────

const ACCENTS = [
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
  chrome.storage.local.get('accentId', r => applyAccent(r.accentId || 'blue'));
});

// ── Port connection ───────────────────────────────────────────────────────────

let port = null;
let currentTabId = null;
let currentBrowserTabUrl = '';

function connect() {
  port = chrome.runtime.connect({ name: 'sidepanel' });
  port.onMessage.addListener(handleMessage);
  port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 600); });
}
connect();
// Pinned-analyses cache is bootstrapped at the END of this file — calling it here
// would touch PINS_STORAGE_KEY (a const declared later) inside its temporal dead zone.

function wireActiveTab(tabId) {
  if (tabId == null) return;
  currentTabId = tabId;
  chrome.tabs.get(tabId, t => {
    try {
      const u = t?.url || '';
      currentBrowserTabUrl = (u.startsWith('http://') || u.startsWith('https://')) ? distillPageUrlKey(u) : '';
      if (currentBrowserTabUrl) explainPageKey = currentBrowserTabUrl;
    } catch {
      currentBrowserTabUrl = '';
    }
  });
  port?.postMessage({ type: 'GET_STATE', tabId: currentTabId });
  port?.postMessage({ type: 'GET_USAGE', tabId: currentTabId });
  port?.postMessage({ type: 'GET_RESUME', tabId: currentTabId });
}

chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (!tabs[0]) return;
  wireActiveTab(tabs[0].id);
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

function isActionActive(btn) {
  return !!btn?.classList.contains('action-active');
}

const settingsBtn      = $('settingsBtn');
const settingsPanel    = $('settingsPanel');
const viewRead         = $('viewRead');
const viewSettings     = $('viewSettings');
const tabReadBtn       = $('tabReadBtn');
const tabSettingsBtn   = $('tabSettingsBtn');
const apiKeyInput      = $('apiKeyInput');
const aiProviderSelect = $('aiProviderSelect');
const getKeyLink       = $('getKeyLink');
const getKeyNote       = $('getKeyNote');
const quotaDashLink    = $('quotaDashLink');
const validateKeyBtn   = $('validateKeyBtn');
const keyStatusLine    = $('keyStatusLine');
const saveKeyBtn       = $('saveKeyBtn');
const removeKeyBtn     = $('removeKeyBtn');
const onboardGetKeyLink = $('onboardGetKeyLink');
const onboardKeyInput  = $('onboardKeyInput');
const onboardConnectBtn = $('onboardConnectBtn');
const onboardStatusLine = $('onboardStatusLine');
const useBackendProxyToggle = $('useBackendProxyToggle');
const backendTargetSelect = $('backendTargetSelect');
const backendUrlOverrideInput = $('backendUrlOverrideInput');
const backendStatusRow = $('backendStatusRow');
const backendStatusDot = $('backendStatusDot');
const backendStatusText = $('backendStatusText');
const testBackendBtn = $('testBackendBtn');
const fairUseText      = $('fairUseText');
const usageResetText   = $('usageResetText');
const autoResumeToggle = $('autoResumeToggle');
const aiModeSelect     = $('aiModeSelect');
const autoNowModeSelect = $('autoNowModeSelect');
const readerModeSelect  = $('readerModeSelect');
const noArticle        = $('noArticle');
const waiting          = $('waiting');
const mainContent      = $('mainContent');
const setupHintCard = $('setupHintCard');
const setupHintOpenSettingsBtn = $('setupHintOpenSettingsBtn');
const setupHintDismissBtn = $('setupHintDismissBtn');

/** Used to show a one-time-style banner when AI cannot run yet. */
let cachedHasApiKey = false;
let cachedSetupHintDismissed = false;
let cachedBackendAiReady = false;

const PROVIDER_META = {
  gemini: {
    keyLink: 'https://aistudio.google.com/apikey',
    keyLinkText: 'Get a free Gemini key →',
    keyNote: 'No credit card required.',
    placeholder: 'Paste your Gemini API key (AIza…)',
    quotaLink: 'https://aistudio.google.com/apikey',
    quotaText: 'Check your Gemini usage →'
  },
  groq: {
    keyLink: 'https://console.groq.com/keys',
    keyLinkText: 'Get a free Groq key →',
    keyNote: 'No credit card required.',
    placeholder: 'Paste your Groq API key (gsk_…)',
    quotaLink: 'https://console.groq.com/settings/limits',
    quotaText: 'Check your Groq limits →'
  },
  anthropic: {
    keyLink: 'https://console.anthropic.com/settings/keys',
    keyLinkText: 'Get an Anthropic API key →',
    keyNote: 'Anthropic billing applies (no free tier).',
    placeholder: 'Paste your Anthropic key (sk-ant-…)',
    quotaLink: 'https://console.anthropic.com/settings/usage',
    quotaText: 'Check your Anthropic usage →'
  }
};
const PROVIDER_STORAGE = { gemini: 'geminiApiKey', groq: 'groqApiKey', anthropic: 'anthropicApiKey' };
let currentProvider = 'gemini';
const providerKeys = { gemini: '', groq: '', anthropic: '' };
let pendingValidation = null; // 'settings' | 'onboard'

function normProvider(p) { return (p === 'anthropic' || p === 'groq') ? p : 'gemini'; }
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
  if (onboardGetKeyLink) onboardGetKeyLink.href = meta.keyLink;
  if (onboardKeyInput) onboardKeyInput.placeholder = meta.placeholder;
  cachedHasApiKey = !!(providerKeys[currentProvider] && providerKeys[currentProvider].trim());
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
const progressBar      = $('progressBar');
const progressLabel    = $('progressLabel');
const timeLabel        = $('timeLabel');
const usageLabel       = $('usageLabel');
const articleTitleBar  = $('articleTitleBar');
const articleTitle     = $('articleTitle');
const nowSection       = $('nowSection');
const nowText          = $('nowText');
const nowStatus        = $('nowStatus');
const nowTipBtn        = $('nowTipBtn');
const nowRefreshBtn    = $('nowRefreshBtn');
const nowHintChip      = $('nowHintChip');
let nowHintChipTimer   = null;
const summaryText      = $('summaryText');
const summaryStatus    = $('summaryStatus');
const summarySection   = $('summarySection');
const copyNotesBtn     = $('copyNotesBtn');
const copyNotesPlainBtn = $('copyNotesPlainBtn');
const resumeCard       = $('resumeCard');
const resumeMeta       = $('resumeMeta');
const resumeText       = $('resumeText');
const resumeClearBtn   = $('resumeClearBtn');
const copyBtn          = $('copyBtn');
const explainSection   = $('explainSection');
const explainText      = $('explainText');
const explainStatus    = $('explainStatus');
const explainCloseBtn  = $('explainCloseBtn');
const exportExplainMdBtn = $('exportExplainMdBtn');
const exportExplainTxtBtn = $('exportExplainTxtBtn');
const highlightSection = $('highlightSection');
const selectedPreview  = $('selectedPreview');
const analyzeBtn       = $('analyzeBtn');
const exportAnalysisMdBtn = $('exportAnalysisMdBtn');
const exportAnalysisTxtBtn = $('exportAnalysisTxtBtn');
const analysisText     = $('analysisText');
const highlightNoteWrap = $('highlightNoteWrap');
const highlightNoteInput = $('highlightNoteInput');
const highlightNoteSaveBtn = $('highlightNoteSaveBtn');
let lastHighlightId = null;
let lastSelectedText = '';
const recentCheckinsSection = $('recentCheckinsSection');
const recentCheckinsList = $('recentCheckinsList');
const toast            = $('toast');
const explainBtnMain   = $('explainBtnMain');
const explainRefreshBtn = $('explainRefreshBtn');
const historyDetails   = $('historyDetails');
const moreResumeBadge  = $('moreResumeBadge');
const highlightPrompt  = $('highlightPrompt');
const openHighlightBtn = $('openHighlightBtn');
const checkinsPrompt   = $('checkinsPrompt');
const openCheckinsBtn  = $('openCheckinsBtn');
const analyzeActionBtn = $('analyzeActionBtn');
const historyActionBtn = $('historyActionBtn');
const pinnedAnalysesSection = $('pinnedAnalysesSection');
const pinnedAnalysesList = $('pinnedAnalysesList');
const pageAnalysesSection = $('pageAnalysesSection');
const pageAnalysesList = $('pageAnalysesList');
const routingDot       = $('routingDot');
const routingText      = $('routingText');
const usageFallback    = $('usageFallback');
const suggestionsCard  = $('suggestionsCard');
const suggestionsList  = $('suggestionsList');
const sitePrefsSection = $('sitePrefsSection');
const sitePrefsHostname = $('sitePrefsHostname');
const siteFontScale = $('siteFontScale');
const siteFontScaleLabel = $('siteFontScaleLabel');
const siteThemeSelect = $('siteThemeSelect');
const siteBackendOnlyToggle = $('siteBackendOnlyToggle');
let currentSiteOrigin = '';
let sitePrefsSaveTimer = null;
const SITE_PREFS_STORAGE_KEY = 'distillSitePrefsMap';

function setPanel(panel) {
  const isSettings = panel === 'settings';
  viewRead?.classList.toggle('hidden', isSettings);
  viewSettings?.classList.toggle('hidden', !isSettings);
  tabReadBtn?.classList.toggle('tab-btn-active', !isSettings);
  tabSettingsBtn?.classList.toggle('tab-btn-active', isSettings);
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
    setRoutingStatus('ok', 'Direct');
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
      currentSiteOrigin = '';
      document.documentElement.style.removeProperty('--panel-zoom');
      document.documentElement.removeAttribute('data-theme');
      return;
    }
    currentSiteOrigin = new URL(tab.url).origin;
    if (sitePrefsHostname) sitePrefsHostname.textContent = new URL(tab.url).hostname;
    show(sitePrefsSection);
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
    currentSiteOrigin = '';
  }
}

chrome.storage.local.get(['aiProvider', 'geminiApiKey', 'groqApiKey', 'anthropicApiKey', 'accentId', 'autoResumeAfterQuiz', 'aiMode', 'autoNowMode', 'readerMode', 'learnMode', 'useBackendProxy', 'backendTarget', 'backendBaseUrlOverride', 'distillSetupHintDismissed'], r => {
  providerKeys.gemini = typeof r.geminiApiKey === 'string' ? r.geminiApiKey : '';
  providerKeys.groq = typeof r.groqApiKey === 'string' ? r.groqApiKey : '';
  providerKeys.anthropic = typeof r.anthropicApiKey === 'string' ? r.anthropicApiKey : '';
  applyProviderUi(normProvider(r.aiProvider));
  cachedSetupHintDismissed = !!r.distillSetupHintDismissed;
  if (useBackendProxyToggle) useBackendProxyToggle.checked = r.useBackendProxy === true;
  if (backendTargetSelect) {
    const t = r.backendTarget;
    backendTargetSelect.value = t === 'dev' || t === 'staging' ? t : 'prod';
  }
  if (backendUrlOverrideInput) backendUrlOverrideInput.value = typeof r.backendBaseUrlOverride === 'string' ? r.backendBaseUrlOverride : '';
  applyAccent(r.accentId || 'blue');
  autoResumeAfterQuiz = r.autoResumeAfterQuiz !== false;
  autoResumeToggle.checked = autoResumeAfterQuiz;
  aiModeSelect.value = r.aiMode === 'ultra-lean' ? 'ultra-lean' : 'balanced';
  autoNowModeSelect.value = r.autoNowMode === 'smart' ? 'smart' : 'off';
  readerModeSelect.value = r.readerMode === 'study' ? 'study' : (r.readerMode === 'research' ? 'research' : 'skim');
  learnOn = !!r.learnMode;
  setActionActive($('learnBtn'), learnOn);
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

tabReadBtn?.addEventListener('click', () => setPanel('read'));
tabSettingsBtn?.addEventListener('click', () => {
  setPanel('settings');
  void refreshSitePrefsUi();
});

/** Persist a key for the active provider and mark it the selected provider. */
function saveProviderKey(key, { closePanel = false } = {}) {
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
  const provider = normProvider(aiProviderSelect.value);
  applyProviderUi(provider);
  setKeyStatus(keyStatusLine, '', '');
  chrome.storage.local.set({ aiProvider: provider }, () => {
    syncSetupHintCard();
  });
});

validateKeyBtn?.addEventListener('click', () => {
  const key = (apiKeyInput?.value || '').trim();
  if (!key) {
    setKeyStatus(keyStatusLine, 'err', 'Paste your API key first.');
    return;
  }
  pendingValidation = 'settings';
  setKeyStatus(keyStatusLine, 'pending', 'Testing key…');
  port?.postMessage({ type: 'VALIDATE_AI_KEY', provider: currentProvider, key });
});

onboardConnectBtn?.addEventListener('click', () => {
  const key = (onboardKeyInput?.value || '').trim();
  if (!key) {
    setKeyStatus(onboardStatusLine, 'err', 'Paste your key first.');
    return;
  }
  pendingValidation = 'onboard';
  setKeyStatus(onboardStatusLine, 'pending', 'Checking your key…');
  port?.postMessage({ type: 'VALIDATE_AI_KEY', provider: currentProvider, key });
});

useBackendProxyToggle?.addEventListener('change', () => {
  const useBackendProxy = !!useBackendProxyToggle.checked;
  chrome.storage.local.set({ useBackendProxy }, () => {
    showToast(useBackendProxy ? 'Using Distill cloud backend' : 'Using your own AI key', 'success');
    void refreshBackendStatus();
  });
});

setupHintOpenSettingsBtn?.addEventListener('click', () => {
  setPanel('settings');
  void refreshSitePrefsUi();
});

setupHintDismissBtn?.addEventListener('click', () => {
  cachedSetupHintDismissed = true;
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

autoResumeToggle.addEventListener('change', () => {
  autoResumeAfterQuiz = autoResumeToggle.checked;
  chrome.storage.local.set({ autoResumeAfterQuiz });
});

aiModeSelect.addEventListener('change', () => {
  const aiMode = aiModeSelect.value === 'ultra-lean' ? 'ultra-lean' : 'balanced';
  chrome.storage.local.set({ aiMode });
  showToast(`AI mode: ${aiMode}`, 'success');
});

autoNowModeSelect.addEventListener('change', () => {
  const autoNowMode = autoNowModeSelect.value === 'smart' ? 'smart' : 'off';
  chrome.storage.local.set({ autoNowMode });
  showToast(`Auto "Now reading": ${autoNowMode}`, 'success');
});

readerModeSelect.addEventListener('change', () => {
  const readerMode = readerModeSelect.value === 'study'
    ? 'study'
    : (readerModeSelect.value === 'research' ? 'research' : 'skim');

  // Preset pacing/AI defaults only — toolbar toggles (Learn, Focus, etc.) stay independent.
  const patch = { readerMode };
  if (readerMode === 'skim') {
    patch.autoNowMode = 'off';
    patch.aiMode = 'ultra-lean';
    autoNowModeSelect.value = 'off';
    aiModeSelect.value = 'ultra-lean';
  } else if (readerMode === 'study') {
    patch.autoNowMode = 'smart';
    patch.aiMode = 'balanced';
    autoNowModeSelect.value = 'smart';
    aiModeSelect.value = 'balanced';
  } else {
    patch.autoNowMode = 'off';
    patch.aiMode = 'balanced';
    autoNowModeSelect.value = 'off';
    aiModeSelect.value = 'balanced';
  }
  chrome.storage.local.set(patch);
  showToast(`Reader mode: ${readerMode}`, 'success');
});

// ── Focus mode ────────────────────────────────────────────────────────────────

let focusOn = false;
const focusBtn = $('focusBtn');
const focusIcon = $('focusIcon');
focusBtn.addEventListener('click', () => {
  focusOn = !focusOn;
  setActionActive(focusBtn, focusOn);
  if (focusIcon) focusIcon.textContent = focusOn ? '◉' : '◎';
  port?.postMessage({ type: 'SET_FOCUS_MODE', on: focusOn, tabId: currentTabId });
});

// ── Auto-scroll ───────────────────────────────────────────────────────────────

let scrolling  = false;
let scrollSpeed = 200;
const SPEED_STEP = 25, SPEED_MIN = 75, SPEED_MAX = 400;
let autoResumeAfterQuiz = true;
let resumeScrollAfterQuiz = false;

const scrollPlayBtn    = $('scrollPlayBtn');
const scrollSlowBtn    = $('scrollSlowBtn');
const scrollFastBtn    = $('scrollFastBtn');
const scrollSpeedLabel = $('scrollSpeedLabel');

function updateSpeedLabel() { scrollSpeedLabel.textContent = scrollSpeed; }

function setScrolling(on) {
  scrolling = on;
  const scrollIco = scrollPlayBtn?.querySelector('.action-ico');
  if (scrollIco) scrollIco.textContent = on ? '⏸' : '▶';
  setActionActive(scrollPlayBtn, on);
  if (on) {
    hide(nowSection);
  } else if (nowBuffer.trim()) {
    showNowPanelIfAllowed();
  }
}

nowTipBtn?.addEventListener('click', () => requestNowTip({ force: false }));
nowRefreshBtn?.addEventListener('click', () => requestNowTip({ force: true }));

scrollPlayBtn.addEventListener('click', () => {
  if (quizActive) return;
  if (scrolling) {
    setScrolling(false);
    port?.postMessage({ type: 'STOP_SCROLL', tabId: currentTabId });
  } else {
    setScrolling(true);
    port?.postMessage({ type: 'START_SCROLL', speed: scrollSpeed, tabId: currentTabId });
  }
});

scrollSlowBtn.addEventListener('click', () => {
  scrollSpeed = Math.max(SPEED_MIN, scrollSpeed - SPEED_STEP);
  updateSpeedLabel();
  if (scrolling) port?.postMessage({ type: 'SET_SCROLL_SPEED', speed: scrollSpeed, tabId: currentTabId });
});

scrollFastBtn.addEventListener('click', () => {
  scrollSpeed = Math.min(SPEED_MAX, scrollSpeed + SPEED_STEP);
  updateSpeedLabel();
  if (scrolling) port?.postMessage({ type: 'SET_SCROLL_SPEED', speed: scrollSpeed, tabId: currentTabId });
});

// ── Learn Mode ────────────────────────────────────────────────────────────────

let learnOn = false;
const learnBtn = $('learnBtn');

learnBtn.addEventListener('click', () => {
  learnOn = !learnOn;
  setActionActive(learnBtn, learnOn);
  port?.postMessage({ type: 'LEARN_MODE', on: learnOn, tabId: currentTabId });
  // Turning off while a quiz is active → dismiss it immediately and unfreeze the page
  if (!learnOn && quizActive) {
    dismissQuiz();
    port?.postMessage({ type: 'SKIP_QUIZ', tabId: currentTabId });
  }
});

// ── Comprehension quiz ────────────────────────────────────────────────────────

let currentQuestion     = '';
let submittedAnswer     = '';
let quizActive          = false;
let paragraphsUntilNextQuiz = 5;
let recentCheckins = [];
const PINS_STORAGE_KEY = 'distillPinnedAnalyses';
const MAX_PINNED_ANALYSES = 12;
let highlightPageMeta = { pageUrl: '', title: '' };
let highlightHistoryForPage = [];
let pinnedAnalysesCache = [];
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
  maybeResumeScrollAfterQuiz();
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

function maybeResumeScrollAfterQuiz() {
  if (!resumeScrollAfterQuiz) return;
  if (scrolling) {
    resumeScrollAfterQuiz = false;
    return;
  }
  if (!autoResumeAfterQuiz) {
    resumeScrollAfterQuiz = false;
    return;
  }
  resumeScrollAfterQuiz = false;
  setScrolling(true);
  port?.postMessage({ type: 'START_SCROLL', speed: scrollSpeed, tabId: currentTabId });
}

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

// ── Copy summary ──────────────────────────────────────────────────────────────

copyBtn.addEventListener('click', () => {
  if (!summaryBuffer) return;
  navigator.clipboard.writeText(summaryBuffer).then(() => {
    const prev = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = prev; }, 1500);
  });
});

copyNotesBtn?.addEventListener('click', () => {
  port?.postMessage({ type: 'GET_NOTES', tabId: currentTabId, format: 'markdown' });
});

copyNotesPlainBtn?.addEventListener('click', () => {
  port?.postMessage({ type: 'GET_NOTES', tabId: currentTabId, format: 'plain' });
});

// ── Explain this page ─────────────────────────────────────────────────────────

let explainPageKey = '';

function currentExplainPageKey() {
  return explainPageKey || currentBrowserTabUrl || highlightPageMeta.pageUrl || '';
}

function explainPanelVisible() {
  return explainSection && !explainSection.classList.contains('hidden');
}

function renderExplainFromBuffer() {
  explainText.textContent = explainBuffer;
  setExplainExportEnabled(!!explainBuffer.trim());
}

function requestExplain({ force = false } = {}) {
  hideNowHintChip();
  hide(noArticle);
  hide(waiting);
  show(mainContent);
  show(explainSection);
  setActionActive(explainBtnMain, true);
  clearSuggestions();

  const key = currentExplainPageKey();
  if (!force && explainBuffer.trim() && explainPageKey && explainPageKey === key) {
    renderExplainFromBuffer();
    setStatus('explainStatus', '', '');
    return;
  }

  explainBuffer = '';
  explainText.textContent = '';
  setExplainExportEnabled(false);
  setStatus('explainStatus', '⟳ Reading page...', 'updating');
  port?.postMessage({ type: 'EXPLAIN_PAGE', tabId: currentTabId, force: !!force });
}

function collapseExplainPanel() {
  hide(explainSection);
  setStatus('explainStatus', '', '');
  setActionActive(explainBtnMain, false);
}

function exitExplainMode() {
  collapseExplainPanel();
}

function enterExplainMode({ fetch = true, force = false } = {}) {
  setActionActive(explainBtnMain, true);
  if (fetch) requestExplain({ force });
  else if (explainBuffer.trim()) {
    show(explainSection);
    renderExplainFromBuffer();
  } else {
    requestExplain({ force: false });
  }
}

function toggleExplainPanel() {
  if (explainPanelVisible()) {
    collapseExplainPanel();
    return;
  }
  enterExplainMode({ fetch: true, force: false });
}

function hideNowHintChip() {
  if (!nowHintChip) return;
  if (nowHintChipTimer) {
    clearTimeout(nowHintChipTimer);
    nowHintChipTimer = null;
  }
  hide(nowHintChip);
}

function showNowHintChip() {
  if (!nowHintChip) return;
  show(nowHintChip);
  if (nowHintChipTimer) clearTimeout(nowHintChipTimer);
  nowHintChipTimer = setTimeout(() => {
    nowHintChipTimer = null;
    hideNowHintChip();
  }, 8000);
}

function showNowPanelIfAllowed() {
  if (scrolling) return;
  show(nowSection);
}

function requestNowTip({ force = false } = {}) {
  hideNowHintChip();
  port?.postMessage({ type: 'REQUEST_NOW_TIP', tabId: currentTabId, force: !!force });
}

$('explainBtnNoArticle').addEventListener('click', () => enterExplainMode({ fetch: true, force: false }));
$('explainBtnMain').addEventListener('click', toggleExplainPanel);

explainCloseBtn?.addEventListener('click', exitExplainMode);
explainRefreshBtn?.addEventListener('click', () => requestExplain({ force: true }));

function buildExplainExportMarkdown() {
  const capturedAt = distillFormatExportCaptured();
  return distillBuildExplainExportMarkdown({
    title: (articleTitle?.textContent || '').trim(),
    body: (explainBuffer || '').trim(),
    capturedAt
  });
}

function buildExplainExportPlain() {
  const capturedAt = distillFormatExportCaptured();
  return distillBuildExplainExportPlain({
    title: (articleTitle?.textContent || '').trim(),
    body: (explainBuffer || '').trim(),
    capturedAt
  });
}

function buildAnalysisExportMarkdown() {
  const capturedAt = distillFormatExportCaptured();
  return distillBuildAnalysisExportMarkdown({
    title: (articleTitle?.textContent || '').trim(),
    quote: (lastSelectedText || '').trim(),
    analysis: (analysisBuffer || '').trim(),
    capturedAt
  });
}

function buildAnalysisExportPlain() {
  const capturedAt = distillFormatExportCaptured();
  return distillBuildAnalysisExportPlain({
    title: (articleTitle?.textContent || '').trim(),
    quote: (lastSelectedText || '').trim(),
    analysis: (analysisBuffer || '').trim(),
    capturedAt
  });
}

function setExplainExportEnabled(on) {
  if (exportExplainMdBtn) exportExplainMdBtn.disabled = !on;
  if (exportExplainTxtBtn) exportExplainTxtBtn.disabled = !on;
}

function setAnalysisExportEnabled(on) {
  if (exportAnalysisMdBtn) exportAnalysisMdBtn.disabled = !on;
  if (exportAnalysisTxtBtn) exportAnalysisTxtBtn.disabled = !on;
}

exportExplainMdBtn?.addEventListener('click', () => {
  const t = buildExplainExportMarkdown();
  if (!t) return;
  navigator.clipboard.writeText(t).then(() => showToast('Explanation copied (Markdown)', 'success'));
});

exportExplainTxtBtn?.addEventListener('click', () => {
  const t = buildExplainExportPlain();
  if (!t) return;
  navigator.clipboard.writeText(t).then(() => showToast('Explanation copied (plain text)', 'success'));
});

exportAnalysisMdBtn?.addEventListener('click', () => {
  const t = buildAnalysisExportMarkdown();
  if (!t) return;
  navigator.clipboard.writeText(t).then(() => showToast('Analysis copied (Markdown)', 'success'));
});

exportAnalysisTxtBtn?.addEventListener('click', () => {
  const t = buildAnalysisExportPlain();
  if (!t) return;
  navigator.clipboard.writeText(t).then(() => showToast('Analysis copied (plain text)', 'success'));
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
  setAnalysisExportEnabled(!!analysisBuffer.trim());
  analyzeBtn.disabled = !sel || sel.length < 10;
  analyzeBtn.textContent = 'Analyze →';
}

const ANALYZE_EMPTY_HINT = 'Select text on the page, then tap Analyze →.';

function resetAnalyzeWorkspace() {
  analysisBuffer = '';
  analysisForSelection = '';
  lastSelectedText = '';
  lastHighlightId = null;
  analysisText.textContent = '';
  hide(analysisText);
  if (highlightNoteInput) highlightNoteInput.value = '';
  hide(highlightNoteWrap);
  setAnalysisExportEnabled(false);
  analyzeBtn.textContent = 'Analyze →';
  analyzeBtn.disabled = true;
  selectedPreview.textContent = ANALYZE_EMPTY_HINT;
}

function collapseAnalyzePanel() {
  hide(highlightSection);
  hide(highlightPrompt);
  setActionActive(analyzeActionBtn, false);
  clearSuggestions();
  resetAnalyzeWorkspace();
}

function exitAnalyzeMode() {
  collapseAnalyzePanel();
}

/** Open analyze toolbar mode with an empty workspace (prior results stay in History). */
function enterAnalyzeMode({ fresh = true } = {}) {
  setActionActive(analyzeActionBtn, true);
  show(highlightSection);
  hide(highlightPrompt);
  clearSuggestions();
  if (fresh) resetAnalyzeWorkspace();
  else if (analysisBuffer.trim()) show(analysisText);
}

/** Keep the current in-panel result visible (e.g. right after streaming finishes). */
function showAnalyzePanelKeepingResult() {
  setActionActive(analyzeActionBtn, true);
  show(highlightSection);
  hide(highlightPrompt);
  if (analysisBuffer.trim()) show(analysisText);
}

function analyzePanelVisible() {
  return highlightSection && !highlightSection.classList.contains('hidden');
}

function toggleAnalyzeMode() {
  if (analyzePanelVisible()) {
    collapseAnalyzePanel();
    return;
  }
  enterAnalyzeMode({ fresh: true });
  if (!lastSelectedText || lastSelectedText.trim().length < 10) {
    show(highlightPrompt);
    showSuggestionOnce('Select text on the page to analyze a highlight.', 'Got it', () => {});
  }
}

openHighlightBtn?.addEventListener('click', () => {
  enterAnalyzeMode();
});

openCheckinsBtn?.addEventListener('click', () => {
  if (historyDetails) {
    historyDetails.open = true;
    setActionActive(historyActionBtn, true);
  }
  show(recentCheckinsSection);
  hide(checkinsPrompt);
  clearSuggestions();
});

analyzeActionBtn?.addEventListener('click', toggleAnalyzeMode);

function toggleHistoryPanel() {
  if (!historyDetails) return;
  historyDetails.open = !historyDetails.open;
  setActionActive(historyActionBtn, historyDetails.open);
  if (historyDetails.open && currentTabId != null) {
    chrome.tabs.get(currentTabId, t => {
      try {
        const u = t?.url || '';
        currentBrowserTabUrl = (u.startsWith('http://') || u.startsWith('https://')) ? distillPageUrlKey(u) : '';
      } catch {
        currentBrowserTabUrl = '';
      }
      renderPinnedAnalysesList();
    });
  }
}

historyActionBtn?.addEventListener('click', e => {
  e.preventDefault();
  toggleHistoryPanel();
});

historyDetails?.addEventListener('toggle', () => {
  setActionActive(historyActionBtn, !!historyDetails?.open);
});

function setRoutingStatus(kind, text) {
  if (!routingDot || !routingText) return;
  routingText.textContent = text || 'Auto';
  const color = kind === 'ok'
    ? 'var(--accent)'
    : (kind === 'warn' ? '#f59e0b' : '#ef4444');
  routingDot.style.background = color;
}

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
let analysisBuffer = '';
let explainBuffer  = '';
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

  switch (msg.type) {

    case 'ARTICLE_NAVIGATING':
      hideNowHintChip();
      resumeScrollAfterQuiz = false;
      dismissQuiz();
      recentCheckins = [];
      highlightHistoryForPage = [];
      highlightPageMeta = { pageUrl: '', title: '' };
      explainBuffer = '';
      explainPageKey = '';
      analysisBuffer = '';
      analysisForSelection = '';
      renderPageAnalysesList();
      renderRecentCheckins();
      hide(articleTitleBar);
      articleTitle.textContent = '';
      summaryText.innerHTML = '';
      summaryBuffer = '';
      hide(copyBtn);
      hide(copyNotesBtn);
      hide(copyNotesPlainBtn);
      progressBar.style.width = '0%';
      progressLabel.textContent = '0 paragraphs read';
      timeLabel.textContent = '';
      nowBuffer = '';
      nowText.textContent = '';
      hideNowHintChip();
      hide(nowSection);
      hide(highlightPrompt);
      hide(checkinsPrompt);
      clearSuggestions();
      hide(explainSection);
      setActionActive(explainBtnMain, false);
      hide(highlightSection);
      setActionActive(analyzeActionBtn, false);
      // No full-screen waiting page: keep main UI visible.
      hide(waiting); show(mainContent); hide(noArticle);
      break;

    case 'ARTICLE_DETECTED':
      show(mainContent); hide(waiting); hide(noArticle);
      if (msg.title) { articleTitle.textContent = msg.title; show(articleTitleBar); }
      if (msg.pageUrl) explainPageKey = distillPageUrlKey(msg.pageUrl);
      if (typeof msg.paragraphsUntilNextQuiz === 'number') {
        paragraphsUntilNextQuiz = msg.paragraphsUntilNextQuiz;
      }
      port?.postMessage({ type: 'GET_USAGE', tabId: currentTabId });
      break;

    case 'NO_ARTICLE':
      hideNowHintChip();
      resumeScrollAfterQuiz = false;
      dismissQuiz();
      hide(backendDownCard);
      hide(highlightPrompt);
      hide(checkinsPrompt);
      clearSuggestions();
      hide(explainSection);
      setActionActive(explainBtnMain, false);
      hide(highlightSection);
      setActionActive(analyzeActionBtn, false);
      show(noArticle); hide(waiting); hide(mainContent);
      break;

    case 'NO_ARTICLE_SERP':
      hideNowHintChip();
      resumeScrollAfterQuiz = false;
      dismissQuiz();
      hide(backendDownCard);
      // Result pages usually aren’t extractable articles; automatically explain instead.
      enterExplainMode({ fetch: true, force: false });
      break;

    case 'PROGRESS_UPDATE': {
      const pct = msg.totalParagraphs > 0
        ? Math.min((msg.readCount / msg.totalParagraphs) * 100, 100) : 0;
      progressBar.style.width = `${pct}%`;
      progressLabel.textContent =
        `${msg.readCount} paragraph${msg.readCount !== 1 ? 's' : ''} read`;
      timeLabel.textContent = formatTimeLeft(msg.wordsRead, msg.totalWords);
      if (typeof msg.paragraphsUntilNextQuiz === 'number') {
        paragraphsUntilNextQuiz = msg.paragraphsUntilNextQuiz;
      }
      // Reduce clutter: once the user starts reading, hide the resume card.
      if (msg.readCount > 0) hide(resumeCard);
      break;
    }

    // ── Now reading ──
    case 'NOW_CACHED':
      nowBuffer = (msg.text || '').trim();
      nowText.textContent = nowBuffer;
      showNowPanelIfAllowed();
      setStatus('nowStatus', '', '');
      if (msg.fromCache) showToast('Showing saved reading tip.', 'success');
      break;

    case 'NOW_START':
      nowBuffer = '';
      nowText.textContent = '';
      hideNowHintChip();
      showNowPanelIfAllowed();
      setStatus('nowStatus', '⟳', 'updating');
      nowText.classList.add('fading');
      setTimeout(() => nowText.classList.remove('fading'), 220);
      break;

    case 'NOW_CHUNK':
      nowBuffer += msg.chunk;
      nowText.textContent = nowBuffer;
      break;

    case 'NOW_DONE':
      setStatus('nowStatus', '', '');
      break;

    case 'NOW_HINT':
      showNowHintChip();
      break;

    // ── So far ──
    case 'SUMMARY_START':
      summaryText.classList.remove('muted');
      summarySection.classList.add('summary-section-streaming');
      summaryText.classList.add('summary-text-streaming');
      setStatus('summaryStatus', '⟳', 'updating');
      hide(copyBtn);
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
      summarySection.classList.remove('summary-section-streaming');
      summaryText.classList.remove('summary-text-streaming');
      setStatus('summaryStatus', '✓', 'done');
      setTimeout(() => setStatus('summaryStatus', '', ''), 2000);
      if (summaryBuffer) {
        show(copyBtn);
        show(copyNotesBtn);
        show(copyNotesPlainBtn);
      }
      break;

    // ── Explain page ──
    case 'EXPLAIN_START':
      explainBuffer = '';
      explainText.textContent = '';
      setExplainExportEnabled(false);
      show(explainSection);
      setActionActive(explainBtnMain, true);
      setStatus('explainStatus', '⟳ Reading page...', 'updating');
      break;

    case 'EXPLAIN_CHUNK':
      explainBuffer += msg.chunk;
      explainText.textContent = explainBuffer;
      setExplainExportEnabled(!!explainBuffer.trim());
      break;

    case 'EXPLAIN_CACHED':
      explainBuffer = (msg.text || '').trim();
      explainPageKey = currentExplainPageKey();
      explainText.textContent = explainBuffer;
      show(explainSection);
      setActionActive(explainBtnMain, true);
      setStatus('explainStatus', '', '');
      setExplainExportEnabled(!!explainBuffer);
      if (msg.fromCache) showToast('Showing saved explanation.', 'success');
      break;

    case 'EXPLAIN_DONE':
      explainPageKey = currentExplainPageKey();
      setStatus('explainStatus', '', '');
      setExplainExportEnabled(!!explainBuffer.trim());
      break;

    // ── Selection ──
    case 'SELECTION_CHANGED':
      if (msg.selectedText && msg.selectedText.length > 0) {
        const t = msg.selectedText;
        const norm = distillNormalizeSelection(t);
        lastSelectedText = t;
        selectedPreview.textContent = `"${t.length > 130 ? t.slice(0, 130) + '…' : t}"`;
        analyzeBtn.disabled = t.length < 10;
        analyzeBtn.textContent = 'Analyze →';
        if (highlightNoteInput) highlightNoteInput.value = '';
        show(highlightNoteWrap);

        if (isActionActive(analyzeActionBtn) && analyzePanelVisible()) {
          if (norm !== analysisForSelection) {
            analysisBuffer = '';
            analysisForSelection = '';
            analysisText.textContent = '';
            hide(analysisText);
            setAnalysisExportEnabled(false);
            lastHighlightId = null;
          }
          selectedPreview.textContent = `"${t.length > 130 ? t.slice(0, 130) + '…' : t}"`;
          analyzeBtn.disabled = t.length < 10;
          analyzeBtn.textContent = 'Analyze →';
          show(highlightSection);
          hide(highlightPrompt);
        } else if (isActionActive(analyzeActionBtn)) {
          show(highlightSection);
          hide(highlightPrompt);
        } else {
          show(highlightPrompt);
          showSuggestionOnce('You highlighted something. Want a quick analysis?', 'Analyze', () => {
            enterAnalyzeMode();
            analyzeBtn?.click?.();
          });
        }
      } else {
        hide(highlightPrompt);
        if (isActionActive(analyzeActionBtn) && analyzePanelVisible()) {
          resetAnalyzeWorkspace();
          show(highlightSection);
        } else if (isActionActive(analyzeActionBtn)) {
          lastSelectedText = '';
          show(highlightSection);
        } else {
          lastSelectedText = '';
          hide(highlightSection);
          setAnalysisExportEnabled(false);
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
      analysisBuffer = '';
      analysisText.textContent = '';
      setAnalysisExportEnabled(false);
      show(analysisText);
      break;

    case 'ANALYSIS_CHUNK':
      analysisBuffer += msg.chunk;
      analysisText.textContent = analysisBuffer;
      setAnalysisExportEnabled(!!analysisBuffer.trim());
      break;

    case 'ANALYSIS_DONE':
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze →';
      if (msg.highlightId) lastHighlightId = msg.highlightId;
      analysisForSelection = distillNormalizeSelection(lastSelectedText);
      if (highlightNoteInput) highlightNoteInput.value = '';
      show(highlightNoteWrap);
      setAnalysisExportEnabled(!!analysisBuffer.trim());
      showAnalyzePanelKeepingResult();
      showToast('Analysis saved — also in History → On this page.', 'success');
      break;

    case 'HIGHLIGHT_NOTE_SAVED':
      if (msg.highlightId) lastHighlightId = msg.highlightId;
      showToast('Note saved!', 'success');
      break;

    // ── Auto-scroll events from content script ──
    case 'SCROLL_PAUSED':
    case 'SCROLL_ENDED':
      setScrolling(false);
      break;

    // ── Comprehension quiz ──
    case 'QUIZ_START':
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
      resumeScrollAfterQuiz = autoResumeAfterQuiz && scrolling;
      if (scrolling) {
        setScrolling(false);
        port?.postMessage({ type: 'STOP_SCROLL', tabId: currentTabId });
      }
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
      setQuizState('Answer to continue');
      show(quizAnswerWrap);
      quizAnswer.focus();
      break;

    case 'FEEDBACK_START':
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
      quizActive = false;
      const n = typeof msg.paragraphsUntilNextQuiz === 'number' ? msg.paragraphsUntilNextQuiz : QUIZ_EVERY;
      paragraphsUntilNextQuiz = n;
      // Keep feedback visible briefly so readers can finish it before archiving.
      if (quizDismissTimer) clearTimeout(quizDismissTimer);
      if (quizArchiveCountdownTimer) clearInterval(quizArchiveCountdownTimer);
      let secondsLeft = 7;
      setQuizState(`Saved to recent check-ins in ${secondsLeft}s`);
      quizArchiveCountdownTimer = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) {
          clearInterval(quizArchiveCountdownTimer);
          quizArchiveCountdownTimer = null;
          return;
        }
        setQuizState(`Saved to recent check-ins in ${secondsLeft}s`);
      }, 1000);
      quizDismissTimer = setTimeout(() => {
        quizDismissTimer = null;
        if (quizArchiveCountdownTimer) {
          clearInterval(quizArchiveCountdownTimer);
          quizArchiveCountdownTimer = null;
        }
        dismissQuiz();
      }, 7000);
      // Suggest where it went without auto-opening.
      show(checkinsPrompt);
      showSuggestionOnce('Check-in saved. Want to review it?', 'View', () => {
        if (historyDetails) {
          historyDetails.open = true;
          setActionActive(historyActionBtn, true);
        }
        show(recentCheckinsSection);
      });
      break;
    }

    case 'QUIZ_HISTORY_UPDATE':
      recentCheckins = Array.isArray(msg.items) ? msg.items : [];
      renderRecentCheckins();
      // Ensure prompt shows only when there's actually something to view.
      if (recentCheckins?.length) show(checkinsPrompt);
      if (skippedReviewPending) {
        skippedReviewPending = false;
        showToast('Skipped check-in review added to history.', 'success');
        dismissQuiz();
      }
      if (skipQuizBtn.disabled) dismissQuiz();
      break;

    case 'QUIZ_SKIPPED':
      skippedReviewPending = true;
      quizActive = false;
      if (!autoResumeAfterQuiz) resumeScrollAfterQuiz = false;
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
        setQuizState('Saved to recent check-ins shortly');
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
      resumeScrollAfterQuiz = false;
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze →';
      setAnalysisExportEnabled(!!analysisBuffer.trim());
      break;

    case 'BACKEND_RETRYING':
      showToast(msg.message || 'Reconnecting session…', 'success');
      break;

    case 'BACKEND_STATUS': {
      // Keep the settings status indicator in sync with actual routing.
      if (!useBackendProxyToggle?.checked) { setRoutingStatus('ok', 'Direct'); break; }
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

      if (status === 'ok') setRoutingStatus('ok', 'Cloud');
      else if (status === 'fallback_direct') setRoutingStatus('warn', 'Direct');
      else if (status === 'direct_forced') setRoutingStatus('warn', 'Direct');
      else if (status === 'missing_key' || status === 'ai_disabled') setRoutingStatus('error', 'Cloud');
      else setRoutingStatus('error', 'Offline');
      break;
    }

    case 'RESUME_DATA': {
      const item = msg.item || null;
      if (!item || !item.lastSummary) {
        hide(resumeCard);
        hide(moreResumeBadge);
        break;
      }
      const pct = item.totalParagraphs > 0
        ? Math.min((item.readCount / item.totalParagraphs) * 100, 100)
        : 0;
      resumeMeta.textContent = `Last time: ${Math.round(pct)}% · ${item.readCount || 0}/${item.totalParagraphs || 0} paragraphs`;
      resumeText.textContent = item.lastSummary;
      show(resumeCard);
      // De-emphasize by default: show an indicator but don't auto-open.
      show(moreResumeBadge);
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
      highlightPageMeta = { pageUrl: msg.pageUrl || '', title: msg.title || '' };
      if (msg.pageUrl) explainPageKey = distillPageUrlKey(msg.pageUrl);
      highlightHistoryForPage = Array.isArray(msg.items) ? msg.items : [];
      renderPageAnalysesList();
      break;

    case 'USAGE_UPDATE': {
      const remaining = Number.isFinite(msg.remainingCredits) ? msg.remainingCredits : null;
      const dailyLimit = Number.isFinite(msg.dailyLimit) ? msg.dailyLimit : null;
      if (remaining == null) {
        usageLabel.textContent = 'Credits unavailable';
      } else if (dailyLimit == null || dailyLimit <= 0) {
        usageLabel.textContent = `${remaining} credits left`;
      } else {
        usageLabel.textContent = `${remaining}/${dailyLimit} left`;
      }
      show(usageLabel);
      if (usageFallback) hide(usageFallback);
      fairUseText.textContent = 'Fair use: lightweight tasks cost fewer credits than deep analysis.';
      usageResetText.textContent = formatResetText(msg.resetAt);
      break;
    }

    case 'USAGE_UNAVAILABLE':
      usageLabel.textContent = msg.message || 'Using your own AI key';
      show(usageLabel);
      if (usageFallback) hide(usageFallback);
      fairUseText.textContent = 'You use your own provider’s free quota — Distill adds no limits of its own.';
      if (quotaDashLink) {
        const meta = providerMeta(currentProvider);
        quotaDashLink.href = meta.quotaLink;
        quotaDashLink.textContent = meta.quotaText;
      }
      break;

    case 'KEY_VALIDATION_RESULT': {
      const target = pendingValidation;
      pendingValidation = null;
      if (target === 'onboard') {
        if (msg.ok) {
          const key = (onboardKeyInput?.value || '').trim();
          providerKeys[currentProvider] = key;
          chrome.storage.local.set({ [PROVIDER_STORAGE[currentProvider]]: key, aiProvider: currentProvider }, () => {
            cachedHasApiKey = true;
            if (apiKeyInput) apiKeyInput.value = key;
            setKeyStatus(onboardStatusLine, 'ok', msg.message || 'Connected!');
            syncSetupHintCard();
            showToast('Connected! AI is ready.', 'success');
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
      if (focusIcon) focusIcon.textContent = focusOn ? '◉' : '◎';
      break;

    case 'SITE_PREFS':
      if (msg.tabId !== currentTabId) break;
      if (msg.origin && sitePrefsSection) {
        currentSiteOrigin = msg.origin;
        try {
          if (sitePrefsHostname) sitePrefsHostname.textContent = new URL(msg.origin).hostname;
        } catch {}
        show(sitePrefsSection);
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

resumeClearBtn?.addEventListener('click', () => {
  port?.postMessage({ type: 'CLEAR_RESUME', tabId: currentTabId });
  hide(resumeCard);
  showToast('Saved progress cleared.', 'success');
});

const QUIZ_EVERY = 5;

// ── Summary renderer ──────────────────────────────────────────────────────────

function renderSummary(text, container) {
  container.innerHTML = '';
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const t = line.trim();
    if (t.toLowerCase().startsWith('the gist:')) {
      const p = document.createElement('p');
      p.className = 'gist-line summary-line';
      const label = document.createElement('span');
      label.className = 'gist-label';
      label.textContent = 'The gist: ';
      p.appendChild(label);
      p.appendChild(document.createTextNode(t.slice('the gist:'.length).trim()));
      container.appendChild(p);
    } else if (t.startsWith('•')) {
      const div = document.createElement('div');
      div.className = 'bullet-line summary-line';
      const dot = document.createElement('span');
      dot.className = 'bullet-dot';
      dot.textContent = '•';
      const span = document.createElement('span');
      span.textContent = t.slice(1).trim();
      div.appendChild(dot);
      div.appendChild(span);
      container.appendChild(div);
    } else {
      const p = document.createElement('p');
      p.className = 'body-text summary-line';
      p.style.marginBottom = '4px';
      p.textContent = t;
      container.appendChild(p);
    }
  }
}

async function loadPinnedIntoCache() {
  const bag = await chrome.storage.local.get(PINS_STORAGE_KEY).catch(() => ({}));
  pinnedAnalysesCache = Array.isArray(bag[PINS_STORAGE_KEY]) ? bag[PINS_STORAGE_KEY] : [];
}

async function persistPins() {
  await chrome.storage.local.set({ [PINS_STORAGE_KEY]: pinnedAnalysesCache.slice(0, MAX_PINNED_ANALYSES) }).catch(() => {});
}

function pinKeyForPageEntry(entry, pageUrl) {
  const u = (pageUrl || '').trim();
  const id = (entry?.id || '').trim();
  return `${u}::${id}`;
}

function isEntryPinned(entry) {
  const k = pinKeyForPageEntry(entry, highlightPageMeta.pageUrl);
  return pinnedAnalysesCache.some(p => p.key === k);
}

async function togglePinAnalysis(entry) {
  await loadPinnedIntoCache();
  const pageUrl = highlightPageMeta.pageUrl || '';
  const key = pinKeyForPageEntry(entry, pageUrl);
  const idx = pinnedAnalysesCache.findIndex(p => p.key === key);
  if (idx >= 0) {
    pinnedAnalysesCache.splice(idx, 1);
    showToast('Unpinned', 'info');
  } else {
    pinnedAnalysesCache.unshift({
      key,
      pageUrl,
      title: highlightPageMeta.title || (articleTitle?.textContent || '').trim(),
      highlightId: entry.id,
      selection: entry.selection || '',
      analysis: entry.analysis || '',
      note: entry.note || '',
      pinnedAt: Date.now()
    });
    pinnedAnalysesCache = pinnedAnalysesCache.slice(0, MAX_PINNED_ANALYSES);
    showToast('Pinned to History', 'success');
  }
  await persistPins();
  renderPageAnalysesList();
}

async function unpinByKey(key) {
  await loadPinnedIntoCache();
  const idx = pinnedAnalysesCache.findIndex(p => p.key === key);
  if (idx < 0) return;
  pinnedAnalysesCache.splice(idx, 1);
  await persistPins();
  renderPageAnalysesList();
  showToast('Unpinned', 'info');
}

function applyPinnedAnalysisToPanel(pin) {
  applyAnalysisToPanel(
    {
      id: pin.highlightId,
      selection: pin.selection,
      analysis: pin.analysis,
      note: pin.note
    },
    pin.selection
  );
  enterAnalyzeMode({ fresh: false });
}

function renderPinnedAnalysesList() {
  if (!pinnedAnalysesList || !pinnedAnalysesSection) return;
  pinnedAnalysesList.innerHTML = '';
  if (!pinnedAnalysesCache.length) {
    hide(pinnedAnalysesSection);
    return;
  }
  show(pinnedAnalysesSection);

  for (const pin of pinnedAnalysesCache) {
    const card = document.createElement('details');
    card.className = 'analysis-history-card';

    const sum = document.createElement('summary');
    const star = document.createElement('span');
    star.textContent = '★';
    star.style.color = 'var(--accent)';
    star.style.flexShrink = '0';
    const preview = document.createElement('span');
    preview.className = 'analysis-summary-preview';
    const one = (pin.selection || pin.analysis || '').replace(/\s+/g, ' ').trim().slice(0, 72);
    preview.textContent = pin.title ? `${pin.title} — ${one || '(analysis)'}` : (one || 'Pinned analysis');
    sum.appendChild(star);
    sum.appendChild(preview);

    const body = document.createElement('div');
    body.className = 'analysis-history-body';

    if (pin.note) {
      const n = document.createElement('p');
      n.textContent = `Note: ${pin.note}`;
      body.appendChild(n);
    }
    if (pin.selection) {
      const q = document.createElement('blockquote');
      q.className = 'selected-preview';
      q.style.margin = '8px 0';
      q.textContent = pin.selection.length > 400 ? `${pin.selection.slice(0, 400)}…` : pin.selection;
      body.appendChild(q);
    }
    if (pin.analysis) {
      const a = document.createElement('p');
      a.className = 'body-text';
      a.textContent = pin.analysis;
      body.appendChild(a);
    }

    const actions = document.createElement('div');
    actions.className = 'analysis-history-actions';

    const unpinBtn = document.createElement('button');
    unpinBtn.type = 'button';
    unpinBtn.className = 'btn-copy';
    unpinBtn.textContent = 'Unpin';
    unpinBtn.addEventListener('click', e => {
      e.preventDefault();
      void unpinByKey(pin.key);
    });

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn-copy';
    openBtn.textContent = 'Open page';
    openBtn.disabled = !pin.pageUrl || (!pin.pageUrl.startsWith('http://') && !pin.pageUrl.startsWith('https://'));
    openBtn.addEventListener('click', e => {
      e.preventDefault();
      if (pin.pageUrl) chrome.tabs.create({ url: pin.pageUrl });
    });

    const samePage = pin.pageUrl && currentBrowserTabUrl && distillPageUrlKey(pin.pageUrl) === currentBrowserTabUrl;
    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn-copy';
    loadBtn.textContent = 'Show in panel';
    loadBtn.disabled = !samePage;
    loadBtn.title = samePage ? 'Load this analysis into the Highlight section' : 'Switch to this page’s tab to load here';
    loadBtn.addEventListener('click', e => {
      e.preventDefault();
      applyPinnedAnalysisToPanel(pin);
    });

    const copyMd = document.createElement('button');
    copyMd.type = 'button';
    copyMd.className = 'btn-copy';
    copyMd.textContent = 'Copy MD';
    copyMd.addEventListener('click', e => {
      e.preventDefault();
      const md = distillBuildPinnedAnalysisMarkdown({
        title: pin.title,
        pageUrl: pin.pageUrl,
        selection: pin.selection,
        analysis: pin.analysis,
        note: pin.note
      });
      navigator.clipboard.writeText(md).then(() => showToast('Copied (Markdown)', 'success'));
    });

    actions.appendChild(unpinBtn);
    actions.appendChild(openBtn);
    actions.appendChild(loadBtn);
    actions.appendChild(copyMd);
    body.appendChild(actions);

    card.appendChild(sum);
    card.appendChild(body);
    pinnedAnalysesList.appendChild(card);
  }
}

function renderPageAnalysesList() {
  void loadPinnedIntoCache().then(() => {
    if (!pageAnalysesList || !pageAnalysesSection) return;
    pageAnalysesList.innerHTML = '';
    const items = (highlightHistoryForPage || []).filter(
      h => (h?.analysis && String(h.analysis).trim()) || (h?.note && String(h.note).trim())
    );
    if (!items.length) {
      hide(pageAnalysesSection);
    } else {
      show(pageAnalysesSection);

      for (const entry of items) {
        const card = document.createElement('details');
        card.className = 'analysis-history-card';

        const sum = document.createElement('summary');
        const pinBtn = document.createElement('button');
        pinBtn.type = 'button';
        pinBtn.className = `pin-toggle-btn${isEntryPinned(entry) ? ' pinned' : ''}`;
        pinBtn.textContent = isEntryPinned(entry) ? '★' : '☆';
        pinBtn.title = isEntryPinned(entry) ? 'Unpin from History' : 'Pin for quick return';
        pinBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          void togglePinAnalysis(entry);
        });

        const preview = document.createElement('span');
        preview.className = 'analysis-summary-preview';
        const one = (entry.selection || entry.analysis || '').replace(/\s+/g, ' ').trim().slice(0, 72);
        preview.textContent = one || 'Analysis';

        sum.appendChild(pinBtn);
        sum.appendChild(preview);

        const body = document.createElement('div');
        body.className = 'analysis-history-body';
        if (entry.note) {
          const n = document.createElement('p');
          n.textContent = `Note: ${entry.note}`;
          body.appendChild(n);
        }
        if (entry.selection) {
          const q = document.createElement('blockquote');
          q.className = 'selected-preview';
          q.style.margin = '8px 0';
          q.textContent = entry.selection.length > 400 ? `${entry.selection.slice(0, 400)}…` : entry.selection;
          body.appendChild(q);
        }
        if (entry.analysis) {
          const a = document.createElement('p');
          a.className = 'body-text';
          a.textContent = entry.analysis;
          body.appendChild(a);
        }

        card.appendChild(sum);
        card.appendChild(body);
        pageAnalysesList.appendChild(card);
      }
    }

    renderPinnedAnalysesList();
  });
}

function renderRecentCheckins() {
  recentCheckinsList.innerHTML = '';
  if (!recentCheckins.length) {
    hide(recentCheckinsSection);
    return;
  }
  show(recentCheckinsSection);

  for (const item of recentCheckins) {
    const card = document.createElement('details');
    card.className = 'checkin-card';

    const summary = document.createElement('summary');
    summary.className = 'checkin-summary';
    const label = item.status === 'skipped' ? 'Skipped check-in' : 'Check-in review';
    summary.textContent = label;

    const meta = document.createElement('span');
    meta.className = 'checkin-meta';
    meta.textContent = item.createdAt ? `· ${new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
    summary.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'checkin-body';

    const q = document.createElement('p');
    q.textContent = `Q: ${item.question || 'No question captured.'}`;
    body.appendChild(q);

    if (item.answer) {
      const a = document.createElement('p');
      a.textContent = `Your answer: ${item.answer}`;
      body.appendChild(a);
    }

    if (item.feedback) {
      const f = document.createElement('p');
      f.textContent = item.feedback;
      body.appendChild(f);
    }

    card.appendChild(summary);
    card.appendChild(body);
    recentCheckinsList.appendChild(card);
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

// ── Deferred bootstrap ────────────────────────────────────────────────────────
// Runs after every const/let above is initialized (avoids temporal-dead-zone on
// PINS_STORAGE_KEY when loadPinnedIntoCache reads storage during startup).
void loadPinnedIntoCache().then(() => renderPinnedAnalysesList());
