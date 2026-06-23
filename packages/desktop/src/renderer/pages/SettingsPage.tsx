import React, { useState, useEffect } from 'react';
import { SettingsSection } from '../components/SettingsSection.js';

export function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [apiKeyMask, setApiKeyMask] = useState<string>('');
  const [newApiKey, setNewApiKey] = useState<string>('');

  useEffect(() => {
    window.agivar.settings.get().then(setSettings);
    window.agivar.settings.getApiKeyMask().then(setApiKeyMask);
  }, []);

  const updateField = (section: string, field: string, value: any) => {
    setSettings((prev: any) => {
      const next = { ...prev, [section]: { ...prev[section], [field]: value } };
      window.agivar.settings.update({ [section]: { [field]: value } });
      return next;
    });
  };

  const handleSaveApiKey = async () => {
    if (!newApiKey.trim()) return;
    await window.agivar.settings.setApiKey(newApiKey);
    setNewApiKey('');
    const mask = await window.agivar.settings.getApiKeyMask();
    setApiKeyMask(mask);
  };

  if (!settings) return <div className="p-6 text-text-secondary">加载中...</div>;

  return (
    <div className="h-screen bg-bg-primary text-text-primary overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <h1 className="text-xl font-bold">设置</h1>

        <SettingsSection title="LLM 模型">
          <label className="block text-sm text-text-secondary mb-1">API Key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              placeholder={apiKeyMask}
              className="flex-1 bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
            />
            <button onClick={handleSaveApiKey} className="px-3 py-1 bg-accent text-white rounded text-sm">
              保存
            </button>
          </div>

          <label className="block text-sm text-text-secondary mb-1 mt-3">模型</label>
          <input
            value={settings.llm.model}
            onChange={(e) => updateField('llm', 'model', e.target.value)}
            className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
          />

          <label className="block text-sm text-text-secondary mb-1 mt-3">Base URL</label>
          <input
            value={settings.llm.baseURL}
            onChange={(e) => updateField('llm', 'baseURL', e.target.value)}
            className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
          />
        </SettingsSection>

        <SettingsSection title="安全设置">
          <label className="block text-sm text-text-secondary mb-1">紧急停止快捷键</label>
          <input
            value={settings.safety.emergencyStopHotkey}
            onChange={(e) => updateField('safety', 'emergencyStopHotkey', e.target.value)}
            className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
          />
          <label className="block text-sm text-text-secondary mb-1 mt-3">最大重试次数</label>
          <input
            type="number"
            value={settings.safety.maxRetries}
            onChange={(e) => updateField('safety', 'maxRetries', parseInt(e.target.value))}
            className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
          />
        </SettingsSection>

        <div className="flex gap-2 pt-4">
          <button onClick={() => window.history.back()} className="px-4 py-2 bg-bg-secondary text-text-primary rounded text-sm">
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
