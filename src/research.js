"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { rootDir } = require("./config");

const ITUNES_BASE = "https://itunes.apple.com";

async function researchApp(query, options = {}) {
  const country = String(options.country || "cn").toLowerCase();
  const outRoot = path.resolve(rootDir, options.out || "research");
  const reviewPages = Number(options.reviewPages || 1);
  const trackId = options.id ? String(options.id) : null;

  let selected;
  let searchPayload = null;

  if (trackId) {
    selected = await lookupApp(trackId, country);
    if (!selected) {
      throw new Error(`No App Store app found for id=${trackId} country=${country}`);
    }
  } else {
    if (!query) throw new Error("Missing product name. Example: appstorectl research Goodnotes");
    searchPayload = await searchApps(query, country, Number(options.limit || 10));
    selected = pickSearchResult(searchPayload.results || [], query, options);
  }

  const folderName = buildFolderName(selected, country);
  const appDir = path.join(outRoot, folderName);
  fs.mkdirSync(path.join(appDir, "screenshots"), { recursive: true });

  const detail = (await lookupApp(selected.trackId, country)) || selected;
  const reviews = await fetchReviews(detail.trackId, country, reviewPages);

  const metadata = buildMetadata(detail, { country, query: query || null, fetchedAt: new Date().toISOString() });
  writeJson(path.join(appDir, "metadata.json"), metadata);
  writeText(path.join(appDir, "description.txt"), detail.description || "");
  writeText(path.join(appDir, "release-notes.txt"), detail.releaseNotes || "");
  writeJson(path.join(appDir, "reviews.json"), {
    country,
    trackId: detail.trackId,
    averageUserRating: detail.averageUserRating ?? null,
    userRatingCount: detail.userRatingCount ?? null,
    writtenReviewCount: reviews.length,
    reviews
  });
  writeText(path.join(appDir, "reviews.md"), formatReviewsMarkdown(reviews, detail));
  if (searchPayload) {
    writeJson(path.join(appDir, "search.json"), {
      query,
      country,
      resultCount: searchPayload.resultCount,
      results: (searchPayload.results || []).map(summarizeSearchHit)
    });
  }

  const assets = {
    icon: null,
    screenshots: []
  };

  if (detail.artworkUrl512 || detail.artworkUrl100) {
    const iconUrl = upgradeImageUrl(detail.artworkUrl512 || detail.artworkUrl100, 1024);
    assets.icon = await downloadAsset(iconUrl, path.join(appDir, "icon"));
  }

  const iphoneShots = detail.screenshotUrls || [];
  for (let i = 0; i < iphoneShots.length; i += 1) {
    const target = path.join(appDir, "screenshots", `iphone-${String(i + 1).padStart(2, "0")}`);
    const saved = await downloadAsset(upgradeImageUrl(iphoneShots[i], 1290), target);
    assets.screenshots.push({ type: "iphone", index: i + 1, ...saved });
  }

  const ipadShots = detail.ipadScreenshotUrls || [];
  for (let i = 0; i < ipadShots.length; i += 1) {
    const target = path.join(appDir, "screenshots", `ipad-${String(i + 1).padStart(2, "0")}`);
    const saved = await downloadAsset(upgradeImageUrl(ipadShots[i], 2048), target);
    assets.screenshots.push({ type: "ipad", index: i + 1, ...saved });
  }

  writeJson(path.join(appDir, "assets.json"), assets);
  writeText(path.join(appDir, "README.md"), formatReadme(metadata, reviews, assets));

  console.log(`Saved research pack -> ${appDir}`);
  console.log(`App: ${metadata.trackName} (${metadata.bundleId})`);
  console.log(`Rating: ${metadata.averageUserRating ?? "n/a"} / ${metadata.userRatingCount ?? 0} ratings`);
  console.log(`Reviews saved: ${reviews.length}`);
  console.log(`Screenshots: ${assets.screenshots.length}`);
  return { appDir, metadata, reviews, assets };
}

