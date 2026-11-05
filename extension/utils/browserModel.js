'use strict';
// Window-context adapter only. Not an advertised provider until a live supported runtime is verified.
const DISTILL_BROWSER_MODEL_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }]
};
async function distillBrowserModelAvailability(api = globalThis.LanguageModel) {
  if (!api?.availability) return { status: 'unavailable', message: 'This browser does not expose the built-in Prompt API.' };
  try {
    const status = await api.availability(DISTILL_BROWSER_MODEL_OPTIONS);
    const messages = {
      unavailable: 'Chrome’s built-in model is unavailable for this profile or device. Use a configured provider.',
      downloadable: 'Chrome needs to download its model. Setup requires an explicit user action and an unmetered connection.',
      downloading: 'Chrome is downloading its model. Setup is not complete.',
      available: 'Chrome reports its built-in text model is available. Distill live compatibility is not yet verified.'
    };
    return { status: Object.hasOwn(messages, status) ? status : 'unavailable', message: messages[status] || messages.unavailable };
  } catch { return { status: 'unavailable', message: 'Chrome could not check model availability. Try another configured provider.' }; }
}
async function distillStreamBrowserModel({ api = globalThis.LanguageModel, systemPrompt, messages, signal, allowDownload = false, onProgress = () => {}, onChunk }) {
  const availability = await distillBrowserModelAvailability(api);
  if (availability.status === 'unavailable' || (availability.status !== 'available' && !allowDownload)) {
    throw Object.assign(new Error(availability.message), { code: 'BROWSER_MODEL_UNAVAILABLE' });
  }
  signal?.throwIfAborted();
  let session;
  const destroy = () => session?.destroy();
  try {
    session = await api.create({ ...DISTILL_BROWSER_MODEL_OPTIONS, signal,
      initialPrompts: [{ role: 'system', content: systemPrompt || '' }],
      monitor: m => m.addEventListener('downloadprogress', e => onProgress(e.loaded)) });
    signal?.addEventListener('abort', destroy, { once: true });
    signal?.throwIfAborted();
    const usage = session.measureContextUsage ? await session.measureContextUsage(messages) : null;
    if (usage !== null && usage >= session.contextWindow) throw Object.assign(new Error('The supplied passages exceed Chrome’s context window. Shorten the question or selection.'), { code: 'BROWSER_MODEL_CONTEXT' });
    for await (const chunk of session.promptStreaming(messages, { signal })) {
      signal?.throwIfAborted();
      onChunk(chunk);
    }
  } finally { signal?.removeEventListener('abort', destroy); destroy(); }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { distillBrowserModelAvailability, distillStreamBrowserModel };
