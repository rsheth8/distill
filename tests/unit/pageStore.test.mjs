import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const {
  DISTILL_PAGE_STATE_PREFIX,
  DISTILL_HISTORY_PREFIX,
  DISTILL_PAGE_STATE_VERSION,
  distillStableHash,
  distillPageStateKey,
  distillHistoryKey,
  distillClampList,
  distillClampString,
  distillBuildPageStatePayload,
  distillPagePayloadToState,
  distillHistoryPayloadToState,
  distillSelectPrunedKeys
} = require(join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/pageStore.js'));

describe('keys + hash', () => {
  it('hash is deterministic + hex', () => {
    expect(distillStableHash('https://x.test/a')).toBe(distillStableHash('https://x.test/a'));
    expect(distillStableHash('a')).not.toBe(distillStableHash('b'));
    expect(/^[0-9a-f]+$/.test(distillStableHash('hello'))).toBe(true);
  });
  it('keys use the right prefixes + share the hash', () => {
    const url = 'https://x.test/a';
    const h = distillStableHash(url);
    expect(distillPageStateKey(url)).toBe(`${DISTILL_PAGE_STATE_PREFIX}${h}`);
    expect(distillHistoryKey(url)).toBe(`${DISTILL_HISTORY_PREFIX}${h}`);
  });
});

describe('clamps', () => {
  it('clampList caps length and tolerates non-arrays', () => {
    expect(distillClampList([1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(distillClampList(null, 3)).toEqual([]);
  });
  it('clampString caps chars and tolerates non-strings', () => {
    expect(distillClampString('abcdef', 3)).toBe('abc');
    expect(distillClampString(123, 3)).toBe('');
  });
});

describe('distillBuildPageStatePayload', () => {
  it('keeps bulletSections and round-trips them, capped at 40 entries', () => {
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`b${i}`, 'Methods']));
    const payload = distillBuildPageStatePayload({ pageUrl: 'https://x.test', bulletSections: many }, 1);
    expect(Object.keys(payload.bulletSections).length).toBe(40);
    expect(distillPagePayloadToState(payload).bulletSections.b59).toBe('Methods');
  });
  it('captures fields, readCount, version, and applies caps', () => {
    const state = {
      pageUrl: 'https://x.test/a',
      title: 'T',
      totalParagraphs: 100,
      totalWords: 5000,
      wordsRead: 1200,
      readParagraphs: new Array(40).fill('p'),
      readUnits: Array.from({ length: 40 }, (_, i) => `u${i}`),
      lastSummary: 'x'.repeat(9000),
      lastSummaryUnitCount: 12,
      highlightHistory: new Array(20).fill({ id: 1 }),
      quiz: { status: 'question', question: 'Q', answer: '', feedback: '', history: new Array(9).fill({ q: 'h' }) }
    };
    const p = distillBuildPageStatePayload(state, 111);
    expect(p.v).toBe(DISTILL_PAGE_STATE_VERSION);
    expect(p.updatedAt).toBe(111);
    expect(p.readCount).toBe(40);
    expect(p.readUnits.length).toBe(24); // capped, and from the tail
    expect(p.readUnits[p.readUnits.length - 1]).toBe('u39');
    expect(p.lastSummary.length).toBe(5000);
    expect(p.highlightHistory.length).toBe(8);
    expect(p.quiz.history.length).toBe(3);
    expect(p.quiz.status).toBe('question');
  });
  it('tolerates empty state', () => {
    const p = distillBuildPageStatePayload({}, 1);
    expect(p.readUnits).toEqual([]);
    expect(p.readCount).toBe(0);
    expect(p.quiz.status).toBe('idle');
  });
});

describe('round-trip: payload -> state', () => {
  it('restores summary, units, quiz, highlights', () => {
    const payload = distillBuildPageStatePayload({
      pageUrl: 'https://x.test/a', title: 'T', totalParagraphs: 10, readParagraphs: ['a', 'b'],
      readUnits: ['a', 'b'], lastSummary: 'sum', highlightHistory: [{ id: 1 }],
      quiz: { status: 'question', question: 'Q', answer: 'A', feedback: '', history: [{ q: 'h' }] }
    }, 5);
    const s = distillPagePayloadToState(payload);
    expect(s.lastSummary).toBe('sum');
    expect(s.readUnits).toEqual(['a', 'b']);
    expect(s.readParagraphs).toEqual(['a', 'b']);
    expect(s.quiz.status).toBe('question');
    expect(s.quiz.answer).toBe('A');
    expect(s.highlightHistory).toEqual([{ id: 1 }]);
    expect(s.articleText).toBe(''); // not persisted
  });
});

describe('legacy migration: history payload -> state', () => {
  it('hydrates best-effort from old minimal snapshot', () => {
    const s = distillHistoryPayloadToState({ v: 1, pageUrl: 'https://x.test/a', title: 'Old', totalParagraphs: 9, lastSummary: 'oldsum' });
    expect(s.lastSummary).toBe('oldsum');
    expect(s.title).toBe('Old');
    expect(s.totalParagraphs).toBe(9);
    expect(s.readUnits).toEqual([]);
    expect(s.quiz.status).toBe('idle');
  });
});

describe('distillSelectPrunedKeys', () => {
  const now = 1_000_000_000_000;
  it('evicts entries older than TTL', () => {
    const ttlMs = 1000;
    const entries = [
      { hash: 'fresh', updatedAt: now - 100 },
      { hash: 'stale', updatedAt: now - 5000 }
    ];
    expect(distillSelectPrunedKeys(entries, { ttlMs, now })).toEqual(['stale']);
  });
  it('evicts oldest beyond maxPages', () => {
    const entries = [
      { hash: 'a', updatedAt: now - 1 },
      { hash: 'b', updatedAt: now - 2 },
      { hash: 'c', updatedAt: now - 3 }
    ];
    const removed = distillSelectPrunedKeys(entries, { maxPages: 2, now });
    expect(removed).toEqual(['c']); // oldest dropped, two newest survive
  });
  it('combines TTL + cap without duplicates', () => {
    const entries = [
      { hash: 'a', updatedAt: now - 1 },
      { hash: 'b', updatedAt: now - 2 },
      { hash: 'old', updatedAt: now - 99999 }
    ];
    const removed = distillSelectPrunedKeys(entries, { maxPages: 1, ttlMs: 1000, now });
    expect(removed.sort()).toEqual(['b', 'old']); // 'old' by TTL, 'b' by cap; 'a' survives
  });
  it('returns nothing when within limits', () => {
    expect(distillSelectPrunedKeys([{ hash: 'a', updatedAt: now }], { maxPages: 5, ttlMs: 10000, now })).toEqual([]);
    expect(distillSelectPrunedKeys([], { maxPages: 5, ttlMs: 10000, now })).toEqual([]);
  });
});

describe('paper help fields', () => {
  it('round-trip with caps', () => {
    const guides = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`H${i}`, { level: 'everyday', text: 'g'.repeat(9000), terms: new Array(20).fill({ term: 't', definition: 'd' }) }]));
    const p = distillBuildPageStatePayload({
      overview: { level: 'simple', text: 'o'.repeat(9000) },
      guides,
      glossary: new Array(200).fill({ term: 't', definition: 'd', section: 's' }),
      askThread: Array.from({ length: 30 }, (_, i) => ({ q: `q${i}`.padEnd(900, 'q'), a: 'a'.repeat(9000) }))
    }, 1);
    expect(p.overview).toEqual({ level: 'simple', text: 'o'.repeat(3500) });
    expect(Object.keys(p.guides).length).toBe(30);
    expect(p.guides.H0.text.length).toBe(2500);
    expect(p.guides.H0.terms.length).toBe(12);
    expect(p.glossary.length).toBe(150);
    expect(p.askThread.length).toBe(20);
    expect(p.askThread[19].q.startsWith('q29')).toBe(true); // newest kept
    expect(p.askThread[0].q.length).toBe(500);
    expect(p.askThread[0].a.length).toBe(2500);
    const s = distillPagePayloadToState(p);
    expect(s.overview).toEqual(p.overview);
    expect(s.guides).toEqual(p.guides);
    expect(s.glossary).toEqual(p.glossary);
    expect(s.askThread).toEqual(p.askThread);
  });
  it('defaults when missing (old snapshots, legacy history)', () => {
    const empty = { overview: null, guides: {}, glossary: [], askThread: [] };
    const p = distillBuildPageStatePayload({}, 1);
    expect({ overview: p.overview, guides: p.guides, glossary: p.glossary, askThread: p.askThread }).toEqual(empty);
    const s = distillPagePayloadToState({ v: 1 });
    expect({ overview: s.overview, guides: s.guides, glossary: s.glossary, askThread: s.askThread }).toEqual(empty);
    const h = distillHistoryPayloadToState({});
    expect({ overview: h.overview, guides: h.guides, glossary: h.glossary, askThread: h.askThread }).toEqual(empty);
  });
  it('restore drops malformed saved entries instead of crashing', () => {
    const s = distillPagePayloadToState({
      v: 1,
      glossary: [{ term: 'ok', definition: 'd', section: 's' }, { term: 5, definition: 'd' }, null, { term: 't' }],
      guides: {
        Good: { level: 'everyday', text: 'g', terms: [{ term: 'a', definition: 'b' }, null, { term: 1 }] },
        NoText: { level: 'everyday', text: 7, terms: [] },
        BadTerms: { level: 'everyday', text: 'g', terms: 'x' },
        Null: null
      },
      askThread: [{ q: 'kept', a: 'A' }, { q: 3, a: 'x' }, null],
      overview: { level: 'simple', text: 42 }
    });
    expect(s.overview).toBeNull();
    expect(s.guides.Good.terms).toEqual([{ term: 'a', definition: 'b' }]);
    expect(s.glossary).toEqual([{ term: 'ok', definition: 'd', section: 's' }]);
    expect(Object.keys(s.guides)).toEqual(['Good']);
    expect(s.askThread).toEqual([{ q: 'kept', a: 'A' }]);
  });
  it('save drops questions still in flight (empty answer)', () => {
    const p = distillBuildPageStatePayload({
      askThread: [{ q: 'answered', a: 'A' }, { q: 'in flight', a: '' }, { q: 'also answered', a: 'B' }]
    }, 1);
    expect(p.askThread).toEqual([{ q: 'answered', a: 'A' }, { q: 'also answered', a: 'B' }]);
    expect(distillPagePayloadToState(p).askThread).toEqual(p.askThread);
  });
});
