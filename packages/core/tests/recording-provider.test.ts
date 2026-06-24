import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleRecordingProvider } from '../src/memory/recording-provider.js';
import type { LLMProvider } from '../src/llm/provider.js';
import type { RecordingProviderPayload, RecordingWorkflowProviderResult } from '../src/types/workflow.js';

const providerResult: RecordingWorkflowProviderResult = {
  draft: {
    appName: 'Notepad',
    platform: 'desktop',
    topic: 'Save note',
    triggerExamples: ['save note'],
    summary: 'Save a note from recording evidence.',
    initialState: 'Notepad is open.',
    steps: [{
      id: 'step-1',
      order: 1,
      intent: 'Click Save',
      targetHint: 'Save button',
      target: { strategy: 'human', hint: 'Save button' },
      riskLevel: 'low',
    }],
    successCriteria: 'The note is saved.',
    riskLevel: 'low',
    sourceType: 'recording',
  },
  evidence: [{
    id: 'evidence-1',
    sessionId: 'rec-1',
    stepId: 'step-1',
    eventIds: ['ev-1'],
    keyframeIds: ['kf-1'],
    contextIds: ['ctx-1'],
    confidence: 0.8,
    rationale: 'Event and keyframe align with save action.',
  }],
  warnings: ['low confidence on final state'],
  rawResponse: { provider: 'mock' },
};

describe('OpenAICompatibleRecordingProvider', () => {
  it('sends a redacted recording provider payload to the LLM and parses JSON output', async () => {
    const llm = mockLlm(JSON.stringify(providerResult));
    const provider = new OpenAICompatibleRecordingProvider(llm);

    const result = await provider.generateWorkflowDraft(summaryPayload());

    expect(result.draft.topic).toBe('Save note');
    expect(result.evidence[0].keyframeIds).toEqual(['kf-1']);
    expect(result.warnings).toContain('low confidence on final state');

    const request = (llm.generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.temperature).toBe(0.1);
    expect(request.maxTokens).toBeGreaterThan(1000);
    const userContent = request.messages.find((message: { role: string }) => message.role === 'user')?.content ?? '';
    expect(userContent).toContain('"providerName":"openai-compatible"');
    expect(userContent).toContain('"keyframes"');
    expect(userContent).toContain('"events"');
    expect(userContent).not.toContain('secret raw text');
    expect(userContent).not.toContain('C:\\Users\\admin\\recordings\\frame.png');
    const sentPayload = JSON.parse(userContent) as RecordingProviderPayload;
    expect(sentPayload.keyframes[0]).not.toHaveProperty('imagePath');
  });

  it('wraps malformed LLM JSON in a stable provider error', async () => {
    const provider = new OpenAICompatibleRecordingProvider(mockLlm('not json'));

    await expect(provider.generateWorkflowDraft(summaryPayload())).rejects.toThrow('Recording provider returned invalid JSON');
  });
});

function mockLlm(text: string): LLMProvider {
  return {
    id: 'openai-compatible',
    displayName: 'OpenAI Compatible',
    supportsVision: true,
    generateText: vi.fn().mockResolvedValue({
      text,
      toolCalls: [],
      finishReason: 'stop',
    }),
    async *streamText() {
      yield { type: 'finish' };
    },
  };
}

function summaryPayload(): RecordingProviderPayload {
  return {
    sessionId: 'rec-1',
    providerName: 'openai-compatible',
    goal: 'Save note',
    notes: 'Save the current note.',
    scope: 'active-window',
    privacyMode: 'summary',
    redactionPolicy: { privacyMode: 'summary', rawPayload: 'excluded' },
    containsRawText: false,
    containsPreciseCoordinates: false,
    keyframes: [{
      id: 'kf-1',
      timestampMs: 1000,
      imagePath: 'C:\\Users\\admin\\recordings\\frame.png',
      reason: 'event',
      redacted: true,
      hash: 'sha256-a',
      fileSize: 2048,
      mimeType: 'image/png',
    }],
    events: [{
      id: 'ev-1',
      timestampMs: 1200,
      type: 'click',
      summary: 'Clicked Save.',
      redactionLevel: 'summary',
      windowTitle: 'Notepad',
      processName: 'notepad.exe',
      rawPayload: 'secret raw text',
    }],
    context: [{
      id: 'ctx-1',
      timestampMs: 900,
      kind: 'window',
      summary: { title: 'Notepad' },
      source: 'active-window',
    }],
    warnings: [],
  };
}
