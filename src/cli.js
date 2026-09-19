"use strict";

const { loadConfig } = require("./config");
const { doctor } = require("./doctor");
const { archiveAndExport, uploadIpa } = require("./xcode");
const { syncMetadata, submitForReview } = require("./metadata");
const { syncPricing } = require("./pricing");
const { syncReleaseInfo } = require("./release-info");
const { uploadScreenshots } = require("./screenshots");
const { attachBuild, ensureBundleId, ensureStoreProfile, listBuilds, prepareNewApp } = require("./store-setup");
const { findApp, getBundleId, listApps } = require("./asc-api");
const { researchApp } = require("./research");

async function main(argv) {
  const [command, appName, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  // Public App Store research does not require local apps/<name>/config.
  if (command === "research") {
    const flags = parseFlags(appName ? [appName, ...rest] : rest);
    const queryParts = [];
    if (appName && !String(appName).startsWith("--")) queryParts.push(appName);
    for (const value of rest) {
      if (String(value).startsWith("--")) break;
      queryParts.push(value);
    }
    const query = queryParts.join(" ").trim() || null;
    await researchApp(query, {
      country: flags.get("country") || "cn",
      id: flags.get("id") || null,
      out: flags.get("out") || "research",
      limit: Number(flags.get("limit") || 10),
      reviewPages: Number(flags.get("review-pages") || 1),
      yes: flags.has("yes")
    });
    return;
  }

  if (!appName) {
    throw new Error(`Missing app name. Example: appstorectl ${command} example`);
  }
  const flags = parseFlags(rest);
  const config = loadConfig(appName);

  switch (command) {
    case "doctor":
      doctor(config);
      break;
    case "build":
      archiveAndExport(config, {
        dryRun: flags.has("dry-run"),
        skipExport: flags.has("skip-export"),
        exportOnly: flags.has("export-only")
      });
      break;
    case "upload-build":
      uploadIpa(config, {
        dryRun: flags.has("dry-run"),
        ipaPath: flags.get("ipa")
      });
      break;
    case "list-apps":
      await printApps(flags);
      break;
    case "inspect-app":
      await inspectApp(config, flags);
      break;
    case "sync-metadata":
      await syncMetadata(config, {
        dryRun: flags.has("dry-run"),
        createVersion: flags.has("create-version")
      });
      break;
    case "sync-release-info":
      await syncReleaseInfo(config, {
        dryRun: flags.has("dry-run"),
        createVersion: flags.has("create-version")
      });
      break;
    case "sync-pricing":
      await syncPricing(config, {
        dryRun: flags.has("dry-run")
      });
      break;
    case "upload-screenshots":
      await uploadScreenshots(config, {
        dryRun: flags.has("dry-run"),
        createVersion: flags.has("create-version"),
        replace: flags.has("replace")
      });
      break;
    case "attach-build":
      await attachBuild(config, {
        dryRun: flags.has("dry-run"),
        createVersion: flags.has("create-version"),
        wait: flags.has("wait"),
        build: flags.get("build")
      });
      break;
    case "ensure-store-profile":
      await ensureStoreProfile(config, {
        dryRun: flags.has("dry-run")
      });
      break;
    case "ensure-bundle-id":
      await ensureBundleId(config, {
        dryRun: flags.has("dry-run")
      });
      break;
    case "prepare-new-app":
      await prepareNewApp(config, {
        dryRun: flags.has("dry-run")
      });
      break;
    case "list-builds":
      await printBuilds(config, flags);
      break;
    case "submit":
      await submitForReview(config, {
        dryRun: flags.has("dry-run"),
        yes: flags.has("yes")
      });
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseFlags(values) {
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags.set(rawKey, inlineValue);
    } else if (values[index + 1] && !values[index + 1].startsWith("--")) {
      flags.set(rawKey, values[index + 1]);
      index += 1;
    } else {
      flags.set(rawKey, true);
    }
  }
  flags.has = Map.prototype.has.bind(flags);
  flags.get = Map.prototype.get.bind(flags);
  return flags;
}

function printHelp() {
  console.log(`appstorectl

Usage:
  appstorectl doctor <app>
  appstorectl build <app> [--dry-run] [--skip-export] [--export-only]
  appstorectl upload-build <app> [--dry-run] [--ipa path/to/App.ipa]
  appstorectl ensure-store-profile <app> [--dry-run]
  appstorectl ensure-bundle-id <app> [--dry-run]
  appstorectl prepare-new-app <app> [--dry-run]
  appstorectl attach-build <app> [--dry-run] [--wait] [--build N|1.0] [--create-version]
  appstorectl list-apps <app>
  appstorectl list-builds <app>
  appstorectl inspect-app <app>
  appstorectl sync-metadata <app> [--dry-run] [--create-version]
  appstorectl sync-release-info <app> [--dry-run] [--create-version]
  appstorectl sync-pricing <app> [--dry-run]
  appstorectl upload-screenshots <app> [--dry-run] [--create-version] [--replace]
  appstorectl submit <app> [--dry-run] [--yes]
  appstorectl research <name> [--country cn] [--id trackId] [--out research] [--limit 10] [--review-pages 1] [--yes]

Examples:
  appstorectl doctor example
  appstorectl prepare-new-app example
  appstorectl build example
  appstorectl upload-build example
  appstorectl list-builds example
  appstorectl attach-build example --wait
  appstorectl sync-metadata example --create-version --dry-run
  appstorectl upload-screenshots example --replace --dry-run
  appstorectl research "Goodnotes" --country us --yes
`);
}

async function printApps(flags) {
  const apps = await listApps({ dryRun: flags.has("dry-run") });
  if (flags.has("dry-run")) return;
  for (const app of apps) {
    const attr = app.attributes || {};
    console.log(`${app.id}\t${attr.name || "(no name)"}\t${attr.bundleId || "(bundle hidden)"}\t${attr.sku || ""}`);
  }
}

async function printBuilds(config, flags) {
  const app = await findApp(config, { dryRun: flags.has("dry-run") });
  if (flags.has("dry-run")) return;
  const builds = await listBuilds(app.id);
  if (builds.length === 0) {
    console.log("No builds yet.");
    return;
  }
  for (const build of builds) {
    console.log(
      `${build.id}\t${build.processingState}\t${build.marketingVersion || "-"}\t${build.buildNumber || "-"}\t${build.uploadedDate || ""}`
    );
  }
}

async function inspectApp(config, flags) {
  const app = await findApp(config, { dryRun: flags.has("dry-run") });
  if (flags.has("dry-run")) return;
  const attr = app.attributes || {};
  const bundleRelationshipId = app.relationships?.bundleId?.data?.id;
  const bundle = await getBundleId(bundleRelationshipId, { dryRun: false });
  const bundleAttr = bundle?.attributes || {};
  console.log(JSON.stringify({
    appId: app.id,
    name: attr.name,
    sku: attr.sku,
    primaryLocale: attr.primaryLocale,
    bundleId: attr.bundleId || bundleAttr.identifier,
    bundleIdName: bundleAttr.name,
    platform: config.app.platform || "IOS"
  }, null, 2));
}

module.exports = {
  main
};
