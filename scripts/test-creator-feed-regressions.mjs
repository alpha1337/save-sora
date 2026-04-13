import assert from "node:assert/strict";

const CREATOR_PROFILE_FEED_LIMIT = 100;
const CREATOR_PROFILE_FEED_MIN_PAGE_CAP = 250;
const CREATOR_PROFILE_FEED_PAGE_BUFFER = 50;
const CREATOR_PROFILE_FEED_MAX_PAGE_CAP = 5000;

function pickFirstString(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return null;
}

function normalizeCreatorUsername(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/^@+/, "").replace(/\/+$/, "");
}

function getDownloadUrl(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const attachments = Array.isArray(value.attachments) ? value.attachments : [];
  const nested = [
    value.output,
    value.result,
    value.generation,
    value.draft,
    value.item,
    value.data,
    value.asset,
  ].filter(Boolean);

  return pickFirstString([
    value.downloadable_url,
    value.downloadUrl,
    value.raw_url,
    value.rawUrl,
    value.signed_url,
    value.signedUrl,
    value.media_url,
    value.mediaUrl,
    value.video_url,
    value.videoUrl,
    value.asset_url,
    value.assetUrl,
    value.source_url,
    value.sourceUrl,
    value.src,
    value.download_urls && value.download_urls.no_watermark,
    value.download_urls && value.download_urls.watermark,
    value.download_urls && value.download_urls.endcard_watermark,
    ...attachments.flatMap((attachment) => [
      attachment && attachment.downloadable_url,
      attachment && attachment.downloadUrl,
      attachment && attachment.raw_url,
      attachment && attachment.rawUrl,
      attachment && attachment.signed_url,
      attachment && attachment.signedUrl,
      attachment && attachment.media_url,
      attachment && attachment.mediaUrl,
      attachment && attachment.video_url,
      attachment && attachment.videoUrl,
      attachment && attachment.asset_url,
      attachment && attachment.assetUrl,
      attachment && attachment.source_url,
      attachment && attachment.sourceUrl,
      attachment && attachment.src,
      attachment && attachment.download_urls && attachment.download_urls.no_watermark,
      attachment && attachment.download_urls && attachment.download_urls.watermark,
    ]),
    ...nested.flatMap((candidate) => [
      candidate && candidate.downloadable_url,
      candidate && candidate.downloadUrl,
      candidate && candidate.raw_url,
      candidate && candidate.rawUrl,
      candidate && candidate.signed_url,
      candidate && candidate.signedUrl,
      candidate && candidate.media_url,
      candidate && candidate.mediaUrl,
      candidate && candidate.video_url,
      candidate && candidate.videoUrl,
      candidate && candidate.asset_url,
      candidate && candidate.assetUrl,
      candidate && candidate.source_url,
      candidate && candidate.sourceUrl,
      candidate && candidate.src,
      candidate && candidate.download_urls && candidate.download_urls.no_watermark,
      candidate && candidate.download_urls && candidate.download_urls.watermark,
      candidate && candidate.download_urls && candidate.download_urls.endcard_watermark,
    ]),
  ]);
}

function isDirectMediaUrl(value) {
  return typeof value === "string" && /(?:videos\.openai\.com|\/az\/files\/|\/drvs\/)/i.test(value);
}

function getDirectMediaUrl(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const nested = [
    value.output,
    value.result,
    value.generation,
    value.draft,
    value.item,
    value.data,
    value.asset,
  ].filter(Boolean);
  const candidates = [
    value.url,
    value.raw_url,
    value.rawUrl,
    value.signed_url,
    value.signedUrl,
    value.media_url,
    value.mediaUrl,
    value.video_url,
    value.videoUrl,
    value.asset_url,
    value.assetUrl,
    value.source_url,
    value.sourceUrl,
    value.src,
    value.encodings && value.encodings.md && value.encodings.md.path,
    value.encodings && value.encodings.source && value.encodings.source.path,
    value.encodings && value.encodings.ld && value.encodings.ld.path,
    ...nested.flatMap((candidate) => [
      candidate && candidate.url,
      candidate && candidate.raw_url,
      candidate && candidate.rawUrl,
      candidate && candidate.signed_url,
      candidate && candidate.signedUrl,
      candidate && candidate.media_url,
      candidate && candidate.mediaUrl,
      candidate && candidate.video_url,
      candidate && candidate.videoUrl,
      candidate && candidate.asset_url,
      candidate && candidate.assetUrl,
      candidate && candidate.source_url,
      candidate && candidate.sourceUrl,
      candidate && candidate.src,
      candidate && candidate.encodings && candidate.encodings.md && candidate.encodings.md.path,
      candidate && candidate.encodings && candidate.encodings.source && candidate.encodings.source.path,
      candidate && candidate.encodings && candidate.encodings.ld && candidate.encodings.ld.path,
    ]),
  ];

  return candidates.find((candidate) => isDirectMediaUrl(candidate)) || null;
}

