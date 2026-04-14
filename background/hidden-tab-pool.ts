import { SORA_ORIGIN } from "../injected/lib/origins";

interface HiddenWorker {
  busy: boolean;
  injected: boolean;
  tabId: number;
  windowId: number | null;
}

const WORKER_BOOTSTRAP_URL = `${SORA_ORIGIN}/profile`;
const WORKER_LOAD_TIMEOUT_MS = 20_000;
const WORKER_PREPARE_RETRY_LIMIT = 2;
const WORKER_IDLE_EVICTION_MS = 10_000;
const WORKER_TRACKING_KEY = "saveSoraHiddenWorkers";

interface TrackedHiddenWorkers {
  tab_ids: number[];
  window_ids: number[];
}

/**
 * Dedicated hidden-tab worker pool. Workers are extension-owned tabs only and
 * stay pinned to a stable signed-in Sora page so requests execute from a known
 * browser context instead of arbitrary user tabs.
 */
export class HiddenTabPool {
  private readonly workers: HiddenWorker[] = [];
  private readonly idleDisposalTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxWorkers: number) {}

  async run<T>(task: (tabId: number) => Promise<T>): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < WORKER_PREPARE_RETRY_LIMIT; attempt += 1) {
      const worker = await this.acquireWorker();
      let shouldDisposeWorker = false;

      try {
        await ensureWorkerReady(worker);
        return await task(worker.tabId);
      } catch (error) {
        lastError = error;
        shouldDisposeWorker = shouldRetryWorkerTask(error);
        if (!shouldDisposeWorker) {
          throw error;
        }
      } finally {
        if (shouldDisposeWorker) {
          await this.disposeWorker(worker);
        } else {
          this.releaseWorker(worker);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Unknown worker failure.");
  }

  private async acquireWorker(): Promise<HiddenWorker> {
    while (true) {
      await this.reconcileWorkers();

      const availableWorker = this.workers.find((worker) => !worker.busy);
      if (availableWorker) {
        this.clearIdleDisposalTimer(availableWorker.tabId);
        availableWorker.busy = true;
        return availableWorker;
      }

      if (this.workers.length < this.maxWorkers) {
        const worker = await createDedicatedWorker();
        worker.busy = true;
        this.workers.push(worker);
        await this.persistTrackedWorkers();
        return worker;
      }

      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
  }

  private releaseWorker(worker: HiddenWorker): void {
    worker.busy = false;
    this.scheduleIdleDisposal(worker);
    this.queue.shift()?.();
  }

  async disposeAllWorkers(): Promise<void> {
    const workersToDispose = [...this.workers];
    await Promise.all(workersToDispose.map((worker) => this.disposeWorker(worker, true)));
  }

  private async disposeWorker(worker: HiddenWorker, force = false): Promise<void> {
    if (worker.busy && !force) {
      return;
    }

    this.clearIdleDisposalTimer(worker.tabId);
    const workerIndex = this.workers.findIndex((candidate) => candidate.tabId === worker.tabId);
    if (workerIndex >= 0) {
      this.workers.splice(workerIndex, 1);
    }

    worker.busy = false;
    worker.injected = false;

    if (typeof worker.windowId === "number") {
      try {
        const workerWindow = await chrome.windows.get(worker.windowId, { populate: true });
        const tabs = workerWindow.tabs ?? [];
        const hasWorkerTab = tabs.some((tab) => tab.id === worker.tabId);
        const onlyReusableSoraTabs = tabs.length > 0 && tabs.every((tab) => isReusableSoraWorkerTabUrl(tab.url));
        if (workerWindow.type === "popup" && hasWorkerTab && onlyReusableSoraTabs) {
          await chrome.windows.remove(worker.windowId);
          await this.persistTrackedWorkers();
          this.queue.shift()?.();
          return;
        }
      } catch (_error) {
        // Fall back to removing the worker tab if the worker window is unavailable.
      }
    }

    try {
      await chrome.tabs.remove(worker.tabId);
    } catch (_error) {
      // Ignore cleanup failures for already-closed worker tabs.
    } finally {
      await this.persistTrackedWorkers();
      this.queue.shift()?.();
    }
  }

  private async reconcileWorkers(): Promise<void> {
    for (let index = this.workers.length - 1; index >= 0; index -= 1) {
      const worker = this.workers[index];
      try {
        const tab = await chrome.tabs.get(worker.tabId);
        if (!worker.busy && !isReusableSoraWorkerTabUrl(tab.url)) {
          await this.disposeWorker(worker, true);
        }
      } catch (_error) {
        if (!worker.busy) {
          await this.disposeWorker(worker, true);
        }
      }
    }
  }

  private scheduleIdleDisposal(worker: HiddenWorker): void {
    this.clearIdleDisposalTimer(worker.tabId);
    const timeout = setTimeout(() => {
      void this.disposeWorker(worker);
    }, WORKER_IDLE_EVICTION_MS);
    this.idleDisposalTimers.set(worker.tabId, timeout);
  }

  private clearIdleDisposalTimer(tabId: number): void {
    const timeout = this.idleDisposalTimers.get(tabId);
    if (timeout) {
      clearTimeout(timeout);
      this.idleDisposalTimers.delete(tabId);
    }
  }

  private async persistTrackedWorkers(): Promise<void> {
    const trackedWorkers: TrackedHiddenWorkers = {
      tab_ids: this.workers.map((worker) => worker.tabId),
      window_ids: this.workers
        .map((worker) => worker.windowId)
        .filter((windowId): windowId is number => typeof windowId === "number")
    };

    await chrome.storage.session.set({ [WORKER_TRACKING_KEY]: trackedWorkers }).catch(() => undefined);
  }
}

export function shouldRetryWorkerTask(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Receiving end does not exist/i.test(message) ||
    /No tab with id/i.test(message) ||
    /message channel closed before a response was received/i.test(message) ||
    /The message port closed before a response was received/i.test(message) ||
    /Could not derive a Sora bearer token/i.test(message) ||
    /Could not derive the signed-in Sora viewer id/i.test(message) ||
    /Missing bearer authentication/i.test(message) ||
    /Frame with ID 0 is showing error page/i.test(message) ||
    /Cannot access contents of url/i.test(message)
  );
}

async function createDedicatedWorker(): Promise<HiddenWorker> {
  const workerTab = await chrome.tabs.create({
    active: false,
    pinned: true,
    url: WORKER_BOOTSTRAP_URL
  });

  if (!workerTab.id) {
    throw new Error("Could not create a dedicated Sora worker tab.");
  }

  await waitForTabComplete(workerTab.id);
  await chrome.tabs.update(workerTab.id, { active: false, autoDiscardable: false }).catch(() => undefined);

  return {
    busy: false,
    injected: false,
    tabId: workerTab.id,
    windowId: null
  };
}

async function ensureWorkerReady(worker: HiddenWorker): Promise<void> {
  for (let attempt = 0; attempt < WORKER_PREPARE_RETRY_LIMIT; attempt += 1) {
    const currentTab = await chrome.tabs.get(worker.tabId);

    if (!isReusableSoraWorkerTabUrl(currentTab.url) || currentTab.status !== "complete") {
      await chrome.tabs.update(worker.tabId, { active: false, url: WORKER_BOOTSTRAP_URL });
      await waitForTabComplete(worker.tabId);
      worker.injected = false;
    }

    const readyTab = await chrome.tabs.get(worker.tabId);
    if (!isReusableSoraWorkerTabUrl(readyTab.url)) {
      throw new Error(`Worker tab failed to load a reusable Sora page: ${String(readyTab.url ?? "")}`);
    }

    try {
      if (!worker.injected) {
        await chrome.scripting.executeScript({
          target: { tabId: worker.tabId },
          files: ["injected/content-script.js"]
        });
        worker.injected = true;
      }

      await pingWorker(worker.tabId);
      return;
    } catch (error) {
      worker.injected = false;
      if (attempt + 1 >= WORKER_PREPARE_RETRY_LIMIT || !shouldRetryWorkerTask(error)) {
        throw error;
      }

      await chrome.tabs.update(worker.tabId, { active: false, url: WORKER_BOOTSTRAP_URL });
      await waitForTabComplete(worker.tabId);
    }
  }
}

async function pingWorker(tabId: number): Promise<void> {
  const response: { ok?: boolean; payload?: { ready?: boolean } } | undefined = await chrome.tabs.sendMessage(tabId, { type: "ping" });
  if (!response?.ok || response.payload?.ready !== true) {
    throw new Error("Worker content script is not ready.");
  }
}

function waitForTabComplete(tabId: number, timeoutMs = WORKER_LOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) {
        return;
      }
      resolved = true;
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
      reject(new Error("Timed out waiting for the hidden Sora worker tab to finish loading."));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
    };

    const finishIfReady = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") {
          if (resolved) {
            return;
          }
          resolved = true;
          cleanup();
          resolve();
        }
      } catch (error) {
        if (resolved) {
          return;
        }
        resolved = true;
        cleanup();
        reject(error instanceof Error ? error : new Error("The hidden Sora worker tab became unavailable."));
      }
    };

    const handleUpdated = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete" || resolved) {
        return;
      }
      void finishIfReady();
    };

    const handleRemoved = (removedTabId: number) => {
      if (removedTabId !== tabId || resolved) {
        return;
      }
      resolved = true;
      cleanup();
      reject(new Error("The hidden Sora worker tab was closed before it finished loading."));
    };

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
    void finishIfReady();
  });
}

