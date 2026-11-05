'use strict';

/** Normalize selection text for cache lookup (collapse whitespace). */
function distillNormalizeSelection(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/** Find a prior analysis for the same highlight text on this page. */
function distillFindCachedHighlight(history, selection) {
  const key = distillNormalizeSelection(selection);
  if (!key || !Array.isArray(history)) return null;
  for (const h of history) {
    if (!h || typeof h !== 'object') continue;
    if (distillNormalizeSelection(h.selection) !== key) continue;
    const analysis = String(h.analysis || '').trim();
    if (analysis) return h;
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    distillNormalizeSelection,
    distillFindCachedHighlight
  };
}
