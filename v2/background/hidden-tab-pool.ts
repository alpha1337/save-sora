const DEFAULT_SORA_URL = "https://sora.chatgpt.com/";

interface HiddenWorker {
  busy: boolean;
  injected: boolean;
  tabId: number;
}

/**
 * Shared hidden-tab worker pool that bounds live Sora fetch concurrency at 3.
 */
export class HiddenTabPool {
  private readonly workers: HiddenWorker[] = [];
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxWorkers: number) {}

  async run<T>(routeUrl: string | undefined, task: (tabId: number) => Promise<T>): Promise<T> {
    const worker = await this.acquireWorker(routeUrl);

    try {
      try {
        return await task(worker.tabId);
      } catch (error) {
        if (!shouldRetryWorkerTask(error)) {
          throw error;
        }

        worker.injected = false;
        await ensureTabReady(worker, routeUrl);
        return await task(worker.tabId);
      }
    } finally {
      worker.busy = false;
      this.queue.shift()?.();
    }
  }

  private async acquireWorker(routeUrl: string | undefined): Promise<HiddenWorker> {
    while (true) {
      const availableWorker = this.workers.find((worker) => !worker.busy);
      if (availableWorker) {
        availableWorker.busy = true;
        await ensureTabReady(availableWorker, routeUrl);
        return availableWorker;
      }

      if (this.workers.length < this.maxWorkers) {
        const tab = await chrome.tabs.create({ active: false, url: routeUrl || DEFAULT_SORA_URL });
        if (typeof tab.id !== "number") {
          throw new Error("Could not create a hidden Sora tab.");
        }

        const worker: HiddenWorker = { busy: true, injected: false, tabId: tab.id };
        this.workers.push(worker);
        await waitForTabComplete(tab.id);
        await ensureTabReady(worker, routeUrl);
        return worker;
      }

      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
  }
}

export function shouldRetryWorkerTask(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Receiving end does not exist/i.test(message) ||
    /message channel closed before a response was received/i.test(message) ||
    /The message port closed before a response was received/i.test(message)
  );
}

async function ensureTabReady(worker: HiddenWorker, routeUrl: string | undefined): Promise<void> {
  const targetUrl = routeUrl || DEFAULT_SORA_URL;
  const tab = await chrome.tabs.get(worker.tabId);
  if (!tab.url || !tab.url.startsWith(targetUrl)) {
    await chrome.tabs.update(worker.tabId, { url: targetUrl });
    await waitForTabComplete(worker.tabId);
    worker.injected = false;
  }

  if (!worker.injected) {
    await chrome.scripting.executeScript({ target: { tabId: worker.tabId }, files: ["injected/content-script.js"] });
    worker.injected = true;
  }
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}
