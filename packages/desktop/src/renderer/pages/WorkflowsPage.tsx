import React, { useEffect, useState } from 'react';

type RiskLevel = 'low' | 'medium' | 'high' | 'forbidden';

type DraftStep = {
  id?: string;
  order?: number;
  intent: string;
  targetHint: string;
  inputHint?: string;
  riskLevel: RiskLevel;
  target?: any;
};

type WorkflowDraft = {
  id?: string;
  appName: string;
  platform?: 'desktop' | 'browser' | 'hybrid';
  topic: string;
  triggerExamples?: string[];
  summary: string;
  initialState: string;
  steps: DraftStep[];
  successCriteria?: string;
  riskLevel: RiskLevel;
  sourceType?: 'text-teach';
  version?: number;
};

const emptyDraft: WorkflowDraft = {
  appName: 'Desktop',
  platform: 'desktop',
  topic: '',
  triggerExamples: [],
  summary: '',
  initialState: '',
  steps: [],
  successCriteria: '',
  riskLevel: 'low',
  sourceType: 'text-teach',
};

export function WorkflowsPage() {
  const [memories, setMemories] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>(emptyDraft);
  const [goal, setGoal] = useState('');
  const [teachingText, setTeachingText] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [versions, setVersions] = useState<any[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void reload();
  }, []);

  async function reload() {
    const list = await window.agivar.memory.list();
    setMemories(Array.isArray(list) ? list : []);
  }

  async function teach() {
    setMessage('');
    const result = await window.agivar.memory.teachText({
      goal,
      teachingText,
      appName: draft.appName,
      platform: draft.platform,
    });
    if (!result.ok) {
      setMessage(result.errors?.join('; ') || result.error?.message || 'Failed to generate draft');
      return;
    }
    setDraft(result.data.draft);
    setSelected(null);
    setMessage(result.data.warnings?.join('; ') || 'Draft generated');
  }

  async function saveDraft() {
    const result = await window.agivar.memory.saveDraft(draft, changeNote || 'text teaching');
    if (!result.ok) {
      setMessage(result.error?.message || result.errors?.join('; ') || 'Failed to save workflow');
      return;
    }
    setSelected(result.data);
    setDraft(result.data);
    setMessage('Workflow saved');
    await reload();
    await loadVersions(result.data.id);
  }

  async function updateSelected() {
    if (!selected) return;
    const result = await window.agivar.memory.update({ ...selected, ...draft }, changeNote || 'edit workflow');
    if (!result.ok) {
      setMessage(result.error?.message || 'Failed to update workflow');
      return;
    }
    setSelected(result.data);
    setDraft(result.data);
    setMessage('Workflow updated');
    await reload();
    await loadVersions(result.data.id);
  }

  async function selectMemory(memory: any) {
    setSelected(memory);
    setDraft(memory);
    await loadVersions(memory.id);
  }

  async function loadVersions(memoryId: string) {
    const list = await window.agivar.memory.listVersions(memoryId);
    setVersions(Array.isArray(list) ? list : []);
  }

  async function rollback(version: number) {
    if (!selected) return;
    const result = await window.agivar.memory.rollback(selected.id, version, `rollback to ${version}`);
    if (!result.ok) {
      setMessage(result.error?.message || 'Failed to rollback workflow');
      return;
    }
    setSelected(result.data);
    setDraft(result.data);
    setMessage(`Rolled back to version ${version}`);
    await reload();
    await loadVersions(result.data.id);
  }

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    }));
  }

  function addStep() {
    setDraft((current) => ({
      ...current,
      steps: [
        ...current.steps,
        { intent: '', targetHint: '', target: { strategy: 'human', hint: '' }, riskLevel: 'low' },
      ],
    }));
  }

  function startNewWorkflow() {
    setSelected(null);
    setDraft(emptyDraft);
    setVersions([]);
    setMessage('');
  }

  return (
    <div className="h-[calc(100vh-2rem)] grid grid-cols-[260px_1fr_280px] bg-bg-primary text-text-primary">
      <aside className="border-r border-border p-3 overflow-y-auto">
        <button onClick={startNewWorkflow} className="w-full bg-accent hover:bg-accent-hover text-white text-sm py-2 px-3 rounded">
          New workflow
        </button>
        <div className="mt-3 space-y-2">
          {memories.map((memory) => (
            <button key={memory.id} onClick={() => selectMemory(memory)} className="w-full text-left border border-border rounded p-2 hover:bg-bg-secondary">
              <div className="text-sm font-medium truncate">{memory.topic}</div>
              <div className="text-xs text-text-secondary truncate">{memory.appName} - v{memory.version}</div>
            </button>
          ))}
        </div>
      </aside>

      <main className="p-4 overflow-y-auto space-y-4">
        <section className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={draft.appName} onChange={(e) => setDraft({ ...draft, appName: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="App name" />
            <input value={goal} onChange={(e) => setGoal(e.target.value)} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Teaching goal" />
          </div>
          <textarea value={teachingText} onChange={(e) => setTeachingText(e.target.value)} className="w-full h-24 bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Describe the workflow steps" />
          <button onClick={teach} className="bg-accent hover:bg-accent-hover text-white text-sm py-2 px-3 rounded">Generate draft</button>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <input value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Topic" />
          <input value={draft.triggerExamples?.join(', ') ?? ''} onChange={(e) => setDraft({ ...draft, triggerExamples: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Trigger examples" />
          <textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Summary" />
          <textarea value={draft.initialState} onChange={(e) => setDraft({ ...draft, initialState: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Initial state" />
          <textarea value={draft.successCriteria ?? ''} onChange={(e) => setDraft({ ...draft, successCriteria: e.target.value })} className="col-span-2 bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Success criteria" />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Steps</h2>
            <button onClick={addStep} className="text-xs border border-border rounded px-2 py-1">Add step</button>
          </div>
          {draft.steps.map((step, index) => (
            <div key={index} className="border border-border rounded p-2 grid grid-cols-[40px_1fr_1fr_120px] gap-2">
              <div className="text-xs text-text-secondary pt-2">#{index + 1}</div>
              <input value={step.intent} onChange={(e) => updateStep(index, { intent: e.target.value })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm" placeholder="Intent" />
              <input value={step.targetHint} onChange={(e) => updateStep(index, { targetHint: e.target.value, target: { strategy: 'human', hint: e.target.value } })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm" placeholder="Target hint" />
              <select value={step.riskLevel} onChange={(e) => updateStep(index, { riskLevel: e.target.value as RiskLevel })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="forbidden">forbidden</option>
              </select>
            </div>
          ))}
        </section>

        <section className="flex items-center gap-2">
          <input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} className="flex-1 bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Change note" />
          <button onClick={selected ? updateSelected : saveDraft} className="bg-accent hover:bg-accent-hover text-white text-sm py-2 px-3 rounded">
            {selected ? 'Save edit' : 'Save draft'}
          </button>
        </section>
        {message && <div className="text-sm text-text-secondary">{message}</div>}
      </main>

      <aside className="border-l border-border p-3 overflow-y-auto">
        <h2 className="text-sm font-semibold mb-2">Versions</h2>
        <div className="space-y-2">
          {versions.map((version) => (
            <div key={version.id} className="border border-border rounded p-2">
              <div className="text-sm">v{version.version}</div>
              <div className="text-xs text-text-secondary">{version.source}</div>
              <div className="text-xs text-text-secondary truncate">{version.changeNote}</div>
              <button onClick={() => rollback(version.version)} className="mt-2 text-xs border border-border rounded px-2 py-1">Rollback</button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
