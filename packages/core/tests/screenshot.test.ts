import { describe, expect, it } from 'vitest';
import { selectActiveWindowCandidate } from '../src/tools/screenshot.js';

describe('screenshot active window selection', () => {
  it('prefers the focused visible window over monitor fallback metadata', () => {
    const selected = selectActiveWindowCandidate([
      makeWindow({ id: 10, title: 'Background', focused: false }),
      makeWindow({ id: 22, title: 'Focused editor', focused: true }),
    ]);

    expect(selected).toEqual({
      hwnd: 22,
      title: 'Focused editor',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      isMinimized: false,
    });
  });

  it('falls back to the first visible titled window when focus metadata is unavailable', () => {
    const selected = selectActiveWindowCandidate([
      makeWindow({ id: 0, title: 'Taskbar', width: 2560, height: 48 }),
      makeWindow({ id: 31, title: '', width: 800, height: 600 }),
      makeWindow({ id: 42, title: 'QQ Music', width: 1000, height: 720 }),
    ]);

    expect(selected?.hwnd).toBe(42);
    expect(selected?.title).toBe('QQ Music');
  });

  it('ignores minimized, offscreen, zero-sized, and hwnd=0 pseudo windows', () => {
    const selected = selectActiveWindowCandidate([
      makeWindow({ id: 0, title: 'Monitor 1', focused: true }),
      makeWindow({ id: 11, title: 'Hidden', minimized: true }),
      makeWindow({ id: 12, title: 'Zero', width: 0, height: 0 }),
      makeWindow({ id: 13, title: 'Offscreen', x: -21333, y: -21333 }),
    ]);

    expect(selected).toBeNull();
  });
});

function makeWindow(overrides: {
  id: number;
  title: string;
  focused?: boolean;
  minimized?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  return {
    id: () => overrides.id,
    title: () => overrides.title,
    isFocused: () => overrides.focused ?? false,
    isMinimized: () => overrides.minimized ?? false,
    x: () => overrides.x ?? 0,
    y: () => overrides.y ?? 0,
    width: () => overrides.width ?? 800,
    height: () => overrides.height ?? 600,
  };
}
