import React, { useState, useEffect } from 'react';
import { ChatPage } from './pages/ChatPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { WorkflowsPage } from './pages/WorkflowsPage.js';

type Page = 'chat' | 'settings' | 'workflows';

declare global {
  interface Window {
    agivar: any;
  }
}

export function App() {
  const [page, setPage] = useState<Page>('chat');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setPage((p) => (p === 'settings' ? 'chat' : 'settings'));
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        setPage((p) => (p === 'workflows' ? 'chat' : 'workflows'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (page === 'settings') {
    return (
      <div>
        <div className="h-8 bg-bg-secondary border-b border-border flex items-center px-3">
          <button
            onClick={() => setPage('chat')}
            className="text-text-secondary hover:text-text-primary text-xs"
          >
            Back to chat
          </button>
          <button
            onClick={() => setPage('workflows')}
            className="ml-3 text-text-secondary hover:text-text-primary text-xs"
          >
            Workflows
          </button>
        </div>
        <SettingsPage />
      </div>
    );
  }

  if (page === 'workflows') {
    return (
      <div>
        <div className="h-8 bg-bg-secondary border-b border-border flex items-center gap-3 px-3">
          <button
            onClick={() => setPage('chat')}
            className="text-text-secondary hover:text-text-primary text-xs"
          >
            Back to chat
          </button>
          <button
            onClick={() => setPage('settings')}
            className="text-text-secondary hover:text-text-primary text-xs"
          >
            Settings
          </button>
        </div>
        <WorkflowsPage />
      </div>
    );
  }

  return <ChatPage />;
}
