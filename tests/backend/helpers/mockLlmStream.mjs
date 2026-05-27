/**
 * Inject a mocked ./lib/llmStream into require.cache before loading backend/server.js.
 * Uses real consumeLlmStream so Anthropic SSE parsing stays under test.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** @param {string} body */
export function parseSseBody(body) {
  const events = [];
  for (const block of String(body).split('\n\n')) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let event = 'message';
    /** @type {unknown} */
    let data = null;
    for (const line of trimmed.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      if (line.startsWith('data: ')) data = JSON.parse(line.slice(6));
    }
    events.push({ event, data });
  }
  return events;
}

/**
 * @param {string[]} textChunks
 * @returns {{ ok: true, body: ReadableStream<Uint8Array> }}
 */
export function anthropicSseResponse(textChunks) {
  const encoder = new TextEncoder();
  const payload = textChunks
    .map(
      text =>
        `data: ${JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text }
        })}\n\n`
    )
    .join('');
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      }
    })
  };
}

/**
 * @param {{ streamLlm?: () => Promise<{ ok: boolean, body: ReadableStream }> }} [overrides]
 */
export function installLlmStreamMock(overrides = {}) {
  const llmPath = require.resolve(join(repoRoot, 'backend/lib/llmStream.js'));
  const actual = require(llmPath);

  const defaultStreamLlm = async () => anthropicSseResponse(['Hello', ' world']);

  require.cache[llmPath] = {
    id: llmPath,
    filename: llmPath,
    loaded: true,
    exports: {
      resolveProvider: () => 'anthropic',
      isAiConfigured: () => true,
      pickModelsForTask: (_task, provider) => ({
        provider: provider || 'anthropic',
        primary: 'mock-haiku',
        fallback: 'mock-haiku'
      }),
      streamLlm: defaultStreamLlm,
      consumeLlmStream: actual.consumeLlmStream,
      ...overrides
    }
  };
}

/** @returns {import('express').Application} */
export function loadServerApp() {
  const serverPath = require.resolve(join(repoRoot, 'backend/server.js'));
  delete require.cache[serverPath];
  return require(serverPath).app;
}
