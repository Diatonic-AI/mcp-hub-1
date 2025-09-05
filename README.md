# MCP Hub - Advanced Model Context Protocol Server Manager

[![npm version](https://badge.fury.io/js/mcp-hub.svg)](https://www.npmjs.com/package/mcp-hub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

**The Ultimate MCP Server Orchestrator** - A production-ready platform that acts as a central coordinator for Model Context Protocol (MCP) servers and clients, providing unified access to dozens of AI-powered tools through a single endpoint.

## 🚀 What Is MCP Hub?

MCP Hub transforms the complexity of managing multiple MCP servers into a simple, unified experience. Instead of connecting to individual MCP servers, you connect once to MCP Hub and access all capabilities seamlessly.

### 🎯 **Dual Interface Architecture**

1. **🎛️ Management Interface** (`/api/*`): REST API and web interface for server management
2. **🔗 MCP Server Interface** (`/mcp`): Single endpoint for ALL MCP clients to access ALL server capabilities

### 🔥 **Key Value Proposition**

- **ONE Connection** → Access to 50+ different MCP servers
- **Smart Routing** → Automatically routes requests to the right server
- **Real-time Updates** → Live capability discovery and updates
- **Universal Authentication** → OAuth, API keys, tokens - all handled centrally
- **Production Ready** → Docker support, logging, monitoring, workspace management

### 📊 **Supported Server Types**

| Server Type | Examples | Authentication | Installation |
|-------------|----------|----------------|---------------|
| **NPX Servers** | GitHub, Filesystem, Everything | API Keys | `npx @modelcontextprotocol/server-*` |
| **Python UV Servers** | Fetch, Time, Git, SQLite | Environment | `uv tool install mcp-server-*` |
| **Remote HTTP Servers** | Wix, Perplexity, Custom APIs | OAuth/Bearer | Cloud-hosted endpoints |
| **Custom Builds** | Your own servers | Any method | Local executables |

## 📋 Quick Start Guide

### 🐳 **Docker Installation (Recommended)**

```bash
# 1. Clone the repository
git clone https://github.com/ravitemer/mcp-hub.git
cd mcp-hub

# 2. Copy example configurations
cp .env.example .env
cp config/mcp-servers.json.example config/mcp-servers.json

# 3. Add your API keys to .env and config files

# 4. Start with Docker
docker compose up -d

# 5. Connect any MCP client to:
# http://localhost:37373/mcp
```

### 🎯 **Client Configuration**

Configure any MCP client (Claude Desktop, Cline, etc.) with just ONE endpoint:

```json
{
  "mcpServers": {
    "hub": {
      "url": "http://localhost:37373/mcp"
    }
  }
}
```

That's it! You now have access to ALL configured servers through one connection.

---

## 🛠️ Server Configuration Master Guide

MCP Hub supports **four main types** of MCP servers, each with different setup requirements:

### 🔧 **1. NPX Servers (Node.js based)**

**Best for:** GitHub, Filesystem, Official MCP servers  
**Authentication:** API Keys, Environment Variables  
**Installation:** Automatic via `npx`

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      },
      "description": "GitHub operations - issues, repos, PRs"
    },
    "filesystem": {
      "type": "stdio", 
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"],
      "description": "Secure filesystem operations"
    }
  }
}
```

### 🐍 **2. Python UV Servers (Python based)**

**Best for:** HTTP fetching, Database ops, Utilities  
**Authentication:** Environment Variables  
**Installation:** UV tool management

```json
{
  "mcpServers": {
    "mcp-fetch": {
      "type": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "description": "HTTP/HTTPS fetching capabilities"
    },
    "mcp-sqlite": {
      "type": "stdio",
      "command": "uvx", 
      "args": ["mcp-server-sqlite", "--db-path", "/path/to/database.db"],
      "description": "SQLite database operations"
    }
  }
}
```

### 🌐 **3. Remote HTTP Servers (Cloud-hosted)**

**Best for:** SaaS integrations, OAuth-protected services  
**Authentication:** OAuth 2.0, Bearer tokens  
**Installation:** None (cloud-hosted)

```json
{
  "mcpServers": {
    "wix-mcp-remote": {
      "type": "http",
      "url": "https://mcp.wix.com/mcp",
      "headers": {
        "Authorization": "Bearer ${WIX_API_TOKEN}"
      },
      "description": "Wix site management - OAuth authentication required"
    },
    "perplexity-api": {
      "type": "http",
      "url": "https://api.perplexity.ai/mcp",
      "headers": {
        "Authorization": "Bearer ${PERPLEXITY_API_KEY}",
        "Content-Type": "application/json"
      },
      "description": "Perplexity AI search and Q&A"
    }
  }
}
```

### ⚙️ **4. Custom Executable Servers**

**Best for:** Your own MCP servers, Custom builds  
**Authentication:** Any method you implement  
**Installation:** Custom executable

```json
{
  "mcpServers": {
    "my-custom-server": {
      "type": "stdio",
      "command": "/path/to/my-server",
      "args": ["--config", "${CONFIG_PATH}"],
      "env": {
        "API_KEY": "${MY_API_KEY}",
        "DATABASE_URL": "${DB_CONNECTION}"
      },
      "cwd": "/path/to/server/directory",
      "description": "My custom MCP server"
    }
  }
}
```

---

## 🔐 Authentication Configuration Guide

### **OAuth 2.0 Servers (Wix, Google, etc.)**

1. **Configure the server** with proper OAuth settings:
```json
{
  "wix-mcp-remote": {
    "type": "http",
    "url": "https://mcp.wix.com/mcp",
    "headers": {
      "Authorization": "Bearer ${WIX_API_TOKEN}"
    }
  }
}
```

2. **Start MCP Hub** and check server status:
```bash
curl http://localhost:37373/api/servers
```

3. **If server shows "unauthorized", trigger OAuth flow**:
```bash
curl -X POST http://localhost:37373/api/servers/authorize \
  -H "Content-Type: application/json" \
  -d '{"server_name":"wix-mcp-remote"}'
