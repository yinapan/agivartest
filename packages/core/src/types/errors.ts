export type ToolErrorCode =
  | 'NATIVE_LOAD_FAILED'
  | 'NATIVE_ABI_MISMATCH'
  | 'NATIVE_MODULE_PATH_INVALID'
  | 'NATIVE_PACKAGED_LOAD_FAILED'
  | 'WINDOW_NOT_FOUND'
  | 'WINDOW_OCCLUDED'
  | 'WINDOW_MINIMIZED'
  | 'UIA_TIMEOUT'
  | 'UIA_PATTERN_UNSUPPORTED'
  | 'UIA_ELEMENT_NOT_FOUND'
  | 'UIA_BACKEND_UNRELIABLE'
  | 'INPUT_ABORTED'
  | 'INPUT_FOCUS_MISMATCH'
  | 'BROWSER_LAUNCH_FAILED'
  | 'BROWSER_ACTION_FAILED'
  | 'RECORDER_BACKEND_UNAVAILABLE'
  | 'RECORDER_RESOURCE_LEAK'
  | 'DPI_MAPPING_FAILED'
  | 'TASK_ABORTED'
  | 'FILE_NOT_FOUND'
  | 'FILE_ACCESS_DENIED'
  | 'TABLE_PARSE_FAILED';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details?: unknown;
}

export type ToolResult<T> =
  | { ok: true; data: T; durationMs: number }
  | { ok: false; error: ToolError; durationMs: number };

export function toolOk<T>(data: T, durationMs: number): ToolResult<T> {
  return { ok: true, data, durationMs };
}

export function toolErr<T>(
  code: ToolErrorCode,
  message: string,
  durationMs: number,
  details?: unknown,
): ToolResult<T> {
  return { ok: false, error: { code, message, details }, durationMs };
}
