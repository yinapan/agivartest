// packages/desktop/src/main/credential-store.ts
import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * OS 凭据存储 — 临时使用 Electron safeStorage (DPAPI on Windows)。
 * 后续阶段迁移到 Windows Credential Manager / macOS Keychain。
 */
export class CredentialStore {
  private storePath: string;

  constructor(dataDir: string) {
    this.storePath = path.join(dataDir, 'credentials.enc');
  }

  setApiKey(key: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密不可用');
    }
    const encrypted = safeStorage.encryptString(key);
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.storePath, encrypted);
  }

  getApiKey(): string | null {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      if (!fs.existsSync(this.storePath)) return null;
      const encrypted = fs.readFileSync(this.storePath);
      return safeStorage.decryptString(Buffer.from(encrypted));
    } catch {
      return null;
    }
  }

  getApiKeyMask(): string {
    const key = this.getApiKey();
    if (!key) return '(未设置)';
    if (key.length <= 7) return '****';
    return `${key.slice(0, 3)}-...${key.slice(-4)}`;
  }

  deleteApiKey(): void {
    try {
      if (fs.existsSync(this.storePath)) fs.unlinkSync(this.storePath);
    } catch { /* ignore */ }
  }
}
