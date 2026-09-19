"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ascRequest, findApp, findBundleId, findOrCreateVersion, getAll } = require("./asc-api");
const { resolveFromRoot } = require("./config");

const DEFAULT_CONTENT_RIGHTS = "DOES_NOT_USE_THIRD_PARTY_CONTENT";

async function syncAppListing(config, options = {}) {
  const app = await findApp(config, options);
  const contentRights = config.appStore?.contentRightsDeclaration || DEFAULT_CONTENT_RIGHTS;
  await ascRequest("PATCH", `/v1/apps/${app.id}`, {
    data: {
      type: "apps",
      id: app.id,
      attributes: { contentRightsDeclaration: contentRights }
    }
  }, options);
  console.log(`Content rights: ${contentRights}`);

  const primaryCategory = config.appStore?.primaryCategory;
  const secondaryCategory = config.appStore?.secondaryCategory;
  const primarySubcategoryOne = config.appStore?.primarySubcategoryOne;
  const primarySubcategoryTwo = config.appStore?.primarySubcategoryTwo;
  if (!primaryCategory) {
    console.log("Skipping app category (set appStore.primaryCategory to sync).");
    return;
  }

  const appInfos = await getAll(`/v1/apps/${app.id}/appInfos?limit=10`, options);
  const appInfo = appInfos[0];
  if (!appInfo && !options.dryRun) throw new Error("No appInfo found for category update.");
  const relationships = {
    primaryCategory: { data: { type: "appCategories", id: primaryCategory } }
  };
  if (secondaryCategory) {
    relationships.secondaryCategory = { data: { type: "appCategories", id: secondaryCategory } };
  }
  if (primarySubcategoryOne) {
    relationships.primarySubcategoryOne = { data: { type: "appCategories", id: primarySubcategoryOne } };
  }
  if (primarySubcategoryTwo) {
    relationships.primarySubcategoryTwo = { data: { type: "appCategories", id: primarySubcategoryTwo } };
  }
  await ascRequest("PATCH", `/v1/appInfos/${appInfo?.id || "(dry-run-app-info-id)"}`, {
    data: {
      type: "appInfos",
      id: appInfo?.id || "(dry-run-app-info-id)",
      relationships
    }
  }, options);
  const parts = [primaryCategory];
  if (primarySubcategoryOne) parts.push(primarySubcategoryOne);
  if (primarySubcategoryTwo) parts.push(primarySubcategoryTwo);
  if (secondaryCategory) parts.push(secondaryCategory);
  console.log(`Categories: ${parts.join(" + ")}`);
}

async function attachBuild(config, options = {}) {
  const app = await findApp(config, options);
  const version = await findOrCreateVersion(config, app.id, options);
  const wanted = options.build ? String(options.build) : null;
  const timeoutMs = Number(options.timeoutMs || 15 * 60 * 1000);
  const started = Date.now();

  let selected = await findMatchingBuild(app.id, wanted, options);
  while (!selected && options.wait && Date.now() - started < timeoutMs) {
    const latest = (await listBuilds(app.id, options))[0];
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (latest) {
      console.log(
        `Waiting for VALID build... ${elapsed}s latest=${latest.processingState} ` +
          `${latest.marketingVersion || "?"}/${latest.buildNumber || "?"} uploaded=${latest.uploadedDate || "?"}`
      );
    } else {
      console.log(`Waiting for VALID build... ${elapsed}s (no build visible yet; Apple is still ingesting the IPA)`);
    }
    await sleep(15000);
    selected = await findMatchingBuild(app.id, wanted, options);
  }
  if (!selected) {
    const hint = wanted ? `build ${wanted}` : "latest VALID build";
    throw new Error(
      `No VALID ${hint} found for ${config.app.name}. Apple processing of a first upload often takes 5–15 minutes. Retry attach-build --wait.`
    );
  }

  await ascRequest("PATCH", `/v1/appStoreVersions/${version.id}`, {
    data: {
      type: "appStoreVersions",
      id: version.id,
      relationships: {
        build: { data: { type: "builds", id: selected.id } }
      }
    }
  }, options);
  console.log(`Attached build ${selected.version} (${selected.id}) to version ${config.appStore.version}.`);
}

