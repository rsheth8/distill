/* Shared source offsets. No text transformations are used for speech. */
(() => {
  const model = blocks => {
    let text = '';
    const ranges = blocks.map(value => { const start = text.length; text += value + '\n\n'; return { start, end: text.length - 2 }; });
    return { text: text.slice(0, -2), blocks: ranges, words: [...text.trimEnd().matchAll(/\S+/gu)].map(m => ({ start: m.index, end: m.index + m[0].length })) };
  };
  const chunks = text => {
    const result = [];
    const segments = new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text);
    for (const s of segments) {
      let start = s.index;
      const end = start + s.segment.length;
      while (start < end) {
        let stop = Math.min(end, start + 320);
        if (stop < end) { const space = text.lastIndexOf(' ', stop); if (space > start) stop = space + 1; }
        result.push({ start, end: stop, text: text.slice(start, stop) }); start = stop;
      }
    }
    return result;
  };
  const normalize = text => {
    let value = ''; const offsets = [];
    for (let i = 0; i < text.length; i++) {
      const hyphen = text.slice(i).match(/^-\s*\n\s*/);
      if (hyphen) { i += hyphen[0].length - 1; continue; }
      if (/\s/u.test(text[i])) continue;
      value += text[i].toLowerCase(); offsets.push(i);
    }
    return { value, offsets };
  };
  const align = (source, target) => {
    const a = normalize(source), b = normalize(target).value;
    const i = a.value.indexOf(b);
    if (!b || i < 0 || a.value.indexOf(b, i + 1) >= 0) return null;
    return { start: a.offsets[i], end: a.offsets[i + b.length - 1] + 1 };
  };
  const alignRange = (source, target, start, end) => {
    const a = normalize(source), b = normalize(target);
    const i = a.value.indexOf(b.value);
    if (!b.value || i < 0 || a.value.indexOf(b.value, i + 1) >= 0) return null;
    const first = b.offsets.findIndex(offset => offset >= start);
    let last = b.offsets.findLastIndex(offset => offset < end);
    if (first < 0 || last < first) return null;
    return { start: a.offsets[i + first], end: a.offsets[i + last] + 1 };
  };
  const pageFor = (pages, target) => {
    const needle = normalize(target).value;
    if (!needle) return null;
    const matches = pages.map((text, index) => normalize(text).value.includes(needle) ? index : -1).filter(i => i >= 0);
    return matches.length === 1 && align(pages[matches[0]], target) ? matches[0] + 1 : null;
  };
  globalThis.DistillReadAlong = { model, chunks, align, alignRange, pageFor,
    route: (voice, consent) => !!voice && (voice.localService === true || consent === true),
    session: () => { let generation = 0; return { next: () => ++generation, valid: id => id === generation }; }
  };
})();
