import React from 'react';
import { Sidebar } from '../components/Sidebar.js';
import { ChatView } from '../components/ChatView.js';
import { InputBar } from '../components/InputBar.js';

export function ChatPage() {
  return (
    <div className="flex h-screen bg-bg-primary text-text-primary">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <div className="h-10 border-b border-border flex items-center px-4 text-sm text-text-secondary">
          Agivar — 可教学桌面流程 Agent
        </div>
        <ChatView />
        <InputBar />
      </div>
    </div>
  );
}
