# Advanced Server Loading - Quick Start Guide

## 🚀 What's New

The MCP Hub now features intelligent server loading that automatically manages server lifecycles for optimal performance and resource usage.

## ⚡ Immediate Benefits

- **Faster startup**: Core tools available in under 2 seconds
- **Reduced memory usage**: Servers auto-unload after 6 minutes of inactivity  
- **Persistent tools**: Tool registry survives container restarts
- **Smart loading**: Remaining servers load automatically during idle periods

## 📋 Quick Test Commands

### 1. Check Advanced Loading Status
```bash
curl -s http://localhost:37373/api/servers/loading-status | jq .
```

**Expected Response:**
```json
{
  "status": "ok",
  "loadingManager": {
    "uptime": 120000,
    "batchLoadingActive": false,
    "loadingQueueLength": 16,
    "coreServersLoaded": 8,
    "statusBreakdown": {
      "connected": 8,
      "idle": 16
    },
    "persistentRegistry": {
      "enabled": true,
      "toolCount": 45,
      "serverCount": 8
    }
  }
}
```

### 2. View Persistent Tool Registry
```bash
curl -s http://localhost:37373/api/servers/persistent-registry | jq '.registry.summary'
```

**Expected Response:**
```json
{
  "toolCount": 45,
  "serverCount": 8
}
```

### 3. Trigger Manual Server Loading
```bash
curl -s -X POST http://localhost:37373/api/servers/trigger-load \
  -H "Content-Type: application/json" \
  -d '{"server_name": "aws-s3"}' | jq .
```

### 4. Monitor Health with Loading Info
```bash
curl -s http://localhost:37373/api/health | jq '.serverLoadingManager.coreServersLoaded'
```

## 🔧 Configuration Examples

### Basic Configuration (Default)
```json
{
  "hub": {
    "lazyLoad": true,
    "idleTimeoutMs": 360000
  },
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    }
  }
}
```

### High-Performance Configuration
```json
{
  "hub": {
    "lazyLoad": true,
    "idleTimeoutMs": 180000
  }
}
```
*Servers unload after 3 minutes instead of 6*

### Memory-Optimized Configuration
```json
{
  "hub": {
    "lazyLoad": true,
    "idleTimeoutMs": 120000
  }
}
```
*Aggressive unloading after 2 minutes*

## 📊 Usage Patterns

### Core Servers (Auto-loaded)
These servers load immediately on startup:
- `filesystem` - File operations
- `mcp-everything` - Testing and examples  
- `mcp-fetch` - HTTP requests
- `mcp-time` - Date/time operations
- `mcp-sequential-thinking` - Reasoning
- `mcp-memory` - Knowledge graphs
- `github` - Repository operations
- `wix-mcp-remote` - Wix platform

### Standard Servers (Batch-loaded)
These load automatically after 60 seconds of system idle time:
- `aws-s3`, `aws-dynamodb`, `aws-lambda-tool`
- `mcp-postgres`, `mcp-sqlite`
- `mcp-puppeteer`, `mcp-slack`
- And others...

## 🕒 Timeline Examples

### Typical Startup Sequence
```
00:00 - Container starts
00:02 - Core servers connected (8 servers, ~45 tools available)
00:05 - First tool call (resets idle timer)
01:05 - System idle for 60s, batch loading starts
01:07 - Server 1 loads (2s delay)
01:09 - Server 2 loads (2s delay)
...continues until all servers loaded or activity detected
```

### Idle Unloading Example
```
10:00 - Tool call to 'aws-s3' server
16:00 - No calls to 'aws-s3' for 6 minutes
16:00 - 'aws-s3' server auto-unloads (memory freed)
16:01 - 'aws-s3' returns to lazy-load queue
```

## 🧪 Testing Scenarios

### Test 1: Core Server Availability
```bash
# Test immediately after container start
curl -s -X POST http://localhost:37373/api/servers/tools \
  -H "Content-Type: application/json" \
  -d '{"server_name": "filesystem", "tool": "list_allowed_directories", "arguments": {}}'
```
**Expected**: Instant response (server already loaded)

