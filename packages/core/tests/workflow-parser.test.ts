import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseWorkflowContent,
  workflowFileToMemory,
} from '../src/memory/workflow-parser.js';
import type { WorkflowFileData } from '../src/memory/workflow-parser.js';

function loadFixtureYaml(): string {
  return readFileSync(
    join(import.meta.dirname, '../../../tests/fixtures/workflows/form-fill-local.yaml'),
    'utf-8',
  );
}

describe('parseWorkflowContent (YAML)', () => {
  it('parses valid YAML workflow, verifies appName, steps.length, inputs', async () => {
    const content = loadFixtureYaml();
    const result = await parseWorkflowContent(content, 'yaml');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const data = result.data;
    expect(data.appName).toBe('Chrome');
    expect(data.steps).toHaveLength(4);
    expect(data.inputs).toBeDefined();
    expect(Object.keys(data.inputs!)).toHaveLength(2);
    expect(data.inputs!.userName.type).toBe('string');
    expect(data.inputs!.userName.required).toBe(true);
    expect(data.inputs!.userName.minLength).toBe(1);
    expect(data.inputs!.userName.maxLength).toBe(50);
    expect(data.inputs!.email.type).toBe('string');
    expect(data.inputs!.email.required).toBe(true);
    expect(data.riskLevel).toBe('low');
    expect(data.triggerExamples).toEqual(['帮我填表单', '填写测试表单']);
  });

  it('rejects workflow with missing required fields', async () => {
    const result = await parseWorkflowContent(
      `
appName: Test
platform: browser
topic: test
`,
      'yaml',
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid YAML syntax', async () => {
    const result = await parseWorkflowContent(
      'this is: [bad yaml: - invalid::',
      'yaml',
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.errors[0]).toContain('Failed to parse yaml');
  });

  it('parses step with full expectedState', async () => {
    const content = loadFixtureYaml();
    const result = await parseWorkflowContent(content, 'yaml');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const step0 = result.data.steps[0];
    expect(step0.intent).toBe('导航到测试表单页');
    expect(step0.target.strategy).toBe('playwright');
    expect(step0.expectedState).toBeDefined();
    expect(step0.expectedState!.any).toBeDefined();
    expect(step0.expectedState!.any![0].type).toBe('page_text_contains');
    expect((step0.expectedState!.any![0] as { type: string; value: string }).value).toBe('Test Form');
  });

  it('parses the last step with fallback', async () => {
    const content = loadFixtureYaml();
    const result = await parseWorkflowContent(content, 'yaml');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    const lastStep = result.data.steps[3];
    expect(lastStep.fallback).toBe('retry');
    expect(lastStep.riskLevel).toBe('medium');
  });
});

describe('parseWorkflowContent (JSON)', () => {
  it('parses JSON format', async () => {
    const content = loadFixtureYaml();
    // First parse YAML to get valid data, then convert to JSON and re-parse
    const yamlResult = await parseWorkflowContent(content, 'yaml');
    expect(yamlResult.ok).toBe(true);
    if (!yamlResult.ok) throw new Error('expected ok');

    const jsonContent = JSON.stringify(yamlResult.data);
    const jsonResult = await parseWorkflowContent(jsonContent, 'json');

    expect(jsonResult.ok).toBe(true);
    if (!jsonResult.ok) throw new Error('expected ok');

    expect(jsonResult.data.appName).toBe('Chrome');
    expect(jsonResult.data.steps).toHaveLength(4);
    expect(jsonResult.data.riskLevel).toBe('low');
  });
});

describe('TargetDescriptor validation', () => {
  it('rejects invalid TargetDescriptor strategy', async () => {
    const badYaml = `
appName: Test
platform: browser
topic: test
triggerExamples:
  - test
summary: test
initialState: test
steps:
  - intent: test
    targetHint: test
    target:
      strategy: invalid_strategy
    riskLevel: low
successCriteria: test
riskLevel: low
`;
    const result = await parseWorkflowContent(badYaml, 'yaml');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    const combinedErrors = result.errors.join(' ');
    expect(combinedErrors).toMatch(/invalid/i);
  });

  it('validates coordinate strategy requires x,y coordinates', async () => {
    const yaml = `
appName: Test
platform: browser
topic: test
triggerExamples:
  - test
summary: test
initialState: test
steps:
  - intent: test
    targetHint: test
    target:
      strategy: coordinate
      point:
        x: 100
        y: 200
        space: screen-physical
    riskLevel: low
successCriteria: test
riskLevel: low
`;
    const result = await parseWorkflowContent(yaml, 'yaml');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.data.steps[0].target.strategy).toBe('coordinate');
    if (result.data.steps[0].target.strategy === 'coordinate') {
      expect(result.data.steps[0].target.point.x).toBe(100);
      expect(result.data.steps[0].target.point.y).toBe(200);
    }
  });

  it('validates human strategy requires hint', async () => {
    const yaml = `
appName: Test
platform: browser
topic: test
triggerExamples:
  - test
summary: test
initialState: test
steps:
  - intent: test
    targetHint: test
    target:
      strategy: human
      hint: click the button
    riskLevel: low
successCriteria: test
riskLevel: low
`;
    const result = await parseWorkflowContent(yaml, 'yaml');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.data.steps[0].target.strategy).toBe('human');
    if (result.data.steps[0].target.strategy === 'human') {
      expect(result.data.steps[0].target.hint).toBe('click the button');
    }
  });
});

describe('workflowFileToMemory', () => {
  it('produces valid WorkflowMemory with id, steps with order, searchText, inputs with name', async () => {
    const content = loadFixtureYaml();
    const yamlResult = await parseWorkflowContent(content, 'yaml');
    expect(yamlResult.ok).toBe(true);
    if (!yamlResult.ok) throw new Error('expected ok');

    const memory = workflowFileToMemory(yamlResult.data);

    // id should be a non-empty string
    expect(memory.id).toBeTruthy();
    expect(typeof memory.id).toBe('string');
    expect(memory.id.length).toBeGreaterThan(0);

    // steps should have order and id
    expect(memory.steps).toHaveLength(4);
    for (let i = 0; i < memory.steps.length; i++) {
      const step = memory.steps[i];
      expect(step.order).toBe(i);
      expect(step.id).toBeTruthy();
      expect(typeof step.id).toBe('string');
      expect(step.id.length).toBeGreaterThan(0);
    }

    // inputs should be flattened to array with name field
    expect(memory.inputs).toBeDefined();
    expect(memory.inputs).toHaveLength(2);
    expect(memory.inputs![0].name).toBe('userName');
    expect(memory.inputs![0].type).toBe('string');
    expect(memory.inputs![1].name).toBe('email');
    expect(memory.inputs![1].type).toBe('string');

    // searchText should combine appName, topic, triggerExamples, summary
    expect(memory.searchText).toContain('Chrome');
    expect(memory.searchText).toContain('local-form/fill');

    // metadata fields
    expect(memory.sourceType).toBe('manual');
    expect(memory.version).toBe(1);
    expect(memory.embeddingStatus).toBe('not_indexed');
    expect(memory.createdAt).toBeTruthy();
    expect(memory.updatedAt).toBeTruthy();
    expect(memory.createdAt).toBe(memory.updatedAt);
  });
});
