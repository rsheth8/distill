'use strict';

async function distillSourceVersion(text) {
  if (!globalThis.crypto?.subtle) return `exact:${text}`; // Session memory only; never exported or persisted.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256-v1:${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('')}`;
}
function distillValidSourceReturn(anchor, {paperKey, sourceVersion, textLength}) {
  return !!anchor && anchor.schemaVersion === 1 && anchor.paperKey === paperKey && anchor.sourceVersion === sourceVersion &&
    Number.isInteger(anchor.charOffset) && anchor.charOffset >= 0 && anchor.charOffset < textLength &&
    Number.isInteger(anchor.blockIndex) && anchor.blockIndex >= 0 && ['html','reading','pdf'].includes(anchor.view) &&
    ['ask-source','reading'].includes(anchor.focusTarget);
}
globalThis.DistillSourceReturn = {distillSourceVersion,distillValidSourceReturn};
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DistillSourceReturn;
