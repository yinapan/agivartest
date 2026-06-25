import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageBubble } from '../src/renderer/components/MessageBubble.js';
import type { ChatMessage } from '../src/renderer/stores/chat-store.js';

const userMessage: ChatMessage = {
  id: 'm1',
  sessionId: 's1',
  role: 'user',
  content: '我录制一下',
  createdAt: '2026-06-24T00:00:00.000Z',
  metadata: {
    attachments: [{
      type: 'recording',
      sessionId: 'rec-1',
      title: '录屏 2026/06/24 08:55',
      durationSeconds: 14,
      thumbnailPath: 'frame.png',
      scope: 'fullscreen',
      privacyMode: 'summary',
      status: 'stopped',
      keyframeCount: 4,
    }],
  },
};

const assistantMessage: ChatMessage = {
  id: 'm2',
  sessionId: 's1',
  role: 'assistant',
  content: '看到你录制了操作。',
  createdAt: '2026-06-24T00:00:01.000Z',
  metadata: {
    recordingExplanation: {
      type: 'recording-explanation',
      sessionId: 'rec-1',
      summary: '根据录屏生成了操作步骤。',
      steps: [{
        id: 'step-1',
        title: '点击首页',
        instruction: '点击左侧首页图标',
        evidenceIds: ['kf-1'],
        toolPills: [{ kind: 'wait', label: 'wait', status: 'done' }],
      }],
      warnings: ['event capture degraded'],
    },
  },
};

describe('phase4d chat recording UI smoke', () => {
  it('renders recording attachments and assistant step explanations', () => {
    const html = renderToStaticMarkup(
      <div>
        <MessageBubble message={userMessage} />
        <MessageBubble message={assistantMessage} />
      </div>,
    );

    expect(html).toContain('录屏 2026/06/24 08:55');
    expect(html).toContain('14s');
    expect(html).toContain('wait');
    expect(html).toContain('点击首页');
    expect(html).toContain('event capture degraded');
  });

  it('handles legacy and unknown metadata without throwing', () => {
    const html = renderToStaticMarkup(
      <div>
        <MessageBubble message={{ ...userMessage, metadata: undefined }} />
        <MessageBubble
          message={{
            ...userMessage,
            id: 'm-unknown',
            metadata: { attachments: [{ type: 'unknown', label: 'bad' }] },
          }}
        />
      </div>,
    );

    expect(html).toContain('我录制一下');
    expect(html).not.toContain('bad');
  });

  it('renders manifest ready and discarded recording states safely', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          ...userMessage,
          metadata: {
            attachments: [
              {
                type: 'recording',
                sessionId: 'rec-ready',
                title: '待确认录屏',
                scope: 'active-window',
                privacyMode: 'detailed',
                status: 'manifest_ready',
              },
              {
                type: 'recording',
                sessionId: 'rec-discarded',
                title: '已删除录屏',
                thumbnailPath: 'deleted-frame.png',
                scope: 'fullscreen',
                privacyMode: 'summary',
                status: 'discarded',
              },
            ],
          },
        }}
      />,
    );

    expect(html).toContain('待确认');
    expect(html).toContain('已删除');
    expect(html).not.toContain('deleted-frame.png');
  });
});
