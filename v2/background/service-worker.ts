import type {
  BackgroundRequest,
  BackgroundResponse,
  ContentScriptResponse,
  FetchBatchResponse,
  FetchCharacterAccountsResponse,
  FetchDetailHtmlResponse,
  ResolveCreatorProfileResponse
} from "../src/types/background";
import { HiddenTabPool } from "./hidden-tab-pool";

const pool = new HiddenTabPool(3);
const APP_URL = chrome.runtime.getURL("app.html");

chrome.action.onClicked.addListener(() => {
  void openOrFocusAppTab();
});

chrome.runtime.onMessage.addListener((request: BackgroundRequest, _sender, sendResponse) => {
  void handleRequest(request)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      } satisfies BackgroundResponse);
    });

  return true;
});

/**
 * Opens the fullscreen application tab or focuses the existing one.
 */
async function openOrFocusAppTab(): Promise<void> {
  const existingTabs = await chrome.tabs.query({ url: APP_URL });
  const existingTab = existingTabs[0];

  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, { active: true });
    if (typeof existingTab.windowId === "number") {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ active: true, url: APP_URL });
}

async function handleRequest(request: BackgroundRequest): Promise<BackgroundResponse> {
  const routeUrl = "route_url" in request ? request.route_url : undefined;

  switch (request.type) {
    case "fetch-batch":
      return { ok: true, payload: await runContentScriptRequest<FetchBatchResponse["payload"]>(request, routeUrl) };
    case "resolve-creator-profile":
      return {
        ok: true,
        payload: await runContentScriptRequest<ResolveCreatorProfileResponse["payload"]>(request, routeUrl)
      };
    case "fetch-character-accounts":
      return {
        ok: true,
        payload: await runContentScriptRequest<FetchCharacterAccountsResponse["payload"]>(request, routeUrl)
      };
    case "fetch-detail-html":
      return {
        ok: true,
        payload: await runContentScriptRequest<FetchDetailHtmlResponse["payload"]>(request, routeUrl)
      };
    default:
      throw new Error(`Unsupported background request type: ${(request as BackgroundRequest).type}`);
  }
}
async function runContentScriptRequest<TPayload>(
  request: BackgroundRequest,
  routeUrl: string | undefined
): Promise<TPayload> {
  return pool.run(routeUrl, async (tabId) => {
    const response: ContentScriptResponse | undefined = await chrome.tabs.sendMessage(tabId, {
      type: "run-source-request",
      payload: request
    });

    if (!response) {
      throw new Error("The injected Sora fetch runtime did not return a response.");
    }
    if (!response.ok) {
      throw new Error(response.error || "The injected Sora fetch runtime returned an unknown error.");
    }

    return response.payload as TPayload;
  });
}
