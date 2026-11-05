import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const path = new URL('../../extension/utils/readingAssistance.js', import.meta.url);
const context = vm.createContext({ module: { exports: {} } });
try { vm.runInContext(readFileSync(path, 'utf8'), context); } catch (err) { if (err.code !== 'ENOENT') throw err; }
const policy = prefs => context.module.exports.distillReadingAssistance?.(prefs);
describe('reading assistance policy', () => {
  it('starts quiet including legacy check-in preferences without modifying user data', () => {
    const prefs = { learnMode: true, notes: ['keep'] };
    expect(policy(prefs)).toEqual({ schemaVersion: 1, automaticHelp: false, checkins: false });
    expect(prefs).toEqual({ learnMode: true, notes: ['keep'] });
    expect(policy({ readingAssistance: {schemaVersion:1,automaticHelp:'true',checkins:1} })).toEqual({schemaVersion:1,automaticHelp:false,checkins:false});
  });
  it('allows only explicitly enabled automatic work; overview remains manual', () => {
    const run = context.module.exports.distillMayAutoRun;
    expect(run?.({automaticHelp:true,checkins:false},'summary')).toBe(true);
    expect(run?.({automaticHelp:true,checkins:false},'section_guide')).toBe(true);
    expect(run?.({automaticHelp:true,checkins:true},'overview')).toBe(false);
    expect(run?.({automaticHelp:false,checkins:true},'quiz_question')).toBe(true);
    expect(run?.({automaticHelp:false,checkins:true},'summary')).toBe(false);
  });
});
