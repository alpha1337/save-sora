const WATERMARK_PROVIDER_PATTERN = /watermark|proxy\/video|download failed|gateway timeout/i;

export function getUserFacingErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const message = rawMessage.trim();

  if (!message) {
    return "Something went wrong. Please try again.";
  }

  const watermarkStatusMatch = message.match(/download failed.*status\s+(\d{3})/i);
  if (watermarkStatusMatch) {
    return mapWatermarkRemovalStatus(Number(watermarkStatusMatch[1]));
  }

  const soraRequestStatusMatch = message.match(/Sora request failed with status\s+(\d{3})/i);
  if (soraRequestStatusMatch) {
    return mapSoraRequestStatus(Number(soraRequestStatusMatch[1]));
  }

  const draftShareStatusMatch = message.match(/Draft share creation failed with status\s+(\d{3})/i);
  if (draftShareStatusMatch) {
    return mapDraftShareStatus(Number(draftShareStatusMatch[1]));
  }

  if (WATERMARK_PROVIDER_PATTERN.test(message)) {
    return "Watermark removal is temporarily unavailable for one or more videos. Please retry.";
  }

  return message;
}

function mapWatermarkRemovalStatus(status: number): string {
  if (status === 429) {
    return "Watermark removal is being rate-limited right now. Please wait a minute and try Build ZIP again.";
  }
  if (status === 400) {
    return "Watermark removal is unavailable for one or more selected videos right now. They may still be processing.";
  }
  if (status === 404) {
    return "A selected video is no longer available for watermark removal.";
  }
  if (status >= 500) {
    return "Watermark removal is temporarily unavailable due to a server issue. Please retry shortly.";
  }
  return `Watermark removal failed for one or more selected videos (status ${status}).`;
}

function mapSoraRequestStatus(status: number): string {
  if (status === 400) {
    return "Sora rejected this request. This usually means the item is unavailable, no longer shareable, or still processing.";
  }
  if (status === 401 || status === 403) {
    return "Your Sora session is no longer authorized. Refresh Sora, sign in again, then retry.";
  }
  if (status === 429) {
    return "Sora is rate-limiting requests right now. Please retry in a minute.";
  }
  if (status >= 500) {
    return "Sora is temporarily unavailable. Please retry shortly.";
  }
  return `Sora request failed (status ${status}).`;
}

function mapDraftShareStatus(status: number): string {
  if (status === 400) {
    return "Draft sharing is unavailable for this item right now. It may be restricted, invalid, or still processing.";
  }
  if (status === 401 || status === 403) {
    return "Your Sora session is no longer authorized for draft sharing. Sign in again and retry.";
  }
  if (status === 429) {
    return "Draft sharing is rate-limited right now. Please retry shortly.";
  }
  if (status >= 500) {
    return "Draft sharing is temporarily unavailable. Please retry shortly.";
  }
  return `Draft sharing failed (status ${status}).`;
}
