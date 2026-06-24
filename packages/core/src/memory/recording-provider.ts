import type { LLMProvider } from '../llm/provider.js';
import type {
  RecordingProviderPayload,
  RecordingWorkflowProviderResult,
} from '../types/workflow.js';
import type { RecordingWorkflowProvider } from './recording-teaching-service.js';

export class OpenAICompatibleRecordingProvider implements RecordingWorkflowProvider {
  constructor(private readonly llm: LLMProvider) {}

  async generateWorkflowDraft(payload: RecordingProviderPayload): Promise<RecordingWorkflowProviderResult> {
    const result = await this.llm.generateText({
      messages: [
        { role: 'system', content: buildRecordingProviderSystemPrompt() },
        { role: 'user', content: JSON.stringify(sanitizePayloadForPrompt(payload)) },
      ],
      maxTokens: 4096,
      temperature: 0.1,
    });

    try {
      return JSON.parse(stripCodeFence(result.text)) as RecordingWorkflowProviderResult;
    } catch (err) {
      throw new Error(`Recording provider returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function buildRecordingProviderSystemPrompt(): string {
  return [
    'You convert confirmed local desktop recording evidence into a workflow draft.',
    'Return strict JSON only. Do not include markdown.',
    'The JSON shape must be: {"draft": WorkflowDraft, "evidence": StepEvidenceLink[], "warnings": string[], "rawResponse"?: unknown}.',
    'Use stable step ids so evidence.stepId can refer to generated draft steps.',
    'Respect the redactionPolicy. Do not invent raw text, coordinates, files, or application state not present in the payload.',
  ].join('\n');
}

function sanitizePayloadForPrompt(payload: RecordingProviderPayload): unknown {
  const withoutLocalPaths = {
    ...payload,
    keyframes: payload.keyframes.map(({ imagePath, ...keyframe }) => keyframe),
  };

  if (payload.privacyMode === 'detailed' && payload.containsRawText) return withoutLocalPaths;

  return {
    ...withoutLocalPaths,
    events: payload.events.map(({ rawPayload, ...event }) => event),
  };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}
