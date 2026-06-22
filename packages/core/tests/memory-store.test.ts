import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabaseForTest } from '../src/memory/db.js';
import { MemoryStore } from '../src/memory/memory-store.js';
import type { DatabaseLike } from '../src/memory/schema.js';
import type { WorkflowMemory } from '../src/types/workflow.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

let seq = 0;
function nextId(): string {
  return `mem-${Date.now()}-${seq++}`;
}

function makeMemory(overrides?: Partial<WorkflowMemory>): WorkflowMemory {
  return {
    id: nextId(),
    appName: 'test-app',
    platform: 'desktop',
    topic: '填写表单',
    triggerExamples: ['帮我填表', '填写订单'],
    summary: '自动填写网页表单的流程',
    initialState: '浏览器已打开目标网页',
    inputs: [
      { name: 'username', type: 'string', required: true, prompt: '用户名' },
    ],
    steps: [
      {
        id: 'step-1',
        order: 1,
        intent: '点击用户名输入框',
        targetHint: '用户名输入框',
        target: { strategy: 'human', hint: '用户名输入框' },
        riskLevel: 'low',
      },
    ],
    successCriteria: '表单填写成功，显示提交按钮变灰',
    riskLevel: 'low',
    sourceType: 'manual',
    version: 1,
    searchText: '填表 表单 自动填写',
    embeddingStatus: 'not_indexed',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MemoryStore', () => {
  let db: DatabaseLike;
  let store: MemoryStore;

  beforeEach(() => {
    db = getDatabaseForTest(':memory:');
    store = new MemoryStore(db);
  });

  afterEach(() => {
    if (db) {
      (db as DatabaseLike & { close(): void }).close();
    }
  });

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  describe('insert + getById roundtrip', () => {
    it('persists and retrieves all scalar fields', () => {
      const mem = makeMemory();
      store.insert(mem);
      const fetched = store.getById(mem.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(mem.id);
      expect(fetched!.appName).toBe('test-app');
      expect(fetched!.platform).toBe('desktop');
      expect(fetched!.topic).toBe('填写表单');
      expect(fetched!.summary).toBe('自动填写网页表单的流程');
      expect(fetched!.initialState).toBe('浏览器已打开目标网页');
      expect(fetched!.successCriteria).toBe('表单填写成功，显示提交按钮变灰');
      expect(fetched!.riskLevel).toBe('low');
      expect(fetched!.sourceType).toBe('manual');
      expect(fetched!.version).toBe(1);
      expect(fetched!.searchText).toBe('填表 表单 自动填写');
      expect(fetched!.embeddingStatus).toBe('not_indexed');
      expect(fetched!.createdAt).toBe('2025-01-01T00:00:00.000Z');
      expect(fetched!.updatedAt).toBe('2025-01-01T00:00:00.000Z');
    });

    it('round-trips triggerExamples as a JSON array', () => {
      const mem = makeMemory({ triggerExamples: ['帮我填表', '填写订单', '新增客户'] });
      store.insert(mem);
      const fetched = store.getById(mem.id);
      expect(fetched!.triggerExamples).toEqual(['帮我填表', '填写订单', '新增客户']);
    });

    it('round-trips steps as a JSON array', () => {
      const mem = makeMemory({
        steps: [
          {
            id: 'step-1',
            order: 1,
            intent: '填写用户名',
            targetHint: '用户名输入框',
            target: { strategy: 'human', hint: '用户名输入框' },
            riskLevel: 'low',
          },
          {
            id: 'step-2',
            order: 2,
            intent: '点击提交',
            targetHint: '提交按钮',
            target: { strategy: 'uia', query: {}, hint: '提交按钮' },
            fallback: 'retry',
            riskLevel: 'medium',
          },
        ],
      });
      store.insert(mem);
      const fetched = store.getById(mem.id);
      expect(fetched!.steps).toHaveLength(2);
      expect(fetched!.steps[0].intent).toBe('填写用户名');
      expect(fetched!.steps[1].fallback).toBe('retry');
      expect(fetched!.steps[1].target.strategy).toBe('uia');
    });

    it('round-trips optional inputs including nested fields', () => {
      const mem = makeMemory({
        inputs: [
          { name: 'username', type: 'string', required: true, prompt: '用户名', minLength: 3, maxLength: 20 },
          { name: 'count', type: 'number', required: false, prompt: '数量', defaultValue: '1' },
        ],
      });
      store.insert(mem);
      const fetched = store.getById(mem.id);
      expect(fetched!.inputs).toHaveLength(2);
      expect(fetched!.inputs![0].minLength).toBe(3);
      expect(fetched!.inputs![1].defaultValue).toBe('1');
    });

    it('handles missing inputs as undefined', () => {
      const mem = makeMemory({ inputs: undefined });
      store.insert(mem);
      const fetched = store.getById(mem.id);
      expect(fetched!.inputs).toBeUndefined();
    });
  });

  describe('getById', () => {
    it('returns null for non-existent id', () => {
      expect(store.getById('nonexistent')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all memories', () => {
      store.insert(makeMemory());
      store.insert(makeMemory({ appName: 'other-app' }));
      expect(store.list()).toHaveLength(2);
    });

    it('returns empty array when no memories exist', () => {
      expect(store.list()).toEqual([]);
    });

    it('filters by appName', () => {
      store.insert(makeMemory({ appName: 'chrome' }));
      store.insert(makeMemory({ appName: 'firefox' }));
      store.insert(makeMemory({ appName: 'chrome' }));

      const chrome = store.list({ appName: 'chrome' });
      expect(chrome).toHaveLength(2);
      expect(chrome.every((m) => m.appName === 'chrome')).toBe(true);
    });

    it('filters by topic', () => {
      store.insert(makeMemory({ topic: 'login' }));
      store.insert(makeMemory({ topic: 'checkout' }));
      store.insert(makeMemory({ topic: 'login' }));

      const login = store.list({ topic: 'login' });
      expect(login).toHaveLength(2);
      expect(login.every((m) => m.topic === 'login')).toBe(true);
    });

    it('filters by both appName and topic', () => {
      store.insert(makeMemory({ appName: 'chrome', topic: 'login' }));
      store.insert(makeMemory({ appName: 'chrome', topic: 'checkout' }));
      store.insert(makeMemory({ appName: 'firefox', topic: 'login' }));

      const result = store.list({ appName: 'chrome', topic: 'login' });
      expect(result).toHaveLength(1);
      expect(result[0].appName).toBe('chrome');
      expect(result[0].topic).toBe('login');
    });
  });

  describe('delete', () => {
    it('returns true and removes the memory', () => {
      const mem = makeMemory();
      store.insert(mem);

      expect(store.delete(mem.id)).toBe(true);
      expect(store.getById(mem.id)).toBeNull();
    });

    it('returns false for non-existent id', () => {
      expect(store.delete('nonexistent')).toBe(false);
    });

    it('deleting twice returns false the second time', () => {
      const mem = makeMemory();
      store.insert(mem);
      expect(store.delete(mem.id)).toBe(true);
      expect(store.delete(mem.id)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  describe('search', () => {
    it('exact trigger match gives score >= 0.5', () => {
      store.insert(
        makeMemory({
          triggerExamples: ['帮我填表单'],
          topic: '表单填写',
          summary: '自动填写网页表单的流程',
          searchText: '填表 表单',
        }),
      );

      const results = store.search('帮我填表单');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].score).toBeGreaterThanOrEqual(0.5);
    });

    it('returns match with matchedFields populated correctly', () => {
      store.insert(
        makeMemory({
          triggerExamples: ['搜索客户记录'],
          topic: '客户管理',
          summary: '在CRM中搜索并显示客户信息',
          searchText: '搜索 客户',
          appName: 'CRM',
        }),
      );

      const results = store.search('搜索客户记录');
      expect(results.length).toBeGreaterThanOrEqual(1);
      // triggerExamples should be matched since the tokens come from it
      expect(results[0].matchedFields).toContain('triggerExamples');
      // score should contain matchedFields as a non-empty array
      expect(results[0].matchedFields.length).toBeGreaterThan(0);
    });

    it('unrelated query returns empty array', () => {
      store.insert(makeMemory());

      const results = store.search('cat dog bird xyzzyplugh');
      expect(results).toEqual([]);
    });

    it('empty goal returns empty array', () => {
      store.insert(makeMemory());

      expect(store.search('')).toEqual([]);
      expect(store.search('   ')).toEqual([]);
    });

    it('returns at most 3 results', () => {
      // Insert 5 memories that all share the same searchText so they all
      // match the query.
      for (let i = 0; i < 5; i++) {
        store.insert(
          makeMemory({
            searchText: '通用 搜索 common',
            // Vary the topic to make each memory slightly different.
            topic: `任务${i}`,
          }),
        );
      }

      const results = store.search('通用 搜索');
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('sorts results by score descending', () => {
      // Memory with exact match in triggerExamples (high-weight field)
      store.insert(
        makeMemory({
          triggerExamples: ['发送电子邮件'],
          topic: '邮件',
          summary: '发送邮件',
          searchText: '邮件',
        }),
      );
      // Memory with only a low-weight field match
      store.insert(
        makeMemory({
          triggerExamples: ['播放音乐'],
          topic: '邮件提醒',
          summary: '设置邮件提醒',
          searchText: '音乐',
        }),
      );

      const results = store.search('发送电子邮件');
      expect(results.length).toBeGreaterThanOrEqual(2);

      // Scores should be non-increasing
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it('partial Chinese token match scores appropriately', () => {
      store.insert(
        makeMemory({
          triggerExamples: ['打开百度搜索'],
          topic: '搜索',
          summary: '打开百度并执行搜索',
          searchText: '百度 搜索',
        }),
      );

      // "百度" is a 2-char Chinese word → token: "百度"
      const results = store.search('百度');
      expect(results.length).toBeGreaterThanOrEqual(1);
      // Should match triggerExamples, topic, and searchText
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Tokenization edge cases
  // -----------------------------------------------------------------------

  describe('tokenize (via search)', () => {
    it('handles ASCII-only input', () => {
      store.insert(makeMemory({ searchText: 'hello world foo bar' }));
      const results = store.search('hello world');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('handles mixed Chinese and ASCII input', () => {
      store.insert(makeMemory({ searchText: 'react 组件 渲染' }));
      const results = store.search('react 组件');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('handles punctuation in the goal', () => {
      store.insert(makeMemory({ searchText: '填表 表单' }));
      const results = store.search('填表！？');
      // Punctuation is stripped; token "填表" should remain
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('deduplicates repeated tokens', () => {
      store.insert(makeMemory({ searchText: '搜索' }));
      // "搜索搜索搜索" → bigrams: ["搜索", "索搜", "搜索", "索搜", ...]
      // After dedup the set should be small; "搜索" still appears
      const results = store.search('搜索搜索');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });
});
