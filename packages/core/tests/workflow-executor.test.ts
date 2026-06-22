import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveVariables,
  buildStepPlan,
  validateInputs,
  getMissingInputs,
  getHumanOnlyInputs,
  getRequiredInputs,
} from '../src/agent/workflow-executor.js';
import { parseWorkflowContent, workflowFileToMemory } from '../src/memory/workflow-parser.js';
import type { WorkflowStep, WorkflowMemory } from '../src/types/workflow.js';

// ---------------------------------------------------------------------------
// resolveVariables
// ---------------------------------------------------------------------------

describe('resolveVariables', () => {
  it('replaces known variables', () => {
    expect(resolveVariables('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('preserves unknown variables as-is', () => {
    expect(resolveVariables('Hello {{name}}', {})).toBe('Hello {{name}}');
  });

  it('handles multiple variables in one string', () => {
    expect(
      resolveVariables('{{greeting}} {{name}}!', { greeting: 'Hello', name: 'World' }),
    ).toBe('Hello World!');
  });

  it('handles no variables at all', () => {
    expect(resolveVariables('plain text', {})).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(resolveVariables('', { name: 'World' })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildStepPlan
// ---------------------------------------------------------------------------

describe('buildStepPlan', () => {
  it('creates navigate action from navigate: prefix', () => {
    const step: WorkflowStep = {
      id: 's1',
      order: 0,
      intent: '导航到搜索页',
      targetHint: '地址栏',
      target: { strategy: 'playwright', selector: 'body' },
      inputHint: 'navigate:http://127.0.0.1:12827/search-local.html',
      riskLevel: 'low',
    };

    const plan = buildStepPlan(step, {});
    expect(plan.action).toEqual({ type: 'navigate', url: 'http://127.0.0.1:12827/search-local.html' });
    expect(plan.intent).toBe('导航到搜索页');
    expect(plan.riskLevel).toBe('low');
    expect(plan.source).toBe('workflow');
  });

  it('creates type action from playwright target with inputHint', () => {
    const step: WorkflowStep = {
      id: 's2',
      order: 1,
      intent: '输入搜索关键词',
      targetHint: '搜索输入框',
      target: { strategy: 'playwright', selector: '#searchInput' },
      inputHint: 'TypeScript',
      riskLevel: 'low',
    };

    const plan = buildStepPlan(step, {});
    expect(plan.action).toEqual({ type: 'type', text: 'TypeScript' });
  });

  it('resolves variables in type action hint', () => {
    const step: WorkflowStep = {
      id: 's2',
      order: 1,
      intent: '输入搜索关键词',
      targetHint: '搜索输入框',
      target: { strategy: 'playwright', selector: '#searchInput' },
      inputHint: '{{keyword}}',
      riskLevel: 'low',
    };

    const plan = buildStepPlan(step, { keyword: 'TypeScript' });
    expect(plan.action).toEqual({ type: 'type', text: 'TypeScript' });
  });

  it('creates click action for step without inputHint', () => {
    const step: WorkflowStep = {
      id: 's3',
      order: 2,
      intent: '点击搜索按钮',
      targetHint: '搜索按钮',
      target: { strategy: 'playwright', selector: '#searchBtn' },
      riskLevel: 'low',
    };

    const plan = buildStepPlan(step, {});
    expect(plan.action).toEqual({
      type: 'click',
      target: { strategy: 'playwright', selector: '#searchBtn' },
    });
  });

  it('creates type action from uia target with inputHint', () => {
    const step: WorkflowStep = {
      id: 's4',
      order: 0,
      intent: '输入文本',
      targetHint: '记事本编辑区',
      target: {
        strategy: 'uia',
        query: { controlType: 'Document', className: 'RichEditD2DPT' },
      },
      inputHint: 'hello world',
      riskLevel: 'low',
    };

    const plan = buildStepPlan(step, {});
    expect(plan.action).toEqual({ type: 'type', text: 'hello world' });
  });

  it('creates click action for coordinate target without inputHint', () => {
    const step: WorkflowStep = {
      id: 's5',
      order: 0,
      intent: 'click coordinate',
      targetHint: 'screen',
      target: {
        strategy: 'coordinate',
        point: { x: 100, y: 200, space: 'screen-physical' },
      },
      riskLevel: 'low',
    };

    const plan = buildStepPlan(step, {});
    expect(plan.action).toEqual({
      type: 'click',
      target: {
        strategy: 'coordinate',
        point: { x: 100, y: 200, space: 'screen-physical' },
      },
    });
  });

  it('includes expectedState and riskLevel in plan', () => {
    const step: WorkflowStep = {
      id: 's6',
      order: 0,
      intent: '导航',
      targetHint: '地址栏',
      target: { strategy: 'playwright', selector: 'body' },
      inputHint: 'navigate:http://example.com',
      expectedState: {
        any: [{ type: 'page_text_contains', value: 'Search Test' }],
      },
      riskLevel: 'medium',
    };

    const plan = buildStepPlan(step, {});
    expect(plan.expectedState).toEqual({
      any: [{ type: 'page_text_contains', value: 'Search Test' }],
    });
    expect(plan.riskLevel).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// validateInputs
// ---------------------------------------------------------------------------

describe('validateInputs', () => {
  const baseWorkflow: WorkflowMemory = {
    id: 'wf1',
    appName: 'Test',
    platform: 'browser',
    topic: 'test',
    triggerExamples: [],
    summary: 'test',
    initialState: 'starting',
    inputs: [
      { name: 'name', type: 'string', required: true, prompt: 'name', minLength: 1 },
      { name: 'email', type: 'string', required: true, prompt: 'email' },
      { name: 'bio', type: 'string', required: false, prompt: 'bio', maxLength: 10 },
    ],
    steps: [],
    successCriteria: '',
    riskLevel: 'low',
    sourceType: 'manual',
    version: 1,
    searchText: '',
    embeddingStatus: 'not_indexed',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  it('reports missing required inputs', () => {
    const errors = validateInputs(baseWorkflow, {});
    expect(errors).toEqual([
      'Missing required input: name',
      'Missing required input: email',
    ]);
  });

  it('passes with all required inputs provided', () => {
    const errors = validateInputs(baseWorkflow, { name: 'Alice', email: 'a@b.com' });
    expect(errors).toEqual([]);
  });

  it('passes when optional input missing', () => {
    const errors = validateInputs(baseWorkflow, { name: 'Alice', email: 'a@b.com' });
    expect(errors).toEqual([]);
  });

  it('validates minLength', () => {
    const errors = validateInputs(baseWorkflow, { name: '', email: 'a@b.com' });
    expect(errors).toContain('Missing required input: name');
  });

  it('validates maxLength', () => {
    const errors = validateInputs(baseWorkflow, {
      name: 'Alice',
      email: 'a@b.com',
      bio: 'this is way too long text',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('bio');
    expect(errors[0]).toContain('maximum length');
  });

  it('handles empty input array', () => {
    const wf: WorkflowMemory = { ...baseWorkflow, inputs: [] };
    const errors = validateInputs(wf, {});
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getMissingInputs
// ---------------------------------------------------------------------------

describe('getMissingInputs', () => {
  const baseWorkflow: WorkflowMemory = {
    id: 'wf2',
    appName: 'Test',
    platform: 'browser',
    topic: 'test',
    triggerExamples: [],
    summary: 'test',
    initialState: 'starting',
    inputs: [
      { name: 'name', type: 'string', required: true, prompt: 'name' },
      { name: 'email', type: 'string', required: false, prompt: 'email' },
    ],
    steps: [],
    successCriteria: '',
    riskLevel: 'low',
    sourceType: 'manual',
    version: 1,
    searchText: '',
    embeddingStatus: 'not_indexed',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  it('returns only missing required inputs', () => {
    const missing = getMissingInputs(baseWorkflow, { email: 'a@b.com' });
    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe('name');
  });

  it('returns empty when all required provided', () => {
    const missing = getMissingInputs(baseWorkflow, { name: 'Alice' });
    expect(missing).toEqual([]);
  });

  it('does not include non-required inputs', () => {
    const missing = getMissingInputs(baseWorkflow, { name: 'Alice' });
    expect(missing.some(i => i.name === 'email')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getHumanOnlyInputs
// ---------------------------------------------------------------------------

describe('getHumanOnlyInputs', () => {
  it('returns only inputs marked humanOnly', () => {
    const workflow: WorkflowMemory = {
      id: 'wf3',
      appName: 'Test',
      platform: 'browser',
      topic: 'test',
      triggerExamples: [],
      summary: 'test',
      initialState: 'starting',
      inputs: [
        { name: 'name', type: 'string', required: true, prompt: 'name' },
        { name: 'secret_key', type: 'string', required: true, prompt: 'key', humanOnly: true },
        { name: 'email', type: 'string', required: false, prompt: 'email' },
      ],
      steps: [],
      successCriteria: '',
      riskLevel: 'low',
      sourceType: 'manual',
      version: 1,
      searchText: '',
      embeddingStatus: 'not_indexed',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    const humanOnly = getHumanOnlyInputs(workflow);
    expect(humanOnly).toHaveLength(1);
    expect(humanOnly[0].name).toBe('secret_key');
  });
});

// ---------------------------------------------------------------------------
// getRequiredInputs
// ---------------------------------------------------------------------------

describe('getRequiredInputs', () => {
  it('returns only required inputs', () => {
    const workflow: WorkflowMemory = {
      id: 'wf4',
      appName: 'Test',
      platform: 'browser',
      topic: 'test',
      triggerExamples: [],
      summary: 'test',
      initialState: 'starting',
      inputs: [
        { name: 'name', type: 'string', required: true, prompt: 'name' },
        { name: 'email', type: 'string', required: false, prompt: 'email' },
      ],
      steps: [],
      successCriteria: '',
      riskLevel: 'low',
      sourceType: 'manual',
      version: 1,
      searchText: '',
      embeddingStatus: 'not_indexed',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    const required = getRequiredInputs(workflow);
    expect(required).toHaveLength(1);
    expect(required[0].name).toBe('name');
  });
});

// ---------------------------------------------------------------------------
// YAML fixture parsing
// ---------------------------------------------------------------------------

function loadFixtureYaml(name: string): string {
  return readFileSync(
    join(import.meta.dirname, `../../../tests/fixtures/workflows/${name}`),
    'utf-8',
  );
}

describe('YAML fixture parsing', () => {
  it('parses form-fill-local.yaml correctly', async () => {
    const content = loadFixtureYaml('form-fill-local.yaml');
    const result = await parseWorkflowContent(content, 'yaml');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const data = result.data;
    expect(data.appName).toBe('Chrome');
    expect(data.steps).toHaveLength(4);
    expect(data.inputs).toBeDefined();
    expect(Object.keys(data.inputs!)).toHaveLength(2);

    const memory = workflowFileToMemory(data);
    expect(memory.steps).toHaveLength(4);
    expect(memory.inputs).toHaveLength(2);
  });

  it('parses search-local.yaml correctly', async () => {
    const content = loadFixtureYaml('search-local.yaml');
    const result = await parseWorkflowContent(content, 'yaml');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const data = result.data;
    expect(data.appName).toBe('Chrome');
    expect(data.topic).toBe('local-search/keyword');
    expect(data.steps).toHaveLength(3);
    expect(data.inputs).toBeDefined();
    expect(Object.keys(data.inputs!)).toHaveLength(1);
    expect(data.inputs!.keyword.type).toBe('string');
    expect(data.inputs!.keyword.required).toBe(true);
    expect(data.inputs!.keyword.minLength).toBe(1);

    // Verify the navigate: prefix is preserved on the first step
    expect(data.steps[0].inputHint).toBe('navigate:http://127.0.0.1:12827/search-local.html');

    // Verify the {{keyword}} placeholder is preserved on the second step
    expect(data.steps[1].inputHint).toBe('{{keyword}}');

    // Verify the expectedState has {{keyword}} as well
    expect(data.steps[2].expectedState).toBeDefined();
    expect(data.steps[2].expectedState!.any).toBeDefined();
    expect((data.steps[2].expectedState!.any![0] as { type: string; value: string }).value).toBe('{{keyword}}');

    const memory = workflowFileToMemory(data);
    expect(memory.steps).toHaveLength(3);
    expect(memory.inputs).toHaveLength(1);
    expect(memory.inputs![0].name).toBe('keyword');
  });

  it('parses notepad-text.yaml correctly', async () => {
    const content = loadFixtureYaml('notepad-text.yaml');
    const result = await parseWorkflowContent(content, 'yaml');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const data = result.data;
    expect(data.appName).toBe('记事本');
    expect(data.platform).toBe('desktop');
    expect(data.topic).toBe('notepad/input-text');
    expect(data.steps).toHaveLength(3);
    expect(data.inputs).toBeDefined();
    expect(Object.keys(data.inputs!)).toHaveLength(1);
    expect(data.inputs!.content.type).toBe('string');
    expect(data.inputs!.content.required).toBe(true);

    // Verify coordinate strategy on step 0
    expect(data.steps[0].target.strategy).toBe('coordinate');
    if (data.steps[0].target.strategy === 'coordinate') {
      expect(data.steps[0].target.point.x).toBe(0);
      expect(data.steps[0].target.point.y).toBe(0);
      expect(data.steps[0].target.point.space).toBe('screen-physical');
    }

    // Verify UIA strategy on step 1
    expect(data.steps[1].target.strategy).toBe('uia');
    expect(data.steps[1].fallback).toBe('retry');

    // Verify UIA strategy on step 2
    expect(data.steps[2].target.strategy).toBe('uia');
    expect(data.steps[2].inputHint).toBe('{{content}}');

    const memory = workflowFileToMemory(data);
    expect(memory.steps).toHaveLength(3);
    expect(memory.inputs).toHaveLength(1);
  });
});
