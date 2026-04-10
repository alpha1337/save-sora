/**
 * Archive ZIP debug helpers.
 *
 * This module owns the in-memory debug registry used by the ZIP/archive flow.
 * It does not own archive execution, download execution, or UI rendering.
 * Consumers can import these helpers to read, mutate, or serialize archive debug jobs.
 */

const DEFAULT_DEBUG_KEY = "__SAVE_SORA_ZIP_DEBUG__";

/**
 * Ensures a plain object exists on the provided global object for archive debug state.
 *
 * @param {object} [globalObject=globalThis] Global host object that stores the debug registry.
 * @param {string} [debugKey=DEFAULT_DEBUG_KEY] Property name used to store the registry.
 * @returns {{activeJobId: string, jobs: Array<object>}} The shared archive debug root.
 */
export function getArchiveDebugRoot(globalObject = globalThis, debugKey = DEFAULT_DEBUG_KEY) {
  const host = globalObject && typeof globalObject === "object" ? globalObject : globalThis;

  if (!host[debugKey] || typeof host[debugKey] !== "object") {
    host[debugKey] = {
      activeJobId: "",
      jobs: [],
    };
  }

  return host[debugKey];
}

/**
 * Finds the debug job for a given archive job ID.
 *
 * @param {string} jobId Archive job identifier.
 * @param {object} [globalObject=globalThis] Global host object that stores the debug registry.
 * @param {string} [debugKey=DEFAULT_DEBUG_KEY] Property name used to store the registry.
 * @returns {object|null} The matching debug job, or null if none exists.
 */
export function getArchiveDebugJob(jobId, globalObject = globalThis, debugKey = DEFAULT_DEBUG_KEY) {
  if (typeof jobId !== "string" || !jobId) {
    return null;
  }

  const debugRoot = getArchiveDebugRoot(globalObject, debugKey);
  return Array.isArray(debugRoot.jobs)
    ? debugRoot.jobs.find((job) => job && job.jobId === jobId) || null
    : null;
}

/**
 * Creates or returns the active archive debug job.
 *
 * @param {{jobId: string}} job Archive job descriptor.
 * @param {object} [options] Job metadata used when creating a new debug record.
 * @param {string} [options.archiveFilename=""] Archive output filename.
 * @param {number} [options.totalItems=0] Number of items being archived.
 * @param {object} [globalObject=globalThis] Global host object that stores the debug registry.
 * @param {string} [debugKey=DEFAULT_DEBUG_KEY] Property name used to store the registry.
 * @param {number} [maxJobs=50] Maximum number of archive jobs to retain.
 * @returns {object|null} The created or found debug job, or null when the job is invalid.
 */
export function ensureArchiveDebugJob(
  job,
  options = {},
  globalObject = globalThis,
  debugKey = DEFAULT_DEBUG_KEY,
  maxJobs = 50,
) {
  if (!job || typeof job.jobId !== "string" || !job.jobId) {
    return null;
  }

  const debugRoot = getArchiveDebugRoot(globalObject, debugKey);
  if (!Array.isArray(debugRoot.jobs)) {
    debugRoot.jobs = [];
  }

  let debugJob = getArchiveDebugJob(job.jobId, globalObject, debugKey);
  if (!debugJob) {
    debugJob = {
      jobId: job.jobId,
      archiveFilename: typeof options.archiveFilename === "string" && options.archiveFilename ? options.archiveFilename : "",
      totalItems: Number(options.totalItems) || 0,
      startedAt: new Date().toISOString(),
      completedAt: "",
      status: "running",
      itemResults: [],
      events: [],
    };
    debugRoot.jobs.unshift(debugJob);
    if (Number.isFinite(maxJobs) && maxJobs > 0 && debugRoot.jobs.length > maxJobs) {
      debugRoot.jobs.length = maxJobs;
    }
  }

  debugRoot.activeJobId = job.jobId;
  return debugJob;
}

