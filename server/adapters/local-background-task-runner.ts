import type { BackgroundTaskRunner } from '../lib/background-task-runner.js';

export class LocalBackgroundTaskRunner implements BackgroundTaskRunner {
  run(task: () => Promise<void>, delayMs = 0) {
    setTimeout(() => {
      void task();
    }, delayMs);
  }
}
