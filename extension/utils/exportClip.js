'use strict';

/**
 * Clipboard / export strings for Analyze (no DOM).
 * @param {Date} [d]
 * @returns {string}
 */
function distillFormatExportCaptured(d) {
  const t = d instanceof Date ? d : new Date();
  return t.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * @param {{ title?: string, quote?: string, analysis?: string, capturedAt: string }} p
 */
function distillBuildAnalysisExportMarkdown(p) {
  const title = (p.title || '').trim();
  const quote = (p.quote || '').trim();
  const analysis = (p.analysis || '').trim();
  const head = title ? `# Highlight analysis — ${title}` : '# Highlight analysis';
  const lines = [head, '', `Captured: ${p.capturedAt}`, ''];
  if (quote) lines.push('## Quoted text', '', `> ${quote.replace(/\n+/g, ' ')}`, '');
  lines.push('## Analysis', '', analysis);
  return lines.join('\n').trim();
}

/**
 * @param {{ title?: string, quote?: string, analysis?: string, capturedAt: string }} p
 */
function distillBuildAnalysisExportPlain(p) {
  const title = (p.title || '').trim();
  const quote = (p.quote || '').trim();
  const analysis = (p.analysis || '').trim();
  const head = title ? `Highlight analysis — ${title}` : 'Highlight analysis';
  const lines = [head, '', `Captured: ${p.capturedAt}`, ''];
  if (quote) lines.push('Quoted text:', quote, '');
  lines.push('Analysis:', analysis);
  return lines.join('\n').trim();
}

/**
 * Pinned analysis card "Copy MD" (includes optional source + note).
 * @param {{ title?: string, pageUrl?: string, selection?: string, analysis?: string, note?: string }} p
 */
function distillBuildPinnedAnalysisMarkdown(p) {
  const title = (p.title || '').trim();
  const lines = [title ? `# Pinned analysis — ${title}` : '# Pinned analysis', ''];
  if (p.pageUrl) lines.push(`Source: ${p.pageUrl}`, '');
  if (p.selection) lines.push('## Quoted text', '', `> ${String(p.selection).replace(/\n+/g, ' ')}`, '');
  if (p.analysis) lines.push('## Analysis', '', p.analysis);
  if (p.note) lines.push('', '## Note', '', p.note);
  return lines.join('\n').trim();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    distillFormatExportCaptured,
    distillBuildAnalysisExportMarkdown,
    distillBuildAnalysisExportPlain,
    distillBuildPinnedAnalysisMarkdown
  };
}
