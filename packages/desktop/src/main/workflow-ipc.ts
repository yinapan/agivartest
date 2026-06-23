import {
  TextTeachingService,
  draftToMemory,
  validateWorkflowDraft,
  type MemoryStore,
  type TextTeachingProvider,
  type TextTeachingRequest,
  type TextTeachingResult,
  type WorkflowDraft,
  type WorkflowMemory,
  type WorkflowMemoryVersion,
  type WorkflowValidationResult,
} from '@agivar/core';

export type IpcOk<T> = { ok: true; data: T };
export type IpcErr = { ok: false; error: { code: string; message: string } };
export type IpcResult<T> = IpcOk<T> | IpcErr;

export function ipcOk<T>(data: T): IpcOk<T> {
  return { ok: true, data };
}

export function ipcErr(code: string, message: string): IpcErr {
  return { ok: false, error: { code, message } };
}

export async function safeIpc<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return ipcOk(await fn());
  } catch (err) {
    return errorToIpcResult(err);
  }
}

export function splitTeachingTextIntoSteps(text: string): string[] {
  return text
    .split(/[\r\n。.;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function createFallbackTeachingProvider(): TextTeachingProvider {
  return {
    async generateWorkflowDraft(request) {
      const topic = request.goal.trim() || 'Untitled workflow';
      const appName = request.appName?.trim() || 'Desktop';
      const steps = splitTeachingTextIntoSteps(request.teachingText)
        .slice(0, 12)
        .map((line) => ({
          intent: line,
          targetHint: line,
          target: { strategy: 'human' as const, hint: line },
          riskLevel: 'low' as const,
        }));

      return {
        appName,
        platform: request.platform ?? 'desktop',
        topic,
        triggerExamples: [topic],
        summary: request.teachingText.trim().slice(0, 240) || topic,
        initialState: `${appName} is ready.`,
        steps,
        successCriteria: `${topic} is complete.`,
        riskLevel: 'low',
        sourceType: 'text-teach',
      };
    },
  };
}

export async function handleMemoryTeachText(
  request: unknown,
  provider: TextTeachingProvider,
): Promise<IpcResult<TextTeachingResult>> {
  return safeIpc(async () => {
    assertTextTeachingRequest(request);
    const result = await new TextTeachingService(provider).teach(request);
    if (!result.ok || !result.data) {
      throw new Error(result.errors.join('; ') || 'text teaching failed');
    }
    return result.data;
  });
}

export async function handleMemoryValidateDraft(
  draft: WorkflowDraft,
): Promise<IpcResult<WorkflowValidationResult<WorkflowDraft>>> {
  return safeIpc(() => validateWorkflowDraft(draft));
}

export async function handleMemorySaveDraft(
  store: MemoryStore | null,
  draft: WorkflowDraft,
  changeNote?: string,
): Promise<IpcResult<WorkflowMemory>> {
  if (!store) return ipcErr('NO_MEMORY_STORE', 'MemoryStore not initialized');

  return safeIpc(() => {
    const memory = draftToMemory(draft);
    store.saveWithVersion(memory, { source: 'text-teach', changeNote });
    return memory;
  });
}

export async function handleMemoryUpdate(
  store: MemoryStore | null,
  memory: WorkflowMemory,
  changeNote?: string,
): Promise<IpcResult<WorkflowMemory>> {
  if (!store) return ipcErr('NO_MEMORY_STORE', 'MemoryStore not initialized');

  return safeIpc(() => store.updateWithVersion(memory, { source: 'edit', changeNote }));
}

export async function handleMemoryListVersions(
  store: MemoryStore | null,
  memoryId: unknown,
): Promise<IpcResult<WorkflowMemoryVersion[]>> {
  if (!store) return ipcErr('NO_MEMORY_STORE', 'MemoryStore not initialized');

  return safeIpc(() => {
    assertMemoryId(memoryId);
    return store.listVersions(memoryId);
  });
}

export async function handleMemoryGetVersion(
  store: MemoryStore | null,
  memoryId: unknown,
  version: unknown,
): Promise<IpcResult<WorkflowMemoryVersion | null>> {
  if (!store) return ipcErr('NO_MEMORY_STORE', 'MemoryStore not initialized');

  return safeIpc(() => {
    assertMemoryId(memoryId);
    assertVersion(version);
    return store.getVersion(memoryId, version);
  });
}

export async function handleMemoryRollback(
  store: MemoryStore | null,
  memoryId: unknown,
  version: unknown,
  changeNote?: string,
): Promise<IpcResult<WorkflowMemory>> {
  if (!store) return ipcErr('NO_MEMORY_STORE', 'MemoryStore not initialized');

  return safeIpc(() => {
    assertMemoryId(memoryId);
    assertVersion(version);
    return store.rollback(memoryId, version, changeNote);
  });
}

function errorToIpcResult(err: unknown): IpcErr {
  const message = err instanceof Error ? err.message : String(err);
  if (/already exists|duplicate/i.test(message)) {
    return ipcErr('WORKFLOW_ALREADY_EXISTS', message);
  }
  if (
    /must be|required|too long|invalid|positive integer|non-empty string/i.test(message)
  ) {
    return ipcErr('INVALID_PAYLOAD', message);
  }
  return ipcErr('IPC_HANDLER_FAILED', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertTextTeachingRequest(value: unknown): asserts value is TextTeachingRequest {
  if (!isRecord(value)) throw new Error('request must be an object');
  assertStringField(value.goal, 'goal', { min: 1, max: 500 });
  assertStringField(value.teachingText, 'teachingText', { min: 1, max: 20000 });
  if ('appName' in value) assertStringField(value.appName, 'appName', { min: 1, max: 200 });
  if (
    'platform' in value
    && value.platform !== 'desktop'
    && value.platform !== 'browser'
    && value.platform !== 'hybrid'
  ) {
    throw new Error('platform is invalid');
  }
}

function assertStringField(
  value: unknown,
  field: string,
  limits: { min: number; max: number },
): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const length = value.trim().length;
  if (length < limits.min) throw new Error(`${field} is required`);
  if (length > limits.max) throw new Error(`${field} is too long`);
}

function assertMemoryId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('memoryId must be a non-empty string');
  }
}

function assertVersion(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('version must be a positive integer');
  }
}