/**
 * Appends an archive debug event to the active debug job.
 *
 * @param {string} jobId Archive job identifier.
 * @param {string} type Event type label.
 * @param {object} [payload={}] Event payload.
 * @param {object} [globalObject=globalThis] Global host object that stores the debug registry.
 * @param {string} [debugKey=DEFAULT_DEBUG_KEY] Property name used to store the registry.
 * @param {number} [maxJobs=50] Maximum number of archive jobs to retain.
 * @param {number} [maxEvents=200] Maximum number of events to retain per job.
 * @returns {object|null} The updated debug job, or null when the job is invalid.
 */
export function pushArchiveDebugEvent(
  jobId,
  type,
  payload = {},
  globalObject = globalThis,
  debugKey = DEFAULT_DEBUG_KEY,
  maxJobs = 50,
  maxEvents = 200,
) {
  const debugJob = ensureArchiveDebugJob({ jobId }, {}, globalObject, debugKey, maxJobs);
  if (!debugJob) {
    return null;
  }

  if (!Array.isArray(debugJob.events)) {
    debugJob.events = [];
  }

  debugJob.events.push({
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  });
  if (Number.isFinite(maxEvents) && maxEvents > 0 && debugJob.events.length > maxEvents) {
    debugJob.events.splice(0, debugJob.events.length - maxEvents);
  }

  return debugJob;
}

/**
 * Marks an archive debug job complete and applies the provided patch.
 *
 * @param {string} jobId Archive job identifier.
 * @param {object} [patch={}] Final fields to merge into the debug job.
 * @param {object} [globalObject=globalThis] Global host object that stores the debug registry.
 * @param {string} [debugKey=DEFAULT_DEBUG_KEY] Property name used to store the registry.
 * @param {number} [maxJobs=50] Maximum number of archive jobs to retain.
 * @returns {object|null} The updated debug job, or null when the job is invalid.
 */
export function finalizeArchiveDebugJob(
  jobId,
  patch = {},
  globalObject = globalThis,
  debugKey = DEFAULT_DEBUG_KEY,
  maxJobs = 50,
) {
  const debugJob = ensureArchiveDebugJob({ jobId }, {}, globalObject, debugKey, maxJobs);
  if (!debugJob) {
    return null;
  }

  Object.assign(debugJob, patch, {
    completedAt: new Date().toISOString(),
  });
  return debugJob;
}

/**
 * Normalizes the archive debug payload for event logging and serialization.
 *
 * @param {object} [details={}] Raw archive detail object.
 * @returns {{
 *   itemKey: string,
 *   id: string,
 *   filename: string,
 *   archivePath: string,
 *   sourcePage: string,
 *   downloadUrl: string,
 *   attempts: Array<{
 *     attempt: number,
 *     downloadUrl: string,
 *     finalUrl: string,
 *     status: number|null,
 *     statusText: string,
 *     contentType: string,
 *     refreshed: boolean,
 *     refreshedDownloadUrl: string,
 *     error: string,
 *   }>,
 * }} Normalized archive payload.
 */
export function createArchiveDebugPayload(details = {}) {
  return {
    itemKey: typeof details.itemKey === "string" ? details.itemKey : "",
    id: typeof details.id === "string" ? details.id : "",
    filename: typeof details.filename === "string" ? details.filename : "",
    archivePath: typeof details.archivePath === "string" ? details.archivePath : "",
    sourcePage: typeof details.sourcePage === "string" ? details.sourcePage : "",
    downloadUrl: typeof details.downloadUrl === "string" ? details.downloadUrl : "",
    attempts: Array.isArray(details.attempts)
      ? details.attempts.map((attempt) => ({
          attempt: Number(attempt && attempt.attempt) || 0,
          downloadUrl: typeof attempt?.downloadUrl === "string" ? attempt.downloadUrl : "",
          finalUrl: typeof attempt?.finalUrl === "string" ? attempt.finalUrl : "",
          status: Number.isFinite(Number(attempt?.status)) ? Number(attempt.status) : null,
          statusText: typeof attempt?.statusText === "string" ? attempt.statusText : "",
          contentType: typeof attempt?.contentType === "string" ? attempt.contentType : "",
          refreshed: attempt?.refreshed === true,
          refreshedDownloadUrl:
            typeof attempt?.refreshedDownloadUrl === "string" ? attempt.refreshedDownloadUrl : "",
          error: typeof attempt?.error === "string" ? attempt.error : "",
        }))
      : [],
  };
}

