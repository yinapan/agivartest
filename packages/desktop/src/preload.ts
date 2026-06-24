import { contextBridge, ipcRenderer } from 'electron';

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

type TextTeachingRequestDto = {
  goal: string;
  teachingText: string;
  appName?: string;
  platform?: 'desktop' | 'browser' | 'hybrid';
};

type WorkflowMemoryDto = Record<string, unknown>;
type WorkflowDraftDto = Record<string, unknown>;
type WorkflowMemoryVersionDto = Record<string, unknown>;
type TextTeachingResultDto = Record<string, unknown>;
type RecordingTeachStartRequestDto = {
  scope: 'fullscreen' | 'active-window';
  privacyMode: 'summary' | 'detailed';
  goal?: string;
  notes?: string;
  activeSessionId?: string;
};
type RecordingSessionDto = Record<string, unknown>;
type RecordingTimelineDto = Record<string, unknown>;

contextBridge.exposeInMainWorld('agivar', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  screenshot: {
    captureScreen: (idx?: number) => ipcRenderer.invoke('screenshot:captureScreen', idx),
    getActiveWindow: () => ipcRenderer.invoke('screenshot:getActiveWindow'),
    listWindows: () => ipcRenderer.invoke('screenshot:listWindows'),
  },
  uia: {
    getUiTree: (hwnd: number, opts?: any) => ipcRenderer.invoke('uia:getUiTree', hwnd, opts),
    findElement: (hwnd: number, q: any, opts?: any) => ipcRenderer.invoke('uia:findElement', hwnd, q, opts),
  },
  input: {
    click: (x: number, y: number, opts?: any) => ipcRenderer.invoke('input:click', x, y, opts),
    typeText: (text: string) => ipcRenderer.invoke('input:typeText', text),
    pressKeys: (keys: string[]) => ipcRenderer.invoke('input:pressKeys', keys),
  },
  browser: {
    launch: (opts?: any) => ipcRenderer.invoke('browser:launch', opts),
  },
  recorder: {
    start: (config: any) => ipcRenderer.invoke('recorder:start', config),
    stop: (sid: string) => ipcRenderer.invoke('recorder:stop', sid),
    forceStopAll: () => ipcRenderer.invoke('recorder:forceStopAll'),
  },
  recordingTeach: {
    start: (request: RecordingTeachStartRequestDto): Promise<IpcResult<RecordingSessionDto>> =>
      ipcRenderer.invoke('recordingTeach:start', request),
    stop: (sessionId: string): Promise<IpcResult<RecordingSessionDto>> =>
      ipcRenderer.invoke('recordingTeach:stop', sessionId),
    status: (sessionId: string): Promise<IpcResult<RecordingSessionDto>> =>
      ipcRenderer.invoke('recordingTeach:status', sessionId),
    getTimeline: (sessionId: string): Promise<IpcResult<RecordingTimelineDto>> =>
      ipcRenderer.invoke('recordingTeach:getTimeline', sessionId),
  },
  dpi: {
    getScaleFactor: (idx?: number) => ipcRenderer.invoke('dpi:getScaleFactor', idx),
  },
  agent: {
    runTask: (goal: string, sessionId: string) =>
      ipcRenderer.invoke('agent:runTask', goal, sessionId),
    abort: () => ipcRenderer.invoke('agent:abort'),
    resumeTakeover: () => ipcRenderer.invoke('agent:resumeTakeover'),
    selectMemory: (memoryId: string) =>
      ipcRenderer.invoke('agent:selectMemory', memoryId),
    onEvent: (taskRunId: string, callback: (event: unknown) => void) => {
      const handler = (_: unknown, event: any) => {
        if (event.taskRunId === taskRunId) callback(event);
      };
      ipcRenderer.on('agent:event', handler);
      return () => { try { ipcRenderer.removeListener('agent:event', handler); } catch { /* ignore */ } };
    },
  },
  memory: {
    import: (filePath: string) => ipcRenderer.invoke('memory:import', filePath),
    list: (filter?: { appName?: string; topic?: string }) =>
      ipcRenderer.invoke('memory:list', filter),
    get: (id: string) => ipcRenderer.invoke('memory:get', id),
    delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
    teachText: (request: TextTeachingRequestDto): Promise<IpcResult<TextTeachingResultDto>> =>
      ipcRenderer.invoke('memory:teachText', request),
    validateDraft: (draft: WorkflowDraftDto): Promise<IpcResult<unknown>> =>
      ipcRenderer.invoke('memory:validateDraft', draft),
    saveDraft: (draft: WorkflowDraftDto, changeNote?: string): Promise<IpcResult<WorkflowMemoryDto>> =>
      ipcRenderer.invoke('memory:saveDraft', draft, changeNote),
    update: (memory: WorkflowMemoryDto, changeNote?: string): Promise<IpcResult<WorkflowMemoryDto>> =>
      ipcRenderer.invoke('memory:update', memory, changeNote),
    listVersions: (memoryId: string): Promise<IpcResult<WorkflowMemoryVersionDto[]>> =>
      ipcRenderer.invoke('memory:listVersions', memoryId),
    getVersion: (memoryId: string, version: number): Promise<IpcResult<WorkflowMemoryVersionDto | null>> =>
      ipcRenderer.invoke('memory:getVersion', memoryId, version),
    rollback: (memoryId: string, version: number, changeNote?: string): Promise<IpcResult<WorkflowMemoryDto>> =>
      ipcRenderer.invoke('memory:rollback', memoryId, version, changeNote),
  },
  session: {
    list: () => ipcRenderer.invoke('session:list'),
    create: () => ipcRenderer.invoke('session:create'),
    delete: (id: string) => ipcRenderer.invoke('session:delete', id),
    getMessages: (sessionId: string) =>
      ipcRenderer.invoke('session:getMessages', sessionId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:update', patch),
    getApiKeyMask: () => ipcRenderer.invoke('settings:getApiKeyMask'),
    setApiKey: (key: string) => ipcRenderer.invoke('settings:setApiKey', key),
  },
});
