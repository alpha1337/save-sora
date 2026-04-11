import { describe, expect, it } from "vitest";
import { shouldRetryWorkerTask } from "./hidden-tab-pool";

describe("hidden-tab-pool retry policy", () => {
  it("retries when the content-script message channel closes", () => {
    expect(shouldRetryWorkerTask(new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"))).toBe(true);
    expect(shouldRetryWorkerTask(new Error("The message port closed before a response was received."))).toBe(true);
    expect(shouldRetryWorkerTask(new Error("Could not establish connection. Receiving end does not exist."))).toBe(true);
  });

  it("does not retry unrelated worker errors", () => {
    expect(shouldRetryWorkerTask(new Error("Sora request failed with status 500."))).toBe(false);
  });
});