async function ensureStoreProfile(config, options = {}) {
  const bundleId = config.app.bundleId;
  const profileName = config.signing?.profileName || readProfileNameFromExportOptions(config, bundleId);
  if (!profileName) {
    throw new Error("Missing signing.profileName and could not read provisioningProfiles from ExportOptions.plist.");
  }

  const bundle = await findBundleId(bundleId, options);
  const existing = await findProfileByName(profileName, options);
  let profile = existing;
  if (!profile) {
    const certificate = await resolveDistributionCertificate(config, options);
    console.log(`Creating IOS_APP_STORE profile "${profileName}" with certificate ${certificate.id}.`);
    const created = await ascRequest("POST", "/v1/profiles", {
      data: {
        type: "profiles",
        attributes: {
          name: profileName,
          profileType: "IOS_APP_STORE"
        },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundle.id } },
          certificates: { data: [{ type: "certificates", id: certificate.id }] }
        }
      }
    }, options);
    profile = created.data;
  } else {
    console.log(`Reusing existing profile "${profileName}" (${profile.id}).`);
  }

  if (options.dryRun) return;
  if (profile?.id && !profile.attributes?.profileContent) {
    const full = await ascRequest("GET", `/v1/profiles/${profile.id}`, null, options);
    profile = full.data;
  }
  const installed = installProvisioningProfile(profile);
  console.log(`Installed profile ${installed.uuid} -> ${installed.paths.join(", ")}`);
}

async function listBuilds(appId, options = {}) {
  const json = await ascRequest(
    "GET",
    `/v1/builds?filter[app]=${encodeURIComponent(appId)}&include=preReleaseVersion&sort=-uploadedDate&limit=30`,
    null,
    options
  );
  if (options.dryRun) return [];
  const included = json.included || [];
  const versionById = new Map(
    included
      .filter((item) => item.type === "preReleaseVersions")
      .map((item) => [item.id, item.attributes?.version])
  );
  return (json.data || []).map((item) => ({
    id: item.id,
    marketingVersion: versionById.get(item.relationships?.preReleaseVersion?.data?.id) || null,
    buildNumber: item.attributes?.version || null,
    processingState: item.attributes?.processingState || null,
    uploadedDate: item.attributes?.uploadedDate || null,
    expired: Boolean(item.attributes?.expired)
  }));
}

function matchesWantedBuild(build, wanted) {
  if (!wanted) return true;
  const needle = String(wanted);
  return [build.marketingVersion, build.buildNumber, build.id].some((value) => String(value) === needle);
}

async function findMatchingBuild(appId, wantedVersion, options) {
  if (options.dryRun) {
    return { id: "(dry-run-build-id)", version: wantedVersion || "(latest)" };
  }
  const builds = await listBuilds(appId, options);
  const valid = builds.filter((item) => item.processingState === "VALID" && !item.expired);
  const matches = wantedVersion ? valid.filter((item) => matchesWantedBuild(item, wantedVersion)) : valid;
  const selected = matches[0] || null;
  if (selected) {
    selected.version = selected.marketingVersion || selected.buildNumber;
  }
  return selected;
}

async function ensureBundleId(config, options = {}) {
  const identifier = config.app.bundleId;
  if (!identifier) throw new Error("Missing app.bundleId in appstore.config.json");
  try {
    const existing = await findBundleId(identifier, options);
    console.log(`Bundle ID exists: ${identifier} (${existing.id})`);
    return existing;
  } catch (error) {
    if (!String(error.message).includes("No Bundle ID found")) throw error;
  }

  const created = await ascRequest("POST", "/v1/bundleIds", {
    data: {
      type: "bundleIds",
      attributes: {
        identifier,
        name: config.app.bundleName || config.app.name,
        platform: "IOS"
      }
    }
  }, options);
  console.log(`Created Bundle ID: ${identifier} (${created.data?.id || "dry-run"})`);
  return created.data;
}

