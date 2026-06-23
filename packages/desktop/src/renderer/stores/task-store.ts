import { create } from 'zustand';
import type { AgentEvent } from '@agivar/core';

export interface TaskRun {
  taskRunId: string;
  goal: string;
  mode: 'workflow' | 'llm' | 'hybrid';
  status: 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'aborted';
  events: AgentEvent[];
  currentStep?: number;
  totalSteps?: number;
}

interface TaskStore {
  currentTask: TaskRun | null;
  isRunning: boolean;
  isPaused: boolean;

  startTask: (taskRunId: string, goal: string, mode?: 'workflow' | 'llm') => void;
  pushEvent: (event: AgentEvent) => void;
  setPaused: (paused: boolean) => void;
  completeTask: (status: 'success' | 'failed' | 'aborted') => void;
  reset: () => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  currentTask: null,
  isRunning: false,
  isPaused: false,

  startTask: (taskRunId, goal, mode = 'workflow') => set({
    currentTask: { taskRunId, goal, mode, status: 'running', events: [] },
    isRunning: true,
    isPaused: false,
  }),

  pushEvent: (event) => set((s) => {
    if (!s.currentTask) return s;
    const events = [...s.currentTask.events, event];

    let status = s.currentTask.status;
    let isRunning = s.isRunning;
    let isPaused = s.isPaused;

    switch (event.type) {
      case 'takeover-required':
        status = 'paused';
        isPaused = true;
        break;
      case 'task-complete':
        status = 'success';
        isRunning = false;
        break;
      case 'task-failed':
        status = 'failed';
        isRunning = false;
        break;
    }

    let currentStep = s.currentTask.currentStep;
    if (event.type === 'step-start' && 'index' in event && typeof event.index === 'number') {
      currentStep = event.index;
    }

    return {
      currentTask: { ...s.currentTask, events, status, currentStep },
      isRunning,
      isPaused,
    };
  }),

  setPaused: (paused) => set((s) => ({
    isPaused: paused,
    currentTask: s.currentTask ? { ...s.currentTask, status: paused ? 'paused' as const : 'running' as const } : null,
  })),

  completeTask: (status) => set((s) => ({
    isRunning: false,
    isPaused: false,
    currentTask: s.currentTask ? { ...s.currentTask, status } : null,
  })),

  reset: () => set({ currentTask: null, isRunning: false, isPaused: false }),
}));
