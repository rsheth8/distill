import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const {
  distillBuildExplainExportMarkdown,
  distillBuildExplainExportPlain,
  distillBuildAnalysisExportMarkdown,
  distillBuildAnalysisExportPlain,
  distillBuildPinnedAnalysisMarkdown
} = require(join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/exportClip.js'));

describe('exportClip', () => {
  const cap = 'Jan 15, 2:30 PM';

  it('explain markdown includes title and body', () => {
    const s = distillBuildExplainExportMarkdown({
      title: 'My Article',
      body: 'The explanation.',
      capturedAt: cap
    });
    expect(s).toContain('# Page explanation — My Article');
    expect(s).toContain(`Captured: ${cap}`);
    expect(s).toContain('The explanation.');
  });

  it('explain plain matches structure', () => {
    const s = distillBuildExplainExportPlain({
      title: 'Hi',
      body: 'b',
      capturedAt: cap
    });
    expect(s).toContain('Page explanation — Hi');
    expect(s).toContain('b');
  });

  it('analysis markdown collapses newlines in quote', () => {
    const s = distillBuildAnalysisExportMarkdown({
      title: 'T',
      quote: 'line1\n\nline2',
      analysis: 'A',
      capturedAt: cap
    });
    expect(s).toContain('> line1 line2');
    expect(s).toContain('## Analysis');
  });

  it('analysis plain omits markdown headings', () => {
    const s = distillBuildAnalysisExportPlain({
      title: '',
      quote: 'q',
      analysis: 'a',
      capturedAt: cap
    });
    expect(s).toContain('Highlight analysis');
    expect(s).not.toContain('#');
    expect(s).toContain('Quoted text:');
  });

  it('pinned analysis markdown includes source and note', () => {
    const s = distillBuildPinnedAnalysisMarkdown({
      title: 'T',
      pageUrl: 'https://a.example/p',
      selection: 'q1\nq2',
      analysis: 'A',
      note: 'N'
    });
    expect(s).toContain('# Pinned analysis — T');
    expect(s).toContain('Source: https://a.example/p');
    expect(s).toContain('> q1 q2');
    expect(s).toContain('## Note');
    expect(s).toContain('N');
  });
});
