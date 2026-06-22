const launchedPids: number[] = [];

export function trackPid(pid: number): void {
  launchedPids.push(pid);
}

export function killTrackedProcesses(): void {
  for (const pid of launchedPids) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[cleanup] killed PID ${pid}`);
    } catch {
      // already exited
    }
  }
  launchedPids.length = 0;
}

export function launchNotepad(): number {
  const child = require('node:child_process').spawn('notepad.exe', [], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const pid = child.pid!;
  trackPid(pid);
  console.log(`[cleanup] launched notepad PID=${pid}`);
  return pid;
}
