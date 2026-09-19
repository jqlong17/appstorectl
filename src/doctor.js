"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { listMetadataFiles, resolveFromRoot } = require("./config");
const { commandExists, run } = require("./shell");

function doctor(config) {
  console.log(`App: ${config.app.name}`);
  console.log(`Bundle ID: ${config.app.bundleId}`);
  console.log("");

  checkCommand("node");
  checkCommand("xcodebuild");
  checkCommand("xcrun");

  const project = resolveFromRoot(config.xcode.project);
  const exportOptions = resolveFromRoot(config.xcode.exportOptionsPlist);
  checkPath("Xcode project", project);
  checkPath("ExportOptions.plist", exportOptions);
  checkPath("Metadata directory", resolveFromRoot(config.metadata.directory));

  const metadataFiles = listMetadataFiles(config);
  console.log(`Metadata locales: ${metadataFiles.map((file) => path.basename(file, ".json")).join(", ") || "(none)"}`);

  checkEnv("ASC_ISSUER_ID");
  checkEnv("ASC_KEY_ID");
  if (process.env.ASC_PRIVATE_KEY_PATH) {
    checkPath("ASC_PRIVATE_KEY_PATH", process.env.ASC_PRIVATE_KEY_PATH);
  } else if (process.env.ASC_PRIVATE_KEY) {
    console.log("OK   ASC_PRIVATE_KEY is set");
  } else {
    console.log("WARN ASC_PRIVATE_KEY_PATH or ASC_PRIVATE_KEY is not set");
  }

  if (process.env.ASC_KEY_ID) {
    const transporterKey = path.join(
      process.env.HOME || "",
      ".appstoreconnect",
      "private_keys",
      `AuthKey_${process.env.ASC_KEY_ID}.p8`
    );
    if (fs.existsSync(transporterKey)) {
      console.log(`OK   Transporter/altool key exists: ${transporterKey}`);
    } else {
      console.log(`WARN Transporter/altool key missing: ${transporterKey}`);
      console.log("     upload-build uses xcrun altool, which expects AuthKey_<KEY_ID>.p8 in this folder.");
    }
  }

  const developerDir = config.xcode.developerDir || "/Applications/Xcode.app/Contents/Developer";
  checkPath("xcode.developerDir", developerDir);
  if (developerDir.includes("CommandLineTools")) {
    console.log("WARN xcode.developerDir points at Command Line Tools; archive/export needs full Xcode.app");
  }

  run("xcodebuild", ["-version"], {
    capture: true,
    env: {
      DEVELOPER_DIR: developerDir
    }
  });
  console.log("");
  console.log("Doctor finished.");
}

function checkCommand(command) {
  const found = commandExists(command);
  console.log(`${found ? "OK  " : "FAIL"} command ${command}${found ? ` -> ${found}` : ""}`);
}

function checkPath(label, filePath) {
  console.log(`${fs.existsSync(filePath) ? "OK  " : "FAIL"} ${label}: ${filePath}`);
}

function checkEnv(name) {
  console.log(`${process.env[name] ? "OK  " : "WARN"} ${name}${process.env[name] ? " is set" : " is not set"}`);
}

module.exports = {
  doctor
};
