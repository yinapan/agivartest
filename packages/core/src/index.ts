export * from './types/index.js';
export * as screenshot from './tools/screenshot.js';
export * as input from './tools/input.js';
export * as browser from './tools/browser.js';
export * as uia from './tools/uia.js';
export * as dpi from './tools/dpi.js';
export * as recorder from './tools/recorder.js';
export * as eventCapture from './tools/event-capture.js';

// Phase 1A: Agent execution engine
export { MemoryStore } from './memory/memory-store.js';
export type { MemorySearchResult } from './memory/memory-store.js';
export { parseWorkflowContent, workflowFileToMemory } from './memory/workflow-parser.js';
export {
  validateWorkflowDraft,
  normalizeWorkflowDraft,
  draftToMemory,
  memoryToDraft,
  rebuildMemoryForUpdate,
} from './memory/workflow-draft.js';
export { TextTeachingService } from './memory/text-teaching-service.js';
export type { TextTeachingProvider } from './memory/text-teaching-service.js';
export { RecordingTeachingService } from './memory/recording-teaching-service.js';
export {
  validateRecordingTeachingRequest,
  validateRecordingTimeline,
  buildProviderPayloadManifest,
  buildRecordingProviderPayload,
} from './memory/recording-teaching-service.js';
export type { RecordingWorkflowProvider } from './memory/recording-teaching-service.js';
export { OpenAICompatibleRecordingProvider } from './memory/recording-provider.js';
export { RecordingStore } from './memory/recording-store.js';
export type { RecordingArtifactKind } from './memory/recording-store.js';
export { getDatabase, getDatabaseForTest, closeDatabase } from './memory/db.js';
export { runMigrations } from './memory/schema.js';
export { AbortManager } from './safety/abort-manager.js';
export type { AbortSource } from './safety/abort-manager.js';
export { RiskClassifier } from './safety/risk-classifier.js';
export { ExecutionLog } from './safety/execution-log.js';
export { ToolRouter } from './agent/tool-router.js';
export type { ToolAdapters } from './agent/tool-router.js';
export { StateVerifier } from './agent/state-verifier.js';
export { FailureHandler } from './agent/failure-handler.js';
export { StepExecutor } from './agent/step-executor.js';
export { resolveVariables, buildStepPlan, validateInputs, getMissingInputs, getHumanOnlyInputs, getRequiredInputs } from './agent/workflow-executor.js';
export type { ResolvedInputs } from './agent/workflow-executor.js';

// Phase 1B: Agent orchestration
export { TaskPlanner } from './agent/task-planner.js';
export type { PlannerOutput } from './agent/task-planner.js';
export { AgentService } from './agent/agent-service.js';
export type { AgentServiceDeps } from './agent/agent-service.js';

// Phase 1B: LLM
export { OpenAIClient } from './llm/openai-compatible.js';
export type { OpenAIClientConfig } from './llm/openai-compatible.js';
export type { LLMProvider, Message, ToolDefinition, GenerateTextResult, StreamChunk } from './llm/provider.js';
export { buildSystemPrompt, formatStepHistory } from './llm/prompts.js';
export type { PromptContext } from './llm/prompts.js';
