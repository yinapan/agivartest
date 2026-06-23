import React, { useEffect, useState } from 'react';
import {
  createEmptyDraft,
  draftHasHighRisk,
  getExpectedStateType,
  getExpectedStateValue,
  getIpcErrorMessage,
  setStepExpectedState,
  versionPreview,
  type DraftStep,
  type ExpectedStateType,
  type IpcResult,
  type Platform,
  type RiskLevel,
  type WorkflowDraft,
  type WorkflowInput,
  type WorkflowMemoryVersion,
} from './workflow-editor-model.js';

type BusyAction = 'teach' | 'save' | 'update' | 'rollback' | null;

export function WorkflowsPage() {
  const [memories, setMemories] = useState<WorkflowDraft[]>([]);
  const [selected, setSelected] = useState<WorkflowDraft | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>(() => createEmptyDraft());
  const [goal, setGoal] = useState('');
  const [teachingText, setTeachingText] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [versions, setVersions] = useState<WorkflowMemoryVersion[]>([]);
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  useEffect(() => {
    void reload();
  }, []);

  async function reload() {
    const list = await window.agivar.memory.list();
    setMemories(Array.isArray(list) ? list : []);
  }

  async function teach() {
    setMessage('');
    setBusyAction('teach');
    try {
      const result = await window.agivar.memory.teachText({
        goal,
        teachingText,
        appName: draft.appName,
        platform: draft.platform,
      }) as IpcResult<{ draft: WorkflowDraft; warnings: string[] }>;
      if (!result.ok) {
        setMessage(getIpcErrorMessage(result));
        return;
      }
      setDraft({ ...createEmptyDraft(), ...result.data.draft });
      setSelected(null);
      setValidationWarnings(result.data.warnings ?? []);
      setValidationErrors([]);
      setMessage(result.data.warnings?.join('; ') || 'Draft generated');
    } finally {
      setBusyAction(null);
    }
  }

  async function validateBeforeWrite(): Promise<boolean> {
    const result = await window.agivar.memory.validateDraft(draft) as IpcResult<{
      ok: boolean;
      errors: string[];
      warnings: string[];
    }>;
    if (!result.ok) {
      setValidationErrors([getIpcErrorMessage(result)]);
      return false;
    }

    setValidationErrors(result.data.errors);
    setValidationWarnings(result.data.warnings);
    if (!result.data.ok) return false;

    if (draftHasHighRisk(draft) && !window.confirm('This workflow is marked high risk. Save anyway?')) {
      return false;
    }

    return true;
  }

  async function saveDraft() {
    setMessage('');
    if (!(await validateBeforeWrite())) return;
    setBusyAction('save');
    try {
      const result = await window.agivar.memory.saveDraft(draft, changeNote || 'text teaching') as IpcResult<WorkflowDraft>;
      if (!result.ok) {
        setMessage(getIpcErrorMessage(result));
        return;
      }
      setSelected(result.data);
      setDraft(result.data);
      setMessage('Workflow saved');
      await reload();
      await loadVersions(result.data.id ?? '');
    } finally {
      setBusyAction(null);
    }
  }

  async function updateSelected() {
    if (!selected) return;
    setMessage('');
    if (!(await validateBeforeWrite())) return;
    setBusyAction('update');
    try {
      const result = await window.agivar.memory.update({ ...selected, ...draft }, changeNote || 'edit workflow') as IpcResult<WorkflowDraft>;
      if (!result.ok) {
        setMessage(getIpcErrorMessage(result));
        return;
      }
      setSelected(result.data);
      setDraft(result.data);
      setMessage('Workflow updated');
      await reload();
      await loadVersions(result.data.id ?? '');
    } finally {
      setBusyAction(null);
    }
  }

  async function selectMemory(memory: WorkflowDraft) {
    setSelected(memory);
    setDraft({ ...createEmptyDraft(), ...memory, inputs: memory.inputs ?? [] });
    setValidationErrors([]);
    setValidationWarnings([]);
    setMessage('');
    await loadVersions(memory.id ?? '');
  }

  async function loadVersions(memoryId: string) {
    if (!memoryId) {
      setVersions([]);
      return;
    }
    const result = await window.agivar.memory.listVersions(memoryId) as IpcResult<WorkflowMemoryVersion[]>;
    setVersions(result.ok ? result.data : []);
  }

  async function rollback(version: WorkflowMemoryVersion) {
    if (!selected) return;
    const preview = versionPreview(version);
    if (!window.confirm(`Rollback to version ${version.version}: ${preview.topic}? This creates a new version.`)) {
      return;
    }
    setBusyAction('rollback');
    try {
      const result = await window.agivar.memory.rollback(selected.id, version.version, `rollback to ${version.version}`) as IpcResult<WorkflowDraft>;
      if (!result.ok) {
        setMessage(getIpcErrorMessage(result));
        return;
      }
      setSelected(result.data);
      setDraft(result.data);
      setMessage(`Rolled back to version ${version.version}`);
      await reload();
      await loadVersions(result.data.id ?? '');
    } finally {
      setBusyAction(null);
    }
  }

  function updateInput(index: number, patch: Partial<WorkflowInput>) {
    setDraft((current) => ({
      ...current,
      inputs: (current.inputs ?? []).map((input, i) => (i === index ? { ...input, ...patch } : input)),
    }));
  }

  function addInput() {
    setDraft((current) => ({
      ...current,
      inputs: [...(current.inputs ?? []), { name: '', type: 'string', required: true, prompt: '' }],
    }));
  }

  function removeInput(index: number) {
    setDraft((current) => ({
      ...current,
      inputs: (current.inputs ?? []).filter((_, i) => i !== index),
    }));
  }

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    }));
  }

  function updateStepExpectedState(index: number, type: ExpectedStateType, value: string) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, i) => (i === index ? setStepExpectedState(step, type, value) : step)),
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

  function removeStep(index: number) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.filter((_, i) => i !== index),
    }));
  }

  function startNewWorkflow() {
    setSelected(null);
    setDraft(createEmptyDraft());
    setVersions([]);
    setValidationErrors([]);
    setValidationWarnings([]);
    setMessage('');
  }

  const isBusy = busyAction !== null;

  return (
    <div className="h-[calc(100vh-2rem)] grid grid-cols-[260px_1fr_320px] bg-bg-primary text-text-primary">
      <aside className="border-r border-border p-3 overflow-y-auto">
        <button disabled={isBusy} onClick={startNewWorkflow} className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm py-2 px-3 rounded">
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
          <button disabled={isBusy} onClick={teach} className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm py-2 px-3 rounded">
            {busyAction === 'teach' ? 'Generating...' : 'Generate draft'}
          </button>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <input value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Topic" />
          <input value={draft.triggerExamples?.join(', ') ?? ''} onChange={(e) => setDraft({ ...draft, triggerExamples: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Trigger examples" />
          <select value={draft.platform ?? 'desktop'} onChange={(e) => setDraft({ ...draft, platform: e.target.value as Platform })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm">
            <option value="desktop">desktop</option>
            <option value="browser">browser</option>
            <option value="hybrid">hybrid</option>
          </select>
          <select value={draft.riskLevel} onChange={(e) => setDraft({ ...draft, riskLevel: e.target.value as RiskLevel })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm">
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="forbidden">forbidden</option>
          </select>
          <textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Summary" />
          <textarea value={draft.initialState} onChange={(e) => setDraft({ ...draft, initialState: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Initial state" />
          <textarea value={draft.successCriteria ?? ''} onChange={(e) => setDraft({ ...draft, successCriteria: e.target.value })} className="col-span-2 bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Success criteria" />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Inputs</h2>
            <button disabled={isBusy} onClick={addInput} className="text-xs border border-border rounded px-2 py-1">Add input</button>
          </div>
          {(draft.inputs ?? []).map((input, index) => (
            <div key={index} className="border border-border rounded p-2 grid grid-cols-[1fr_110px_1fr_80px_80px_80px] gap-2">
              <input value={input.name} onChange={(e) => updateInput(index, { name: e.target.value })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm" placeholder="Name" />
              <select value={input.type} onChange={(e) => updateInput(index, { type: e.target.value as WorkflowInput['type'] })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm">
                <option value="string">string</option>
                <option value="number">number</option>
              </select>
              <input value={input.prompt} onChange={(e) => updateInput(index, { prompt: e.target.value })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm" placeholder="Prompt" />
              <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={input.required} onChange={(e) => updateInput(index, { required: e.target.checked })} /> Req</label>
              <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={!!input.secret} onChange={(e) => updateInput(index, { secret: e.target.checked })} /> Secret</label>
              <button onClick={() => removeInput(index)} className="text-xs border border-border rounded px-2 py-1">Remove</button>
              <input value={input.defaultValue ?? ''} onChange={(e) => updateInput(index, { defaultValue: e.target.value })} className="col-span-3 bg-bg-secondary border border-border rounded px-2 py-1 text-sm" placeholder="Default value" />
              <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={!!input.humanOnly} onChange={(e) => updateInput(index, { humanOnly: e.target.checked })} /> Human</label>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Steps</h2>
            <button disabled={isBusy} onClick={addStep} className="text-xs border border-border rounded px-2 py-1">Add step</button>
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
              <div />
              <input value={step.inputHint ?? ''} onChange={(e) => updateStep(index, { inputHint: e.target.value })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm" placeholder="Input hint" />
              <input value={step.fallback ?? ''} onChange={(e) => updateStep(index, { fallback: (e.target.value || undefined) as DraftStep['fallback'] })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm" placeholder="Fallback" />
              <button onClick={() => removeStep(index)} className="text-xs border border-border rounded px-2 py-1">Remove</button>
              <div />
              <select value={getExpectedStateType(step)} onChange={(e) => updateStepExpectedState(index, e.target.value as ExpectedStateType, getExpectedStateValue(step))} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm">
                <option value="window_title_contains">window_title_contains</option>
                <option value="page_text_contains">page_text_contains</option>
              </select>
              <input value={getExpectedStateValue(step)} onChange={(e) => updateStepExpectedState(index, getExpectedStateType(step), e.target.value)} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm" placeholder="Expected value" />
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} className="flex-1 bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Change note" />
            <button disabled={isBusy} onClick={selected ? updateSelected : saveDraft} className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm py-2 px-3 rounded">
              {busyAction === 'save' || busyAction === 'update' ? 'Saving...' : selected ? 'Save edit' : 'Save draft'}
            </button>
          </div>
          {validationErrors.length > 0 && <div className="text-sm text-red-400">{validationErrors.join('; ')}</div>}
          {validationWarnings.length > 0 && <div className="text-sm text-yellow-300">{validationWarnings.join('; ')}</div>}
          {message && <div className="text-sm text-text-secondary">{message}</div>}
        </section>
      </main>

      <aside className="border-l border-border p-3 overflow-y-auto">
        <h2 className="text-sm font-semibold mb-2">Versions</h2>
        <div className="space-y-2">
          {versions.map((version) => {
            const preview = versionPreview(version);
            return (
              <div key={version.id} className="border border-border rounded p-2">
                <div className="text-sm">v{version.version}</div>
                <div className="text-xs text-text-secondary">{version.source}</div>
                <div className="text-xs text-text-secondary truncate">{version.changeNote}</div>
                <div className="mt-2 text-xs font-medium truncate">{preview.topic}</div>
                <div className="text-xs text-text-secondary line-clamp-2">{preview.summary}</div>
                <ul className="mt-2 text-xs text-text-secondary space-y-1">
                  {preview.stepIntents.map((intent, index) => <li key={index} className="truncate">{intent}</li>)}
                </ul>
                <button disabled={isBusy} onClick={() => rollback(version)} className="mt-2 text-xs border border-border rounded px-2 py-1">
                  {busyAction === 'rollback' ? 'Rolling back...' : 'Rollback'}
                </button>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
