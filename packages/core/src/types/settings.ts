export interface AppSettings {
  llm: {
    provider: 'openai-compatible';
    model: string;
    baseURL?: string;
    visionModel?: string;
    maxTokens: number;
    temperature: number;
  };
  safety: {
    emergencyStopHotkey: string;
    confirmMediumRisk: boolean;
    maxRetries: number;
    takeoverTimeoutMs: number;
  };
  storage: {
    dataDir: string;
    logRetentionDays: number;
  };
  privacy: {
    screenshotOnlyForTask: boolean;
    logLlmRequests: boolean;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    provider: 'openai-compatible',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.1,
  },
  safety: {
    emergencyStopHotkey: 'Ctrl+Alt+Space',
    confirmMediumRisk: false,
    maxRetries: 2,
    takeoverTimeoutMs: 300000,
  },
  storage: {
    dataDir: '',
    logRetentionDays: 30,
  },
  privacy: {
    screenshotOnlyForTask: true,
    logLlmRequests: true,
  },
};