```

4. **Open the returned authorization URL** in your browser
5. **Complete OAuth flow** - the server will automatically become "connected"

### **API Key Authentication**

1. **Add API keys to your `.env` file**:
```bash
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token_here
PERPLEXITY_API_KEY=pplx-your-key-here
BRAVE_API_KEY=your-brave-key-here
```

2. **Reference in server config**:
```json
{
  "github": {
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
    }
  }
}
```

### **Environment Variable Authentication**

**Global Environment** (applied to ALL servers):
```bash
export MCP_HUB_ENV='{"SHARED_SECRET":"abc123","DATABASE_URL":"postgresql://..."}'
```

**Server-specific Environment**:
```json
{
  "my-server": {
    "env": {
      "SERVER_SPECIFIC_KEY": "${MY_SECRET}",
      "DATABASE_URL": "postgresql://user:${DB_PASSWORD}@localhost/myapp"
    }
  }
}
```

---

## 📦 Pre-configured Server Catalog

MCP Hub comes with **29 pre-configured servers** ready to use. Just add your API keys:

### **🔧 Development & DevOps**
- **GitHub** - Repository operations, issues, PRs
- **GitLab** - GitLab API operations  
- **Git** - Local git repository management
- **Filesystem** - Secure file operations

### **🌐 Web & APIs**
- **Fetch** - HTTP/HTTPS requests and web scraping
- **Puppeteer** - Browser automation and scraping
- **Brave Search** - Web search capabilities

### **🗄️ Databases**
- **PostgreSQL** - Database queries and management
- **SQLite** - Local database operations
- **AWS DynamoDB** - NoSQL database operations

### **☁️ Cloud Services**
- **AWS S3** - Object storage operations
- **AWS Lambda** - Serverless function execution
- **AWS CDK** - Infrastructure as code

### **🏢 Business & Productivity**
- **Wix** - Website management (OAuth)
- **Google Workspace** - Drive, Gmail, Calendar (OAuth)
- **Slack** - Team communication
- **Obsidian** - Note-taking integration

### **🤖 AI & Search**
- **Everything** - Comprehensive testing server
- **Memory** - Knowledge graph system
- **Sequential Thinking** - Step-by-step reasoning
- **Time** - Date and time operations

### **🌍 Infrastructure**
- **Cloudflare** - CDN and DNS management
- **Multiple specialized servers** for docs, workers, radar, browser rendering

---

## 🚀 Installation & Setup Methods

### **Method 1: Docker (Recommended for Production)**

```bash
# Quick start
git clone https://github.com/ravitemer/mcp-hub.git
cd mcp-hub
cp .env.example .env
# Edit .env with your API keys
docker compose up -d
```

### **Method 2: NPM Global Install**

```bash
# Install globally
npm install -g mcp-hub

# Create config directory
mkdir -p ~/.config/mcphub
cp config/mcp-servers.json.example ~/.config/mcphub/mcp-servers.json

# Start the hub
mcp-hub --port 37373 --config ~/.config/mcphub/mcp-servers.json
```

### **Method 3: Development Setup**

```bash
# Clone and setup
git clone https://github.com/ravitemer/mcp-hub.git
cd mcp-hub
npm install

# Development mode with auto-restart
npm run dev -- --port 37373 --config config/mcp-servers.json
```

---

## 🎛️ Advanced Configuration Features

### **Variable Substitution System**

MCP Hub supports powerful variable substitution in ALL configuration fields:

```json
{
  "my-server": {
    "command": "${HOME}/bin/my-server",
    "args": [
      "--token", "${API_TOKEN}",
      "--database", "${cmd: op read op://vault/database/url}",
      "--secret", "${cmd: aws ssm get-parameter --name /app/secret --query Parameter.Value --output text}"
    ],
    "env": {
      "WORKSPACE": "${workspaceFolder}",
      "USER_HOME": "${userHome}",
      "PATH_SEP": "${pathSeparator}"
    }
  }
}
```

**Supported Variables:**
- `${ENV_VAR}` - Environment variables
- `${cmd: command args}` - Command execution
- `${workspaceFolder}` - Current directory
- `${userHome}` - User home directory
- `${pathSeparator}` - OS path separator
- `${input:variable-id}` - VS Code compatibility

### **Development Mode & Hot Reload**

```json
{
  "my-dev-server": {
    "command": "node",
    "args": ["server.js"],
    "dev": {
      "enabled": true,
      "watch": ["src/**/*.js", "**/*.json"],
      "cwd": "/absolute/path/to/server/directory"
    }
  }
}
```

### **Multi-Config File Support**

```bash
# Load multiple configs (merged in order)
mcp-hub --port 37373 \
  --config ~/.config/mcphub/global.json \
  --config ./project-config.json \
  --config ./local-overrides.json
