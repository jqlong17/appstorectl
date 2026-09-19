"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ascRequest, findApp, findOrCreateVersion, getAll } = require("./asc-api");
const { resolveFromRoot } = require("./config");

async function uploadScreenshots(config, options = {}) {
  const app = await findApp(config, options);
  const version = await findOrCreateVersion(config, app.id, options);
  const localizations = await getAll(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`, options);
  const locale = config.app.primaryLocale || "zh-Hans";
  const localization = localizations.find((item) => item.attributes?.locale === locale) || localizations[0];
  if (!localization && !options.dryRun) throw new Error(`No App Store version localization found for ${locale}`);

  const root = resolveFromRoot(config.screenshots?.directory);
  if (!root || !fs.existsSync(root)) throw new Error(`Screenshots directory not found: ${root || "(empty)"}`);
  const displayDirs = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (displayDirs.length === 0) throw new Error(`No screenshot display directories found under ${root}`);

  for (const dirent of displayDirs) {
    const displayType = dirent.name;
    const files = fs.readdirSync(path.join(root, displayType))
      .filter((name) => /\.(png|jpg|jpeg)$/i.test(name))
      .sort()
      .map((name) => path.join(root, displayType, name));
    if (files.length === 0) continue;

    const setId = await getOrCreateScreenshotSet(localization.id, displayType, options);
    console.log(`Screenshot set: ${displayType} -> ${setId}`);
    if (options.replace) {
      await deleteExistingScreenshots(setId, options);
    }
    for (const file of files) {
      const result = await uploadScreenshot(setId, file, options);
      console.log(`Uploaded ${path.basename(file)} -> ${result.state}`);
    }
  }
}

async function getOrCreateScreenshotSet(localizationId, displayType, options) {
  const existing = await getAll(`/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?limit=50`, options);
  const match = existing.find((set) => set.attributes?.screenshotDisplayType === displayType);
  if (match) return match.id;
  const created = await ascRequest("POST", "/v1/appScreenshotSets", {
    data: {
      type: "appScreenshotSets",
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localizationId } }
      }
    }
  }, options);
  return created.data.id;
}

async function deleteExistingScreenshots(setId, options) {
  const existing = await getAll(`/v1/appScreenshotSets/${setId}/appScreenshots?limit=50`, options);
  for (const shot of existing) {
    await ascRequest("DELETE", `/v1/appScreenshots/${shot.id}`, null, options);
    console.log(`Deleted screenshot ${shot.attributes?.fileName || shot.id}`);
  }
}

async function uploadScreenshot(setId, file, options) {
  const bytes = fs.readFileSync(file);
  const created = await ascRequest("POST", "/v1/appScreenshots", {
    data: {
      type: "appScreenshots",
      attributes: { fileName: path.basename(file), fileSize: bytes.length },
      relationships: {
        appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } }
      }
    }
  }, options);
  if (options.dryRun) return { state: "dry-run" };

  const id = created.data.id;
  for (const op of created.data.attributes.uploadOperations || []) {
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const headers = Object.fromEntries((op.requestHeaders || []).map((header) => [header.name, header.value]));
    const response = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!response.ok) throw new Error(`${path.basename(file)} upload failed: ${response.status} ${await response.text()}`);
  }

  const checksum = crypto.createHash("md5").update(bytes).digest("hex");
  const committed = await ascRequest("PATCH", `/v1/appScreenshots/${id}`, {
    data: { type: "appScreenshots", id, attributes: { sourceFileChecksum: checksum, uploaded: true } }
  }, options);
  return { state: committed.data.attributes.assetDeliveryState?.state };
}

module.exports = {
  uploadScreenshots
};
