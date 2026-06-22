import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @nut-tree-fork/nut-js before any imports
vi.mock('@nut-tree-fork/nut-js', () => ({
  mouse: {
    config: { autoDelayMs: 50 },
    scrollDown: vi.fn(),
    scrollUp: vi.fn(),
    move: vi.fn(),
  },
  keyboard: {
    config: { autoDelayMs: 50 },
    releaseKey: vi.fn(),
    type: vi.fn(),
    pressKey: vi.fn(),
  },
  Key: { LeftShift: 0, LeftControl: 1, LeftAlt: 2, LeftSuper: 3 },
  straightTo: vi.fn(),
  Point: vi.fn(),
}));

describe('input.scroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scrolls down with given amount', async () => {
    const { scroll } = await import('../src/tools/input.js');
    const result = await scroll('down', 3);
    expect(result.ok).toBe(true);
  });

  it('scrolls up with given amount', async () => {
    const { scroll } = await import('../src/tools/input.js');
    const result = await scroll('up', 5);
    expect(result.ok).toBe(true);
  });

  it('returns error on failure', async () => {
    const nut = await import('@nut-tree-fork/nut-js');
    (nut.mouse.scrollDown as any).mockRejectedValueOnce(new Error('scroll failed'));
    const { scroll } = await import('../src/tools/input.js');
    const result = await scroll('down', 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INPUT_ABORTED');
  });
});

describe('input.releaseAllKeys', () => {
  it('releases modifier keys without error', async () => {
    const { releaseAllKeys } = await import('../src/tools/input.js');
    const result = await releaseAllKeys();
    expect(result.ok).toBe(true);
  });
});
