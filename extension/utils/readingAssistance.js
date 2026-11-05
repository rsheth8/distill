'use strict';

function distillReadingAssistance(prefs = {}) {
  const value = prefs.readingAssistance;
  return { schemaVersion: 1, automaticHelp: value?.schemaVersion === 1 && value.automaticHelp === true,
    checkins: value?.schemaVersion === 1 && value.checkins === true };
}

function distillMayAutoRun(assistance, task) {
  if (task === 'summary' || task === 'section_guide') return assistance.automaticHelp === true;
  return task === 'quiz_question' && assistance.checkins === true;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { distillReadingAssistance, distillMayAutoRun };
