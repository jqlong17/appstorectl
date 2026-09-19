#!/usr/bin/env node
"use strict";

const path = require("node:path");

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    args.set(key, value);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cliRoot = path.resolve(args.get("cli-root") || path.join(__dirname, ".."));
  const appName = args.get("app") || "example";
  const { loadConfig } = require(path.join(cliRoot, "src/config"));
  const { ascRequest, findApp, findOrCreateVersion, getAll, getFirstRelated } = require(path.join(cliRoot, "src/asc-api"));

  const config = loadConfig(appName);
  const app = await findApp(config);
  const version = await findOrCreateVersion(config, app.id);
  const appInfo = await getFirstRelated("apps", app.id, "appInfos");
  const localizations = await getAll(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`);
  const localization = localizations.find((item) => item.attributes?.locale === config.app.primaryLocale) || localizations[0];

  const appFull = await ascRequest("GET", `/v1/apps/${app.id}`, null);
  const versionFull = await ascRequest("GET", `/v1/appStoreVersions/${version.id}?include=build,appStoreReviewDetail`, null);
  const age = appInfo ? await ascRequest("GET", `/v1/appInfos/${appInfo.id}/ageRatingDeclaration`, null) : null;
  const review = await ascRequest("GET", `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`, null);
  const screenshotSets = localization ? await summarizeScreenshots(localization.id, getAll) : [];
  const availability = await readAvailability(app.id, ascRequest, getAll);
  const pricing = await readPricing(app.id, ascRequest, getAll);
  const requiredDisplayTypes = config.screenshots?.requiredDisplayTypes || ["APP_IPHONE_67", "APP_IPAD_PRO_3GEN_129"];

  const summary = {
    app: {
      id: app.id,
      name: app.attributes?.name,
      bundleId: app.attributes?.bundleId,
      contentRightsDeclaration: appFull.data.attributes.contentRightsDeclaration,
    },
    version: {
      id: version.id,
      versionString: version.attributes?.versionString,
      state: versionFull.data.attributes.appStoreState,
      build: versionFull.data.relationships.build.data,
      reviewDetail: versionFull.data.relationships.appStoreReviewDetail.data,
      usesIdfa: versionFull.data.attributes.usesIdfa,
      copyright: versionFull.data.attributes.copyright,
    },
    ageRating: age?.data?.attributes,
    review: review.data ? {
      contactFirstName: review.data.attributes.contactFirstName,
      contactLastName: review.data.attributes.contactLastName,
      contactEmail: review.data.attributes.contactEmail,
      contactPhone: review.data.attributes.contactPhone,
      demoAccountRequired: review.data.attributes.demoAccountRequired,
    } : null,
    screenshots: screenshotSets,
    requiredDisplayTypes,
    availability,
    pricing,
  };
  summary.warnings = [
    "App Privacy cannot be verified via public API. Confirm the nutrition labels are filled AND published in the ASC web UI."
  ];
  summary.blockers = blockers(summary);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.blockers.length) process.exitCode = 2;
}

async function summarizeScreenshots(localizationId, getAll) {
  const sets = await getAll(`/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?limit=50`);
  const result = [];
  for (const set of sets) {
    const screenshots = await getAll(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`);
    result.push({
      displayType: set.attributes.screenshotDisplayType,
      count: screenshots.length,
      files: screenshots.map((shot) => shot.attributes.fileName),
      states: screenshots.map((shot) => shot.attributes.assetDeliveryState?.state),
      errors: screenshots.flatMap((shot) => shot.attributes.assetDeliveryState?.errors || []),
    });
  }
  return result;
}

async function readAvailability(appId, ascRequest, getAll) {
  try {
    const availability = await ascRequest("GET", `/v2/appAvailabilities/${appId}`, null);
    const territories = await getAll(`/v2/appAvailabilities/${appId}/territoryAvailabilities?limit=200`);
    return {
      availableInNewTerritories: availability.data.attributes.availableInNewTerritories,
      territoryCount: territories.length,
      availableCount: territories.filter((item) => item.attributes?.available === true).length,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function readPricing(appId, ascRequest, getAll) {
  try {
    const base = await ascRequest("GET", `/v1/appPriceSchedules/${appId}/baseTerritory`, null);
    const automatic = await getAll(`/v1/appPriceSchedules/${appId}/automaticPrices?limit=200`);
    return {
      baseTerritory: base.data.id,
      automaticPriceCount: automatic.length,
      nonFreeAutomaticCount: automatic.filter((price) => !String(price.id).includes("MTAwMDA")).length,
    };
  } catch (error) {
    return { error: error.message };
  }
}

function blockers(summary) {
  const issues = [];
  if (!summary.version.build) issues.push("No build selected for version.");
  if (summary.app.contentRightsDeclaration !== "DOES_NOT_USE_THIRD_PARTY_CONTENT") issues.push("Content Rights not set.");
  if (!summary.review) issues.push("App Review detail missing.");
  if (summary.ageRating?.ageRatingOverrideV2 !== "NONE") issues.push("Age rating not confirmed as default 4+ style.");
  const requiredDisplayTypes = summary.requiredDisplayTypes || ["APP_IPHONE_67", "APP_IPAD_PRO_3GEN_129"];
  for (const type of requiredDisplayTypes) {
    const set = summary.screenshots.find((item) => item.displayType === type);
    if (!set || set.count < 1) issues.push(`Missing screenshots for ${type}.`);
    if (set && set.states.some((state) => state !== "COMPLETE")) issues.push(`Screenshot processing incomplete for ${type}.`);
    if (set && set.errors.length) issues.push(`Screenshot errors for ${type}.`);
  }
  if (summary.availability.availableInNewTerritories !== true) issues.push("Global availability is not enabled for new territories.");
  if (summary.availability.territoryCount && summary.availability.territoryCount !== summary.availability.availableCount) issues.push("Not all territories are available.");
  if (summary.pricing.nonFreeAutomaticCount !== 0) issues.push("Some automatic prices are not free.");
  return issues;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