function pickSearchResult(results, query, options = {}) {
  if (!results.length) {
    throw new Error(`No App Store results for query="${query}" country=${options.country || "cn"}`);
  }

  const normalized = normalizeName(query);
  const exact = results.filter((item) => normalizeName(item.trackName) === normalized);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 && !options.yes) {
    printCandidates(exact, `Multiple exact matches for "${query}". Re-run with --id <trackId>.`);
    throw new Error("Ambiguous exact matches; pass --id to select one.");
  }
  if (exact.length > 1 && options.yes) return exact[0];

  if (results.length === 1) return results[0];
  if (options.yes) return results[0];

  printCandidates(results, `Multiple results for "${query}". Re-run with --id <trackId>, or --yes to take the first.`);
  throw new Error("Ambiguous search results; pass --id or --yes.");
}

function printCandidates(results, message) {
  console.log(message);
  for (const item of results) {
    console.log(
      `- ${item.trackId}\t${item.trackName}\t${item.bundleId || ""}\t${item.artistName || ""}\t${item.trackViewUrl || ""}`
    );
  }
}

async function searchApps(term, country, limit = 10) {
  const url =
    `${ITUNES_BASE}/search?term=${encodeURIComponent(term)}` +
    `&entity=software&country=${encodeURIComponent(country)}&limit=${encodeURIComponent(String(limit))}`;
  return itunesGet(url);
}

async function lookupApp(trackId, country) {
  const url =
    `${ITUNES_BASE}/lookup?id=${encodeURIComponent(String(trackId))}` +
    `&country=${encodeURIComponent(country)}`;
  const json = await itunesGet(url);
  return (json.results || [])[0] || null;
}

async function fetchReviews(trackId, country, pages = 1) {
  const maxPages = Math.max(1, Math.min(Number(pages) || 1, 10));
  const reviews = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages; page += 1) {
    const url =
      `${ITUNES_BASE}/${encodeURIComponent(country)}/rss/customerreviews` +
      `/page=${page}/id=${encodeURIComponent(String(trackId))}/sortby=mostrecent/json`;
    let json;
    try {
      json = await itunesGet(url);
    } catch (error) {
      if (page === 1) throw error;
      break;
    }
    const entries = json?.feed?.entry;
    const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
    let added = 0;
    for (const entry of list) {
      const parsed = parseReviewEntry(entry);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      reviews.push(parsed);
      added += 1;
    }
    if (added === 0) break;
  }

  return reviews;
}

function parseReviewEntry(entry) {
  if (!entry || !entry["im:rating"]) return null;
  return {
    id: labelOf(entry.id),
    author: labelOf(entry.author?.name),
    rating: Number(labelOf(entry["im:rating"]) || 0),
    title: labelOf(entry.title),
    content: labelOf(entry.content),
    version: labelOf(entry["im:version"]),
    updated: labelOf(entry.updated),
    voteSum: Number(labelOf(entry["im:voteSum"]) || 0),
    voteCount: Number(labelOf(entry["im:voteCount"]) || 0),
    link: entry.link?.attributes?.href || null
  };
}

function buildMetadata(detail, extra = {}) {
  return {
    ...extra,
    trackId: detail.trackId,
    trackName: detail.trackName,
    bundleId: detail.bundleId,
    artistName: detail.artistName,
    sellerName: detail.sellerName,
    version: detail.version,
    price: detail.price,
    formattedPrice: detail.formattedPrice,
    currency: detail.currency,
    averageUserRating: detail.averageUserRating ?? null,
    averageUserRatingForCurrentVersion: detail.averageUserRatingForCurrentVersion ?? null,
    userRatingCount: detail.userRatingCount ?? null,
    userRatingCountForCurrentVersion: detail.userRatingCountForCurrentVersion ?? null,
    primaryGenreName: detail.primaryGenreName,
    genres: detail.genres || [],
    contentAdvisoryRating: detail.contentAdvisoryRating,
    minimumOsVersion: detail.minimumOsVersion,
    fileSizeBytes: detail.fileSizeBytes,
    languageCodesISO2A: detail.languageCodesISO2A || [],
    releaseDate: detail.releaseDate,
    currentVersionReleaseDate: detail.currentVersionReleaseDate,
    trackViewUrl: detail.trackViewUrl,
    artistViewUrl: detail.artistViewUrl,
    sellerUrl: detail.sellerUrl || null,
    artworkUrl512: detail.artworkUrl512 || null,
    screenshotUrls: detail.screenshotUrls || [],
    ipadScreenshotUrls: detail.ipadScreenshotUrls || [],
    supportedDevices: detail.supportedDevices || [],
    advisories: detail.advisories || [],
    features: detail.features || []
  };
}

