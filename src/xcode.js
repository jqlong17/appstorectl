"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveFromRoot, requireFile } = require("./config");
const { run } = require("./shell");

function archiveAndExport(config, options = {}) {
  const project = resolveFromRoot(config.xcode.project);
  const archivePath = resolveFromRoot(config.xcode.archivePath);
  const exportPath = resolveFromRoot(config.xcode.exportPath);
  const exportOptionsPlist = resolveFromRoot(config.xcode.exportOptionsPlist);
  const developerDir = config.xcode.developerDir || "/Applications/Xcode.app/Contents/Developer";

  requireFile("Xcode project", project);
  requireFile("ExportOptions.plist", exportOptionsPlist);

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.mkdirSync(exportPath, { recursive: true });

  if (!options.exportOnly) {
    run(
      "xcodebuild",
      [
        "-project", project,
        "-scheme", config.xcode.scheme,
        "-configuration", config.xcode.configuration || "Release",
        "-destination", config.xcode.destination || "generic/platform=iOS",
        "-archivePath", archivePath,
        "-allowProvisioningUpdates",
        ...xcodeAuthenticationArgs(),
        "archive"
      ],
      { dryRun: options.dryRun, env: { DEVELOPER_DIR: developerDir } }
    );
  }

  if (options.skipExport) return;

  run(
    "xcodebuild",
    [
      "-exportArchive",
      "-archivePath", archivePath,
      "-exportPath", exportPath,
      "-exportOptionsPlist", exportOptionsPlist,
      "-allowProvisioningUpdates",
      ...xcodeAuthenticationArgs()
    ],
    { dryRun: options.dryRun, env: { DEVELOPER_DIR: developerDir } }
  );
}

function xcodeAuthenticationArgs() {
  const keyPath = process.env.ASC_PRIVATE_KEY_PATH;
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  if (!keyPath || !keyId || !issuerId) return [];
  return [
    "-authenticationKeyPath", keyPath,
    "-authenticationKeyID", keyId,
    "-authenticationKeyIssuerID", issuerId
  ];
}

function uploadIpa(config, options = {}) {
  const uploadPath = resolveFromRoot(options.ipaPath || config.upload?.ipaPath || config.upload?.packagePath);
  const developerDir = config.xcode.developerDir || "/Applications/Xcode.app/Contents/Developer";
  if (!options.dryRun) {
    requireFile("App package", uploadPath);
  }
  const keyId = process.env.ASC_KEY_ID || config.auth?.keyId || (options.dryRun ? "ASC_KEY_ID" : "");
  const issuerId = process.env.ASC_ISSUER_ID || config.auth?.issuerId || (options.dryRun ? "ASC_ISSUER_ID" : "");
  if (!keyId) throw new Error("Missing ASC_KEY_ID");
  if (!issuerId) throw new Error("Missing ASC_ISSUER_ID");
  const uploadType = config.upload?.type || (config.app?.platform === "MAC_OS" ? "macos" : "ios");

  run(
    "xcrun",
    [
      "altool",
      "--upload-app",
      "--type", uploadType,
      "--file", uploadPath,
      "--apiKey", keyId,
      "--apiIssuer", issuerId
    ],
    { dryRun: options.dryRun, env: { DEVELOPER_DIR: developerDir } }
  );
}

module.exports = {
  archiveAndExport,
  uploadIpa
};
