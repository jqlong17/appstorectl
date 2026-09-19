"use strict";

const { spawnSync } = require("node:child_process");

function run(command, args, options = {}) {
  const printable = [command, ...args.map(quoteIfNeeded)].join(" ");
  if (options.dryRun) {
    console.log(`[dry-run] ${printable}`);
    return { status: 0, stdout: "", stderr: "" };
  }

  console.log(`$ ${printable}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = result.stderr ? `\n${result.stderr}` : "";
    throw new Error(`Command failed (${result.status}): ${printable}${detail}`);
  }
  return result;
}

function commandExists(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function quoteIfNeeded(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

module.exports = {
  commandExists,
  run
};
