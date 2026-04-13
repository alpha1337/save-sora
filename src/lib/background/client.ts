import type { BackgroundRequest, BackgroundResponse } from "types/background";

/**
 * Thin wrapper around runtime messaging so controllers do not duplicate the
 * extension transport logic.
 */
export async function sendBackgroundRequest<T extends BackgroundResponse>(
  request: BackgroundRequest
): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse | undefined;

  if (!response) {
    throw new Error("The background worker did not return a response.");
  }

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response as T;
}
