'use strict';

// Underline jargon terms in the paper. Text nodes only — paper text and AI terms are untrusted.

const DISTILL_TERM_SKIP = 'a, code, pre, math, script, style, .distill-term';

function distillEscapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wrap the first whole-word match of each term in each element. Returns the number of marks added. */
function distillMarkTerms(elements, terms) {
  let added = 0;
  // Longest first, so "self-attention" is marked before "attention" can claim part of it.
  const ordered = (terms || []).filter(t => typeof t?.term === 'string' && t.term)
    .sort((a, b) => b.term.length - a.term.length);
  for (const el of elements) {
    const doc = el.ownerDocument;
    for (const { term, definition = '' } of ordered) {
      const already = [...el.querySelectorAll('.distill-term')].some(s => s.dataset.term.toLowerCase() === term.toLowerCase());
      if (already) continue;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${distillEscapeRegExp(term)})(?=$|[^\\p{L}\\p{N}])`, 'iu');
      const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest(DISTILL_TERM_SKIP)) continue;
        const m = re.exec(node.data);
        if (!m) continue;
        const hit = node.splitText(m.index + m[1].length);
        hit.splitText(m[2].length);
        const span = doc.createElement('span');
        span.className = 'distill-term';
        span.tabIndex = 0;
        span.dataset.term = term;
        span.dataset.definition = definition;
        hit.replaceWith(span);
        span.append(hit);
        added++;
        break;
      }
    }
  }
  return added;
}

function distillUnmarkTerms(root) {
  for (const span of root.querySelectorAll('.distill-term')) {
    const parent = span.parentNode;
    span.replaceWith(...span.childNodes);
    parent.normalize();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillMarkTerms, distillUnmarkTerms };
}
