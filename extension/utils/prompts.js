// Every AI prompt Distill sends, used by the extension (direct key) and the backend proxy.
// Edit here, then `npm run sync:prompts` copies it to backend/lib/prompts.js.
// context/input arrive from the network on the backend, so everything is trimmed here.

const DISTILL_LEVEL_STYLE = {
  simple: 'Use short sentences and no technical terms at all; compare ideas to everyday things.',
  everyday: 'Use everyday words. If you must use a technical term, explain it in a few words.',
  close: "Keep the field's key terms, and define each one the first time you use it."
};

function distillPersona(level) {
  return 'You help someone with no academic background read a research paper. ' +
    (Object.hasOwn(DISTILL_LEVEL_STYLE, level) ? DISTILL_LEVEL_STYLE[level] : DISTILL_LEVEL_STYLE.everyday) +
    ' Stick to what the paper says; never invent findings, numbers or claims.';
}

const DISTILL_SECTION_HINTS = {
  intro: 'This part sets up the problem and why it matters.',
  methods: 'This part describes what the researchers did. Explain the steps, not whether they worked.',
  results: 'This part reports what they found. Say what the numbers mean in plain terms without overstating them.',
  discussion: "This part interprets the findings. Keep the authors' caveats and limits."
};

function distillPromptClamp(text, maxChars) {
  const t = (typeof text === 'string' ? text : '').trim();
  return t.length <= maxChars ? t : `${t.slice(0, maxChars).trim()}\n…`;
}

/** "You're in the Methods section. <hint>" — or null when the section is unknown. */
function distillSectionBlock(section) {
  const heading = distillPromptClamp(section?.heading, 120);
  if (!heading) return null;
  const hint = DISTILL_SECTION_HINTS[section.kind] || '';
  return `The reader is in the section "${heading}". ${hint}`.trim();
}

/**
 * @returns {{ system: string, blocks: string[] }}
 *   blocks are the user message's text parts, in order.
 */
function distillBuildPrompt(task, context = {}, input = {}) {
  const c = context || {};
  const i = input || {};
  const title = distillPromptClamp(c.title, 300) || '(untitled)';
  const recent = distillPromptClamp(c.recent, 3200);
  const section = distillSectionBlock(c.section);
  const sys = extra => `${distillPersona(c.level)} ${extra}`;
  const out = (system, blocks) => ({ system, blocks: blocks.filter(Boolean) });

  switch (task) {
    case 'now':
      return out(sys('Give one short sentence that helps them keep going.'), [
        section,
        `Recent context:\n\n${recent || '(start of paper)'}`,
        `Current paragraph:\n\n"${distillPromptClamp(i.paragraph, 1300)}"\n\n` +
          'In ONE plain sentence (max 22 words), say what this means and why it matters.'
      ]);

    case 'summary': {
      const prev = distillPromptClamp(c.prevSummary, 2000);
      return out(sys('Summarize only what they have read so far; never hint at what comes next.'), [
        `Paper title: ${title}`,
        `Abstract or opening:\n\n${distillPromptClamp(c.opener, 1500) || '(not available)'}`,
        prev ? `Previous summary:\n\n${prev}` : null,
        `Most recent read context:\n\n${recent || '(none yet)'}`,
        section,
        prev
          ? `Newly read since last update:\n\n${distillPromptClamp(i.freshRead, 3200) || '(no significant change)'}`
          : `Read so far (${Number(c.readCount) || 0} paragraph(s)):\n\n${distillPromptClamp(i.readSoFar, 12000)}`,
        prev
          ? 'Continue the summary with 1-3 NEW bullets for the newly read part. Keep earlier points, avoid repeats, no headings.'
          : 'Write only what was read. Format exactly: one line "The gist: ..." plus up to 3 short bullets. No headings. No markdown.'
      ]);
    }

    case 'quiz_question':
      return out(sys('Write one check-in question to see whether they understood.'), [
        section,
        `The reader just finished:\n\n${recent}`,
        'Ask ONE short question about the main idea of this part, answerable in everyday words. ' +
          'No trick questions and no jargon. Output only the question.'
      ]);

    case 'quiz_feedback':
      return out(sys('Give brief, warm, specific feedback on their answer.'), [
        `Recent part of the paper:\n\n${recent}`,
        `Question: ${distillPromptClamp(i.question, 500)}\nReader answer: "${distillPromptClamp(i.answer, 700)}"\n\n` +
          'In 2-3 supportive sentences, say whether it is right and what they got or missed.'
      ]);

    case 'quiz_skipped_review':
      return out(sys('They skipped a check-in question; show them the answer.'), [
        `Recent part of the paper:\n\n${recent}`,
        `Question: ${distillPromptClamp(i.question, 500)}\n\n` +
          'Give a short model answer and one key takeaway in 2-3 sentences.'
      ]);

    case 'analysis': {
      const gist = distillPromptClamp(c.priorGist, 1500);
      return out(sys('They highlighted a passage and want it explained.'), [
        `Paper title: ${title}`,
        `Abstract or opening:\n\n${distillPromptClamp(c.opener, 1500) || '(not available)'}`,
        gist ? `Gist so far:\n${gist}` : null,
        section,
        `Recent reading context:\n\n${recent}`,
        `Highlighted:\n\n"${distillPromptClamp(i.selection, 900)}"\n\n` +
          'In 3-5 conversational sentences, say what it means in plain words and how it fits the paper so far. ' +
          'Explain any jargon in it.'
      ]);
    }

    default:
      throw new Error(`No prompt for task '${task}'`);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillBuildPrompt };
}
