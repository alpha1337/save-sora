const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_STORE_PATH = path.join(REPO_ROOT, "data", "feature-poll.json");
const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_STORE = Object.freeze({
  version: 1,
  updatedAt: null,
  items: [],
});

function getPollConfig() {
  const githubToken = String(
    process.env.FEATURE_POLL_GITHUB_TOKEN || process.env.GITHUB_TOKEN || ""
  ).trim();
  const githubOwner = String(process.env.FEATURE_POLL_GITHUB_OWNER || "alpha1337").trim();
  const githubRepo = String(process.env.FEATURE_POLL_GITHUB_REPO || "save-sora").trim();
  const githubBranch = String(process.env.FEATURE_POLL_GITHUB_BRANCH || "main").trim();
  const githubPath = String(process.env.FEATURE_POLL_GITHUB_PATH || "data/feature-poll.json").trim();
  const localPath = path.resolve(
    String(process.env.FEATURE_POLL_LOCAL_PATH || DEFAULT_STORE_PATH).trim()
  );
  const issueMirrorEnabled = parseBooleanEnv(
    process.env.FEATURE_POLL_MIRROR_ISSUES,
    false
  );
  const issueLabels = String(
    process.env.FEATURE_POLL_ISSUE_LABELS || "feature-request"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    githubToken,
    githubOwner,
    githubRepo,
    githubBranch,
    githubPath,
    localPath,
    clientSalt: String(process.env.FEATURE_POLL_CLIENT_SALT || "save-sora-feature-poll"),
    issueMirrorEnabled,
    issueLabels,
    useGitHubStore: Boolean(githubToken && githubOwner && githubRepo),
  };
}

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

function sanitizeStore(input) {
  const items = Array.isArray(input && input.items) ? input.items : [];
  return {
    version: Number(input && input.version) || 1,
    updatedAt: input && typeof input.updatedAt === "string" ? input.updatedAt : null,
    items: items.map(sanitizeItem).filter(Boolean),
  };
}

function sanitizeItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const title = normalizeTitle(item.title || "");
  if (!title) {
    return null;
  }

  const createdAt = asIsoDate(item.createdAt) || new Date().toISOString();
  const updatedAt = asIsoDate(item.updatedAt) || createdAt;

  return {
    id: typeof item.id === "string" && item.id ? item.id : buildItemId(title),
    title,
    description: normalizeDescription(item.description || ""),
    slug: slugify(title),
    status: item.status === "closed" ? "closed" : "open",
    createdAt,
    updatedAt,
    issueNumber:
      typeof item.issueNumber === "number" && Number.isFinite(item.issueNumber)
        ? item.issueNumber
        : null,
    issueUrl: typeof item.issueUrl === "string" ? item.issueUrl : null,
    voteHashes: Array.isArray(item.voteHashes)
      ? [...new Set(item.voteHashes.map((value) => String(value).trim()).filter(Boolean))]
      : [],
  };
}

function asIsoDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function normalizeDescription(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function normalizeTitleKey(value) {
  return normalizeTitle(value).toLowerCase();
}

function slugify(value) {
  return normalizeTitle(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function buildItemId(title) {
  const slug = slugify(title) || "request";
  return `fr_${slug}_${crypto.randomBytes(3).toString("hex")}`;
}

function hashClientIdentity(clientId, req, config) {
  const headerClientId =
    req && req.headers ? req.headers["x-feature-poll-client-id"] || req.headers["X-Feature-Poll-Client-Id"] : "";
  const forwardedFor =
    req && req.headers && typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0].trim()
      : "";
  const userAgent =
    req && req.headers && typeof req.headers["user-agent"] === "string"
      ? req.headers["user-agent"]
      : "";

  const seed = String(clientId || headerClientId || `${forwardedFor}|${userAgent}`)
    .trim()
    .slice(0, 512);

  if (!seed) {
    return null;
  }

  return crypto
    .createHash("sha256")
    .update(config.clientSalt)
    .update(":")
    .update(seed)
    .digest("hex");
}

function sortItems(items, sort = "top") {
  return [...items].sort((left, right) => {
    if (sort === "new") {
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    }

    if (right.voteHashes.length !== left.voteHashes.length) {
      return right.voteHashes.length - left.voteHashes.length;
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function toPublicItem(item, viewerHash) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    slug: item.slug,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    votes: item.voteHashes.length,
    hasVoted: Boolean(viewerHash && item.voteHashes.includes(viewerHash)),
    issueNumber: item.issueNumber,
    issueUrl: item.issueUrl,
  };
}

function buildPublicSnapshot(store, viewerHash) {
  const openItems = store.items.filter((item) => item.status === "open");
  const sortedItems = sortItems(openItems, "top");
  const totalVotes = openItems.reduce((sum, item) => sum + item.voteHashes.length, 0);
  const config = getPollConfig();

  return {
    items: sortedItems.map((item) => toPublicItem(item, viewerHash)),
    meta: {
      totalItems: openItems.length,
      totalVotes,
      updatedAt: store.updatedAt,
      issueMirrorEnabled: config.issueMirrorEnabled,
    },
  };
}

async function ensureLocalStoreExists(localPath) {
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  try {
    await fs.access(localPath);
  } catch (error) {
    await fs.writeFile(localPath, `${JSON.stringify(DEFAULT_STORE, null, 2)}\n`, "utf8");
  }
}

async function loadStore(config = getPollConfig()) {
  if (config.useGitHubStore) {
    return loadStoreFromGitHub(config);
  }

  return loadStoreFromLocalDisk(config);
}

async function loadStoreFromLocalDisk(config) {
  await ensureLocalStoreExists(config.localPath);
  const content = await fs.readFile(config.localPath, "utf8");
  return {
    sha: null,
    store: sanitizeStore(JSON.parse(content)),
  };
}

async function loadStoreFromGitHub(config) {
  const response = await fetch(buildGitHubContentUrl(config), {
    headers: buildGitHubHeaders(config.githubToken),
  });

  if (response.status === 404) {
    return {
      sha: null,
      store: sanitizeStore(DEFAULT_STORE),
    };
  }

  if (!response.ok) {
    throw await buildGitHubError("Unable to load the feature poll store from GitHub.", response);
  }

  const payload = await response.json();
  const content = Buffer.from(String(payload.content || "").replace(/\n/g, ""), "base64").toString(
    "utf8"
  );

  return {
    sha: payload.sha || null,
    store: sanitizeStore(JSON.parse(content)),
  };
}

async function saveStore(config, store, sha, message) {
  const normalizedStore = sanitizeStore(store);
  normalizedStore.updatedAt = new Date().toISOString();

  if (config.useGitHubStore) {
    return saveStoreToGitHub(config, normalizedStore, sha, message);
  }

  await ensureLocalStoreExists(config.localPath);
  await fs.writeFile(config.localPath, `${JSON.stringify(normalizedStore, null, 2)}\n`, "utf8");
  return { sha: null, store: normalizedStore };
}

async function saveStoreToGitHub(config, store, sha, message) {
  const response = await fetch(buildGitHubContentUrl(config), {
    method: "PUT",
    headers: buildGitHubHeaders(config.githubToken),
    body: JSON.stringify({
      message,
      branch: config.githubBranch,
      sha: sha || undefined,
      content: Buffer.from(`${JSON.stringify(store, null, 2)}\n`, "utf8").toString("base64"),
    }),
  });

  if (!response.ok) {
    throw await buildGitHubError("Unable to save the feature poll store to GitHub.", response);
  }

  const payload = await response.json();
  return {
    sha: payload.content && payload.content.sha ? payload.content.sha : null,
    store,
  };
}

async function mutateStore(mutator, commitMessage) {
  const config = getPollConfig();
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await loadStore(config);
    const store = sanitizeStore(loaded.store);
    const result = await mutator(store, config);

    try {
      const saved = await saveStore(config, store, loaded.sha, commitMessage);
      return {
        config,
        store: saved.store,
        result,
      };
    } catch (error) {
      lastError = error;
      if (config.useGitHubStore && isGitHubConflict(error) && attempt < 2) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Unable to update the feature poll store.");
}

function isGitHubConflict(error) {
  return Boolean(error && (error.status === 409 || error.status === 422));
}

function buildGitHubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

function buildGitHubContentUrl(config) {
  const encodedPath = config.githubPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://api.github.com/repos/${encodeURIComponent(
    config.githubOwner
  )}/${encodeURIComponent(config.githubRepo)}/contents/${encodedPath}?ref=${encodeURIComponent(
    config.githubBranch
  )}`;
}

async function buildGitHubError(message, response) {
  let details = "";
  try {
    details = await response.text();
  } catch (error) {
    details = "";
  }

  const error = new Error(`${message} (${response.status})`);
  error.status = response.status;
  error.details = details;
  return error;
}

function findItem(store, itemId) {
  return store.items.find((item) => item.id === itemId);
}

function findDuplicateItem(store, title) {
  const titleKey = normalizeTitleKey(title);
  return store.items.find(
    (item) => item.status === "open" && normalizeTitleKey(item.title) === titleKey
  );
}

function ensureVote(item, viewerHash) {
  if (!viewerHash) {
    return false;
  }

  if (item.voteHashes.includes(viewerHash)) {
    return false;
  }

  item.voteHashes.push(viewerHash);
  return true;
}

async function createSuggestion(options) {
  const title = normalizeTitle(options && options.title);
  const description = normalizeDescription(options && options.description);
  if (!title) {
    const error = new Error("Give the request a clear title first.");
    error.status = 400;
    throw error;
  }

  const config = getPollConfig();
  const viewerHash = hashClientIdentity(options && options.clientId, options && options.req, config);
  if (!viewerHash) {
    const error = new Error("A stable local voter ID is required to submit feature requests.");
    error.status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const mutation = await mutateStore((store) => {
    const duplicate = findDuplicateItem(store, title);
    if (duplicate) {
      const voteAdded = ensureVote(duplicate, viewerHash);
      duplicate.updatedAt = now;
      return {
        created: false,
        merged: true,
        voteAdded,
        itemId: duplicate.id,
      };
    }

    const item = sanitizeItem({
      id: buildItemId(title),
      title,
      description,
      status: "open",
      createdAt: now,
      updatedAt: now,
      voteHashes: [viewerHash],
    });

    store.items.unshift(item);
    return {
      created: true,
      merged: false,
      voteAdded: true,
      itemId: item.id,
    };
  }, `feat(poll): ${title}`);

  const createdItem = findItem(mutation.store, mutation.result.itemId);
  if (
    createdItem &&
    mutation.result.created &&
    mutation.config.issueMirrorEnabled &&
    mutation.config.useGitHubStore
  ) {
    const issue = await mirrorItemToGitHubIssue(createdItem, mutation.config).catch(() => null);
    if (issue) {
      await mutateStore((store) => {
        const item = findItem(store, createdItem.id);
        if (!item || item.issueUrl) {
          return { attached: false };
        }
        item.issueUrl = issue.html_url;
        item.issueNumber = issue.number;
        item.updatedAt = new Date().toISOString();
        return { attached: true };
      }, `chore(poll): mirror ${createdItem.title}`);
    }
  }

  return getPollSnapshot({
    clientId: options && options.clientId,
    req: options && options.req,
    itemId: mutation.result.itemId,
    created: mutation.result.created,
    merged: mutation.result.merged,
  });
}

async function mirrorItemToGitHubIssue(item, config) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(
      config.githubRepo
    )}/issues`,
    {
      method: "POST",
      headers: buildGitHubHeaders(config.githubToken),
      body: JSON.stringify({
        title: `[Feature Poll] ${item.title}`,
        labels: config.issueLabels,
        body: [
          "## Feature poll request",
          "",
          "This issue was created automatically from the anonymous Save Sora feature poll.",
          "",
          `- Poll item id: \`${item.id}\``,
          `- Votes at creation: ${item.voteHashes.length}`,
          "",
          "### Requested change",
          "",
          item.description || "No extra description was supplied in the poll submission.",
        ].join("\n"),
      }),
    }
  );

  if (!response.ok) {
    throw await buildGitHubError("Unable to mirror the feature request into a GitHub issue.", response);
  }

  return response.json();
}

async function toggleVote(options) {
  const itemId = String(options && options.itemId || "").trim();
  if (!itemId) {
    const error = new Error("Pick a feature request before voting.");
    error.status = 400;
    throw error;
  }

  const config = getPollConfig();
  const viewerHash = hashClientIdentity(options && options.clientId, options && options.req, config);
  if (!viewerHash) {
    const error = new Error("A stable local voter ID is required to cast a vote.");
    error.status = 400;
    throw error;
  }

  const mutation = await mutateStore((store) => {
    const item = findItem(store, itemId);
    if (!item || item.status !== "open") {
      const error = new Error("That feature request could not be found.");
      error.status = 404;
      throw error;
    }

    const existingIndex = item.voteHashes.indexOf(viewerHash);
    let voted = true;
    if (existingIndex >= 0) {
      item.voteHashes.splice(existingIndex, 1);
      voted = false;
    } else {
      item.voteHashes.push(viewerHash);
      voted = true;
    }

    item.updatedAt = new Date().toISOString();
    return {
      voted,
      itemId,
    };
  }, `vote(poll): ${itemId}`);

  return getPollSnapshot({
    clientId: options && options.clientId,
    req: options && options.req,
    itemId: mutation.result.itemId,
    voted: mutation.result.voted,
  });
}

async function getPollSnapshot(options = {}) {
  const config = getPollConfig();
  const viewerHash = hashClientIdentity(options.clientId, options.req, config);
  const loaded = await loadStore(config);
  const snapshot = buildPublicSnapshot(loaded.store, viewerHash);

  if (options.itemId) {
    snapshot.item = snapshot.items.find((item) => item.id === options.itemId) || null;
  }

  if (typeof options.created === "boolean") {
    snapshot.created = options.created;
  }

  if (typeof options.merged === "boolean") {
    snapshot.merged = options.merged;
  }

  if (typeof options.voted === "boolean") {
    snapshot.voted = options.voted;
  }

  return snapshot;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Feature-Poll-Client-Id");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, status, payload) {
  setCorsHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendError(res, error, fallbackMessage) {
  const status = error && typeof error.status === "number" ? error.status : 500;
  const message =
    error && typeof error.message === "string" && error.message
      ? error.message
      : fallbackMessage || "Unexpected server error.";
  sendJson(res, status, { ok: false, error: message });
}

function handleCors(req, res) {
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

module.exports = {
  createSuggestion,
  getPollConfig,
  getPollSnapshot,
  handleCors,
  readJsonBody,
  sendError,
  sendJson,
  toggleVote,
};
