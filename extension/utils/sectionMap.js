'use strict';

// Renders the panel's section map: one button per paper section. DOM only, no chrome.*.

const DISTILL_STATE_WORDS = { read: 'read', current: 'you are here', ahead: 'not read yet' };

function distillRenderSectionMap(container, segments, onJump) {
  const list = Array.isArray(segments) ? segments : [];
  container.replaceChildren();
  container.hidden = list.length < 2;
  if (container.hidden) return;
  for (const s of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-seg';
    btn.dataset.state = s.state;
    btn.style.flexGrow = String(s.flex);
    btn.title = s.heading;
    btn.setAttribute('aria-label', `${s.heading}, ${DISTILL_STATE_WORDS[s.state] || s.state}. Jump to this section`);
    if (s.state === 'current') btn.setAttribute('aria-current', 'step');
    btn.addEventListener('click', () => onJump(s.heading));
    container.append(btn);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillRenderSectionMap };
}
