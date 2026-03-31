/**
 * Legacy popup entrypoint.
 *
 * The popup implementation now lives in small ES modules under `popup/`.
 * Keeping this tiny wrapper means `popup.html` does not need to know about
 * the internal folder layout and contributors have a single place to start.
 */
void import("./popup/index.js")
  .then(({ initPopupApp }) => {
    initPopupApp();
  })
  .catch((error) => {
    console.error("Failed to initialize the Save Sora popup.", error);
  });
