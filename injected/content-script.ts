import type { ContentScriptRequest, ContentScriptResponse } from "../src/types/background";
import { runSourceRequest } from "./sources/source-runner";

let listenerAttached = false;

if (!listenerAttached) {
  chrome.runtime.onMessage.addListener((message: ContentScriptRequest, _sender, sendResponse) => {
    if (!message) {
      return false;
    }

    if (message.type === "ping") {
      sendResponse({ ok: true, payload: { ready: true } } satisfies ContentScriptResponse);
      return false;
    }

    if (message.type !== "run-source-request") {
      return false;
    }

    void runSourceRequest(message.payload)
      .then((payload) => sendResponse({ ok: true, payload } satisfies ContentScriptResponse))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        } satisfies ContentScriptResponse);
      });

    return true;
  });

  listenerAttached = true;
}
