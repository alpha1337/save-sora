import { describe, expect, it } from "vitest";
import { isReusableSoraWorkerTabUrl, shouldRetryWorkerTask } from "./hidden-tab-pool";

describe("hidden-tab-pool recovery policy", () => {
  it("retries when the content-script bridge breaks", () => {
    expect(shouldRetryWorkerTask(new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"))).toBe(true);
    expect(shouldRetryWorkerTask(new Error("The message port closed before a response was received."))).toBe(true);
    expect(shouldRetryWorkerTask(new Error("Could not establish connection. Receiving end does not exist."))).toBe(true);
  });

  it("retries when worker preparation loses auth or lands on an error page", () => {
    expect(shouldRetryWorkerTask(new Error("Could not derive a Sora bearer token from the signed-in browser session."))).toBe(true);
    expect(shouldRetryWorkerTask(new Error("Could not derive the signed-in Sora viewer id."))).toBe(true);
    expect(shouldRetryWorkerTask(new Error("Missing bearer authentication in header"))).toBe(true);
    expect(shouldRetryWorkerTask(new Error("Frame with ID 0 is showing error page"))).toBe(true);
  });

  it("does not retry unrelated API failures", () => {
    expect(shouldRetryWorkerTask(new Error("Sora request failed with status 500."))).toBe(false);
  });

  it("recognizes reusable Sora worker pages", () => {
    expect(isReusableSoraWorkerTabUrl("https://sora.chatgpt.com/profile/crystal.party")).toBe(true);
    expect(isReusableSoraWorkerTabUrl("https://sora.chatgpt.com/drafts")).toBe(true);
    expect(isReusableSoraWorkerTabUrl("https://chatgpt.com/")).toBe(false);
    expect(isReusableSoraWorkerTabUrl("chrome-extension://abc/app.html")).toBe(false);
  });
});
