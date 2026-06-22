export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function countdown(seconds: number, label: string): Promise<void> {
  for (let i = seconds; i > 0; i--) {
    console.log(`[countdown] ${label} — starting in ${i}s... (Ctrl+C to cancel)`);
    await sleep(1000);
  }
  console.log(`[countdown] ${label} — starting now`);
}

export function createAbortController(): {
  controller: AbortController;
  checkAbort: () => void;
} {
  const controller = new AbortController();
  const checkAbort = () => {
    if (controller.signal.aborted) {
      throw new Error('INPUT_ABORTED: operation cancelled by abort signal');
    }
  };
  return { controller, checkAbort };
}

export function measureMs(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  return fn().then(() => performance.now() - start);
}
