'use strict';

// Numeric diagnostics only. Nothing is persisted or sent over the network.
const DISTILL_PERF_VALUES = {
  metric: ['panel_ready', 'restore_load', 'restore_presented', 'extraction', 'cache_presented', 'action_feedback', 'ai_first_text', 'ai_complete', 'cancel_ack'],
  outcome: ['success', 'error', 'canceled'],
  task: ['now', 'summary', 'quiz_question', 'quiz_feedback', 'quiz_skipped_review', 'explain_page', 'analysis', 'overview', 'section_guide', 'ask'],
  provider: ['groq', 'openai', 'gemini', 'anthropic', 'backend', 'local'],
  route: ['direct', 'backend'],
  cache: ['hit', 'miss']
};
function distillValidPerformanceSample(s) {
  return !!s && typeof s === 'object' && !Array.isArray(s) &&
    Object.keys(s).every(k => k === 'durationMs' || DISTILL_PERF_VALUES[k]?.includes(s[k])) &&
    DISTILL_PERF_VALUES.metric.includes(s.metric) && DISTILL_PERF_VALUES.outcome.includes(s.outcome) &&
    Number.isFinite(s.durationMs) && s.durationMs >= 0;
}
function distillCreatePerformanceRecorder({ enabled = false, now = () => performance.now(), limit = 200 } = {}) {
  let samples = [];
  const cap = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 200)) : 200;
  const noop = { firstText() {}, finish() {}, setLabels() {} };
  function start(metric, labels = {}) {
    if (!enabled || !DISTILL_PERF_VALUES.metric.includes(metric)) return noop;
    const safe = {};
    for (const k of ['task', 'provider', 'route', 'cache']) {
      if (labels[k] !== undefined) {
        if (!DISTILL_PERF_VALUES[k].includes(labels[k])) return noop;
        safe[k] = labels[k];
      }
    }
    const begin = now();
    let closed = false, first = false, firstDuration;
    function record(name, outcome, duration = now() - begin) {
      const s = { metric: name, durationMs: duration, outcome, ...safe };
      if (!distillValidPerformanceSample(s)) return;
      samples.push(s);
      if (samples.length > cap) samples.shift();
    }
    return {
      setLabels(next) {
        for (const k of ['provider', 'route']) if (DISTILL_PERF_VALUES[k].includes(next[k])) safe[k] = next[k];
      },
      firstText() {
        if (closed || first || metric !== 'ai_complete') return;
        first = true; firstDuration = now() - begin;
      },
      finish(outcome) {
        if (closed) return;
        closed = true;
        if (first && outcome === 'success') record('ai_first_text', 'success', firstDuration);
        record(metric, outcome);
      }
    };
  }
  return { start, snapshot: () => ({ schemaVersion: 1, samples: samples.map(s => ({ ...s })) }), clear() { samples = []; } };
}

// Explicit per-context console opt-in, never accessible in the page's MAIN world.
function distillInstallPerformanceDiagnostics(scope) {
  let recorder = distillCreatePerformanceRecorder();
  let enabled = false;
  const api = {
    enable() { recorder = distillCreatePerformanceRecorder({ enabled: true }); enabled = true; },
    disable() { enabled = false; recorder = distillCreatePerformanceRecorder(); },
    snapshot: () => recorder.snapshot(),
    clear: () => recorder.clear(),
    get enabled() { return enabled; },
    start: (metric, labels) => recorder.start(metric, labels),
    presented(metric, labels) {
      if (!enabled) return;
      const h = recorder.start(metric, labels);
      // A frame opportunity is a proxy, not proof of pixels painted.
      scope.requestAnimationFrame(() => h.finish('success'));
    }
  };
  scope.distillPerformance = api;
  return api;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillCreatePerformanceRecorder, distillValidPerformanceSample, distillInstallPerformanceDiagnostics };
} else {
  distillInstallPerformanceDiagnostics(globalThis);
}
