const CONTEXT_SEPARATOR = "Context:";
const SOURCE_DOWNLOAD_STATUS_PATTERN = /Source video download failed \(status\s+(\d{3})\)\.?/i;
const SORA_NETWORK_ERROR_PATTERN = /Sora request failed due to a network error after\s+(\d+)\s+attempt/i;

export function getUserFacingErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const message = rawMessage.trim();
  const contextDetails = extractContextDetails(message);
  const withoutContext = stripContextDetails(message);
  const requestDetails = extractRequestDetails(withoutContext);
  const baseMessage = stripRequestDetails(withoutContext);
  const debugDetails = combineDebugDetails(requestDetails, contextDetails);

  if (!message) {
    return "Something went wrong. Please try again.";
  }

  if (/^fetch canceled\.?$/i.test(baseMessage) || /^fetch canceled\.? fetch canceled\.?$/i.test(baseMessage)) {
    return "Fetch canceled.";
  }

  const sourceDownloadStatusMatch = baseMessage.match(SOURCE_DOWNLOAD_STATUS_PATTERN);
  if (sourceDownloadStatusMatch) {
    return mapSourceDownloadStatus(Number(sourceDownloadStatusMatch[1]), debugDetails);
  }

  const soraRequestStatusMatch = baseMessage.match(/Sora request failed with status\s+(\d{3})/i);
  if (soraRequestStatusMatch && !baseMessage.includes("Attempts:")) {
    return mapSoraRequestStatus(Number(soraRequestStatusMatch[1]), debugDetails);
  }

  const soraNetworkErrorMatch = baseMessage.match(SORA_NETWORK_ERROR_PATTERN);
  if (soraNetworkErrorMatch) {
    return mapSoraNetworkError(Number(soraNetworkErrorMatch[1]), debugDetails);
  }

  const draftShareStatusMatch = baseMessage.match(/Draft share creation failed with status\s+(\d{3})/i);
  if (draftShareStatusMatch) {
    return mapDraftShareStatus(Number(draftShareStatusMatch[1]), debugDetails);
  }

  return appendDebugDetails(baseMessage, debugDetails);
}

function mapSourceDownloadStatus(status: number, contextDetails: string): string {
  if (status === 400 || status === 404) {
    return appendDebugDetails("The selected video file is unavailable.", contextDetails);
  }
  if (status === 401 || status === 403) {
    return appendDebugDetails("Your Sora session is no longer authorized. Refresh Sora, sign in again, then retry.", contextDetails);
  }
  if (status === 429) {
    return appendDebugDetails("Sora is rate-limiting file downloads right now. Please retry in a minute.", contextDetails);
  }
  if (status >= 500) {
    return appendDebugDetails("Video download is temporarily unavailable. Please retry shortly.", contextDetails);
  }
  return appendDebugDetails(`Video download failed (status ${status}).`, contextDetails);
}

function mapSoraRequestStatus(status: number, contextDetails: string): string {
  if (status === 400) {
    return appendDebugDetails("Sora rejected this request. This usually means the item is unavailable, no longer shareable, or still processing.", contextDetails);
  }
  if (status === 401 || status === 403) {
    return appendDebugDetails("Your Sora session is no longer authorized. Refresh Sora, sign in again, then retry.", contextDetails);
  }
  if (status === 429) {
    return appendDebugDetails("Sora is rate-limiting requests right now. Please retry in a minute.", contextDetails);
  }
  if (status >= 500) {
    return appendDebugDetails("Sora is temporarily unavailable. Please retry shortly.", contextDetails);
  }
  return appendDebugDetails(`Sora request failed (status ${status}).`, contextDetails);
}

function mapSoraNetworkError(attempts: number, contextDetails: string): string {
  const safeAttempts = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 1;
  const attemptLabel = safeAttempts === 1 ? "1 attempt" : `${safeAttempts} attempts`;
  return appendDebugDetails(
    `Sora could not be reached after ${attemptLabel}. Check your connection and retry.`,
    contextDetails
  );
}

function mapDraftShareStatus(status: number, contextDetails: string): string {
  if (status === 400) {
    return appendDebugDetails("Draft sharing is unavailable for this item right now. It may be restricted, invalid, or still processing.", contextDetails);
  }
  if (status === 401 || status === 403) {
    return appendDebugDetails("Your Sora session is no longer authorized for draft sharing. Sign in again and retry.", contextDetails);
  }
  if (status === 429) {
    return appendDebugDetails("Draft sharing is rate-limited right now. Please retry shortly.", contextDetails);
  }
  if (status >= 500) {
    return appendDebugDetails("Draft sharing is temporarily unavailable. Please retry shortly.", contextDetails);
  }
  return appendDebugDetails(`Draft sharing failed (status ${status}).`, contextDetails);
}

function extractContextDetails(message: string): string {
  const contextIndex = message.indexOf(CONTEXT_SEPARATOR);
  if (contextIndex < 0) {
    return "";
  }
  return message.slice(contextIndex + CONTEXT_SEPARATOR.length).trim();
}

function stripContextDetails(message: string): string {
  const contextIndex = message.indexOf(CONTEXT_SEPARATOR);
  if (contextIndex < 0) {
    return message;
  }
  return message.slice(0, contextIndex).trim();
}

function extractRequestDetails(message: string): string {
  const match = message.match(/Request:\s*(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function stripRequestDetails(message: string): string {
  return message.replace(/\s*Request:\s*.+$/i, "").trim();
}

function combineDebugDetails(requestDetails: string, contextDetails: string): string {
  const details = [requestDetails, contextDetails].filter(Boolean);
  return details.join(" · ");
}

function appendDebugDetails(baseMessage: string, contextDetails: string): string {
  if (!contextDetails) {
    return baseMessage;
  }
  return `${baseMessage} Debug: ${contextDetails}`;
}
