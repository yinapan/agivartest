import React, { useMemo, useState } from 'react';
import { getIpcErrorMessage, type IpcResult, type WorkflowDraft } from './workflow-editor-model.js';
import {
  buildConfirmedManifest,
  createInitialRecordingTeachState,
  manifestSummary,
  recordingStatusLabel,
  timelineSummary,
  toEditorDraft,
  type ProviderPayloadManifestDto,
  type RecordingDraftLinkDto,
  type RecordingSessionDto,
  type RecordingTimelineDto,
} from './recording-teach-model.js';

export interface RecordingTeachPanelProps {
  disabled?: boolean;
  onDraftGenerated(draft: WorkflowDraft, changeNote: string): void;
}

export function RecordingTeachPanel({ disabled, onDraftGenerated }: RecordingTeachPanelProps) {
  const [state, setState] = useState(createInitialRecordingTeachState);
  const [detailedModeAcknowledged, setDetailedModeAcknowledged] = useState(false);
  const isBusy = disabled || state.phase === 'starting' || state.phase === 'stopping' || state.phase === 'generating';
  const requiresDetailedAck = state.privacyMode === 'detailed' && !detailedModeAcknowledged;
  const timelineInfo = state.timeline ? timelineSummary(state.timeline) : null;
  const manifestInfo = state.manifest ? manifestSummary(state.manifest) : null;
  const detailWarning = state.privacyMode === 'detailed'
    ? 'Detailed mode may retain raw text or precise coordinates locally. Review the manifest before generating a draft.'
    : '';

  async function startRecording() {
    if (requiresDetailedAck) {
      setState((current) => ({ ...current, error: 'Acknowledge detailed mode before starting.' }));
      return;
    }
    setState((current) => ({
      ...current,
      phase: 'starting',
      error: '',
      session: null,
      timeline: null,
      manifest: null,
      draftLink: null,
    }));
    const result = await window.agivar.recordingTeach.start({
      scope: state.scope,
      privacyMode: state.privacyMode,
      goal: state.goal || undefined,
      notes: state.notes || undefined,
      activeSessionId: state.session?.id,
    }) as IpcResult<RecordingSessionDto>;

    if (!result.ok) {
      setState((current) => ({ ...current, phase: 'failed', error: getIpcErrorMessage(result) }));
      return;
    }
    setState((current) => ({ ...current, phase: 'recording', session: result.data, error: '' }));
  }

  async function stopRecording() {
    if (!state.session) return;
    setState((current) => ({ ...current, phase: 'stopping', error: '' }));
    const stopped = await window.agivar.recordingTeach.stop(state.session.id) as IpcResult<RecordingSessionDto>;
    if (!stopped.ok) {
      setState((current) => ({ ...current, phase: 'failed', error: getIpcErrorMessage(stopped) }));
      return;
    }

    const timeline = await window.agivar.recordingTeach.getTimeline(stopped.data.id) as IpcResult<RecordingTimelineDto>;
    if (!timeline.ok) {
      setState((current) => ({
        ...current,
        phase: 'failed',
        session: stopped.data,
        error: getIpcErrorMessage(timeline),
      }));
      return;
    }
    setState((current) => ({ ...current, phase: 'ready', session: stopped.data, timeline: timeline.data, error: '' }));
  }

  async function buildManifest() {
    if (!state.session) return;
    const result = await window.agivar.recordingTeach.buildManifest(state.session.id, 'recording-teaching-provider') as IpcResult<ProviderPayloadManifestDto>;
    if (!result.ok) {
      setState((current) => ({ ...current, error: getIpcErrorMessage(result) }));
      return;
    }
    setState((current) => ({ ...current, phase: 'manifest_ready', manifest: result.data, error: '' }));
  }

  async function generateDraft() {
    if (!state.session || !state.manifest) return;
    setState((current) => ({ ...current, phase: 'generating', error: '' }));
    const result = await window.agivar.recordingTeach.generateDraft({
      sessionId: state.session.id,
      manifest: buildConfirmedManifest(state.manifest),
    }) as IpcResult<RecordingDraftLinkDto>;
    if (!result.ok) {
      setState((current) => ({ ...current, phase: 'manifest_ready', error: getIpcErrorMessage(result) }));
      return;
    }
    const draft = toEditorDraft(result.data);
    onDraftGenerated(draft, 'recording teaching');
    setState((current) => ({ ...current, phase: 'draft_ready', draftLink: result.data, error: '' }));
  }

  async function resumeDraft() {
    if (!state.session) return;
    const result = await window.agivar.recordingTeach.resumeDraft(state.session.id) as IpcResult<RecordingDraftLinkDto>;
    if (!result.ok) {
      setState((current) => ({ ...current, error: getIpcErrorMessage(result) }));
      return;
    }
    onDraftGenerated(toEditorDraft(result.data), 'recording teaching');
    setState((current) => ({ ...current, phase: 'draft_ready', draftLink: result.data, error: '' }));
  }

  const recentEvents = useMemo(() => state.timeline?.events.slice(0, 5) ?? [], [state.timeline]);

  return (
    <section className="border border-border rounded p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Recording teaching</h2>
        <span className="text-xs text-text-secondary">
          {state.session ? recordingStatusLabel(state.session.status) : state.phase}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          disabled={isBusy}
          value={state.scope}
          onChange={(event) => setState((current) => ({ ...current, scope: event.target.value as typeof current.scope }))}
          className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm"
        >
          <option value="active-window">active-window</option>
          <option value="fullscreen">fullscreen</option>
        </select>
        <select
          disabled={isBusy}
          value={state.privacyMode}
          onChange={(event) => {
            const privacyMode = event.target.value as typeof state.privacyMode;
            setDetailedModeAcknowledged(privacyMode !== 'detailed');
            setState((current) => ({ ...current, privacyMode }));
          }}
          className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm"
        >
          <option value="summary">summary</option>
          <option value="detailed">detailed</option>
        </select>
        <input
          disabled={isBusy}
          value={state.goal}
          onChange={(event) => setState((current) => ({ ...current, goal: event.target.value }))}
          className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm"
          placeholder="Recording goal"
        />
        <input
          disabled={isBusy}
          value={state.notes}
          onChange={(event) => setState((current) => ({ ...current, notes: event.target.value }))}
          className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm"
          placeholder="Recording notes"
        />
      </div>

      {detailWarning && <div className="text-xs text-yellow-300">{detailWarning}</div>}
      {state.privacyMode === 'detailed' && (
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={detailedModeAcknowledged}
            onChange={(event) => setDetailedModeAcknowledged(event.target.checked)}
            disabled={isBusy}
          />
          I understand detailed mode may keep raw local evidence until I delete it.
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          disabled={isBusy || state.phase === 'recording' || requiresDetailedAck}
          onClick={startRecording}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm py-2 px-3 rounded"
        >
          {state.phase === 'starting' ? 'Starting...' : 'Start'}
        </button>
        <button
          disabled={isBusy || state.phase !== 'recording'}
          onClick={stopRecording}
          className="border border-border disabled:opacity-50 text-sm py-2 px-3 rounded"
        >
          {state.phase === 'stopping' ? 'Stopping...' : 'Stop'}
        </button>
        <button disabled={isBusy || !state.timeline} onClick={buildManifest} className="border border-border disabled:opacity-50 text-sm py-2 px-3 rounded">
          Build manifest
        </button>
        <button disabled={isBusy || !state.manifest} onClick={generateDraft} className="border border-border disabled:opacity-50 text-sm py-2 px-3 rounded">
          {state.phase === 'generating' ? 'Generating...' : 'Confirm & generate'}
        </button>
        <button disabled={isBusy || !state.session} onClick={resumeDraft} className="border border-border disabled:opacity-50 text-sm py-2 px-3 rounded">
          Resume draft
        </button>
      </div>

      {state.error && <div className="text-sm text-red-400">{state.error}</div>}

      {timelineInfo && (
        <div className="grid grid-cols-5 gap-2 text-xs text-text-secondary">
          <div>Frames: {timelineInfo.keyframeCount}</div>
          <div>Events: {timelineInfo.eventCount}</div>
          <div>Context: {timelineInfo.contextCount}</div>
          <div>Warnings: {timelineInfo.warningCount}</div>
          <div>{timelineInfo.durationSeconds}s</div>
        </div>
      )}

      {recentEvents.length > 0 && (
        <ul className="space-y-1 text-xs text-text-secondary">
          {recentEvents.map((event) => <li key={event.id} className="truncate">{event.type}: {event.summary}</li>)}
        </ul>
      )}

      {manifestInfo && (
        <div className="border border-border rounded p-2 text-xs text-text-secondary grid grid-cols-2 gap-1">
          <div>Provider: {manifestInfo.providerName}</div>
          <div>Artifacts: {manifestInfo.artifactCount}</div>
          <div>Size: {manifestInfo.estimatedKb} KB</div>
          <div>Raw text: {manifestInfo.includesRawText ? 'yes' : 'no'}</div>
          <div>Coordinates: {manifestInfo.includesPreciseCoordinates ? 'yes' : 'no'}</div>
        </div>
      )}
    </section>
  );
}