function getPostCandidates(row) {
  if (!row || typeof row !== "object") {
    return [];
  }

  return [
    row.post,
    row.item,
    row.data,
    row.output,
    row.result,
    row.generation,
    row.asset,
    row.entry,
    row.content,
    row.payload,
    row.object,
    row.target,
    row.entity,
    row.node,
    row.card,
    row,
  ].filter((candidate) => candidate && typeof candidate === "object");
}

function extractPostIdFromUrl(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  for (const pattern of [/\/p\/([^/?#]+)/i, /\/d\/([^/?#]+)/i]) {
    const match = value.match(pattern);
    if (match && typeof match[1] === "string" && match[1]) {
      return match[1];
    }
  }

  return "";
}

function getPostId(value) {
  return (
    pickFirstString([
      value && value.post_id,
      value && value.postId,
      value && value.public_id,
      value && value.publicId,
      value && value.share_id,
      value && value.shareId,
      extractPostIdFromUrl(value && value.permalink),
      extractPostIdFromUrl(value && value.detail_url),
      extractPostIdFromUrl(value && value.public_url),
      extractPostIdFromUrl(value && value.publicUrl),
      extractPostIdFromUrl(value && value.detailUrl),
      extractPostIdFromUrl(value && value.url),
      value && value.id,
      value && value.generation_id,
      value && value.generationId,
      value && value.task_id,
      value && value.taskId,
      value && value.asset_id,
      value && value.assetId,
      value && value.item_id,
      value && value.itemId,
    ]) || ""
  );
}

function getPostAttachments(value) {
  if (!value || typeof value !== "object") {
    return [];
  }

  const attachments = [];

  function appendEntries(source) {
    if (!source || typeof source !== "object") {
      return;
    }

    const attachmentArrays = [
      source.attachments,
      source.outputs,
      source.media,
      source.assets,
      source.files,
      source.videos,
      source.entries,
      source.nodes,
      source.clips,
      source.results,
    ];

    for (const array of attachmentArrays) {
      if (!Array.isArray(array)) {
        continue;
      }

      for (const entry of array) {
        if (entry && typeof entry === "object") {
          attachments.push(entry);
        }
      }
    }

    for (const entry of [
      source.attachment,
      source.output,
      source.result,
      source.generation,
      source.asset,
      source.file,
      source.video,
      source.entry,
      source.content,
      source.payload,
      source.object,
      source.target,
      source.entity,
      source.node,
      source.card,
    ]) {
      if (entry && typeof entry === "object") {
        attachments.push(entry);
      }
    }
  }

  appendEntries(value);
  for (const candidate of getPostCandidates(value)) {
    appendEntries(candidate);
  }

  const dedupedAttachments = [];
  const seenAttachmentKeys = new Set();

  for (const attachment of attachments) {
    const attachmentKey =
      pickFirstString([
        attachment && attachment.id,
        attachment && attachment.generation_id,
        attachment && attachment.generationId,
        attachment && attachment.task_id,
        attachment && attachment.taskId,
        getDownloadUrl(attachment),
        getDirectMediaUrl(attachment),
        attachment && attachment.url,
        attachment && attachment.path,
      ]) || null;

    if (attachmentKey) {
      if (seenAttachmentKeys.has(attachmentKey)) {
        continue;
      }

      seenAttachmentKeys.add(attachmentKey);
    }

    dedupedAttachments.push(attachment);
  }

  return dedupedAttachments;
}

function classifyCreatorFeedItem(row, post, config = {}) {
  const targetUserId =
    config && typeof config.creatorUserId === "string" && config.creatorUserId
      ? config.creatorUserId
      : "";
  const targetUsername = normalizeCreatorUsername(
    config && typeof config.creatorUsername === "string" ? config.creatorUsername : "",
  );
  const ownerUserId = pickFirstString([
    row && row.user_id,
    row && row.userId,
    row && row.owner_profile && row.owner_profile.user_id,
    post && post.user_id,
    post && post.userId,
    post && post.owner_profile && post.owner_profile.user_id,
  ]);
  const ownerUsername = normalizeCreatorUsername(
    pickFirstString([
      row && row.username,
      row && row.user_name,
      post && post.username,
      post && post.user_name,
    ]),
  );

  if (
    (targetUserId && ownerUserId === targetUserId) ||
    (targetUsername && ownerUsername && ownerUsername === targetUsername)
  ) {
    return { sourcePage: "creatorPublished", sourceLabel: "Creator Post" };
  }

  const hintValues = [
    row && row.kind,
    row && row.relationship,
    row && row.relationship_type,
    post && post.kind,
    post && post.relationship,
    post && post.relationship_type,
  ]
    .filter((value) => typeof value === "string" && value)
    .map((value) => value.toLowerCase());

  if (hintValues.some((value) => /cast|appearance|cameo/.test(value))) {
    return { sourcePage: "creatorCameos", sourceLabel: "Creator Cast In" };
  }

  return { sourcePage: "creatorPublished", sourceLabel: "Creator Post" };
}

function getCreatorFeedItemKey(item) {
  return [
    item && typeof item.id === "string" ? item.id : "",
    item && typeof item.downloadUrl === "string" && item.downloadUrl
      ? item.downloadUrl
      : item && typeof item.detailUrl === "string" && item.detailUrl
        ? item.detailUrl
        : `attachment:${Number.isInteger(item && item.attachmentIndex) ? item.attachmentIndex : 0}`,
  ].join("|");
}

function getCreatorProfileExpectedPostCount(profile) {
  const profileData =
    profile && profile.profileData && typeof profile.profileData === "object"
      ? profile.profileData
      : null;
  const candidates = [
    profileData && profileData.post_count,
    profileData && profileData.postCount,
    profileData && profileData.posts_count,
    profileData && profileData.postsCount,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.floor(candidate);
    }
  }

  return 0;
}

function getCreatorFeedPageCap(creatorProfile) {
  const expectedCount = getCreatorProfileExpectedPostCount(creatorProfile);
  if (!expectedCount) {
    return CREATOR_PROFILE_FEED_MIN_PAGE_CAP;
  }

  const expectedPages =
    Math.ceil(expectedCount / Math.max(1, CREATOR_PROFILE_FEED_LIMIT)) +
    CREATOR_PROFILE_FEED_PAGE_BUFFER;

  return Math.min(
    CREATOR_PROFILE_FEED_MAX_PAGE_CAP,
    Math.max(CREATOR_PROFILE_FEED_MIN_PAGE_CAP, expectedPages),
  );
}

function decodeEmbeddedText(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&quot;/gi, "\"")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function extractPostMediaCandidatesFromHtml(html) {
  const decodedHtml = decodeEmbeddedText(html);
  if (!decodedHtml) {
    return {
      mediaUrls: [],
      thumbnailUrl: null,
    };
  }

  const matchedUrls = decodedHtml.match(/https:\/\/videos\.openai\.com\/[^"'`\s<\\)]+/gi) || [];
  const uniqueUrls = [...new Set(matchedUrls)];
  const mediaUrls = uniqueUrls.filter(
    (url) =>
      !/thumbnail/i.test(url) &&
      (/(?:\/drvs\/(?:md|hd|ld|source)\/raw)/i.test(url) ||
        /(?:\/raw(?:[?#]|$))/i.test(url) ||
        /\.mp4(?:[?#]|$)/i.test(url)),
  );
  const thumbnailUrl =
    uniqueUrls.find((url) => /thumbnail/i.test(url)) ||
    uniqueUrls.find((url) => /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) ||
    null;

  return {
    mediaUrls,
    thumbnailUrl,
  };
}

function testSiblingRowMediaFallback() {
  const row = {
    post: { id: "post-1", permalink: "https://sora.chatgpt.com/p/post-1" },
    output: {
      downloadable_url: "https://videos.openai.com/az/files/post-1/raw.mp4",
    },
  };

  const attachments = getPostAttachments(row).filter(
    (attachment) => getDownloadUrl(attachment) || getDirectMediaUrl(attachment),
  );
  assert.equal(attachments.length, 1);
  assert.equal(getDownloadUrl(attachments[0]), "https://videos.openai.com/az/files/post-1/raw.mp4");
}

function testAttachmentDedupesWithinRow() {
  const row = {
    post: {
      id: "post-2",
      attachments: [
        { id: "asset-1", downloadable_url: "https://videos.openai.com/az/files/post-2/raw.mp4" },
      ],
    },
    output: {
      id: "asset-1",
      downloadable_url: "https://videos.openai.com/az/files/post-2/raw.mp4",
    },
  };

  const attachments = getPostAttachments(row).filter(
    (attachment) => getDownloadUrl(attachment) || getDirectMediaUrl(attachment),
  );
  assert.equal(attachments.length, 1);
}

function testOwnedRowsStayInPostsBucket() {
  const row = {
    relationship_type: "cameo",
    owner_profile: { user_id: "user-creator-1" },
  };
  const post = { id: "post-3" };

  assert.deepEqual(
    classifyCreatorFeedItem(row, post, { creatorUserId: "user-creator-1", creatorUsername: "creator.alt" }),
    { sourcePage: "creatorPublished", sourceLabel: "Creator Post" },
  );
}

function testCreatorFeedItemKeyIgnoresAttachmentIndexWhenUrlMatches() {
  const first = {
    id: "post-4",
    attachmentIndex: 0,
    downloadUrl: "https://videos.openai.com/az/files/post-4/raw.mp4",
    detailUrl: "https://sora.chatgpt.com/p/post-4",
  };
  const second = {
    id: "post-4",
    attachmentIndex: 1,
    downloadUrl: "https://videos.openai.com/az/files/post-4/raw.mp4",
    detailUrl: "https://sora.chatgpt.com/p/post-4",
  };

  assert.equal(getCreatorFeedItemKey(first), getCreatorFeedItemKey(second));
}

function testPostIdSupportsGenerationIdsAndPermalinks() {
  assert.equal(
    getPostId({
      generation_id: "gen-123",
      permalink: "https://sora.chatgpt.com/p/s_abc123",
    }),
    "s_abc123",
  );

  assert.equal(
    getPostId({
      public_url: "https://sora.chatgpt.com/p/s_abc123",
    }),
    "s_abc123",
  );
}

function testCreatorFeedPageCapScalesPastTwoThousandCeiling() {
  const pageCap = getCreatorFeedPageCap({
    profileData: {
      post_count: 3018,
    },
  });

  assert.equal(pageCap, 250);
  assert.ok(pageCap >= 250);
}

function testCreatorFeedBatchSizeUsesHundredItemPages() {
  assert.equal(CREATOR_PROFILE_FEED_LIMIT, 100);
}

function testDownloadUrlSupportsSignedMediaShapes() {
  assert.equal(
    getDownloadUrl({
      video_url: "https://videos.openai.com/az/files/post-5/raw.mp4",
    }),
    "https://videos.openai.com/az/files/post-5/raw.mp4",
  );

  assert.equal(
    getDirectMediaUrl({
      signedUrl: "https://videos.openai.com/az/files/post-5/raw.mp4",
    }),
    "https://videos.openai.com/az/files/post-5/raw.mp4",
  );
}

function testPayloadRowsCountAsPostCandidates() {
  const row = {
    payload: {
      permalink: "https://sora.chatgpt.com/p/s_payload123",
      clips: [
        {
          mediaUrl: "https://videos.openai.com/az/files/post-6/raw.mp4",
        },
      ],
    },
  };

  const post = getPostCandidates(row).find((candidate) => getPostId(candidate));
  assert.equal(getPostId(post), "s_payload123");

  const attachments = getPostAttachments(row).filter(
    (attachment) => getDownloadUrl(attachment) || getDirectMediaUrl(attachment),
  );
  assert.equal(attachments.length, 1);
}

function testHtmlMediaExtractionFindsDetailFallbackUrls() {
  const html = `
    <script id="__NEXT_DATA__" type="application/json">
      {"download":"https:\\/\\/videos.openai.com\\/az\\/files\\/post-7\\/raw.mp4","thumbnail":"https:\\/\\/videos.openai.com\\/az\\/files\\/post-7\\/drvs\\/thumbnail\\/raw"}
    </script>
  `;

  const extracted = extractPostMediaCandidatesFromHtml(html);
  assert.deepEqual(extracted.mediaUrls, [
    "https://videos.openai.com/az/files/post-7/raw.mp4",
  ]);
  assert.equal(
    extracted.thumbnailUrl,
    "https://videos.openai.com/az/files/post-7/drvs/thumbnail/raw",
  );
}

testSiblingRowMediaFallback();
testAttachmentDedupesWithinRow();
testOwnedRowsStayInPostsBucket();
testCreatorFeedItemKeyIgnoresAttachmentIndexWhenUrlMatches();
testPostIdSupportsGenerationIdsAndPermalinks();
testCreatorFeedPageCapScalesPastTwoThousandCeiling();
testCreatorFeedBatchSizeUsesHundredItemPages();
testDownloadUrlSupportsSignedMediaShapes();
testPayloadRowsCountAsPostCandidates();
testHtmlMediaExtractionFindsDetailFallbackUrls();

console.log("Creator feed regression checks passed.");
