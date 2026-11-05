// Paper help in the side panel: reading level, overview, trust, section guide, Ask, Glossary.
// Loaded after sidepanel.js and uses its globals ($, port, currentTabId, show, hide, setStatus, setPanel).
// AI output and paper text are untrusted: everything goes in with textContent.

const DISTILL_LEVELS = ['simple', 'everyday', 'close'];
// state: last PAPER_HELP_STATE; section: heading the reader is in; streams: text arriving per "kind:key".
const paperView = { level: 'everyday', state: null, section: '', streams: {} };

const levelSelect = $('levelSelect');
chrome.storage.local.get('readingLevel').then(({ readingLevel }) => {
  if (DISTILL_LEVELS.includes(readingLevel)) paperView.level = levelSelect.value = readingLevel;
});
levelSelect.addEventListener('change', () => {
  paperView.level = levelSelect.value;
  chrome.storage.local.set({ readingLevel: paperView.level });
});
