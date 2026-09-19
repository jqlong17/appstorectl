"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ASC_BASE_URL = "https://api.appstoreconnect.apple.com";

function loadAuthFromEnv() {
  const issuerId = process.env.ASC_ISSUER_ID;
  const keyId = process.env.ASC_KEY_ID;
  const privateKeyPath = process.env.ASC_PRIVATE_KEY_PATH;
  const privateKeyInline = process.env.ASC_PRIVATE_KEY;

  if (!issuerId) throw new Error("Missing ASC_ISSUER_ID");
  if (!keyId) throw new Error("Missing ASC_KEY_ID");
  if (!privateKeyPath && !privateKeyInline) {
    throw new Error("Missing ASC_PRIVATE_KEY_PATH or ASC_PRIVATE_KEY");
  }

  const privateKey = privateKeyInline || fs.readFileSync(path.resolve(privateKeyPath), "utf8");
  return { issuerId, keyId, privateKey };
}

function createJwt(auth = loadAuthFromEnv()) {
  const header = base64UrlJson({ alg: "ES256", kid: auth.keyId, typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlJson({
    iss: auth.issuerId,
    iat: now,
    exp: now + 19 * 60,
    aud: "appstoreconnect-v1"
  });
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: auth.privateKey,
    dsaEncoding: "ieee-p1363"
  });
  return `${signingInput}.${base64Url(signature)}`;
}

async function ascRequest(method, resourcePath, body, options = {}) {
  if (options.dryRun) {
    console.log(`[dry-run] ${method} ${ASC_BASE_URL}${resourcePath}`);
    if (body) console.log(JSON.stringify(body, null, 2));
    return { data: null, links: null, meta: null };
  }

  const token = createJwt();
  const response = await fetch(`${ASC_BASE_URL}${resourcePath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const errorText = json.errors ? JSON.stringify(json.errors, null, 2) : text;
    throw new Error(`ASC API ${method} ${resourcePath} failed: ${response.status}\n${errorText}`);
  }
  return json;
}

async function getAll(resourcePath, options = {}) {
  let nextPath = resourcePath;
  const items = [];
  while (nextPath) {
    const json = await ascRequest("GET", nextPath, null, options);
    if (Array.isArray(json.data)) items.push(...json.data);
    const nextUrl = json.links?.next;
    nextPath = nextUrl ? new URL(nextUrl).pathname + new URL(nextUrl).search : null;
  }
  return items;
}

async function findApp(config, options = {}) {
  if (config.appStore?.appId) {
    if (options.dryRun) return { id: config.appStore.appId };
    const json = await ascRequest("GET", `/v1/apps/${encodeURIComponent(config.appStore.appId)}`, null, options);
    return json.data;
  }
  const bundle = await findBundleId(config.app.bundleId, options);
  const apps = await getAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundle.id)}`, options);
  if (options.dryRun) return { id: "(dry-run-app-id)" };
  if (apps.length === 0) throw new Error(`No App Store Connect app found for bundleId=${config.app.bundleId}`);
  if (apps.length > 1) throw new Error(`Multiple apps found for bundleId=${config.app.bundleId}`);
  return apps[0];
}

async function findBundleId(identifier, options = {}) {
  const bundleIds = await getAll(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=20`, options);
  if (options.dryRun) return { id: "(dry-run-bundle-id)", attributes: { identifier } };
  const exact = bundleIds.filter((item) => item.attributes?.identifier === identifier);
  if (exact.length === 0) throw new Error(`No Bundle ID found for identifier=${identifier}`);
  if (exact.length > 1) throw new Error(`Multiple Bundle IDs found for identifier=${identifier}`);
  return exact[0];
}

async function listApps(options = {}) {
  return getAll("/v1/apps?limit=200", options);
}

async function getBundleId(bundleIdRelationshipId, options = {}) {
  if (!bundleIdRelationshipId) return null;
  const json = await ascRequest("GET", `/v1/bundleIds/${bundleIdRelationshipId}`, null, options);
  return json.data || null;
}

async function findOrCreateVersion(config, appId, options = {}) {
  const platform = encodeURIComponent(config.app.platform || "IOS");
  const versionString = encodeURIComponent(config.appStore.version);
  const versions = await getAll(
    `/v1/apps/${appId}/appStoreVersions?filter[platform]=${platform}&filter[versionString]=${versionString}&limit=10`,
    options
  );
  if (versions.length > 0) return versions[0];
  if (options.dryRun) return { id: "(dry-run-version-id)" };
  if (!options.createVersion) {
    throw new Error(`App Store version ${config.appStore.version} not found. Re-run with --create-version if you want to create it.`);
  }
  const body = {
    data: {
      type: "appStoreVersions",
      attributes: {
        platform: config.app.platform || "IOS",
        versionString: config.appStore.version
      },
      relationships: {
        app: {
          data: { type: "apps", id: appId }
        }
      }
    }
  };
  return ascRequest("POST", "/v1/appStoreVersions", body, options).then((json) => json.data || { id: "(dry-run-version-id)" });
}

async function getFirstRelated(typePath, ownerId, relationName, options = {}) {
  const items = await getAll(`/v1/${typePath}/${ownerId}/${relationName}?limit=10`, options);
  return items[0] || null;
}

function base64UrlJson(value) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

module.exports = {
  ascRequest,
  findApp,
  findBundleId,
  findOrCreateVersion,
  getBundleId,
  getAll,
  getFirstRelated,
  listApps,
  loadAuthFromEnv
};
