import type { StepPlan, RiskLevel } from '../types/agent.js';

const HIGH_RISK_KEYWORDS = ['删除','提交','发送','支付','delete','submit','send','pay','purchase','remove'];
const FORBIDDEN_KEYWORDS = ['密码','验证码','password','captcha','otp','支付密码'];

export class RiskClassifier {
  classify(step: StepPlan): RiskLevel {
    if (step.source === 'workflow') return step.riskLevel;
    return this.inferFromAction(step);
  }

  private inferFromAction(step: StepPlan): RiskLevel {
    const text = [step.intent, this.actionText(step)].join(' ').toLowerCase();

    if (FORBIDDEN_KEYWORDS.some(k => text.includes(k))) return 'forbidden';
    if (HIGH_RISK_KEYWORDS.some(k => text.includes(k))) return 'high';

    switch (step.action.type) {
      case 'navigate': case 'observe': case 'scroll': return 'low';
      case 'click': case 'type': case 'press':
        return HIGH_RISK_KEYWORDS.some(k => text.includes(k)) ? 'high' : 'low';
      case 'wait': case 'done': return 'low';
      case 'takeover': return 'forbidden';
      case 'read_file': case 'read_table': case 'get_page_text': return 'low';
      case 'copy_file': return 'medium';
      default: return 'medium';
    }
  }

  private actionText(step: StepPlan): string {
    const a = step.action;
    switch (a.type) {
      case 'type': return a.text;
      case 'navigate': return a.url;
      case 'click': return a.target.hint ?? '';
      case 'read_file': return a.path;
      case 'copy_file': return `${a.source} → ${a.target}`;
      case 'read_table': return a.path;
      default: return '';
    }
  }
}
