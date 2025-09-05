#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startServer } from "../server.js";
import logger from "./logger.js";
import { readFileSync } from 'fs';
import {
  isMCPHubError,
} from "./errors.js";
import { fileURLToPath } from "url";
import { join } from "path";

// VERSION will be injected from package.json during build
/* global process.env.VERSION */


// Get version either from build-time define or runtime package.json
let appVersion;
if (typeof process.env.VERSION !== 'undefined' && process.env.VERSION !== 'v0.0.0') {
  // Production build with injected version
  appVersion = process.env.VERSION;
} else {
  // Development mode - read from package.json
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const pkgPath = join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  appVersion = pkg.version;
}

// Custom failure handler for yargs
function handleParseError(msg, err) {
  // Ensure CLI parsing errors exit immediately with proper code
  // Use direct console.error for CLI errors to avoid SSE broadcast issues
  console.error(JSON.stringify({
    type: 'error',
    code: 'CLI_ARGS_ERROR',
    message: 'Failed to parse command line arguments',
    data: {
      message: msg || "Missing required arguments",
      help: "Use --help to see usage information",
      error: err?.message,
    },
    timestamp: new Date().toISOString()
  }));
  process.exit(1);
}


async function run() {
  const argv = yargs(hideBin(process.argv))
    .usage("Usage: mcp-hub [options]")
    .version(appVersion || "v0.0.0")
    .options({
      port: {
        alias: "p",
        describe: "Port to run the server on",
        type: "number",
        demandOption: true,
      },
      host: {
        alias: "H",
        describe: "Host to bind the server to",
        type: "string",
        default: "localhost",
      },
      config: {
        alias: "c",
        describe: "Path to config file(s). Can be specified multiple times. Merged in order.",
        type: "array",
        demandOption: true,
      },
      watch: {
        alias: "w",
        describe: "Watch for config file changes",
        type: "boolean",
        default: false,
      },
      "auto-shutdown": {
        describe: "Whether to automatically shutdown when no clients are connected",
        type: "boolean",
        default: false
      },
      "shutdown-delay": {
        describe:
          "Delay in milliseconds before shutting down when auto-shutdown is enabled and no clients are connected",
        type: "number",
        default: 0,
      },
      "hub-server-url": {
        describe: "Base URL for OAuth callbacks (e.g., http://localhost:3000). Defaults to http://host:port",
        type: "string",
      },
    })
    .example("mcp-hub --port 3000 --config ./global.json --config ./project.json")
    .help("h")
    .alias("h", "help")
    .fail(handleParseError).argv;

  try {
    // Normalize config: if array of length 1, return single string to match tests
    const config = Array.isArray(argv.config) && argv.config.length === 1 ? argv.config[0] : argv.config;
    await startServer({
      port: argv.port,
      host: argv.host,
      config,
      watch: argv.watch,
      autoShutdown: argv["auto-shutdown"],
      shutdownDelay: argv["shutdown-delay"],
      hubServerUrl: argv["hub-server-url"]
    });
  } catch (error) {
    // Log the error but don't forcefully shutdown unless it's fatal
    console.error('Failed to start server:', error.message);
    
    // Only exit for fatal startup errors, not runtime errors
    if (error.message.includes('EADDRINUSE') || error.message.includes('EACCES')) {
      process.exit(1);
    }
    // For other errors, let the server continue running if possible
  }
}

run()
