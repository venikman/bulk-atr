export interface BackgroundTaskRunner {
  run(task: () => Promise<void>, delayMs?: number): void;
}
