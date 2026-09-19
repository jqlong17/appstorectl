"use strict";

const path = require("node:path");
const { ascRequest, findApp, findOrCreateVersion, getFirstRelated } = require("./asc-api");
const { loadProfile, readTextIfExists } = require("./config");
const { syncAppListing } = require("./store-setup");

async function syncReleaseInfo(config, options = {}) {
  const profile = loadProfile(config);
  if (!profile) throw new Error("Missing app.profile in appstore.config.json");

  const app = await findApp(config, options);
  const version = await findOrCreateVersion(config, app.id, options);
  const appInfo = await getFirstRelated("apps", app.id, "appInfos", options);
  if (!appInfo && !options.dryRun) throw new Error("No appInfo found for this app.");

  await syncAppListing(config, options);

  const copyright = profile.copyright || profile.developerName;
  if (copyright) {
    await ascRequest("PATCH", `/v1/appStoreVersions/${version.id}`, {
      data: {
        type: "appStoreVersions",
        id: version.id,
        attributes: {
          copyright,
          usesIdfa: false,
          releaseType: "AFTER_APPROVAL"
        }
      }
    }, options);
  }

  if (appInfo || options.dryRun) {
    await syncDefaultAgeRating(appInfo?.id || "(dry-run-app-info-id)", options);
  }

  const notesPath = path.join(config.__appDir, "review-notes.md");
  const notes = readTextIfExists(notesPath).replace(/^# .+\n+/, "").trim();
  await upsertReviewDetail(version.id, profile, notes, options);
  console.log(`Synced release info for ${config.app.name}.`);
}

async function upsertReviewDetail(versionId, profile, notes, options) {
  const contact = profile.contact || {};
  const attributes = {
    contactFirstName: contact.firstName,
    contactLastName: contact.lastName,
    contactPhone: contact.phone,
    contactEmail: contact.email,
    demoAccountRequired: false,
    notes
  };

  const existing = await ascRequest("GET", `/v1/appStoreVersions/${versionId}/appStoreReviewDetail`, null, options);
  if (existing.data?.id) {
    await ascRequest("PATCH", `/v1/appStoreReviewDetails/${existing.data.id}`, {
      data: { type: "appStoreReviewDetails", id: existing.data.id, attributes }
    }, options);
    return;
  }

  await ascRequest("POST", "/v1/appStoreReviewDetails", {
    data: {
      type: "appStoreReviewDetails",
      attributes,
      relationships: {
        appStoreVersion: { data: { type: "appStoreVersions", id: versionId } }
      }
    }
  }, options);
}

async function syncDefaultAgeRating(appInfoId, options) {
  try {
    await ascRequest("PATCH", `/v1/ageRatingDeclarations/${appInfoId}`, {
      data: {
        type: "ageRatingDeclarations",
        id: appInfoId,
        attributes: {
          advertising: false,
          alcoholTobaccoOrDrugUseOrReferences: "NONE",
          contests: "NONE",
          gambling: false,
          gamblingSimulated: "NONE",
          gunsOrOtherWeapons: "NONE",
          healthOrWellnessTopics: false,
          lootBox: false,
          medicalOrTreatmentInformation: "NONE",
          messagingAndChat: false,
          parentalControls: false,
          profanityOrCrudeHumor: "NONE",
          ageAssurance: false,
          sexualContentGraphicAndNudity: "NONE",
          sexualContentOrNudity: "NONE",
          socialMedia: false,
          socialMediaAgeRestricted: false,
          horrorOrFearThemes: "NONE",
          matureOrSuggestiveThemes: "NONE",
          unrestrictedWebAccess: false,
          userGeneratedContent: false,
          violenceCartoonOrFantasy: "NONE",
          violenceRealisticProlongedGraphicOrSadistic: "NONE",
          violenceRealistic: "NONE",
          ageRatingOverrideV2: "NONE",
          koreaAgeRatingOverride: "NONE"
        }
      }
    }, options);
  } catch (error) {
    if (String(error.message).includes("409") || String(error.message).includes("STATE_ERROR")) {
      console.warn(`Skipping ageRatingDeclaration update (not editable): ${error.message.split("\n")[0]}`);
      return;
    }
    throw error;
  }
}

module.exports = {
  syncReleaseInfo
};
