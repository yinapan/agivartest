import React, { useState, useEffect } from 'react';
import { ChatPage } from './pages/ChatPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

type Page = 'chat' | 'settings';

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
            ← 返回聊天
          </button>
        </div>
        <SettingsPage />
      </div>
    );
  }

  return <ChatPage />;
}