```

### **VS Code Configuration Compatibility**

MCP Hub is **100% compatible** with VS Code MCP configurations:

```bash
# Use your existing VS Code config directly
mcp-hub --port 37373 --config .vscode/mcp.json
```

---

## Source Code Overview (src/)

High-level implementation map for maintainers and LLM agents working only inside `src/`:

- `src/server.js` – Express app & HTTP surface: REST routes (`/api/*`), SSE (`/api/events`), internal MCP streamable-http endpoint (`/mcp`), messages relay (`/messages`), marketplace + centralized tool index endpoints.
- `src/mcp/server.js` – Internal hub MCP endpoint that exposes aggregated capabilities from all managed servers using namespaced identifiers (`<server>__<tool>`). Handles routing + timeout.
- `src/mcp/toolset-registry.js` – Hub meta-tools (`hub__*`) for discovery, search, execution, server listing, HTTP calling; auto-sync to centralized tool index.
- `src/MCPHub.js` – Orchestrator: config ingestion, lifecycle (start/stop/restart), capability updates, event emission, lazy connection, idle timeout.
- `src/MCPConnection.js` – Single server connection abstraction (stdio vs remote), capability fetch, tool/prompt/resource calls, OAuth state, reconnection, uptime tracking.
- `src/marketplace.js` – Registry fetch + caching + README retrieval with curl fallback. Powers `/api/marketplace` endpoints.
- `src/utils/cli.js` – CLI argument parsing (yargs) + startup bootstrap.
- `src/utils/config.js` – Multi-file JSON/JSON5 loader, VS Code compatibility (`servers`→`mcpServers`), diff engine, watcher.
- `src/utils/dev-watcher.js` – Hot reload watcher (glob enumeration + chokidar + debounced change batch events).
- `src/utils/env-resolver.js` – Universal placeholder resolution (`${VAR}`, `${env:}`, `${cmd: ...}`, VS Code predefined vars, recursive with cycle detection, `input:` from `MCP_HUB_ENV`).
- `src/utils/errors.js` – Structured error classes (`ConfigError`, `ConnectionError`, `ServerError`, `ToolError`, `ResourceError`, `ValidationError`).
- `src/utils/logger.js` – Structured JSON logger (console/file/XDG paths, SSE streaming, capability changes, status updates).
- `src/utils/oauth-provider.js` – OAuth PKCE persistence with JSON storage (client info, tokens, code verifier) implementing MCP SDK client interface.
- `src/utils/router.js` – Route registration + introspection for startup banner.
- `src/utils/sse-manager.js` – SSE connection lifecycle (heartbeat, auto-shutdown timers, broadcast helpers, event typing).
- `src/utils/tool-index.js` – Centralized tool index store (registration, search, stats, routing metadata) for `/api/tools/*`.
- `src/utils/workspace-cache.js` – Global instance registry (ports, PIDs, active connections, shutdown timers) with file locking + stale cleanup.
- `src/utils/xdg-paths.js` – XDG directory utilities with legacy fallback.

### Capability Layers
1. Transport: stdio / streamable-http / SSE (handled by `MCPConnection`).
2. Aggregation: `MCPHub` + internal MCP server (`src/mcp/server.js`) consolidate & namespace capabilities.
3. Discovery: Hub meta-tools in `toolset-registry.js` expose search/list/execute primitives.
4. Index: `tool-index.js` provides fast in-memory searchable registry, REST endpoints, routing metadata.
5. Presentation: External clients use `/mcp` (MCP protocol) or REST/SSE API for management & execution.

## 🧠 Hub Meta-Tools & Intelligence

MCP Hub includes **intelligent meta-tools** (prefixed with `hub__*`) that provide discovery, search, and orchestration capabilities across ALL connected servers:

### 🔍 **Discovery & Search Tools**

| Tool | Purpose | Key Arguments |
|------|---------|---------------|
| `hub__list_all_tools` | Lists all tools across servers | `format`: detailed\|simple\|grouped, `refresh`: bool |
| `hub__get_tool_by_name` | Find tool with fuzzy matching | `name`: tool name, `fuzzy`: bool |
| `hub__get_tools_by_server` | Filter tools by server | `server_name`: string, `format`: detailed\|simple |
| `hub__search_tools` | Semantic tool search | `query`: search terms, `format`: detailed\|simple |
| `hub__find_tools` | Regex pattern search | `pattern`: regex, `case_sensitive`: bool |

### 📊 **Server Management Tools**

| Tool | Purpose | Key Arguments |
|------|---------|---------------|
| `hub__list_servers` | List all servers with status | `include_disabled`: bool |
| `hub__get_start_here` | Hub documentation | `format`: markdown\|text\|json |

### ⚡ **Execution & Integration Tools**

| Tool | Purpose | Key Arguments |
|------|---------|---------------|
| `hub__call_tool` | Execute any tool on any server | `server_name`: string, `tool_name`: string, `arguments`: object |
| `hub__chain_tools` | Multi-step tool execution | `chain`: array, `execution_options`: object |
| `hub__call_api` | Generic HTTP requests | `method`: string, `url`: string, `headers`: object, `body`: any |

### 🎧 **Advanced Tool Chaining**

The `hub__chain_tools` provides sophisticated multi-step execution:

```json
{
  "chain": [
    {
      "id": "search",
      "server_name": "brave-search", 
      "tool_name": "search",
      "arguments": {"query": "MCP protocol"}
    },
    {
      "id": "analyze",
      "server_name": "openai",
      "tool_name": "analyze",
      "input_mapping": {
        "content": "search.results[0].text"
      },
      "conditions": {
        "execute_if": "search.results.length > 0"
      }
    }
  ],
  "execution_options": {
    "fail_fast": true,
    "max_parallel": 3
  }
}
```

**Chain Features:**
- **Data Flow**: Pass results between steps using `input_mapping`
- **Conditional Execution**: Use `conditions.execute_if` for logic
- **Parallel Processing**: Execute steps concurrently with `parallel_group`
- **Error Handling**: Continue on errors with `skip_on_error`
- **Retries**: Built-in retry logic with exponential backoff

---

### Centralized Tool Index (REST)
`src/utils/tool-index.js` maintains a canonical in-memory registry updated automatically when servers connect or tools change. REST endpoints (all under `/api`):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/tools/register` | Register (or re-register) a server + tool list. |
| DELETE | `/tools/unregister/:serverName` | Remove a server + its tools. |
| GET | `/tools/list` | List tools (filtering params). |
| GET | `/tools/search` | Pattern search (query `pattern`). |
| GET | `/tools/:toolId` | Detailed tool info. |
| GET | `/tools/:toolId/routing` | Routing metadata for execution. |
| POST | `/tools/:toolId/execute` | Execute via routing (delegates to Hub). |
| GET | `/tools/index/stats` | Index statistics. |
| DELETE | `/tools/index/clear` | Clear entire index (admin). |

Execution path (toolId): index lookup → ensure connection (lazy) → delegate to `MCPHub.callTool` → return MCP content.

Error handling uses classes in `errors.js`; HTTP mapping performed in `src/server.js` via helper.

### Development Guidelines (Focused on src/)
| Target | Rules |
|--------|-------|
| Namespacing | Always `<serverName>__<capabilityName>`; changing delimiter requires README + migration path. |
| Meta-Tools | New hub tools must start `hub__`, validate inputs, return `{ content: [...] }`, avoid blocking > configured timeout without abort handling. |
| Index Consistency | When altering identity or fields in `tool-index.js`, update REST responses + meta-tool formatting + tests. |
| Events | Introduce new SSE event types only after extending enums in `sse-manager.js`. Maintain backward compatible payload shapes. |
| Config Merge | Preserve additive merge of `mcpServers`; non-server keys replaced by later files. Document any new merge semantics. |
| Placeholder Resolver | Add new variable forms with recursion depth limit + cycle detection; update README placeholder section. |
| Logging | Avoid logging secrets (env, headers). Redact new sensitive fields. Keep structured shape stable. |
| Error Surfacing | Wrap unknown errors with `wrapError` or specific custom error class before responding. |
| Tests | Each new feature: success + error + edge (e.g., empty list, invalid pattern). Update WARP.md test count. |

Performance: prefer index lookups over scanning connections; only fall back to live connections if index empty or refresh requested.

Security: OAuth secrets remain only in XDG data JSON; never print raw tokens in logs or SSE events.

Release Steps (summary): increment version → run vitest → update README/WARP.md → generate CHANGELOG entry → publish.

---

## Feature Support

| Category | Feature | Support | Notes |
|----------|---------|---------|-------|
| **Transport** ||||
| | streamable-http | ✅ | Primary transport protocol for remote servers |
| | SSE | ✅ | Fallback transport for remote servers |
| | STDIO | ✅ | For running local servers |
| **Authentication** ||||
| | OAuth 2.0 | ✅ | With PKCE flow |
| | Headers | ✅ | For API keys/tokens |
| **Capabilities** ||||
| | Tools | ✅ | List tools |
| | 🔔 Tool List Changed | ✅ | Real-time updates |
| | Resources | ✅ | Full support |
| | 🔔 Resource List Changed | ✅ | Real-time updates |
| | Resource Templates | ✅ | URI templates |
| | Prompts | ✅ | Full support |
| | 🔔 Prompts List Changed | ✅ | Real-time updates |
| | Roots | ❌ | Not supported |
| | Sampling | ❌ | Not supported |
| | Completion | ❌ | Not supported |
| **Marketplace** ||||
| | Server Discovery | ✅ | Browse available servers |
| | Installation | ✅ | Auto configuration |
| **Real-time** ||||
| | Status Updates | ✅ | Server & connection state |
| | Capability Updates | ✅ | Automatic refresh |
| | Event Streaming to clients | ✅ | SSE-based |
| | Auto Reconnection | ✅ | With backoff |
| **Development** ||||
| | Hot Reload | ✅ | Auto restart a MCP server on file changes with `dev` mode |
| **Configuration** ||||
| | `${}` Syntax | ✅ | Environment variables and command execution across all fields |
| | VS Code Compatibility | ✅ | Support for `servers` key, `${env:}`, `${input:}`, predefined variables |
| | JSON5 Support | ✅ | Comments and trailing commas in configuration files |

## Simplified Client Configuration

Configure all MCP clients with just one endpoint:
```json
{
    "mcpServers" : {
        "Hub": {
            "url" : "http://localhost:37373/mcp"  
        }
    }
}
```

The Hub automatically:
- Namespaces capabilities to prevent conflicts (e.g., `filesystem__search` vs `database__search`)
- Routes requests to the appropriate server
- Updates capabilities in real-time when servers are added/removed
- Handles authentication and connection management

## Key Features

- **Unified MCP Server Endpoint** (/mcp):
  - Single endpoint for ALL MCP clients to connect to
  - Access capabilities from all managed servers through one connection
  - Automatic namespacing prevents conflicts between servers
  - Real-time capability updates when servers change
  - Simplified client configuration - just one endpoint instead of many

- **Dynamic Server Management**:
  - Start, stop, enable/disable servers on demand
  - Real-time configuration updates with automatic server reconnection
  - Support for local (STDIO) and remote (streamable-http/SSE) MCP servers 
  - Health monitoring and automatic recovery
  - OAuth authentication with PKCE flow
  - Header-based token authentication

- **Unified REST API**:
  - Execute tools from any connected server
  - Access resources and resource templates
  - Real-time status updates via Server-Sent Events (SSE)
  - Full CRUD operations for server management

- **Real-time Events & Monitoring**:
  - Live server status and capability updates
  - Client connection tracking
  - Tool and resource list change notifications
  - Structured JSON logging with file output

- **Client Connection Management**:
  - Simple SSE-based client connections via /api/events
  - Automatic connection cleanup on disconnect
  - Optional auto-shutdown when no clients connected
  - Real-time connection state monitoring

- **Process Lifecycle Management**:
  - Graceful startup and shutdown handling
  - Proper cleanup of server connections
  - Error recovery and reconnection

- **Workspace Management**:
  - Track active MCP Hub instances across different working directories
  - Global workspace cache in XDG-compliant state directory
  - Real-time workspace updates via SSE events
  - API endpoints to list and monitor active workspaces

### Components

#### Hub Server
The main management server that:
- Maintains connections to multiple MCP servers
- Provides unified API access to server capabilities
- Handles server lifecycle and health monitoring
- Manages SSE client connections and events
- Processes configuration updates and server reconnection

#### MCP Servers
Connected services that:
- Provide tools, resources, templates, and prompts
- Support two connectivity modes:
  - Script-based STDIO servers for local operations
  - Remote servers (streamable-http/SSE) with OAuth support
- Implement real-time capability updates
- Support automatic status recovery
- Maintain consistent interface across transport types

## Installation

```bash
npm install -g mcp-hub
```

## Basic Usage

Start the hub server:

```bash
mcp-hub --port 3000 --config path/to/config.json

# Or with multiple config files (merged in order)
mcp-hub --port 3000 --config ~/.config/mcphub/global.json --config ./.mcphub/project.json
```

### CLI Options
```bash
Options:
  --port            Port to run the server on (required)
  --config          Path to config file(s). Can be specified multiple times. Merged in order. (required)
  --watch           Watch config file for changes, only updates affected servers (default: false)
  --auto-shutdown   Whether to automatically shutdown when no clients are connected (default: false)
  --shutdown-delay  Delay in milliseconds before shutting down when auto-shutdown is enabled (default: 0)
  -h, --help       Show help information
```

## Configuration

MCP Hub uses JSON configuration files to define managed servers with **universal `${}` placeholder syntax** for environment variables and command execution.

## VS Code Configuration Compatibility

MCP Hub provides seamless compatibility with VS Code's `.vscode/mcp.json` configuration format, enabling you to use the same configuration files across both VS Code and MCP Hub.

### Supported Features

#### Server Configuration Keys
Both `mcpServers` and `servers` keys are supported:

```json
{
  "servers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/"
    },
    "perplexity": {
      "command": "npx", 
      "args": ["-y", "server-perplexity-ask"],
      "env": {
        "API_KEY": "${env:PERPLEXITY_API_KEY}"
      }
    }
  }
}
```

#### Variable Substitution
MCP Hub supports VS Code-style variable substitution:

- **Environment Variables**: `${env:VARIABLE_NAME}` or `${VARIABLE_NAME}`
- **Workspace Variables**: `${workspaceFolder}`, `${userHome}`, `${pathSeparator}`
- **Command Execution**: `${cmd: command args}`

**Supported Predefined Variables:**
- `${workspaceFolder}` - Directory where mcp-hub is running
- `${userHome}` - User's home directory  
- `${pathSeparator}` - OS path separator (/ or \)
- `${workspaceFolderBasename}` - Just the folder name
- `${cwd}` - Alias for workspaceFolder
- `${/}` - VS Code shorthand for pathSeparator

#### VS Code Input Variables
For `${input:}` variables used in VS Code configs, use the `MCP_HUB_ENV` environment variable:

```bash
# Set input variables globally
export MCP_HUB_ENV='{"input:api-key":"your-secret-key","input:database-url":"postgresql://..."}'

# Then use in config
{
  "servers": {
    "myserver": {
      "env": {
        "API_KEY": "${input:api-key}"
      }
    }
  }
}
```

### Migration from VS Code
Existing `.vscode/mcp.json` files work directly with MCP Hub. Simply point MCP Hub to your VS Code configuration:

```bash
mcp-hub --config .vscode/mcp.json --port 3000
```

### Multiple Configuration Files

MCP Hub supports loading multiple configuration files that are merged in order. This enables flexible configuration management:

- **Global Configuration**: System-wide settings (e.g., `~/.config/mcphub/global.json`)
- **Project Configuration**: Project-specific settings (e.g., `./.mcphub/project.json`)
- **Environment Configuration**: Environment-specific overrides

When multiple config files are specified, they are merged with later files overriding earlier ones:

```bash
# Global config is loaded first, then project config overrides
mcp-hub --port 3000 --config ~/.config/mcphub/global.json --config ./.mcphub/project.json
```

**Merge Behavior:**
- `mcpServers` sections are merged (server definitions from later files override earlier ones)
- Other top-level properties are completely replaced by later files
- Missing config files are silently skipped

### Universal Placeholder Syntax

- **`${ENV_VAR}`** or **`${env:ENV_VAR}`** - Resolves environment variables
- **`${cmd: command args}`** - Executes commands and uses output
- **`${workspaceFolder}`** - Directory where mcp-hub is running
- **`${userHome}`** - User's home directory
- **`${pathSeparator}`** - OS path separator
- **`${input:variable-id}`** - Resolves from MCP_HUB_ENV (VS Code compatibility)
- **`null` or `""`** - Falls back to `process.env`

### Configuration Examples

#### Local STDIO Server
```json
{
  "mcpServers": {
    "local-server": {
      "command": "${MCP_BINARY_PATH}/server",
      "args": [
        "--token", "${API_TOKEN}",
        "--database", "${DB_URL}",
        "--secret", "${cmd: op read op://vault/secret}"
      ],
      "env": {
        "API_TOKEN": "${cmd: aws ssm get-parameter --name /app/token --query Parameter.Value --output text}",
        "DB_URL": "postgresql://user:${DB_PASSWORD}@localhost/myapp",
        "DB_PASSWORD": "${cmd: op read op://vault/db/password}",
        "FALLBACK_VAR": null
      },
      "dev": {
        "enabled": true,
        "watch": ["src/**/*.js", "**/*.json"],
        "cwd": "/absolute/path/to/server/directory"
      }
    }
  }
}
```

#### Remote Server
```json
{
  "mcpServers": {
    "remote-server": {
      "url": "https://${PRIVATE_DOMAIN}/mcp",
      "headers": {
        "Authorization": "Bearer ${cmd: op read op://vault/api/token}",
        "X-Custom-Header": "${CUSTOM_VALUE}"
      }
    }
  }
}
```


### Configuration Options

MCP Hub supports both STDIO servers and remote servers (streamable-http/SSE). The server type is automatically detected from the configuration. **All fields support the universal `${}` placeholder syntax.**

#### STDIO Server Options

For running script-based MCP servers locally:

- **command**: Command to start the MCP server executable (supports `${VARIABLE}` and `${cmd: command}`)
- **args**: Array of command line arguments (supports `${VARIABLE}` and `${cmd: command}` placeholders)
- **env**: Environment variables with placeholder resolution and system fallback
- **cwd**: The cwd for process spawning the MCP server
- **dev**: Development mode configuration (optional)
  - **enabled**: Enable/disable dev mode (default: true)
  - **watch**: Array of glob patterns to watch for changes (default: ["**/*.js", "**/*.ts", "**/*.json"])
  - **cwd**: **Required** absolute path to the server's working directory for file watching

