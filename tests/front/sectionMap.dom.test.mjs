import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { distillRenderSectionMap } = require('../../extension/utils/sectionMap.js');

const seg = (heading, state, flex = 1) => ({ heading, kind: 'other', flex, state, line: '' });

describe('distillRenderSectionMap', () => {
  it('hides the map when there are fewer than two sections', () => {
    const box = document.createElement('div');
    distillRenderSectionMap(box, [seg('Only', 'current')], () => {});
    expect(box.hidden).toBe(true);
    expect(box.children.length).toBe(0);
  });
  it('renders one button per section with its state and width', () => {
    const box = document.createElement('div');
    distillRenderSectionMap(box, [seg('Intro', 'read', 0.5), seg('Methods', 'current', 2)], () => {});
    const btns = box.querySelectorAll('button');
    expect(box.hidden).toBe(false);
    expect(btns.length).toBe(2);
    expect(btns[1].dataset.state).toBe('current');
    expect(btns[1].style.flexGrow).toBe('2');
    expect(btns[1].getAttribute('aria-current')).toBe('step');
    expect(btns[0].getAttribute('aria-label')).toBe('Intro, read. Jump to this section');
  });
  it('calls onJump with the heading when a segment is clicked', () => {
    const box = document.createElement('div');
    const onJump = vi.fn();
    distillRenderSectionMap(box, [seg('Intro', 'read'), seg('Methods', 'ahead')], onJump);
    box.querySelectorAll('button')[1].click();
    expect(onJump).toHaveBeenCalledWith('Methods');
  });
  it('replaces the previous render', () => {
    const box = document.createElement('div');
    distillRenderSectionMap(box, [seg('A', 'read'), seg('B', 'current')], () => {});
    distillRenderSectionMap(box, [seg('A', 'read'), seg('B', 'read'), seg('C', 'current')], () => {});
    expect(box.querySelectorAll('button').length).toBe(3);
  });
});