### Test 2: Lazy Loading
```bash
# Test non-core server
curl -s -X POST http://localhost:37373/api/servers/tools \
  -H "Content-Type: application/json" \
  -d '{"server_name": "aws-s3", "tool": "list-buckets", "arguments": {}}'
```
**Expected**: 3-5 second delay on first call, instant on subsequent calls

### Test 3: Idle Unloading
```bash
# 1. Call a tool
curl -s -X POST http://localhost:37373/api/servers/tools \
  -H "Content-Type: application/json" \
  -d '{"server_name": "mcp-time", "tool": "get_current_time", "arguments": {"timezone": "UTC"}}'

# 2. Wait 6+ minutes without calls

# 3. Check server status
curl -s http://localhost:37373/api/health | jq '.servers[] | select(.name == "mcp-time") | .status'
```
**Expected**: Status changes from "connected" to "disconnected"

### Test 4: Registry Persistence
```bash
# 1. Check tool count
curl -s http://localhost:37373/api/servers/persistent-registry | jq '.registry.summary.toolCount'

# 2. Restart container
docker restart mcp-hub

# 3. Check tool count again (should be same)
curl -s http://localhost:37373/api/servers/persistent-registry | jq '.registry.summary.toolCount'
```

## 📈 Performance Expectations

### Tool Availability Times
- **Core tools**: 0-2 seconds (pre-loaded)
- **Cached tools**: 0-1 seconds (registry lookup)
- **Cold tools**: 3-5 seconds (lazy load)

### Memory Usage Patterns
- **Startup**: ~200MB (core servers only)
- **Peak**: ~500MB (all servers loaded)
- **Steady state**: ~300MB (active servers only)

### Server Load Distribution
- **Immediate**: 8 core servers
- **Batch loading**: 16-20 additional servers
- **On-demand**: As needed for tool calls

## 🔍 Monitoring Commands

### Real-time Activity Monitoring
```bash
# Watch loading manager status
watch -n 5 'curl -s http://localhost:37373/api/servers/loading-status | jq .loadingManager.statusBreakdown'
```

### Server State Overview
```bash
# Count servers by status
curl -s http://localhost:37373/api/health | jq '.servers | group_by(.status) | map({status: .[0].status, count: length})'
```

### Tool Usage Tracking
```bash
# View persistent registry growth
curl -s http://localhost:37373/api/servers/persistent-registry | jq '.registry.lastUpdate'
```

## 🚨 Troubleshooting

### Issue: Slow Tool Response
**Check**: Is server in core list?
```bash
curl -s http://localhost:37373/api/servers/loading-status | jq '.loadingManager.coreServersLoaded'
```

**Solution**: Add to core servers or use manual trigger:
```bash
curl -s -X POST http://localhost:37373/api/servers/trigger-load \
  -H "Content-Type: application/json" \
  -d '{"server_name": "your-server"}'
```

### Issue: High Memory Usage
**Check**: How many servers connected?
```bash
curl -s http://localhost:37373/api/health | jq '.servers | map(select(.status == "connected")) | length'
```

**Solution**: Reduce idle timeout in configuration

### Issue: Registry Too Large
**Check**: Registry size
```bash
curl -s http://localhost:37373/api/servers/persistent-registry | jq '.registry.summary'
```

**Solution**: Clear registry (will rebuild automatically)
```bash
docker exec mcp-hub rm -f /app/data/tool-registry.json
docker restart mcp-hub
```

## 🎯 Best Practices

1. **Monitor patterns**: Track which tools you use most frequently
2. **Customize core list**: Add your most-used servers to core servers
3. **Adjust timeouts**: Tune based on your memory vs. responsiveness needs
4. **Use health checks**: Monitor loading manager status in production
5. **Registry maintenance**: Periodically check registry size and contents

## 📞 Support

If you encounter issues with the advanced loading system:

1. Check the health endpoint for status
2. Review container logs for detailed information
3. Use the loading status endpoint for diagnostics
4. Consider filing an issue with logs and configuration details
