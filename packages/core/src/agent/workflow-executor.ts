import type { StepPlan, StepAction } from '../types/agent.js';
import type { WorkflowMemory, WorkflowStep, WorkflowInput } from '../types/workflow.js';

export interface ResolvedInputs {
  [key: string]: string;
}

/** Replace {{variable}} placeholders in text with resolved values */
export function resolveVariables(text: string, inputs: ResolvedInputs): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => inputs[name] ?? `{{${name}}}`);
}

/** Build a StepPlan from a single WorkflowStep with resolved inputs */
export function buildStepPlan(step: WorkflowStep, inputs: ResolvedInputs): StepPlan {
  const action = interpretAction(step, inputs);
  return {
    intent: step.intent,
    action,
    expectedState: step.expectedState,
    riskLevel: step.riskLevel,
    source: 'workflow',
  };
}

function interpretAction(step: WorkflowStep, inputs: ResolvedInputs): StepAction {
  const hint = step.inputHint ? resolveVariables(step.inputHint, inputs) : undefined;

  // navigate: prefix
  if (hint?.startsWith('navigate:')) {
    return { type: 'navigate', url: hint.slice('navigate:'.length) };
  }

  // If the step has a playwright/uia target with an inputHint, treat as type action
  if ((step.target.strategy === 'playwright' || step.target.strategy === 'uia') && hint) {
    return { type: 'type', text: hint };
  }

  // Default: click
  return { type: 'click', target: step.target };
}

export function getRequiredInputs(workflow: WorkflowMemory): WorkflowInput[] {
  return (workflow.inputs ?? []).filter(i => i.required);
}

export function getMissingInputs(workflow: WorkflowMemory, provided: ResolvedInputs): WorkflowInput[] {
  return getRequiredInputs(workflow).filter(i => !(i.name in provided) || provided[i.name] === '');
}

export function getHumanOnlyInputs(workflow: WorkflowMemory): WorkflowInput[] {
  return (workflow.inputs ?? []).filter(i => i.humanOnly);
}

export function validateInputs(workflow: WorkflowMemory, provided: ResolvedInputs): string[] {
  const errors: string[] = [];
  for (const input of workflow.inputs ?? []) {
    const val = provided[input.name];
    if (input.required && (!val || val === '')) {
      errors.push(`Missing required input: ${input.name}`);
      continue;
    }
    if (val && input.minLength && val.length < input.minLength) {
      errors.push(`${input.name}: minimum length ${input.minLength}, got ${val.length}`);
    }
    if (val && input.maxLength && val.length > input.maxLength) {
      errors.push(`${input.name}: maximum length ${input.maxLength}, got ${val.length}`);
    }
  }
  return errors;
}
