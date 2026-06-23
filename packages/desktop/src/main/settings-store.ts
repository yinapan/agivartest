// packages/desktop/src/main/settings-store.ts
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '@agivar/core';
import type { AppSettings } from '@agivar/core';

export class SettingsStore {
  private settings: AppSettings | null = null;
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'settings.json');
  }

  load(): AppSettings {
    if (this.settings) return this.settings;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } else {
        this.settings = { ...DEFAULT_SETTINGS };
        this.save();
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    return this.settings;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const current = this.load();
    this.settings = deepMerge(current, patch) as AppSettings;
    this.save();
    return this.settings;
  }

  get(): AppSettings {
    return this.load();
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
  }
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
