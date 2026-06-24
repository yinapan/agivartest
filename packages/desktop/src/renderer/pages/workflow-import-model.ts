export type ImportValidationResult = { ok: true } | { ok: false; message: string };

export function normalizeImportPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function canImportWorkflow(rawPath: string): ImportValidationResult {
  const filePath = normalizeImportPath(rawPath);
  if (!filePath) {
    return { ok: false, message: '请选择或粘贴 .yaml/.yml/.json 工作流文件路径' };
  }
  if (!/\.(yaml|yml|json)$/i.test(filePath)) {
    return { ok: false, message: '仅支持 .yaml/.yml/.json 工作流文件' };
  }
  return { ok: true };
}

export function importedWorkflowMessage(memory: { topic?: unknown }): string {
  return typeof memory.topic === 'string' && memory.topic.trim()
    ? `已导入：${memory.topic}`
    : '工作流已导入';
}
