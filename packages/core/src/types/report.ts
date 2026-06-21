export type PocStatus = 'passed' | 'failed' | 'skipped';
export type PocKind = 'readonly' | 'interactive';
export type EnvCheckLevel = 'pass' | 'warn' | 'fail';

export interface PocResult {
  name: string;
  kind: PocKind;
  status: PocStatus;
  durationMs: number;
  metrics: Record<string, number | string | boolean>;
  artifacts: string[];
  notes: string[];
}

export interface EnvCheckItem {
  name: string;
  level: EnvCheckLevel;
  value: string;
  message: string;
}

export interface PocReport {
  startedAt: string;
  endedAt: string;
  environment: {
    os: string;
    nodeVersion: string;
    electronVersion?: string;
    rustVersion?: string;
    dpiScale: number;
    monitors: number;
  };
  envChecks: EnvCheckItem[];
  results: PocResult[];
}
