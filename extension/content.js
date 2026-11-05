(function () {
  'use strict';

  // Extension pages are skipped, except Distill's PDF reader, which hands over its paper.
  if (window.location.protocol === 'chrome-extension:' && !globalThis.distillReaderPaper) return;
  if (window.__aiReaderActive) return;
  window.__aiReaderActive = true;

  const MIN_PARA_LEN = 50;
  const READING_LINE  = 0.35;
  const SMALL_PARAGRAPH_MAX_WORDS = 55;
  const UNIT_TARGET_MIN_WORDS = 140;

  const readIds          = new Set();
  let activeParagraphEl  = null;
  let paragraphs         = [];
  let focusMode          = false;
  let lastSelectionAnchor = null;
  // Hover card is attached to each chip (no global popup).

  function nodePathFromBody(node) {
    const path = [];
    let cur = node;
    const root = document.body;
    while (cur && cur !== root) {
      const parent = cur.parentNode;
      if (!parent) break;
      const idx = Array.prototype.indexOf.call(parent.childNodes, cur);
      path.push(idx);
      cur = parent;
    }
    path.push(0); // sentinel for body
    return path.reverse();
  }

  function nodeFromBodyPath(path) {
    if (!Array.isArray(path) || path.length < 1) return null;
    let cur = document.body;
    // first entry is sentinel for body (0)
    for (let i = 1; i < path.length; i++) {
      const idx = path[i];
      if (!cur?.childNodes?.length) return null;
      cur = cur.childNodes[idx];
      if (!cur) return null;
    }
    return cur;
  }

  function serializeRange(range) {
    try {
      return {
        startPath: nodePathFromBody(range.startContainer),
        startOffset: range.startOffset,
        endPath: nodePathFromBody(range.endContainer),
        endOffset: range.endOffset,
      };
    } catch {
      return null;
    }
  }

  function rangeFromSerialized(anchor) {
    if (!anchor) return null;
    const startNode = nodeFromBodyPath(anchor.startPath);
    const endNode = nodeFromBodyPath(anchor.endPath);
    if (!startNode || !endNode) return null;
    try {
      const clampOffset = (node, offset) => {
        const n = Number(offset);
        const raw = Number.isFinite ? (Number.isFinite(n) ? n : 0) : (isFinite(n) ? n : 0);
        // Text nodes: offset is character index into nodeValue.
        if (node && node.nodeType === Node.TEXT_NODE) {
          const len = node.nodeValue ? node.nodeValue.length : 0;
          return Math.max(0, Math.min(raw, len));
        }
        // Element nodes: offset is childNodes index.
        const len = node?.childNodes?.length || 0;
        return Math.max(0, Math.min(raw, len));
      };
      const r = document.createRange();
      r.setStart(startNode, clampOffset(startNode, anchor.startOffset));
      r.setEnd(endNode, clampOffset(endNode, anchor.endOffset));
      return r;
    } catch {
      return null;
    }
  }
  // (Deprecated) Gutter mode removed; keep for back-compat if referenced elsewhere.
  const ANNO_GUTTER_W = 240;

  // ── Annotation column detection (deterministic “beside words”) ─────────────
  let __annoColumnCache = null; // { key, el, rect, measuredAt, viewportW, viewportH }

  function elementKey(el) {
    if (!el || el === document.body || el === document.documentElement) return '';
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string'
      ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
      : '';
    return `${el.tagName}${id}${cls}`;
  }

  function getStyleNumber(el, prop) {
    try {
      const v = getComputedStyle(el)?.[prop];
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  function looksScrollable(el) {
    try {
      const s = getComputedStyle(el);
      const ov = `${s.overflow || ''} ${s.overflowX || ''} ${s.overflowY || ''}`.toLowerCase();
      return ov.includes('auto') || ov.includes('scroll');
    } catch {
      return false;
    }
  }

  function scoreColumnCandidate(el, rect, viewportW) {
    if (!el || !rect) return -Infinity;
    if (!Number.isFinite(rect.width) || rect.width <= 0) return -Infinity;
    if (rect.width < 320) return -Infinity; // too narrow to be the main text column
    if (rect.width > viewportW * 0.98) return -Infinity; // full-bleed container
    if (rect.height < 60) return -Infinity;
    if (looksScrollable(el)) return -Infinity;

    const centerX = rect.left + rect.width / 2;
    const viewportCenter = viewportW / 2;
    const centerDist = Math.abs(centerX - viewportCenter);

    // Prefer readable line lengths (roughly 520–860px), centered-ish.
    const widthTarget = 680;
    const widthPenalty = Math.min(Math.abs(rect.width - widthTarget) / 220, 2.5);
    const centerPenalty = Math.min(centerDist / 180, 2.5);

    // Prefer elements with padding (often “article wrapper”) and explicit max-width.
    const pad = getStyleNumber(el, 'paddingLeft') + getStyleNumber(el, 'paddingRight');
    const padBonus = Math.min(pad / 32, 1.2);
    const mw = getComputedStyle(el)?.maxWidth || '';
    const maxWidthBonus = mw && mw !== 'none' ? 0.6 : 0;

    // Penalize very nested tiny wrappers a bit (but don’t kill them).
    let depth = 0;
    for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) depth++;
    const depthPenalty = Math.min(depth / 40, 0.8);

    return 6.0 - widthPenalty - centerPenalty - depthPenalty + padBonus + maxWidthBonus;
  }

  function rangeToElement(node) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) return node;
    return node.parentElement || null;
  }

  function getTextColumnForRange(range) {
    const viewportW = document.documentElement.clientWidth;
    const viewportH = document.documentElement.clientHeight;
    if (!range) {
      const el = articleEl || document.body;
      return { el, rect: el.getBoundingClientRect(), key: elementKey(el) };
    }

    const startEl = rangeToElement(range.startContainer) || articleEl || document.body;
    const cacheKey = `${elementKey(startEl)}@${viewportW}x${viewportH}`;
    if (__annoColumnCache && __annoColumnCache.key === cacheKey) {
      // Re-measure rect on demand (layout can shift).
      try {
        return { el: __annoColumnCache.el, rect: __annoColumnCache.el.getBoundingClientRect(), key: __annoColumnCache.key };
      } catch {}
    }

    let bestEl = null;
    let bestRect = null;
    let bestScore = -Infinity;

    const limitRoot = articleEl || document.body;
    let cur = startEl;
    let guard = 0;
    while (cur && guard++ < 40) {
      if (cur === document.documentElement) break;
      if (cur.nodeType !== Node.ELEMENT_NODE) { cur = cur.parentElement; continue; }
      // Stop if we escaped the article root (when available).
      if (limitRoot && limitRoot !== document.body && !limitRoot.contains(cur) && cur !== limitRoot) {
        break;
      }

      let rect;
      try { rect = cur.getBoundingClientRect(); } catch { rect = null; }
      const s = scoreColumnCandidate(cur, rect, viewportW);
      if (s > bestScore) {
        bestScore = s;
        bestEl = cur;
        bestRect = rect;
      }
      cur = cur.parentElement;
    }

    // Fallback: use articleEl/body even if scoring didn’t find a great wrapper.
    if (!bestEl) {
      bestEl = articleEl || document.body;
      bestRect = bestEl.getBoundingClientRect();
    }

    __annoColumnCache = { key: cacheKey, el: bestEl, rect: bestRect, measuredAt: Date.now(), viewportW, viewportH };
    return { el: bestEl, rect: bestRect, key: cacheKey };
  }

  function countWords(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  /** Paper section headings (h2) in page order; filled when a paper is detected. */
  let sectionHeads = [];

  /** Heading of the last section that starts before el, e.g. "Methods". */
  function sectionOf(el) {
    let heading = null;
    for (const h of sectionHeads) {
      if (!el || !(h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      heading = h;
    }
    return heading ? distillCleanHeading(distillNodeText(heading)).slice(0, 120) : '';
  }

  /** The tracked paragraphs between this section's h2 and the next one. */
  function sectionParagraphs(heading) {
    const want = String(heading || '').trim().toLowerCase();
    const i = sectionHeads.findIndex(h => distillCleanHeading(distillNodeText(h)).slice(0, 120).toLowerCase() === want);
    if (i === -1) return [];
    const start = sectionHeads[i];
    const end = sectionHeads[i + 1];
    return paragraphs.filter(p => (start.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      (!end || (end.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_PRECEDING)));
  }

  let termCard = null;
  function showTermCard(span) {
    if (!termCard) {
      termCard = document.createElement('div');
      termCard.className = 'distill-term-card';
      termCard.setAttribute('role', 'tooltip');
      document.body.append(termCard);
    }
    termCard.textContent = `${span.dataset.term}: ${span.dataset.definition}`;
    const r = span.getBoundingClientRect();
    termCard.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 300)) + scrollX}px`;
    termCard.style.top = `${r.bottom + scrollY + 6}px`;
    termCard.hidden = false;
  }
  const onTermPointer = e => {
    const span = e.target.closest?.('.distill-term');
    if (span) showTermCard(span);
    else if (termCard) termCard.hidden = true;
  };
  document.addEventListener('mouseover', onTermPointer);
  document.addEventListener('focusin', onTermPointer);

  function sendActiveParagraph(idx) {
    safeSend({ type: 'ACTIVE_PARAGRAPH', text: getParagraphUnitText(idx), section: sectionOf(paragraphs[idx]) });
  }

  function getParagraphUnitText(startIdx) {
    if (startIdx < 0 || startIdx >= paragraphs.length) return '';
    const first = paragraphs[startIdx]?.innerText?.trim() || '';
    if (!first) return '';
    const firstWords = countWords(first);
    if (firstWords > SMALL_PARAGRAPH_MAX_WORDS || firstWords >= UNIT_TARGET_MIN_WORDS) {
      return first;
    }

    const parts = [first];
    let totalWords = firstWords;
    for (let i = startIdx + 1; i < paragraphs.length; i++) {
      const next = paragraphs[i]?.innerText?.trim() || '';
      if (!next) continue;
      const nextWords = countWords(next);
      if (nextWords > SMALL_PARAGRAPH_MAX_WORDS) break;
      parts.push(next);
      totalWords += nextWords;
      if (totalWords >= UNIT_TARGET_MIN_WORDS) break;
    }
    return parts.join('\n\n');
  }

  // ── Freeze overlay (used during comprehension quiz) ────────────────────────
  let freezeOverlay     = null;
  let freezeScrollGuard = null;

  function freezeScroll() {
    if (freezeOverlay) return;
    const savedY = window.scrollY;
    freezeScrollGuard = () => window.scrollTo(0, savedY);
    window.addEventListener('scroll', freezeScrollGuard, { passive: true });
    freezeOverlay = document.createElement('div');
    freezeOverlay.id = 'air-freeze-overlay';
    freezeOverlay.innerHTML = `
      <div id="air-freeze-msg">
        <span class="air-freeze-icon">◈</span>
        <span class="air-freeze-title">Check-in time</span>
        <span class="air-freeze-sub">Answer the question in the side panel to continue reading.</span>
      </div>
    `;
    document.body.appendChild(freezeOverlay);
  }

  function unfreezeScroll() {
    if (!freezeOverlay) return;
    window.removeEventListener('scroll', freezeScrollGuard);
    freezeScrollGuard = null;
    freezeOverlay.remove();
    freezeOverlay = null;
  }

  // ── Accent color ───────────────────────────────────────────────────────────

  const ACCENT_PRESETS = {
    ink:     { light: '#2f4f73', dark: '#a9c1dc' },
    blue:    { light: '#2563eb', dark: '#60a5fa' },
    amber:   { light: '#b45309', dark: '#fbbf24' },
    emerald: { light: '#047857', dark: '#34d399' },
    violet:  { light: '#6d28d9', dark: '#a78bfa' },
    rose:    { light: '#be123c', dark: '#fb7185' },
    slate:   { light: '#334155', dark: '#94a3b8' },
  };

  function applyArticleAccent(accentId) {
    const preset = ACCENT_PRESETS[accentId] || ACCENT_PRESETS.ink;
    const dark   = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const hex    = dark ? preset.dark : preset.light;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const root = document.documentElement;
    root.style.setProperty('--air-accent', hex);
    root.style.setProperty('--air-a05',   `rgba(${r},${g},${b},0.05)`);
    root.style.setProperty('--air-a12',   `rgba(${r},${g},${b},0.12)`);
    root.style.setProperty('--air-a22',   `rgba(${r},${g},${b},0.22)`);
    root.style.setProperty('--air-a35',   `rgba(${r},${g},${b},0.35)`);
    root.style.setProperty('--air-a95',   `rgba(${r},${g},${b},0.95)`);
  }

  chrome.storage.local.get('accentId', r => applyArticleAccent(r.accentId || 'ink'));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    chrome.storage.local.get('accentId', r => applyArticleAccent(r.accentId || 'ink'));
  });

  // ── Incoming messages ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'ACCENT_CHANGED':
        applyArticleAccent(msg.accentId);
        break;
      case 'FOCUS_MODE':
        setFocusMode(msg.on);
        break;
      case 'FREEZE_SCROLL':
        freezeScroll();
        break;
      case 'UNFREEZE_SCROLL':
        unfreezeScroll();
        break;
      case 'SCROLL_TO_HIGHLIGHT': {
        const anchor = msg.anchor;
        const r = anchor ? rangeFromSerialized(anchor) : null;
        if (r) {
          try {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
            const rect = r.getBoundingClientRect();
            if (rect?.height) {
              window.scrollTo({
                top: window.scrollY + rect.top - Math.min(140, window.innerHeight * 0.18),
                behavior: 'smooth'
              });
            }
          } catch {}
        } else if (msg.selection && typeof msg.selection === 'string') {
          const needle = msg.selection.trim().slice(0, 200);
          if (needle.length >= 4) {
            try {
              window.getSelection()?.removeAllRanges();
              const found = window.find(needle, false, false, true);
              if (found) {
                const sel = window.getSelection();
                const rr = sel?.rangeCount ? sel.getRangeAt(0) : null;
                if (rr) {
                  const rect = rr.getBoundingClientRect();
                  if (rect?.height) {
                    window.scrollTo({
                      top: window.scrollY + rect.top - Math.min(140, window.innerHeight * 0.18),
                      behavior: 'smooth'
                    });
                  }
                }
              }
            } catch {}
          }
        }
        break;
      }
      case 'SHOW_TERMS':
        distillMarkTerms(sectionParagraphs(msg.heading), Array.isArray(msg.terms) ? msg.terms : []);
        break;
      case 'CLEAR_TERMS':
        distillUnmarkTerms(document.body);
        if (termCard) termCard.hidden = true;
        break;
      case 'SCROLL_TO_TERM': {
        const want = String(msg.term || '').toLowerCase();
        const span = [...document.querySelectorAll('.distill-term')].find(s => s.dataset.term.toLowerCase() === want);
        if (span) {
          span.scrollIntoView({ behavior: 'smooth', block: 'center' });
          span.focus({ preventScroll: true });
        }
        break;
      }
      case 'GET_SELECTION_ANCHOR': {
        sendResponse({
          selectedText: window.getSelection()?.toString().trim() || '',
          anchor: lastSelectionAnchor
        });
        break;
      }
    }
    return true;
  });

  // ── Injected styles ────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('air-styles')) return;
    const s = document.createElement('style');
    s.id = 'air-styles';
    s.textContent = `
      .air-read {
        background-color: var(--air-a05) !important;
        box-shadow: inset 2px 0 0 var(--air-a22);
        border-radius: 2px;
        transition: background-color 0.8s ease, box-shadow 0.8s ease, opacity 0.4s ease;
      }
      .air-active {
        background-color: var(--air-a12) !important;
        box-shadow: inset 3px 0 0 var(--air-a95);
        border-radius: 2px;
        animation: air-pulse 2.2s ease-in-out infinite;
        transition: background-color 0.2s ease, opacity 0.2s ease;
        opacity: 1 !important;
      }
      .air-dim {
        opacity: 0.2;
        transition: opacity 0.4s ease;
      }
      @keyframes air-pulse {
        0%, 100% { box-shadow: inset 3px 0 0 var(--air-a95); }
        50%       { box-shadow: inset 3px 0 0 var(--air-a22); }
      }
      #air-marker-left,
      #air-marker-right {
        position: fixed;
        top: 35%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        pointer-events: none;
        z-index: 2147483647;
      }
      /* Nudge inward so they aren't lost on the very edge/scrollbar. */
      #air-marker-left  { left: 8px; }
      #air-marker-right { right: 8px; flex-direction: row-reverse; }
      .air-marker-arrow {
        width: 0; height: 0;
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-left: 10px solid var(--air-a35, rgba(37,99,235,0.35));
        filter: drop-shadow(0 0 6px var(--air-a12, rgba(37,99,235,0.12)));
      }
      .air-marker-arrow-flip {
        border-left: none;
        border-right: 10px solid var(--air-a35, rgba(37,99,235,0.35));
      }
      .air-marker-tick {
        width: 22px; height: 2px;
        background: var(--air-a22, rgba(37,99,235,0.22));
        border-radius: 999px;
      }
      #air-freeze-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        background: rgba(0,0,0,0.52);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: default;
        animation: air-freeze-in 0.28s ease;
      }
      @keyframes air-freeze-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      #air-freeze-msg {
        background: rgba(255,255,255,0.96);
        border-radius: 14px;
        padding: 28px 36px;
        text-align: center;
        max-width: 300px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.25);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        #air-freeze-msg {
          background: rgba(22,27,34,0.97);
        }
        .air-freeze-title { color: #e6edf3 !important; }
        .air-freeze-sub   { color: #8b949e !important; }
      }
      .air-freeze-icon {
        font-size: 30px;
        color: var(--air-accent, #2563eb);
        line-height: 1;
        margin-bottom: 4px;
      }
      .air-freeze-title {
        font-size: 16px;
        font-weight: 700;
        color: #0f172a;
        letter-spacing: -0.2px;
      }
      .air-freeze-sub {
        font-size: 12px;
        color: #64748b;
        line-height: 1.55;
        max-width: 220px;
      }

      /* (In-page annotations removed) */
      .air-anno-pop { animation: air-anno-pop 340ms ease-out; }
      @keyframes air-anno-pop {
        0% { transform: translateY(6px) scale(0.98); opacity: 0; }
        70% { transform: translateY(-1px) scale(1.01); opacity: 1; }
        100% { transform: translateY(0) scale(1); opacity: 1; }
      }
      #air-anno-popup { display: none !important; }
      .distill-term { background: rgba(250, 204, 21, 0.38); border-radius: 2px; padding: 0 1px; cursor: help; text-decoration: none; }
      @media (prefers-color-scheme: dark) { .distill-term { background: rgba(250, 204, 21, 0.28); } }
      .distill-term:focus { outline: 2px solid var(--air-a95); outline-offset: 1px; }
      .distill-term-card { position: absolute; z-index: 2147483647; max-width: 280px; padding: 8px 10px;
        background: #fff; color: #222; border: 1px solid rgba(0,0,0,.15); border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,.15); font: 13px/1.4 system-ui, sans-serif; }
    `;
    document.head.appendChild(s);

    const markerLeft = document.createElement('div');
    markerLeft.id = 'air-marker-left';
    // Left marker should read "line → arrowhead" so the tip is at the end.
    markerLeft.innerHTML = '<div class="air-marker-tick"></div><div class="air-marker-arrow"></div>';
    document.body.appendChild(markerLeft);

    const markerRight = document.createElement('div');
    markerRight.id = 'air-marker-right';
    markerRight.innerHTML = '<div class="air-marker-tick"></div><div class="air-marker-arrow air-marker-arrow-flip"></div>';
    document.body.appendChild(markerRight);
  }

  // (In-page annotations removed)

  function escapeHtml(str) {
    return (str || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // ── Focus mode ─────────────────────────────────────────────────────────────

  function setFocusMode(on) {
    focusMode = on;
    for (const el of paragraphs) {
      if (on && el !== activeParagraphEl) {
        el.classList.add('air-dim');
      } else {
        el.classList.remove('air-dim');
      }
    }
  }

  // ── Article detection ──────────────────────────────────────────────────────

  const pageUrlNorm = (() => {
    try {
      const u = new URL(window.location.href);
      return `${u.origin}${u.pathname}${u.search}`;
    } catch {
      return window.location.href.split('#')[0] || '';
    }
  })();

  try {
    chrome.runtime.sendMessage({ type: 'TAB_NAVIGATING', pageUrl: pageUrlNorm }, () => { void chrome.runtime.lastError; });
  } catch (_) {}

  let paper = null;
  try { paper = globalThis.distillReaderPaper || distillExtractPaper(document, location.href); } catch (_) {}
  // The article finder narrows tracking to the paper body; body is the fallback.
  const articleEl = paper ? (extractArticle() || document.body) : null;
  const readerUrl = pdf => `${chrome.runtime.getURL('reader.html')}?src=${encodeURIComponent(pdf)}`;
  if (document.contentType === 'application/pdf') {
    // Chrome's PDF viewer can't be read from here; the panel offers Distill's own reader instead.
    safeSend({ type: 'PDF_DETECTED', pageUrl: location.href, readerUrl: readerUrl(location.href) });
  } else if (!paper) {
    safeSend({ type: 'NO_ARTICLE', pageUrl: pageUrlNorm });
  } else {
    paragraphs = Array.from(
      articleEl.querySelectorAll('h1, h2, h3, h4, p, li')
    ).filter(el => el.innerText.trim().length >= MIN_PARA_LEN);
    sectionHeads = Array.from(articleEl.querySelectorAll('h2'));

    const titleEl = articleEl.querySelector('h1') || document.querySelector('h1');
    const title   = (paper.title || titleEl?.innerText.trim() || document.title || '').slice(0, 140);
    const totalWords = distillPaperText(paper).split(/\s+/).filter(Boolean).length;

    safeSend({
      type: 'PAPER_DETECTED',
      paper,
      // Abstract-only page (e.g. arXiv /abs/): point at the HTML version, else the PDF in Distill's reader.
      fullTextUrl: paper.sections.length ? ''
        : document.querySelector('#latexml-download-link')?.href || (paper.pdfUrl ? readerUrl(paper.pdfUrl) : ''),
      paragraphCount: paragraphs.length,
      title,
      totalWords,
      pageUrl: pageUrlNorm
    });
    injectStyles();
    paragraphs.forEach((el, i) => { el.dataset.airId = `p-${i}`; });

    let initialDone = false;
    setTimeout(() => {
      if (paragraphs.length > 0) {
        activeParagraphEl = paragraphs[0];
        paragraphs[0].classList.add('air-active');
        sendActiveParagraph(0);
      }
      initialDone = true;
    }, 300);

    window.addEventListener('scroll', debounce(() => { if (initialDone) onScroll(); }, 100), { passive: true });
  }

  // ── Reading-line scroll handler ────────────────────────────────────────────

  function onScroll() {
    const readingY = window.innerHeight * READING_LINE;

    for (const el of paragraphs) {
      const id = el.dataset.airId;
      if (readIds.has(id)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < readingY) {
        readIds.add(id);
        safeSend({ type: 'PARAGRAPH_READ', text: el.innerText.trim() });
        if (el !== activeParagraphEl) {
          el.classList.remove('air-active');
          el.classList.add('air-read');
          if (focusMode) el.classList.add('air-dim');
        }
      }
    }

    let best = null;
    let bestDist = Infinity;
    for (const el of paragraphs) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const dist = Math.abs((rect.top + rect.bottom) / 2 - readingY);
      if (dist < bestDist) { bestDist = dist; best = el; }
    }

    if (best !== activeParagraphEl) {
      if (activeParagraphEl) {
        activeParagraphEl.classList.remove('air-active');
        if (readIds.has(activeParagraphEl.dataset.airId)) {
          activeParagraphEl.classList.add('air-read');
        }
        if (focusMode) activeParagraphEl.classList.add('air-dim');
      }
      activeParagraphEl = best;
      if (best) {
        best.classList.remove('air-read', 'air-dim');
        best.classList.add('air-active');
        const idx = paragraphs.indexOf(best);
        sendActiveParagraph(idx);
      }
    }
  }

  // ── Selection listener ─────────────────────────────────────────────────────

  let selTimer = null;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = window.getSelection?.();
      const text = sel?.toString().trim() || null;
      try {
        if (sel && sel.rangeCount > 0) {
          const r = sel.getRangeAt(0);
          lastSelectionAnchor = text ? serializeRange(r) : null;
        } else {
          lastSelectionAnchor = null;
        }
      } catch {
        lastSelectionAnchor = null;
      }
      safeSend({ type: 'SELECTION_CHANGED', selectedText: text || null });
    }, 300);
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function safeSend(msg) {
    try { chrome.runtime.sendMessage(msg, () => { void chrome.runtime.lastError; }); }
    catch (_) {}
  }
})();
