import { setTimeout as delay } from 'node:timers/promises';
import { waitUntil } from '@vercel/functions';
import type { BackgroundTaskRunner } from '../lib/background-task-runner.js';

export class VercelBackgroundTaskRunner implements BackgroundTaskRunner {
  run(task: () => Promise<void>, delayMs = 0) {
    waitUntil(
      (async () => {
        if (delayMs > 0) {
          await delay(delayMs);
        }

        await task();
      })(),
    );
  }
}
