const {
  handleCors,
  readJsonBody,
  sendError,
  sendJson,
  toggleVote,
} = require("./_lib/feature-poll-store");

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) {
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, {
      ok: false,
      error: "Method not allowed.",
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const payload = await toggleVote({
      itemId: body && body.itemId,
      clientId: body && body.clientId,
      req,
    });
    sendJson(res, 200, { ok: true, ...payload });
  } catch (error) {
    sendError(res, error, "Unable to register that vote.");
  }
};
