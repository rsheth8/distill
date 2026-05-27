'use strict';

/**
 * Stable key for a page URL (origin + path + query; strips hash).
 * Shared by the service worker and side panel — keep behavior identical.
 * @param {string} href
 * @returns {string}
 */
function distillPageUrlKey(href) {
  if (!href) return '';
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return href.split('#')[0] || '';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillPageUrlKey };
}
