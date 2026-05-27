(function () {
  'use strict';

  if (window.location.protocol === 'chrome-extension:') return;
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

  // ── Word-by-word teleprompter ──────────────────────────────────────────────
  let scrollWpm     = 200;
  let wordMode      = false;
  let wordParaIdx   = 0;
  let wordParaSpans = [];
  let wordIdx       = 0;
  let wordTimer     = null;
  let wordRafId     = null;
  let wordScrollTgt = null;

  const WORD_EASE = 0.15;

  function countWords(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
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

  function wordScrollTick() {
    if (!wordMode) { wordRafId = null; return; }
    if (wordScrollTgt !== null) {
      const cur  = window.scrollY;
      const diff = wordScrollTgt - cur;
      if (Math.abs(diff) > 0.5) window.scrollTo(0, cur + diff * WORD_EASE);
    }
    wordRafId = requestAnimationFrame(wordScrollTick);
  }

  function wrapWords(el) {
    if (!el || el._airWrapped) return [];
    el._airOrigHTML = el.innerHTML;
    el._airWrapped  = true;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) { if (n.textContent.trim()) nodes.push(n); }
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.textContent.split(/(\s+)/)) {
        if (/\S/.test(part)) {
          const span = document.createElement('span');
          span.className = 'air-word';
          span.textContent = part;
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      }
      node.parentNode.replaceChild(frag, node);
    }
    return Array.from(el.querySelectorAll('.air-word'));
  }

  function unwrapWords(el) {
    if (!el || !el._airWrapped) return;
    el.innerHTML   = el._airOrigHTML;
    el._airWrapped = false;
    delete el._airOrigHTML;
  }

  function advanceWord() {
    if (!wordMode) return;

    if (wordIdx >= wordParaSpans.length) {
      const done = paragraphs[wordParaIdx];
      if (done) {
        unwrapWords(done);
        readIds.add(done.dataset.airId);
        safeSend({ type: 'PARAGRAPH_READ', text: done.innerText.trim() });
        done.classList.remove('air-active');
        done.classList.add('air-read');
        if (focusMode) done.classList.add('air-dim');
      }
      wordParaIdx++;
      if (wordParaIdx >= paragraphs.length) { stopWordMode(); safeSend({ type: 'SCROLL_ENDED' }); return; }
      const next = paragraphs[wordParaIdx];
      activeParagraphEl = next;
      next.classList.remove('air-read', 'air-dim');
      next.classList.add('air-active');
      if (focusMode) setFocusMode(true);
      safeSend({ type: 'ACTIVE_PARAGRAPH', text: getParagraphUnitText(wordParaIdx) });
      wordParaSpans = wrapWords(next);
      wordIdx       = 0;
      if (!wordParaSpans.length) { advanceWord(); return; }
    }

    const span = wordParaSpans[wordIdx];
    setWordTrain(wordIdx);

    const rect     = span.getBoundingClientRect();
    const readingY = window.innerHeight * READING_LINE;
    wordScrollTgt  = window.scrollY + (rect.top - readingY);

    wordIdx++;
    wordTimer = setTimeout(advanceWord, 60000 / scrollWpm);
  }

  function startWordMode() {
    if (wordMode) return;
    wordMode    = true;
    wordParaIdx = Math.max(0, paragraphs.indexOf(activeParagraphEl));
    wordIdx     = 0;
    const para  = paragraphs[wordParaIdx];
    if (!para) { stopWordMode(); return; }
    activeParagraphEl = para;
    wordParaSpans     = wrapWords(para);
    wordScrollTgt     = window.scrollY;
    wordRafId         = requestAnimationFrame(wordScrollTick);
    advanceWord();
  }

  function stopWordMode() {
    if (!wordMode) return;
    wordMode = false;
    clearTimeout(wordTimer); wordTimer = null;
    if (wordRafId) { cancelAnimationFrame(wordRafId); wordRafId = null; }
    const cur = paragraphs[wordParaIdx];
    if (cur) unwrapWords(cur);
    wordParaSpans = [];
    wordIdx       = 0;
    wordScrollTgt = null;
  }

  function setWordTrain(headIdx) {
    for (let i = 0; i < wordParaSpans.length; i++) {
      const node = wordParaSpans[i];
      node.classList.remove(
        'air-word-active',
        'air-word-trail-1',
        'air-word-trail-2',
        'air-word-trail-3',
        'air-word-trail-4',
        'air-word-trail-5'
      );
    }
    if (headIdx < 0 || headIdx >= wordParaSpans.length) return;
    wordParaSpans[headIdx]?.classList.add('air-word-active');
    wordParaSpans[headIdx - 1]?.classList.add('air-word-trail-1');
    wordParaSpans[headIdx - 2]?.classList.add('air-word-trail-2');
    wordParaSpans[headIdx - 3]?.classList.add('air-word-trail-3');
    wordParaSpans[headIdx - 4]?.classList.add('air-word-trail-4');
    wordParaSpans[headIdx - 5]?.classList.add('air-word-trail-5');
  }

  window.addEventListener('wheel',     () => { if (wordMode) { stopWordMode(); safeSend({ type: 'SCROLL_PAUSED' }); } }, { passive: true });
  window.addEventListener('touchmove', () => { if (wordMode) { stopWordMode(); safeSend({ type: 'SCROLL_PAUSED' }); } }, { passive: true });

  // ── Freeze overlay (used during comprehension quiz) ────────────────────────
  let freezeOverlay     = null;
  let freezeScrollGuard = null;

  function freezeScroll() {
    if (wordMode) { stopWordMode(); safeSend({ type: 'SCROLL_PAUSED' }); }
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
    blue:    { light: '#2563eb', dark: '#60a5fa' },
    amber:   { light: '#b45309', dark: '#fbbf24' },
    emerald: { light: '#047857', dark: '#34d399' },
    violet:  { light: '#6d28d9', dark: '#a78bfa' },
    rose:    { light: '#be123c', dark: '#fb7185' },
    slate:   { light: '#334155', dark: '#94a3b8' },
  };

  function applyArticleAccent(accentId) {
    const preset = ACCENT_PRESETS[accentId] || ACCENT_PRESETS.blue;
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

  chrome.storage.local.get('accentId', r => applyArticleAccent(r.accentId || 'blue'));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    chrome.storage.local.get('accentId', r => applyArticleAccent(r.accentId || 'blue'));
  });

  // ── Incoming messages ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'GET_PAGE_TEXT':
        sendResponse({ text: document.body.innerText.trim().slice(0, 12000) });
        break;
      case 'ACCENT_CHANGED':
        applyArticleAccent(msg.accentId);
        break;
      case 'FOCUS_MODE':
        setFocusMode(msg.on);
        break;
      case 'START_SCROLL':
        if (msg.speed) scrollWpm = msg.speed;
        if (!freezeOverlay) startWordMode();
        break;
      case 'STOP_SCROLL':
        stopWordMode();
        break;
      case 'SET_SCROLL_SPEED':
        scrollWpm = msg.speed;
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
      #air-marker-left  { left: 0; }
      #air-marker-right { right: 0; flex-direction: row-reverse; }
      .air-marker-arrow {
        width: 0; height: 0;
        border-top: 5px solid transparent;
        border-bottom: 5px solid transparent;
        border-left: 8px solid var(--air-a35, rgba(37,99,235,0.35));
      }
      .air-marker-arrow-flip {
        border-left: none;
        border-right: 8px solid var(--air-a35, rgba(37,99,235,0.35));
      }
      .air-marker-tick {
        width: 14px; height: 1px;
        background: var(--air-a22, rgba(37,99,235,0.22));
      }
      .air-word {
        position: relative;
        border-radius: 8px;
        padding: 0 2px;
        transition: background-color 0.26s ease-out, box-shadow 0.26s ease-out, color 0.26s ease-out, transform 0.26s ease-out;
      }
      .air-word-active {
        background: radial-gradient(120% 150% at 18% 50%, var(--air-a35, rgba(37,99,235,0.35)) 0%, var(--air-a22, rgba(37,99,235,0.22)) 48%, var(--air-a12, rgba(37,99,235,0.12)) 100%);
        box-shadow:
          0 0 0 1px var(--air-a12, rgba(37,99,235,0.12)),
          0 0 14px var(--air-a12, rgba(37,99,235,0.12));
        animation: air-word-ripple 0.55s ease-out;
      }
      .air-word-trail-1 {
        background: linear-gradient(90deg, var(--air-a22, rgba(37,99,235,0.22)) 0%, var(--air-a12, rgba(37,99,235,0.12)) 100%);
      }
      .air-word-trail-2 {
        background: linear-gradient(90deg, var(--air-a12, rgba(37,99,235,0.12)) 0%, var(--air-a05, rgba(37,99,235,0.05)) 100%);
      }
      .air-word-trail-3 {
        background-color: var(--air-a05, rgba(37,99,235,0.05));
      }
      .air-word-trail-4 {
        background-color: rgba(37,99,235,0.035);
      }
      .air-word-trail-5 {
        background-color: rgba(37,99,235,0.02);
      }
      @keyframes air-word-ripple {
        0% {
          box-shadow:
            0 0 0 0 var(--air-a12, rgba(37,99,235,0.12)),
            0 0 0 0 var(--air-a12, rgba(37,99,235,0.12));
          transform: translateY(0);
        }
        70% {
          box-shadow:
            0 0 0 5px rgba(37,99,235,0),
            0 0 18px var(--air-a12, rgba(37,99,235,0.12));
          transform: translateY(-0.2px);
        }
        100% {
          box-shadow:
            0 0 0 0 rgba(37,99,235,0),
            0 0 12px var(--air-a12, rgba(37,99,235,0.12));
          transform: translateY(0);
        }
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
    `;
    document.head.appendChild(s);

    const markerLeft = document.createElement('div');
    markerLeft.id = 'air-marker-left';
    markerLeft.innerHTML = '<div class="air-marker-arrow"></div><div class="air-marker-tick"></div>';
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

  function isLikelyResultPage(urlString) {
    try {
      const u = new URL(urlString);
      const host = (u.hostname || '').toLowerCase();
      const path = (u.pathname || '').toLowerCase();
      const q = (u.searchParams.get('q') || '').trim();

      // Google Search / News / Discover-ish result pages are usually not "articles"
      // and should be handled via "Explain this page" instead of NO_ARTICLE dead-end.
      const isGoogle =
        host === 'www.google.com' ||
        host.endsWith('.google.com') ||
        host === 'news.google.com';

      if (!isGoogle) return false;

      // Common Google Search SERPs.
      if (path === '/search' || path.startsWith('/search/')) return true;
      if (path === '/news' || path.startsWith('/news/')) return true;

      // Google News result/topic pages.
      if (host === 'news.google.com') {
        if (path.startsWith('/search')) return true;
        if (path.startsWith('/topics')) return true;
        if (path.startsWith('/topstories')) return true;
      }

      // Fallback heuristic: "q=" present on a google host.
      if (q && q.length >= 2) return true;
      return false;
    } catch {
      return false;
    }
  }

  try {
    chrome.runtime.sendMessage({ type: 'TAB_NAVIGATING', pageUrl: pageUrlNorm }, () => { void chrome.runtime.lastError; });
  } catch (_) {}

  const articleEl = extractArticle();
  if (!articleEl || articleEl.innerText.trim().length < 500) {
    if (isLikelyResultPage(pageUrlNorm)) {
      safeSend({ type: 'NO_ARTICLE_SERP', pageUrl: pageUrlNorm });
    } else {
      safeSend({ type: 'NO_ARTICLE', pageUrl: pageUrlNorm });
    }
  } else {
    const articleText = articleEl.innerText.trim();
    paragraphs = Array.from(
      articleEl.querySelectorAll('h1, h2, h3, h4, p, li')
    ).filter(el => el.innerText.trim().length >= MIN_PARA_LEN);

    const titleEl = articleEl.querySelector('h1') || document.querySelector('h1');
    const title   = (titleEl?.innerText.trim() || document.title || '').slice(0, 140);
    const totalWords = articleText.split(/\s+/).filter(Boolean).length;

    safeSend({ type: 'ARTICLE_DETECTED', articleText, paragraphCount: paragraphs.length, title, totalWords, pageUrl: pageUrlNorm });
    injectStyles();
    paragraphs.forEach((el, i) => { el.dataset.airId = `p-${i}`; });

    let initialDone = false;
    setTimeout(() => {
      if (paragraphs.length > 0) {
        activeParagraphEl = paragraphs[0];
        paragraphs[0].classList.add('air-active');
        safeSend({ type: 'ACTIVE_PARAGRAPH', text: getParagraphUnitText(0) });
      }
      initialDone = true;
    }, 300);

    window.addEventListener('scroll', debounce(() => { if (initialDone) onScroll(); }, 100), { passive: true });
  }

  // ── Reading-line scroll handler ────────────────────────────────────────────

  function onScroll() {
    if (wordMode) return;

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
        safeSend({ type: 'ACTIVE_PARAGRAPH', text: getParagraphUnitText(idx) });
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
