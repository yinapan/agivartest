import React from 'react';
import { Sidebar } from '../components/Sidebar.js';
import { ChatView } from '../components/ChatView.js';
import { InputBar } from '../components/InputBar.js';

export function ChatPage() {
  return (
    <div className="flex h-screen bg-white text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <div className="flex h-12 items-center border-b border-slate-100 px-6 text-sm font-medium text-slate-500">
          Agivar-like Chat Recording
        </div>
        <ChatView />
        <InputBar />
      </div>
    </div>
  );
}
