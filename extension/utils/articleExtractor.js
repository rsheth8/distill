// Extracts the main article element from the page using common selectors,
// falling back to the largest text block if none match.
function extractArticle() {
  const selectors = [
    'article',
    '[role="article"]',
    '[itemprop="articleBody"]',
    '.article-body',
    '.article-content',
    '.post-content',
    '.post-body',
    '.entry-content',
    '.story-body',
    '.story-content',
    '.blog-post',
    '.blog-content',
    '#article-body',
    '#post-content',
    'main article',
    'main'
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.innerText.trim().length >= 500) return el;
  }

  // Fallback: find the div/section with the most paragraph text
  const SKIP = ['nav', 'header', 'footer', 'sidebar', 'menu', 'ad', 'advertisement', 'comment', 'social', 'share', 'related', 'promo'];
  let best = null;
  let bestLen = 0;

  for (const el of document.querySelectorAll('div, section')) {
    const cls = (el.className || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    if (SKIP.some(w => cls.includes(w) || id.includes(w))) continue;
    if (el.querySelectorAll('p').length < 3) continue;

    const len = el.innerText.trim().length;
    if (len > bestLen) { bestLen = len; best = el; }
  }

  return bestLen >= 500 ? best : null;
}
