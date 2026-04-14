const WATERMARK_PROVIDER_PATTERN = /watermark|proxy\/video|download failed|gateway timeout/i;
const CONTEXT_SEPARATOR = "Context:";

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

  const watermarkStatusMatch = baseMessage.match(/download failed.*status\s+(\d{3})/i);
  if (watermarkStatusMatch) {
    return mapWatermarkRemovalStatus(Number(watermarkStatusMatch[1]), debugDetails);
  }

  const soraRequestStatusMatch = baseMessage.match(/Sora request failed with status\s+(\d{3})/i);
  if (soraRequestStatusMatch && !baseMessage.includes("Attempts:")) {
    return mapSoraRequestStatus(Number(soraRequestStatusMatch[1]), debugDetails);
  }

  const draftShareStatusMatch = baseMessage.match(/Draft share creation failed with status\s+(\d{3})/i);
  if (draftShareStatusMatch) {
    return mapDraftShareStatus(Number(draftShareStatusMatch[1]), debugDetails);
  }

  if (WATERMARK_PROVIDER_PATTERN.test(baseMessage)) {
    return appendDebugDetails(
      "Watermark removal is temporarily unavailable for one or more videos. Please retry.",
      debugDetails
    );
  }

  return appendDebugDetails(baseMessage, debugDetails);
}

function mapWatermarkRemovalStatus(status: number, contextDetails: string): string {
  if (status === 429) {
    return appendDebugDetails("Watermark removal is being rate-limited right now. Please wait a minute and try Build ZIP again.", contextDetails);
  }
  if (status === 400) {
    return appendDebugDetails("Watermark removal is unavailable for one or more selected videos right now. They may still be processing.", contextDetails);
  }
  if (status === 404) {
    return appendDebugDetails("A selected video is no longer available for watermark removal.", contextDetails);
  }
  if (status >= 500) {
    return appendDebugDetails("Watermark removal is temporarily unavailable due to a server issue. Please retry shortly.", contextDetails);
  }
  return appendDebugDetails(`Watermark removal failed for one or more selected videos (status ${status}).`, contextDetails);
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
