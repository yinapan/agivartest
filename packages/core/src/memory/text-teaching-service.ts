import type {
  TextTeachingRequest,
  TextTeachingResult,
  WorkflowDraft,
  WorkflowValidationResult,
} from '../types/workflow.js';
import { validateWorkflowDraft } from './workflow-draft.js';

export interface TextTeachingProvider {
  generateWorkflowDraft(request: TextTeachingRequest): Promise<WorkflowDraft>;
}

const SENSITIVE_TERMS = [
  'password',
  'passcode',
  'token',
  '2fa',
  'otp',
  'verification code',
  'payment',
  'bank card',
  'identity card',
  '身份证',
  '验证码',
  '银行卡',
  '支付',
  '密码',
];

function containsSensitiveTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return SENSITIVE_TERMS.some((term) => lower.includes(term.toLowerCase()));
}

export class TextTeachingService {
  constructor(private provider: TextTeachingProvider) {}

  async teach(request: TextTeachingRequest): Promise<WorkflowValidationResult<TextTeachingResult>> {
    const draft = await this.provider.generateWorkflowDraft(request);
    const normalizedDraft: WorkflowDraft = {
      ...draft,
      appName: draft.appName || request.appName || '',
      platform: draft.platform || request.platform || 'desktop',
      sourceType: 'text-teach',
    };

    const validation = validateWorkflowDraft(normalizedDraft);
    const warnings = [...validation.warnings];
    if (containsSensitiveTerm(request.teachingText)) {
      warnings.push('teaching text may contain sensitive instructions');
    }

    if (!validation.ok) {
      return { ok: false, errors: validation.errors, warnings };
    }

    return {
      ok: true,
      data: { draft: normalizedDraft, warnings },
      errors: [],
      warnings,
    };
  }
}