##### Global Environment Variables (`MCP_HUB_ENV`)

MCP Hub will look for the environment variable `MCP_HUB_ENV` (a JSON string) in its own process environment. If set, all key-value pairs from this variable will be injected into the environment of every managed MCP server (both stdio and remote). This is useful for passing secrets, tokens, or other shared configuration to all servers without repeating them in each server config.

- Server-specific `env` fields always override values from `MCP_HUB_ENV`.
- Example usage:
  ```sh
  MCP_HUB_ENV='{"DBUS_SESSION_BUS_ADDRESS":"/run/user/1000/bus","MY_TOKEN":"abc"}' mcp-hub --port 3000 --config path/to/config.json
  ```

#### Remote Server Options

For connecting to remote MCP servers:

- **url**: Server endpoint URL (supports `${VARIABLE}` and `${cmd: command}` placeholders)
- **headers**: Authentication headers (supports `${VARIABLE}` and `${cmd: command}` placeholders)

#### Server Type Detection

The server type is determined by:
- STDIO server → Has `command` field
- Remote server → Has `url` field

Note: A server configuration cannot mix STDIO and remote server fields.

#### Placeholder Resolution Order

1. **Commands First**: `${cmd: command args}` are executed first
2. **Environment Variables**: `${VAR}` are resolved from `env` object, then `process.env`
3. **Fallback**: `null` or `""` values fall back to `process.env`
4. **Multi-pass**: Dependencies between variables are resolved automatically

