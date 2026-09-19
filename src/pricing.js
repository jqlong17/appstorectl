"use strict";

const { ascRequest, findApp, getAll } = require("./asc-api");

async function syncPricing(config, options = {}) {
  const app = await findApp(config, options);
  const pricing = config.pricing || {};
  const baseTerritory = pricing.baseTerritory || "USA";
  const price = pricing.price || "free";
  const global = pricing.global !== false;

  if (price !== "free") {
    throw new Error(`Unsupported pricing.price=${price}. This CLI currently supports free apps only.`);
  }

  if (global) {
    await syncGlobalAvailability(app.id, options);
  }
  await syncFreePrice(app.id, baseTerritory, options);
  console.log(`Synced pricing for ${config.app.name}: free, ${global ? "global" : "configured territories only"}.`);
}

async function syncGlobalAvailability(appId, options) {
  const territories = await getAll("/v1/territories?limit=200", options);
  const relationshipData = territories.map((territory) => ({
    type: "territoryAvailabilities",
    id: localId(territory.id)
  }));
  const included = territories.map((territory) => ({
    type: "territoryAvailabilities",
    id: localId(territory.id),
    attributes: { available: true },
    relationships: {
      territory: { data: { type: "territories", id: territory.id } }
    }
  }));

  const body = {
    data: {
      type: "appAvailabilities",
      attributes: { availableInNewTerritories: true },
      relationships: {
        app: { data: { type: "apps", id: appId } },
        territoryAvailabilities: { data: relationshipData }
      }
    },
    included
  };

  try {
    await ascRequest("POST", "/v2/appAvailabilities", body, options);
  } catch (error) {
    const message = String(error.message);
    if (message.includes("There is a resource of type 'appAvailabilities'") || message.includes("already exists")) {
      console.warn("App availability already exists; keeping current availability.");
      return;
    }
    throw error;
  }
}

async function syncFreePrice(appId, baseTerritory, options) {
  const points = await getAll(`/v1/apps/${appId}/appPricePoints?filter[territory]=${encodeURIComponent(baseTerritory)}&limit=200`, options);
  const freePoint = points.find((point) => point.attributes?.customerPrice === "0.0");
  if (!freePoint && !options.dryRun) {
    throw new Error(`No free price point found for ${baseTerritory}`);
  }

  const body = {
    data: {
      type: "appPriceSchedules",
      relationships: {
        app: { data: { type: "apps", id: appId } },
        baseTerritory: { data: { type: "territories", id: baseTerritory } },
        manualPrices: { data: [{ type: "appPrices", id: localId("free-price") }] }
      }
    },
    included: [{
      type: "appPrices",
      id: localId("free-price"),
      attributes: {},
      relationships: {
        appPricePoint: { data: { type: "appPricePoints", id: freePoint?.id || "(dry-run-free-price-point)" } }
      }
    }]
  };

  await ascRequest("POST", "/v1/appPriceSchedules", body, options);
}

function localId(value) {
  return `\${${value}}`;
}

module.exports = {
  syncPricing
};
