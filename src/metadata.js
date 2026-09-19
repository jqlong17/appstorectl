"use strict";

const path = require("node:path");
const { ascRequest, findApp, findOrCreateVersion, getAll, getFirstRelated } = require("./asc-api");
const { listMetadataFiles, readJson } = require("./config");

async function syncMetadata(config, options = {}) {
  const metadataFiles = listMetadataFiles(config);
  if (metadataFiles.length === 0) {
    throw new Error(`No metadata JSON files found in ${config.metadata?.directory}`);
  }

  const app = await findApp(config, options);
  console.log(`App: ${config.app.name} (${config.app.bundleId}) -> ${app.id}`);

  const version = await findOrCreateVersion(config, app.id, options);
  console.log(`Version: ${config.appStore.version} -> ${version.id}`);

  const appInfo = await getFirstRelated("apps", app.id, "appInfos", options);
  if (!appInfo && !options.dryRun) {
    console.warn("No appInfo found. Privacy URL sync may require the app to be fully created in App Store Connect first.");
  }

  const versionLocalizations = await getAll(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`, options);
  const appInfoLocalizations = appInfo
    ? await getAll(`/v1/appInfos/${appInfo.id}/appInfoLocalizations?limit=200`, options)
    : [];

  for (const file of metadataFiles) {
    const locale = path.basename(file, ".json");
    const metadata = readJson(file);
    console.log(`Sync locale: ${locale}`);
    await upsertVersionLocalization(version.id, versionLocalizations, locale, metadata, options);
    if (appInfo || options.dryRun) {
      await upsertAppInfoLocalization(appInfo?.id || "(dry-run-app-info-id)", appInfoLocalizations, locale, metadata, options);
    }
  }
}

async function submitForReview(config, options = {}) {
  const app = await findApp(config, options);
  const version = await findOrCreateVersion(config, app.id, options);
  const platform = config.app?.platform || "IOS";

  // Apple retired CREATE on appStoreVersionSubmissions; use the 3-step reviewSubmissions flow.
  const createBody = {
    data: {
      type: "reviewSubmissions",
      attributes: { platform },
      relationships: {
        app: {
          data: { type: "apps", id: app.id }
        }
      }
    }
  };

  if (!options.yes) {
    console.log("Refusing to submit without --yes. Dry-run request:");
    console.log("1) Create reviewSubmission");
    await ascRequest("POST", "/v1/reviewSubmissions", createBody, { ...options, dryRun: true });
    console.log("2) Add appStoreVersion as reviewSubmissionItem");
    await ascRequest("POST", "/v1/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: "(dry-run-submission-id)" } },
          appStoreVersion: { data: { type: "appStoreVersions", id: version.id } }
        }
      }
    }, { ...options, dryRun: true });
    console.log("3) PATCH reviewSubmission submitted=true");
    await ascRequest("PATCH", "/v1/reviewSubmissions/(dry-run-submission-id)", {
      data: {
        type: "reviewSubmissions",
        id: "(dry-run-submission-id)",
        attributes: { submitted: true }
      }
    }, { ...options, dryRun: true });
    return;
  }

  await ensureBuildExportCompliance(version.id, options);

  let submission = await findOpenReviewSubmission(app.id, platform, options);
  if (!submission) {
    const created = await ascRequest("POST", "/v1/reviewSubmissions", createBody, options);
    submission = created.data;
    console.log(`Created reviewSubmission: ${submission.id}`);
  } else {
    console.log(`Reusing open reviewSubmission: ${submission.id} (${submission.attributes?.state})`);
  }

  const items = await getAll(`/v1/reviewSubmissions/${submission.id}/items?limit=50`, options);
  const alreadyHasVersion = items.some((item) => item.relationships?.appStoreVersion?.data?.id === version.id);
  if (!alreadyHasVersion) {
    await ascRequest("POST", "/v1/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
          appStoreVersion: { data: { type: "appStoreVersions", id: version.id } }
        }
      }
    }, options);
    console.log(`Added appStoreVersion ${version.id} (${config.appStore.version}) to submission.`);
  } else {
    console.log(`Version ${config.appStore.version} already on submission.`);
  }

  const submitted = await ascRequest("PATCH", `/v1/reviewSubmissions/${submission.id}`, {
    data: {
      type: "reviewSubmissions",
      id: submission.id,
      attributes: { submitted: true }
    }
  }, options);
  console.log(`Submitted for review. state=${submitted.data?.attributes?.state || "unknown"} id=${submission.id}`);
}

async function findOpenReviewSubmission(appId, platform, options = {}) {
  const submissions = await getAll(
    `/v1/apps/${appId}/reviewSubmissions?filter[platform]=${encodeURIComponent(platform)}&limit=50`,
    options
  );
  return submissions.find((item) => {
    const state = item.attributes?.state;
    return state && state !== "COMPLETE" && !state.startsWith("UNRESOLVED");
  }) || null;
}

async function ensureBuildExportCompliance(versionId, options = {}) {
  const versionFull = await ascRequest(
    "GET",
    `/v1/appStoreVersions/${versionId}?include=build`,
    null,
    options
  );
  const buildRef = versionFull.data?.relationships?.build?.data;
  if (!buildRef?.id) {
    throw new Error(`Version ${versionId} has no build attached; attach a VALID build before submit.`);
  }
  if (options.dryRun) {
    console.log(`[dry-run] ensure usesNonExemptEncryption on build ${buildRef.id}`);
    return;
  }
  const build = await ascRequest("GET", `/v1/builds/${buildRef.id}`, null, options);
  if (build.data?.attributes?.usesNonExemptEncryption !== null
    && build.data?.attributes?.usesNonExemptEncryption !== undefined) {
    console.log(`Build ${buildRef.id} usesNonExemptEncryption=${build.data.attributes.usesNonExemptEncryption}`);
    return;
  }
  // MusicPocket / typical apps only use exempt encryption (HTTPS/TLS). Override per-app if needed later.
  await ascRequest("PATCH", `/v1/builds/${buildRef.id}`, {
    data: {
      type: "builds",
      id: buildRef.id,
      attributes: { usesNonExemptEncryption: false }
    }
  }, options);
  console.log(`Set build ${buildRef.id} usesNonExemptEncryption=false`);
}

async function upsertVersionLocalization(versionId, existing, locale, metadata, options) {
  const match = existing.find((item) => item.attributes?.locale === locale);
  const attributes = pickDefined({
    locale,
    description: metadata.description,
    keywords: metadata.keywords,
    marketingUrl: metadata.marketingUrl,
    promotionalText: metadata.promotionalText,
    supportUrl: metadata.supportUrl,
    whatsNew: metadata.whatsNew
  });

  if (match) {
    const patchAttributes = { ...attributes };
    delete patchAttributes.locale;
    const body = {
      data: { type: "appStoreVersionLocalizations", id: match.id, attributes: patchAttributes }
    };
    try {
      await ascRequest("PATCH", `/v1/appStoreVersionLocalizations/${match.id}`, body, options);
    } catch (error) {
      if (!patchAttributes.whatsNew || !String(error.message).includes("whatsNew")) throw error;
      console.warn(`Skipping whatsNew for ${locale}; App Store Connect says it is not editable right now.`);
      const retryAttributes = { ...patchAttributes };
      delete retryAttributes.whatsNew;
      await ascRequest("PATCH", `/v1/appStoreVersionLocalizations/${match.id}`, {
        data: { type: "appStoreVersionLocalizations", id: match.id, attributes: retryAttributes }
      }, options);
    }
    return;
  }

  await ascRequest("POST", "/v1/appStoreVersionLocalizations", {
    data: {
      type: "appStoreVersionLocalizations",
      attributes,
      relationships: {
        appStoreVersion: {
          data: { type: "appStoreVersions", id: versionId }
        }
      }
    }
  }, options);
}

async function upsertAppInfoLocalization(appInfoId, existing, locale, metadata, options) {
  const match = existing.find((item) => item.attributes?.locale === locale);
  const attributes = pickDefined({
    locale,
    name: metadata.name,
    subtitle: metadata.subtitle,
    privacyPolicyUrl: metadata.privacyPolicyUrl
  });

  if (Object.keys(attributes).length <= 1) return;

  if (match) {
    const patchAttributes = { ...attributes };
    delete patchAttributes.locale;
    try {
      await ascRequest("PATCH", `/v1/appInfoLocalizations/${match.id}`, {
        data: { type: "appInfoLocalizations", id: match.id, attributes: patchAttributes }
      }, options);
    } catch (error) {
      if (String(error.message).includes("409") || String(error.message).includes("INVALID_STATE")) {
        console.warn(`Skipping appInfoLocalization update for ${locale} (locked after release): ${error.message.split("\n")[0]}`);
        return;
      }
      throw error;
    }
    return;
  }

  try {
    await ascRequest("POST", "/v1/appInfoLocalizations", {
      data: {
        type: "appInfoLocalizations",
        attributes,
        relationships: {
          appInfo: {
            data: { type: "appInfos", id: appInfoId }
          }
        }
      }
    }, options);
  } catch (error) {
    const message = String(error.message);
    if (message.includes("409") || message.includes("DUPLICATE")) {
      const all = await getAll(`/v1/appInfos/${appInfoId}/appInfoLocalizations?limit=200`, options);
      const duplicate = all.find((item) => item.attributes?.locale === locale);
      if (duplicate) {
        const patchAttributes = { ...attributes };
        delete patchAttributes.locale;
        await ascRequest("PATCH", `/v1/appInfoLocalizations/${duplicate.id}`, {
          data: { type: "appInfoLocalizations", id: duplicate.id, attributes: patchAttributes }
        }, options);
        console.log(`Patched existing appInfoLocalization for ${locale} after duplicate POST.`);
        return;
      }
    }
    throw error;
  }
}

function pickDefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

module.exports = {
  submitForReview,
  syncMetadata
};
