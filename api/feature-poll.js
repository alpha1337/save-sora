const {
  createSuggestion,
  getPollSnapshot,
  handleCors,
  readJsonBody,
  sendError,
  sendJson,
} = require("./_lib/feature-poll-store");

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) {
    return;
  }

  try {
    if (req.method === "GET") {
      const payload = await getPollSnapshot({ req });
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const payload = await createSuggestion({
        title: body && body.title,
        description: body && body.description,
        clientId: body && body.clientId,
        req,
      });
      sendJson(res, payload.created ? 201 : 200, { ok: true, ...payload });
      return;
    }

    sendJson(res, 405, {
      ok: false,
      error: "Method not allowed.",
    });
  } catch (error) {
    sendError(res, error, "Unable to process the feature poll request.");
  }
};