export function isReusableSoraWorkerTabUrl(url: string | undefined | null): boolean {
  if (typeof url !== "string" || !url) {
    return false;
  }

  return url === SORA_ORIGIN || url.startsWith(`${SORA_ORIGIN}/`);
}

export async function cleanupTrackedHiddenWorkers(): Promise<void> {
  const stored = await chrome.storage.session.get(WORKER_TRACKING_KEY).catch(() => ({} as Record<string, unknown>));
  const storedRecord = stored as Record<string, unknown>;
  const tracked = storedRecord[WORKER_TRACKING_KEY] as TrackedHiddenWorkers | undefined;
  const windowIds = [...new Set((tracked?.window_ids ?? []).filter((windowId) => Number.isInteger(windowId)))];
  const tabIds = [...new Set((tracked?.tab_ids ?? []).filter((tabId) => Number.isInteger(tabId)))];

  for (const windowId of windowIds) {
    try {
      const workerWindow = await chrome.windows.get(windowId, { populate: true });
      const tabs = workerWindow.tabs ?? [];
      const onlyReusableSoraTabs = tabs.length > 0 && tabs.every((tab) => isReusableSoraWorkerTabUrl(tab.url));
      if (workerWindow.type === "popup" && onlyReusableSoraTabs) {
        await chrome.windows.remove(windowId);
      }
    } catch (_error) {
      // Ignore stale or inaccessible window ids.
    }
  }

  for (const tabId of tabIds) {
    try {
      await chrome.tabs.remove(tabId);
    } catch (_error) {
      // Ignore stale or inaccessible tab ids.
    }
  }

  const allWindows = await chrome.windows.getAll({ populate: true }).catch(() => [] as chrome.windows.Window[]);
  for (const chromeWindow of allWindows) {
    if (chromeWindow.type !== "popup" || chromeWindow.state !== "minimized" || typeof chromeWindow.id !== "number") {
      continue;
    }

    const tabs = chromeWindow.tabs ?? [];
    const isSoraPopupWorkerWindow =
      tabs.length === 1 && typeof tabs[0]?.url === "string" && tabs[0].url.startsWith(WORKER_BOOTSTRAP_URL);
    if (!isSoraPopupWorkerWindow) {
      continue;
    }

    try {
      await chrome.windows.remove(chromeWindow.id);
    } catch (_error) {
      // Ignore windows that are already gone.
    }
  }

  await chrome.storage.session.remove(WORKER_TRACKING_KEY).catch(() => undefined);
}
