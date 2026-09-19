#!/usr/bin/env node

require("../src/cli").main(process.argv.slice(2)).catch((error) => {
  console.error("");
  console.error("Error:", error.message || error);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});