function summarizeSearchHit(item) {
  return {
    trackId: item.trackId,
    trackName: item.trackName,
    bundleId: item.bundleId,
    artistName: item.artistName,
    averageUserRating: item.averageUserRating ?? null,
    userRatingCount: item.userRatingCount ?? null,
    trackViewUrl: item.trackViewUrl
  };
}

function formatReviewsMarkdown(reviews, detail) {
  const lines = [
    `# Reviews — ${detail.trackName}`,
    "",
    `- Average rating: ${detail.averageUserRating ?? "n/a"}`,
    `- Rating count: ${detail.userRatingCount ?? 0}`,
    `- Written reviews saved: ${reviews.length}`,
    ""
  ];
  if (!reviews.length) {
    lines.push("_No written reviews returned by the public RSS feed._");
    return `${lines.join("\n")}\n`;
  }
  for (const review of reviews) {
    lines.push(`## ${review.rating}/5 — ${review.title || "(no title)"}`);
    lines.push("");
    lines.push(`- Author: ${review.author || "anonymous"}`);
    lines.push(`- Version: ${review.version || "n/a"}`);
    lines.push(`- Updated: ${review.updated || "n/a"}`);
    lines.push("");
    lines.push(review.content || "");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function formatReadme(metadata, reviews, assets) {
  return [
    `# ${metadata.trackName}`,
    "",
    `- Bundle ID: \`${metadata.bundleId}\``,
    `- Track ID: ${metadata.trackId}`,
    `- Developer: ${metadata.artistName || metadata.sellerName || "n/a"}`,
    `- Version: ${metadata.version}`,
    `- Country: ${metadata.country}`,
    `- Rating: ${metadata.averageUserRating ?? "n/a"} (${metadata.userRatingCount ?? 0} ratings)`,
    `- Written reviews: ${reviews.length}`,
    `- Store: ${metadata.trackViewUrl}`,
    "",
    "## Files",
    "",
    "- `metadata.json` — App Store metadata",
    "- `description.txt` — product description",
    "- `release-notes.txt` — current version notes",
    "- `reviews.json` / `reviews.md` — user reviews",
    `- \`icon${path.extname(assets.icon?.path || ".png")}\` — app icon`,
    "- `screenshots/` — iPhone/iPad screenshots",
    "- `assets.json` — downloaded asset manifest",
    ""
  ].join("\n");
}

async function downloadAsset(url, targetWithoutExt) {
  const response = await fetch(url, {
    headers: { "User-Agent": "appstore-upload-cli-research/0.1" }
  });
  if (!response.ok) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const ext = extensionFor(contentType, url);
  const filePath = `${targetWithoutExt}${ext}`;
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  return {
    url,
    path: path.relative(rootDir, filePath),
    bytes: buffer.length,
    contentType
  };
}

function extensionFor(contentType, url) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
  if (fromUrl === ".png" || fromUrl === ".jpg" || fromUrl === ".jpeg" || fromUrl === ".webp") {
    return fromUrl === ".jpeg" ? ".jpg" : fromUrl;
  }
  return ".img";
}

function upgradeImageUrl(url, size) {
  if (!url) return url;
  // iTunes thumb URLs often end with /320x480bb.jpg — bump to a larger square/long-edge size when possible.
  return url.replace(/\/\d+x\d+[a-z]*\.(jpg|jpeg|png|webp)(\?.*)?$/i, `/${size}x${size}bb.$1$2`);
}

async function itunesGet(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "appstore-upload-cli-research/0.1",
      Accept: "application/json,text/javascript,text/json"
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`iTunes API ${response.status} for ${url}\n${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse iTunes JSON for ${url}: ${error.message}`);
  }
}

function buildFolderName(app, country = "cn") {
  const slug = slugify(app.trackName || "app");
  const cc = slugify(String(country || "cn").toLowerCase()) || "cn";
  return `${slug}__${app.trackId}__${cc}`;
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fff\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "app";
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\w\u4e00-\u9fff]/g, "");
}

function labelOf(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && value.label != null) return String(value.label);
  return null;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, `${value || ""}${value && !String(value).endsWith("\n") ? "\n" : ""}`, "utf8");
}

module.exports = {
  researchApp,
  searchApps,
  lookupApp,
  fetchReviews
};
