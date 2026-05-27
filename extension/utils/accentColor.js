'use strict';

/**
 * @param {string} hex — `#rrggbb`
 * @returns {[number, number, number]}
 */
function distillHexToRgb(hex) {
  const h = (hex || '').trim();
  if (!h.startsWith('#') || h.length < 7) return [0, 0, 0];
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16)
  ];
}

/**
 * Sets Distill accent CSS variables on a root element (e.g. `document.documentElement`).
 * @param {HTMLElement} root
 * @param {string} hex — `#rrggbb`
 */
function distillApplyAccentCssVars(root, hex) {
  if (!root?.style) return;
  const [r, g, b] = distillHexToRgb(hex);
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-a05', `rgba(${r},${g},${b},0.05)`);
  root.style.setProperty('--accent-a12', `rgba(${r},${g},${b},0.12)`);
  root.style.setProperty('--accent-a20', `rgba(${r},${g},${b},0.20)`);
  root.style.setProperty('--accent-a35', `rgba(${r},${g},${b},0.35)`);
  root.style.setProperty('--accent-a95', `rgba(${r},${g},${b},0.95)`);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillHexToRgb, distillApplyAccentCssVars };
}
