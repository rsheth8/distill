'use strict';

/** Normalize selection text for cache lookup (collapse whitespace). */
function distillNormalizeSelection(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/** Lightweight deterministic hash (FNV-1a style). */
function distillStableStringHash(text) {
  let h = 2166136261;
  const input = text || '';
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** Hash page body sample so explain cache invalidates when content changes materially. */
function distillExplainContentHash(pageText) {
  return distillStableStringHash((pageText || '').slice(0, 12000));
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
    distillStableStringHash,
    distillExplainContentHash,
    distillFindCachedHighlight
  };
}