async function prepareNewApp(config, options = {}) {
  const bundle = await ensureBundleId(config, options);
  try {
    const app = await findApp(config, options);
    const attr = app.attributes || {};
    console.log(JSON.stringify({
      appId: app.id,
      name: attr.name,
      sku: attr.sku,
      primaryLocale: attr.primaryLocale,
      bundleId: config.app.bundleId
    }, null, 2));
    if (config.appStore?.appId && String(config.appStore.appId) !== String(app.id)) {
      console.warn(`Config appStore.appId=${config.appStore.appId} differs from ASC ${app.id}. Update the config.`);
    } else if (!config.appStore?.appId) {
      console.log(`Write appStore.appId ${app.id} into apps/${path.basename(config.__appDir)}/appstore.config.json`);
    }
    return app;
  } catch (error) {
    if (!String(error.message).includes("No App Store Connect app found") && !String(error.message).includes("/v1/apps/")) {
      throw error;
    }
  }

  const locale = config.app.primaryLocale || "zh-Hans";
  const sku = config.app.sku || `${config.app.bundleId}.sku`;
  const message = [
    "App Store Connect API Keys cannot CREATE apps (POST /v1/apps → 403 FORBIDDEN).",
    "Create the app in the web UI, then re-run prepare-new-app / inspect-app.",
    "",
    "If a yellow agreement banner is visible, the Account Holder must accept it first:",
    "  https://developer.apple.com/account",
    "",
    "Then https://appstoreconnect.apple.com/apps → + → New App:",
    `  Platforms: ${config.app.platform === "MAC_OS" ? "macOS" : "iOS"}`,
    `  Name: ${config.app.name}`,
    `  Primary Language: ${locale}`,
    `  Bundle ID: ${config.app.bundleId}${bundle?.id ? ` (${bundle.id})` : ""}`,
    `  SKU: ${sku}`,
    "",
    "altool cannot upload until that app record exists."
  ].join("\n");
  throw new Error(message);
}

async function findProfileByName(name, options) {
  const profiles = await getAll("/v1/profiles?filter[profileType]=IOS_APP_STORE&limit=200", options);
  return profiles.find((item) => item.attributes?.name === name) || null;
}

async function resolveDistributionCertificate(config, options) {
  const wantedId = config.signing?.certificateId;
  const wantedSerial = normalizeSerial(config.signing?.certificateSerial);
  let certificates = await getAll("/v1/certificates?filter[certificateType]=IOS_DISTRIBUTION&limit=50", options);
  if (!options.dryRun && certificates.length === 0) {
    certificates = await getAll("/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50", options);
  }
  if (options.dryRun) {
    return { id: wantedId || "(dry-run-certificate-id)" };
  }
  const active = certificates.filter((item) => item.attributes?.expirationDate && new Date(item.attributes.expirationDate) > new Date());
  const match = active.find((item) => {
    if (wantedId && item.id === wantedId) return true;
    if (wantedSerial && normalizeSerial(item.attributes?.serialNumber) === wantedSerial) return true;
    return false;
  }) || active[0];
  if (!match) throw new Error("No active IOS_DISTRIBUTION certificate found in App Store Connect.");
  return match;
}

function readProfileNameFromExportOptions(config, bundleId) {
  const plistPath = resolveFromRoot(config.xcode?.exportOptionsPlist);
  if (!plistPath || !fs.existsSync(plistPath)) return null;
  const text = fs.readFileSync(plistPath, "utf8");
  const key = `<key>${bundleId}</key>`;
  const index = text.indexOf(key);
  if (index < 0) return null;
  const match = text.slice(index).match(/<string>([^<]+)<\/string>/);
  return match?.[1]?.trim() || null;
}

function installProvisioningProfile(profile) {
  const uuid = profile.attributes?.uuid;
  const content = profile.attributes?.profileContent;
  if (!uuid || !content) throw new Error("Profile response is missing uuid or profileContent.");
  const bytes = Buffer.from(content, "base64");
  const fileName = `${uuid}.mobileprovision`;
  const dirs = [
    path.join(os.homedir(), "Library/Developer/Xcode/UserData/Provisioning Profiles"),
    path.join(os.homedir(), "Library/MobileDevice/Provisioning Profiles")
  ];
  const paths = [];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, fileName);
    fs.writeFileSync(dest, bytes);
    paths.push(dest);
  }
  return { uuid, paths };
}

function normalizeSerial(value) {
  return String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  attachBuild,
  ensureBundleId,
  ensureStoreProfile,
  listBuilds,
  prepareNewApp,
  syncAppListing
};
