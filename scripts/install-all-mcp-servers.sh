#!/usr/bin/env bash
# Install and configure all available MCP servers
set -euo pipefail

echo "🚀 Installing and configuring all available MCP servers..."

# Install Python-based servers via uv
echo "📦 Installing Python MCP servers via uv..."

# These don't require special config
PYTHON_SERVERS=(
  "mcp-server-docker"
  "mcp-server-shell"
  "mcp-server-web-browser"
  "mcp-server-web-search"
)

for server in "${PYTHON_SERVERS[@]}"; do
  echo "Installing $server..."
  uv tool install "$server" || echo "⚠️ Failed to install $server"
done

# Try to install qdrant server (might fail if qdrant not available)
echo "Installing mcp-server-qdrant (may fail if Qdrant not available)..."
uv tool install mcp-server-qdrant || echo "⚠️ Failed to install mcp-server-qdrant"

# Install SQLite server via npm
echo "📦 Installing SQLite server..."
npx -y @modelcontextprotocol/server-sqlite --help || echo "⚠️ Failed to install SQLite server"

# Install Brave Search server (needs API key)
echo "📦 Installing Brave Search server..."
npx -y @modelcontextprotocol/server-brave-search --help || echo "⚠️ Failed to install Brave Search server"

# Install GitLab server (needs token)
echo "📦 Installing GitLab server..."
npx -y @modelcontextprotocol/server-gitlab --help || echo "⚠️ Failed to install GitLab server"

# Install Slack server (needs token)
echo "📦 Installing Slack server..."
npx -y @modelcontextprotocol/server-slack --help || echo "⚠️ Failed to install Slack server"

# Install Cloudflare server
echo "📦 Installing Cloudflare server..."
npx -y @modelcontextprotocol/server-cloudflare --help || echo "⚠️ Failed to install Cloudflare server"

# Install Everart server  
echo "📦 Installing Everart server..."
npx -y @modelcontextprotocol/server-everart --help || echo "⚠️ Failed to install Everart server"

# Install Sentry server (needs DSN)
echo "📦 Installing Sentry server..."
npx -y @modelcontextprotocol/server-sentry --help || echo "⚠️ Failed to install Sentry server"

# Configure AWS CDK and DynamoDB servers that are already installed
echo "📦 Configuring AWS servers..."

# Create extended configuration
cat > config/mcp-servers-extended.json << 'EOCONFIG'
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/daclab-ai"]
    },
    "mcp-everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    },
    "mcp-fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    },
    "mcp-git": {
      "command": "uvx",
      "args": ["mcp-server-git", "--repository", "/home/daclab-ai/dev/mcp-hub"]
    },
    "mcp-memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "mcp-sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    },
    "mcp-time": {
      "command": "uvx",
      "args": ["mcp-server-time"]
    },
    "mcp-google-maps": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-google-maps"],
      "env": {
        "GOOGLE_MAPS_API_KEY": "${GOOGLE_MAPS_API_KEY}"
      }
    },
    "mcp-postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://mcp_user:daclab2024@10.10.10.11:5432/mcp_ml_dev"]
    },
    "mcp-puppeteer": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "mcp-sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "/home/daclab-ai/dev/mcp-hub/data/mcp.db"]
    },
    "mcp-docker": {
      "command": "uvx",
      "args": ["mcp-server-docker"]
    },
    "mcp-shell": {
      "command": "uvx",
      "args": ["mcp-server-shell"]
    },
    "mcp-web-browser": {
      "command": "uvx",
      "args": ["mcp-server-web-browser"]
    },
    "mcp-web-search": {
      "command": "uvx",
      "args": ["mcp-server-web-search"]
    },
    "aws-cdk": {
      "command": "uvx",
      "args": ["awslabs.cdk-mcp-server"],
      "env": {
        "AWS_REGION": "${AWS_REGION:-us-east-1}"
      }
    },
    "aws-dynamodb": {
      "command": "uvx",
      "args": ["awslabs.dynamodb-mcp-server"],
      "env": {
        "AWS_REGION": "${AWS_REGION:-us-east-1}"
      }
    }
  }
}
EOCONFIG

# Add optional servers if API keys are available
if [ ! -z "${BRAVE_API_KEY:-}" ]; then
  echo "Adding Brave Search server (API key found)..."
  cat >> config/mcp-servers-extended.json << 'EOBRAVECONFIG'
    ,
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      }
    }
EOBRAVECONFIG
fi

if [ ! -z "${GITLAB_TOKEN:-}" ]; then
  echo "Adding GitLab server (token found)..."
  cat >> config/mcp-servers-extended.json << 'EOGITLABCONFIG'
    ,
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-gitlab"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "${GITLAB_TOKEN}",
        "GITLAB_API_URL": "${GITLAB_API_URL:-https://gitlab.com/api/v4}"
      }
    }
EOGITLABCONFIG
fi

if [ ! -z "${SLACK_TOKEN:-}" ]; then
  echo "Adding Slack server (token found)..."
  cat >> config/mcp-servers-extended.json << 'EOSLACKCONFIG'
    ,
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_TOKEN}"
      }
    }
EOSLACKCONFIG
fi

if [ ! -z "${SENTRY_DSN:-}" ]; then
  echo "Adding Sentry server (DSN found)..."
  cat >> config/mcp-servers-extended.json << 'EOSENTRYCONFIG'
    ,
    "sentry": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sentry"],
      "env": {
        "SENTRY_DSN": "${SENTRY_DSN}",
        "SENTRY_ORG": "${SENTRY_ORG:-}",
        "SENTRY_PROJECT": "${SENTRY_PROJECT:-}"
      }
    }
EOSENTRYCONFIG
fi

# Close the JSON properly
echo '  }' >> config/mcp-servers-extended.json
echo '}' >> config/mcp-servers-extended.json

echo "✅ Extended configuration created at config/mcp-servers-extended.json"
echo ""
echo "📊 Summary:"
echo "  - Base servers: 11 (already working)"
echo "  - SQLite: Added"
echo "  - Docker: Added"
echo "  - Shell: Added"
echo "  - Web Browser: Added"
echo "  - Web Search: Added"
echo "  - AWS CDK: Added"
echo "  - AWS DynamoDB: Added"
echo ""
echo "🔑 Servers requiring API keys (not added):"
echo "  - Brave Search: Set BRAVE_API_KEY env variable"
echo "  - GitLab: Set GITLAB_TOKEN env variable"
echo "  - Slack: Set SLACK_TOKEN env variable"
echo "  - Sentry: Set SENTRY_DSN env variable"
echo "  - Cloudflare: Requires OAuth setup"
echo "  - Everart: Requires special configuration"
echo ""
echo "To use the extended configuration:"
echo "  cp config/mcp-servers-extended.json config/mcp-servers.json"
echo "  npm start"
