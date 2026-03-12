import { setTimeout as delay } from 'node:timers/promises';
import type { BackgroundTaskRunner } from '../lib/background-task-runner.js';

export class LocalBackgroundTaskRunner implements BackgroundTaskRunner {
  run(task: () => Promise<void>, delayMs = 0) {
    void (async () => {
      if (delayMs > 0) {
        await delay(delayMs);
      }

      await task();
    })().catch((error: unknown) => {
      console.error('Background task failed in local runtime.', error);
    });
  }
}