## Nix

### Nixpkgs install

> coming...

### Flake install

Just add it to your NixOS flake.nix or home-manager:

```nix
inputs = {
  mcp-hub.url = "github:ravitemer/mcp-hub";
  ...
}
```

To integrate mcp-hub to your NixOS/Home Manager configuration, add the following to your environment.systemPackages or home.packages respectively:

```nix
inputs.mcp-hub.packages."${system}".default
```

### Usage without install

If you want to use mcphub.nvim without having mcp-hub server in your PATH you can link the server under the hood adding
the mcp-hub nix store path to the `cmd` command in the plugin config like

[Nixvim](https://github.com/nix-community/nixvim) example:
```nix
{ mcphub-nvim, mcp-hub, ... }:
{
  extraPlugins = [mcphub-nvim];
  extraConfigLua = ''
    require("mcphub").setup({
        port = 3000,
  config = vim.fn.expand("~/mcp-hub/config/mcp-servers.json"),
        cmd = "${mcp-hub}/bin/mcp-hub"
    })
  '';
}

# where
{
  # For nixpkgs (not available yet)
  mcp-hub = pkgs.mcp-hub;

  # For flakes
  mcp-hub = inputs.mcp-hub.packages."${system}".default;
}
```

## Example Integrations

### Neovim Integration

The [ravitemer/mcphub.nvim](https://github.com/ravitemer/mcphub.nvim) plugin provides seamless integration with Neovim, allowing direct interaction with MCP Hub from your editor:

- Execute MCP tools directly from Neovim
- Access MCP resources within your editing workflow
- Real-time status updates in Neovim
- Auto install mcp servers with marketplace addition

## 🌐 REST API Reference

MCP Hub provides comprehensive REST APIs for management and tool execution:

### 📊 **Core Management APIs**

#### Health & Status

```bash
# Comprehensive health check
GET /api/health

# Response includes hub state, server statuses, connections, workspaces
{
  "status": "ok",
  "state": "ready", 
  "server_id": "mcp-hub",
  "version": "5.0.0",
  "activeClients": 3,
  "servers": [...],
  "connections": {...},
  "workspaces": {...}
}
```

#### Server Management

```bash
# List all servers
GET /api/servers

# Get server details
POST /api/servers/info
{"server_name": "github"}

# Start server
POST /api/servers/start  
{"server_name": "github"}

# Stop server (optionally disable)
POST /api/servers/stop?disable=true
{"server_name": "github"}

# Trigger OAuth authorization
POST /api/servers/authorize
{"server_name": "wix-mcp-remote"}

# Refresh server capabilities
POST /api/servers/refresh
{"server_name": "github"}

# Restart all servers (reload config)
POST /api/restart
```

### 📎 **Centralized Tool Index APIs**

MCP Hub maintains a centralized, searchable index of ALL tools across ALL servers:

```bash
# List all tools with filtering
GET /api/tools/list?server=github&category=git&format=detailed

# Search tools by pattern
GET /api/tools/search?pattern=file&fuzzy=true

# Get specific tool details
GET /api/tools/github__create_issue

# Get tool routing information
GET /api/tools/github__create_issue/routing

# Execute tool via index
POST /api/tools/github__create_issue/execute
{
  "arguments": {
    "owner": "user",
    "repo": "repo", 
    "title": "Bug report",
    "body": "Description..."
  }
}

# Register external tools (for custom integrations)
POST /api/tools/register
{
  "serverName": "my-server",
  "tools": [...]
}

# Get index statistics
GET /api/tools/index/stats
{
  "totalTools": 156,
  "totalServers": 29,
  "lastUpdated": "2025-01-17T10:00:00Z",
  "byServer": {...},
  "byCategory": {...}
}
```

### ⚙️ **Tool Execution APIs**

```bash
# Execute tool on specific server
POST /api/servers/tools
{
  "server_name": "github",
  "tool": "create_issue", 
  "arguments": {
    "owner": "user",
    "repo": "repo",
    "title": "Issue title", 
    "body": "Issue description"
  },
  "request_options": {
    "timeout": 30000
  }
}

# Access resource
POST /api/servers/resources
{
  "server_name": "filesystem",
  "uri": "file:///path/to/file.txt",
  "request_options": {}
}

# Execute prompt
POST /api/servers/prompts
{
  "server_name": "openai", 
  "prompt": "code_review",
  "arguments": {
    "code": "function example() { ... }",
    "language": "javascript"
  }
}
```

### 🌍 **Marketplace Integration**

```bash
# Browse available servers
GET /api/marketplace?search=database&category=data&sort=stars

# Get server details with README
POST /api/marketplace/details
{"mcpId": "postgres-server"}

# Response includes installation instructions
{
  "server": {...},
  "readmeContent": "# PostgreSQL MCP Server...",
  "installations": [
    {
      "type": "npm",
      "command": "npx @db/mcp-postgres"
    }
  ]
}
```

### 📍 **Workspace Management**

```bash
# List active workspaces
GET /api/workspaces

# Response shows all running MCP Hub instances
{
  "workspaces": {
    "37373": {
      "cwd": "/path/to/project-a",
      "config_files": [...],
      "pid": 12345,
      "state": "active",
      "activeConnections": 2
    }
  }
}
```

---

## 🔄 Real-time Events System

MCP Hub provides comprehensive real-time updates via Server-Sent Events:

### 🔌 **Connect to Events**

```javascript
// Connect to real-time events
const eventSource = new EventSource('http://localhost:37373/api/events');

eventSource.addEventListener('hub_state', (event) => {
  const data = JSON.parse(event.data);
  console.log('Hub state:', data.state); // starting, ready, error, etc.
});

eventSource.addEventListener('subscription_event', (event) => {
  const data = JSON.parse(event.data);
  switch(data.type) {
    case 'tool_list_changed':
      console.log('Tools updated:', data.server);
      break;
    case 'servers_updated': 
      console.log('Servers changed:', data.changes);
      break;
  }
});
```

### 📢 **Event Types**

| Event Type | Trigger | Data |
|------------|---------|------|
| `hub_state` | Hub status changes | `state`, `version`, `port` |
| `heartbeat` | Periodic health | `connections`, `timestamp` |
| `log` | Server logs | `type`, `message`, `data` |
| `config_changed` | Config file updated | `newConfig`, `isSignificant` |
| `servers_updating` | Server changes start | `changes: {added, removed, modified}` |
| `servers_updated` | Server changes complete | `changes: {added, removed, modified}` |
| `tool_list_changed` | Tools updated | `server`, `tools` |
| `resource_list_changed` | Resources updated | `server`, `resources` |
| `prompt_list_changed` | Prompts updated | `server`, `prompts` |
| `workspaces_updated` | Active workspaces changed | `workspaces` |

---

### Health and Status

#### Health Check

```bash
GET /api/health
```

The health endpoint provides comprehensive status information including:
- Current hub state (starting, ready, restarting, restarted, stopping, stopped, error)
- Connected server statuses and capabilities
- Active SSE connection details
- Detailed connection metrics
- Error state details if applicable

Response:
```json
{
  "status": "ok",
  "state": "ready",
  "server_id": "mcp-hub",
  "version": "4.1.1",
  "activeClients": 2,
  "timestamp": "2024-02-20T05:55:00.000Z",
  "servers": [],
  "connections": {
    "totalConnections": 2,
    "connections": [
      {
        "id": "client-uuid",
        "state": "connected",
        "connectedAt": "2024-02-20T05:50:00.000Z",
        "lastEventAt": "2024-02-20T05:55:00.000Z"
      }
    ]
  },
  "workspaces": {
    "current": "40123",
    "allActive": {
      "40123": {
        "cwd": "/path/to/project-a",
        "config_files": ["/home/user/.config/mcphub/global.json", "/path/to/project-a/.mcphub/project.json"],
        "pid": 12345,
        "port": 40123,
        "startTime": "2025-01-17T10:00:00.000Z",
        "state": "active",
        "activeConnections": 2,
        "shutdownStartedAt": null,
        "shutdownDelay": null
      }
    }
  }
}
```

#### List MCP Servers

```bash
GET /api/servers
```

#### Get Server Info

```bash
POST /api/servers/info
Content-Type: application/json

{
  "server_name": "example-server"
}
```

#### Refresh Server Capabilities

```bash
POST /api/servers/refresh
Content-Type: application/json

{
  "server_name": "example-server"
}
```

Response:

```json
{
  "status": "ok",
  "server": {
    "name": "example-server",
    "capabilities": {
      "tools": ["tool1", "tool2"],
      "resources": ["resource1", "resource2"],
      "resourceTemplates": []
    }
  },
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

#### Refresh All Servers

```bash
POST /api/refresh
```

Response:

```json
{
  "status": "ok",
  "servers": [
    {
      "name": "example-server",
      "capabilities": {
        "tools": ["tool1", "tool2"],
        "resources": ["resource1", "resource2"],
        "resourceTemplates": []
      }
    }
  ],
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

#### Start Server

```bash
POST /api/servers/start
Content-Type: application/json

{
  "server_name": "example-server"
}
```

Response:

```json
{
  "status": "ok",
  "server": {
    "name": "example-server",
    "status": "connected",
    "uptime": 123
  },
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

#### Stop Server

```bash
POST /api/servers/stop?disable=true|false
Content-Type: application/json

{
  "server_name": "example-server"
}
```

The optional `disable` query parameter can be set to `true` to disable the server in the configuration.

Response:

```json
{
  "status": "ok",
  "server": {
    "name": "example-server",
    "status": "disconnected",
    "uptime": 0
  },
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

### Workspace Management

#### List Active Workspaces

```bash
GET /api/workspaces
```

Response:

```json
{
  "workspaces": {
    "40123": {
      "cwd": "/path/to/project-a",
      "config_files": ["/home/user/.config/mcphub/global.json", "/path/to/project-a/.mcphub/project.json"],
      "pid": 12345,
      "port": 40123,
      "startTime": "2025-01-17T10:00:00.000Z",
      "state": "active",
      "activeConnections": 2,
      "shutdownStartedAt": null,
      "shutdownDelay": null
    },
    "40567": {
      "cwd": "/path/to/project-b",
      "config_files": ["/home/user/.config/mcphub/global.json"],
      "pid": 54321,
      "port": 40567,
      "startTime": "2025-01-17T10:05:00.000Z",
      "state": "shutting_down",
      "activeConnections": 0,
      "shutdownStartedAt": "2025-01-17T10:15:00.000Z",
      "shutdownDelay": 600000
    }
  },
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

### Marketplace Integration

#### List Available Servers

```bash
GET /api/marketplace
```

Query Parameters:

- `search`: Filter by name, description, or tags
- `category`: Filter by category
- `tags`: Filter by comma-separated tags
- `sort`: Sort by "newest", "stars", or "name"

Response:

```json
{
  "servers": [
    {
      "id": "example-server",
      "name": "Example Server",
      "description": "Description here",
      "author": "example-author",
      "url": "https://github.com/user/repo",
      "category": "search",
      "tags": ["search", "ai"],
      "stars": 100,
      "featured": true,
      "verified": true,
      "lastCommit": 1751257963,
      "updatedAt": 1751265038
    }
  ],
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

#### Get Server Details

```bash
POST /api/marketplace/details
Content-Type: application/json

{
  "mcpId": "example-server"
}
```

Response:

```json
{
  "server": {
    "id": "example-server",
    "name": "Example Server",
    "description": "Description here",
    "author": "example-author",
    "url": "https://github.com/user/repo",
    "category": "search",
    "tags": ["search", "ai"],
    "installations": [],
    "stars": 100,
    "featured": true,
    "verified": true,
    "lastCommit": 1751257963,
    "updatedAt": 1751265038
  },
  "readmeContent": "# Server Documentation...",
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

### MCP Server Operations

#### Execute Tool

```bash
POST /api/servers/tools
Content-Type: application/json

{
  "server_name": "example-server",
  "tool": "tool_name",
  "arguments": {},
  "request_options" : {}
}
```

#### Access Resource

```bash
POST /api/servers/resources
Content-Type: application/json

{
  "server_name": "example-server",
  "uri": "resource://uri",
  "request_options" : {}
}
```

#### Get Prompt

```bash
POST /api/servers/prompts
Content-Type: application/json

{
  "server_name": "example-server",
  "prompt": "prompt_name",
  "arguments": {},
  "request_options" : {}
}
```

Response:

```json
{
  "result": {
    "messages": [
      {
        "role": "assistant",
        "content": {
          "type": "text",
          "text": "Text response example"
        }
      },
      {
        "role": "assistant",
        "content": {
          "type": "image",
          "data": "base64_encoded_image_data",
          "mimeType": "image/png"
        }
      }
    ]
  },
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

#### Restart Hub

```bash
POST /api/restart
```

Reloads the configuration file and restarts all MCP servers.

Response:

```json
{
  "status": "ok",
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

## Real-time Events System

MCP Hub implements a comprehensive real-time events system using Server-Sent Events (SSE) at `/api/events`. This endpoint provides live updates about server status, configuration changes, capability updates, and more.

### Hub States

The hub server transitions through several states during its lifecycle:

| State | Description |
|-------|-------------|
| `starting` | Initial startup, loading configuration |
| `ready` | Server is running and ready to handle requests |
| `restarting` | Reloading configuration/reconnecting servers |
| `restarted` | Configuration reload complete |
| `stopping` | Graceful shutdown in progress |
| `stopped` | Server has fully stopped |
| `error` | Error state (includes error details) |

You can monitor these states through the `/health` endpoint or SSE events.

### Event Types

MCP Hub emits several types of events:

#### Core Events

1. **heartbeat** - Periodic connection health check
```json
{
  "connections": 2,
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

2. **hub_state** - Hub server state changes
```json
{
  "state": "ready",
  "server_id": "mcp-hub",
  "version": "1.0.0",
  "pid": 12345,
  "port": 3000,
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

3. **log** - Server log messages
```json
{
  "type": "info",
  "message": "Server started",
  "data": {},
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

#### Subscription Events

1. **config_changed** - Configuration file changes detected
```json
{
  "type": "config_changed",
  "newConfig": {},
  "isSignificant": true,
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

2. **servers_updating** - Server updates in progress
```json
{
  "type": "servers_updating",
  "changes": {
    "added": ["server1"],
    "removed": [],
    "modified": ["server2"],
    "unchanged": ["server3"]
  },
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

3. **servers_updated** - Server updates completed
```json
{
  "type": "servers_updated",
  "changes": {
    "added": ["server1"],
    "removed": [],
    "modified": ["server2"],
    "unchanged": ["server3"]
  },
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

4. **tool_list_changed** - Server's tools list updated
```json
{
  "type": "tool_list_changed",
  "server": "example-server",
  "tools": ["tool1", "tool2"],
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

5. **resource_list_changed** - Server's resources/templates updated
```json
{
  "type": "resource_list_changed",
  "server": "example-server",
  "resources": ["resource1", "resource2"],
  "resourceTemplates": [],
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

6. **prompt_list_changed** - Server's prompts list updated
```json
{
  "type": "prompt_list_changed",
  "server": "example-server",
  "prompts": ["prompt1", "prompt2"],
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

7. **workspaces_updated** - Active workspaces changed
```json
{
  "type": "workspaces_updated",
  "workspaces": {
    "40123": {
      "cwd": "/path/to/project-a",
      "config_files": ["/home/user/.config/mcphub/global.json", "/path/to/project-a/.mcphub/project.json"],
      "pid": 12345,
      "port": 40123,
      "startTime": "2025-01-17T10:00:00.000Z",
      "state": "active",
      "activeConnections": 2,
      "shutdownStartedAt": null,
      "shutdownDelay": null
    }
  },
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

### Connection Management

- Each SSE connection is assigned a unique ID
- Connections are automatically cleaned up on client disconnect
- Connection statistics available via `/health` endpoint
- Optional auto-shutdown when no clients are connected

## Logging

MCP Hub uses structured JSON logging for all events. Logs are written to both console and file following XDG Base Directory Specification:

- **XDG compliant**: `$XDG_STATE_HOME/mcp-hub/logs/mcp-hub.log` (typically `~/.local/state/mcp-hub/logs/mcp-hub.log`)
- **Legacy fallback**: `~/.mcp-hub/logs/mcp-hub.log` (for backward compatibility)

Example log entry:

```json
{
  "type": "error",
  "code": "TOOL_ERROR",
  "message": "Failed to execute tool",
  "data": {
    "server": "example-server",
    "tool": "example-tool",
    "error": "Invalid parameters"
  },
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

Log levels include:

- `info`: Normal operational messages
- `warn`: Warning conditions
- `debug`: Detailed debug information (includes configuration changes)
- `error`: Error conditions (includes error code and stack trace)

Logs are rotated daily and kept for 30 days by default.

## Workspace Cache

MCP Hub maintains a global workspace cache to track active instances across different working directories with real-time lifecycle management:

- **Cache Location**: `$XDG_STATE_HOME/mcp-hub/workspaces.json` (typically `~/.local/state/mcp-hub/workspaces.json`)
- **Purpose**: Prevents port conflicts, enables workspace discovery, and provides real-time lifecycle tracking
- **Content**: Maps port numbers (as keys) to hub process information with detailed lifecycle state
- **Cleanup**: Automatically removes stale entries when processes are no longer running

### Cache Structure

```json
{
  "40123": {
    "cwd": "/path/to/project-a",
    "config_files": ["/home/user/.config/mcphub/global.json", "/path/to/project-a/.mcphub/project.json"],
    "pid": 12345,
    "port": 40123,
    "startTime": "2025-01-17T10:00:00.000Z",
    "state": "active",
    "activeConnections": 2,
    "shutdownStartedAt": null,
    "shutdownDelay": null
  },
  "40567": {
    "cwd": "/path/to/project-b", 
    "config_files": ["/home/user/.config/mcphub/global.json"],
    "pid": 54321,
    "port": 40567,
    "startTime": "2025-01-17T10:05:00.000Z",
    "state": "shutting_down",
    "activeConnections": 0,
    "shutdownStartedAt": "2025-01-17T10:15:00.000Z",
    "shutdownDelay": 600000
  }
}
```

## Error Handling

MCP Hub implements a comprehensive error handling system with custom error classes for different types of errors:

### Error Classes

- **ConfigError**: Configuration-related errors (invalid config, missing fields)
- **ConnectionError**: Server connection issues (failed connections, transport errors)
- **ServerError**: Server startup/initialization problems
- **ToolError**: Tool execution failures
- **ResourceError**: Resource access issues
- **ValidationError**: Request validation errors

Each error includes:

- Error code for easy identification
- Detailed error message
- Additional context in the details object
- Stack trace for debugging

Example error structure:

```json
{
  "code": "CONNECTION_ERROR",
  "message": "Failed to communicate with server",
  "details": {
    "server": "example-server",
    "error": "connection timeout"
  },
  "timestamp": "2024-02-20T05:55:00.000Z"
}
```

## Architecture

### Hub Server Lifecycle

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Hub Server
    participant M1 as MCP Server 1
    participant M2 as MCP Server 2

    Note over H: Server Start (state: starting)
    activate H
    
    Note over H: Config Loading
    H->>H: Load & Validate Config
    H->>H: Watch Config File
    H->>H: Initialize SSE Manager
    
    Note over H: Server Connections (state: ready)
    H->>+M1: Connect
    M1-->>-H: Connected + Capabilities
    H->>+M2: Connect
    M2-->>-H: Connected + Capabilities
    H-->>C: hub_state (ready)

    Note over C,H: Client Setup
    C->>H: Connect to /api/events (SSE)
    H-->>C: connection_opened
    
    Note over C,H: Client Operations
    C->>H: Execute Tool (HTTP)
    H->>M1: Execute Tool
    M1-->>H: Tool Result
    H-->>C: HTTP Response
    
    Note over H,C: Real-time Updates
    H->>H: Detect Config Change
    H-->>C: servers_updating (SSE)
    H->>M1: Reconnect with New Config
    M1-->>H: Updated Capabilities
    H-->>C: servers_updated (SSE)

    Note over H,C: Server Events
    M2->>H: Tool List Changed
    H-->>C: tool_list_changed (SSE)
    
    Note over H: Shutdown Process
    Note over C,H: Client Disconnects
    H-->>C: hub_state (stopping) (SSE)
    H->>M1: Disconnect
    H->>M2: Disconnect
    H-->>C: hub_state (stopped) (SSE)
    deactivate H
```

The Hub Server coordinates communication between clients and MCP servers:

1. Starts and connects to configured MCP servers
2. Handles SSE client connections and events
3. Routes tool and resource requests to appropriate servers
4. Monitors server health and maintains capabilities
5. Manages graceful startup/shutdown processes

### MCP Server Management

```mermaid
flowchart TB
    A[Hub Server Start] --> B{Config Available?}
    B -->|Yes| C[Load Server Configs]
    B -->|No| D[Use Default Settings]
    
    C --> E[Initialize Connections]
    D --> E
    
    E --> F{For Each MCP Server}
    F -->|Enabled| G[Attempt Connection]
    F -->|Disabled| H[Skip Server]
    
    G --> I{Connection Status}
    I -->|Success| J[Fetch Capabilities]
    I -->|Failure| K[Log Error]
    
    J --> L[Store Server Info]
    K --> M[Mark Server Unavailable]
    
    L --> N[Monitor Health]
    M --> N
    
    N --> O{Health Check}
    O -->|Healthy| P[Update Capabilities]
    O -->|Unhealthy| Q[Attempt Reconnect]
    
    Q -->|Success| P
    Q -->|Failure| R[Update Status]
    
    P --> N
    R --> N
```

The Hub Server actively manages MCP servers through:

1. Configuration-based server initialization
2. Connection and capability discovery
3. Health monitoring and status tracking
4. Automatic reconnection attempts
5. Server state management

### Request Handling

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Hub Server
    participant M as MCP Server
    
    Note over C,H: Tool Execution
    C->>H: POST /api/servers/tools (HTTP)
    H->>H: Validate Request & Server
    
    alt Server Not Connected
        H-->>C: 503 Server Unavailable (HTTP)
    else Server Connected
        H->>M: Execute Tool
        
        alt Success
            M-->>H: Tool Result
            H-->>C: Result Response (HTTP)
        else Error
            M-->>H: Error Details
            H-->>C: Error Response (HTTP)
            H-->>C: log (SSE Event)
        end
    end
    
    Note over C,H: Resource Access
    C->>H: POST /api/servers/resources (HTTP)
    H->>H: Validate URI & Template
    
    alt Invalid Resource
        H-->>C: 404 Not Found (HTTP)
    else Server Not Connected
        H-->>C: 503 Unavailable (HTTP)
    else Valid Request
        H->>M: Request Resource
        
        alt Success
            M-->>H: Resource Data
            H-->>C: Resource Content (HTTP)
        else Error
            M-->>H: Error Details
            H-->>C: Error Response (HTTP)
            H-->>C: log (SSE Event)
        end
    end
    
    Note over C,H: Prompt Execution
    C->>H: POST /api/servers/prompts (HTTP)
    H->>H: Validate Prompt & Args
    
    alt Invalid Prompt
        H-->>C: 404 Not Found (HTTP)
    else Server Not Connected
        H-->>C: 503 Unavailable (HTTP)
    else Valid Request
        H->>M: Execute Prompt
        
        alt Success
            M-->>H: Messages Array
            H-->>C: Messages Response (HTTP)
        else Error
            M-->>H: Error Details
            H-->>C: Error Response (HTTP)
            H-->>C: log (SSE Event)
        end
    end
```

All client requests follow a standardized flow:

1. Request validation
2. Server status verification
3. Request routing to appropriate MCP server
4. Response handling and error management

## Requirements

- Node.js >= 18.0.0

## MCP Registry

MCP Hub now uses the [MCP Registry](https://github.com/ravitemer/mcp-registry) system for marketplace functionality. This provides:

- **Decentralized Server Discovery**: Registry hosted on GitHub Pages for better reliability
- **Direct GitHub Integration**: README documentation fetched directly from repositories
- **Enhanced Metadata**: Comprehensive server information including stars, categories, and installation instructions
- **Better Caching**: Improved cache system with 1-hour TTL for frequent updates
- **Fallback Support**: Automatic fallback to curl when fetch fails (useful for proxy/VPN environments)

The registry is updated regularly with new servers and improvements to existing entries.

## Todo

- [x] Implement custom marketplace rather than depending on mcp-marketplace
- [x] Centralized tool index REST API layer
- [x] Hub meta-tool discovery & execution helpers
- [ ] TUI like mcphub.nvim
- [ ] Web UI for managing servers

## Acknowledgements

- [ravitemer/mcp-registry](https://github.com/ravitemer/mcp-registry) - For providing the MCP server marketplace endpoints that power MCP Hub's marketplace integration
