import { describe, expect, it } from 'vitest';
import {
  canImportWorkflow,
  importedWorkflowMessage,
  normalizeImportPath,
} from '../src/renderer/pages/workflow-import-model.js';

describe('workflow import model', () => {
  it('normalizes quoted file paths', () => {
    expect(normalizeImportPath('  "C:\\Users\\admin\\Downloads\\flow.yaml"  ')).toBe('C:\\Users\\admin\\Downloads\\flow.yaml');
    expect(normalizeImportPath(" 'C:\\Users\\admin\\Desktop\\flow.json' ")).toBe('C:\\Users\\admin\\Desktop\\flow.json');
  });

  it('allows yaml and json workflow files', () => {
    expect(canImportWorkflow('C:\\Users\\admin\\Downloads\\flow.yaml')).toEqual({ ok: true });
    expect(canImportWorkflow('C:\\Users\\admin\\Downloads\\flow.yml')).toEqual({ ok: true });
    expect(canImportWorkflow('C:\\Users\\admin\\Downloads\\flow.json')).toEqual({ ok: true });
  });

  it('blocks empty or unsupported import paths before IPC', () => {
    expect(canImportWorkflow('')).toEqual({ ok: false, message: '请选择或粘贴 .yaml/.yml/.json 工作流文件路径' });
    expect(canImportWorkflow('C:\\Users\\admin\\Downloads\\flow.txt')).toEqual({ ok: false, message: '仅支持 .yaml/.yml/.json 工作流文件' });
  });

  it('summarizes successful imports', () => {
    expect(importedWorkflowMessage({ topic: 'Create invoice' })).toBe('已导入：Create invoice');
    expect(importedWorkflowMessage({})).toBe('工作流已导入');
  });
});
