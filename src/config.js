"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");

function loadConfig(appName) {
  if (!appName) {
    throw new Error("Missing app name. Example: appstorectl doctor example");
  }
  const appDir = path.join(rootDir, "apps", appName);
  const configPath = path.join(appDir, "appstore.config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.__appName = appName;
  config.__appDir = appDir;
  config.__configPath = configPath;
  return config;
}

function loadProfile(config) {
  const profileName = config.app?.profile;
  if (!profileName) return null;
  const profilePath = path.join(rootDir, "profiles", `${profileName}.json`);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`);
  }
  return readJson(profilePath);
}

function resolveFromRoot(relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) return null;
  if (path.isAbsolute(relativeOrAbsolutePath)) return relativeOrAbsolutePath;
  return path.resolve(rootDir, relativeOrAbsolutePath);
}

function requireFile(label, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath || "(empty)"}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function listMetadataFiles(config) {
  const dir = resolveFromRoot(config.metadata?.directory);
  if (!dir || !fs.existsSync(dir)) return [];
  const enabledLocales = new Set(config.metadata?.locales || []);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => enabledLocales.size === 0 || enabledLocales.has(path.basename(name, ".json")))
    .sort()
    .map((name) => path.join(dir, name));
}

module.exports = {
  listMetadataFiles,
  loadConfig,
  loadProfile,
  readJson,
  readTextIfExists,
  requireFile,
  resolveFromRoot,
  rootDir
};
