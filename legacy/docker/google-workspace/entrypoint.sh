#!/bin/bash
set -e

# Activate virtual environment if it exists
if [ -d "/app/.venv" ]; then
    source /app/.venv/bin/activate
fi

# Run workspace-mcp with passed arguments
exec python -m workspace_mcp "$@"
