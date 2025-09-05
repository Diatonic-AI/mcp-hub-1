# Configuration Layering Guide

This project supports layering multiple JSON config files via repeated `--config` flags. Later files override earlier ones, providing a clean way to manage dev/staging/prod behavior without modifying scripts.

Key points
- Order matters: `--config base.json --config dev.json` → dev overrides base
- Centralized: All runtime behavior (including hub visibility/lazy-load) belongs in these config files, not shell scripts
- Safe toggles: Use overlays to enable features in dev while leaving production default behavior intact

Example files
- configs/base.json
- configs/dev.json
- configs/prod.json

Usage
- Development (meta-only + lazy-load enabled):
  ./dist/cli.js \
    --port 37373 \
    --config configs/base.json \
    --config configs/dev.json \
    --watch

- Production (default behavior):
  ./dist/cli.js \
    --port 37373 \
    --config configs/base.json \
    --config configs/prod.json

Overlay examples
- configs/base.json: Common servers
- configs/dev.json:
  {
    "hub": {
      "metaOnly": true,
      "lazyLoad": true,
      "idleTimeoutMs": 240000
    }
  }
- configs/prod.json:
  {
    "hub": {
      "metaOnly": false,
      "lazyLoad": false,
      "idleTimeoutMs": 300000
    }
  }

Notes
- You can add more overlays (e.g., staging.json) and append them at the end of the command.
- The hub reads `hub.metaOnly`, `hub.lazyLoad`, and `hub.idleTimeoutMs` from the merged config.
- Keep secrets out of config files or inject via environment variables resolved by the hub.

