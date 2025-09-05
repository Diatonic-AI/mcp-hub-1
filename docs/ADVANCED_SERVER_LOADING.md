# Advanced Server Loading Management System

## Overview

The MCP Hub now includes a sophisticated server loading and lifecycle management system that optimizes resource usage while ensuring rapid availability of core tools. This system implements intelligent loading patterns, persistent tool registry, and activity-based lifecycle management.

## Key Features

### 1. Immediate Core Server Loading 🚀
- **Core servers** are loaded immediately on startup for instant availability
- Pre-configured list of essential servers: `filesystem`, `mcp-everything`, `mcp-fetch`, `mcp-time`, `mcp-sequential-thinking`, `mcp-memory`, `github`, `wix-mcp-remote`
- No delay for the most commonly used tools

### 2. Intelligent Idle-Triggered Loading ⏱️
- **60-second idle trigger**: When system is idle for 60 seconds, automatic batch loading begins
- **Staggered loading**: Servers load one at a time with 2-second delays to prevent resource spikes
- **Activity-aware**: Pauses batch loading if new activity is detected
- **Resumable**: Can continue loading remaining servers after activity subsides

### 3. Activity-Based Lifecycle Management 📊
- **360-second idle timeout**: Servers automatically unload after 6 minutes of inactivity
- **Smart reloading**: Unloaded servers return to lazy-load queue for future use
- **Activity tracking**: Tool calls, API requests, and manual operations reset timers
- **Core server protection**: Core servers maintain priority loading status

### 4. Persistent Tool Registry 💾
- **Cross-restart persistence**: Tool registry survives container restarts
- **Automatic updates**: Registry updates when servers connect/disconnect
- **Tool metadata storage**: Comprehensive tool information including schemas and descriptions
- **Performance optimization**: Faster tool discovery and reduced cold start times

## Configuration

### Default Settings
```javascript
{
  // Core servers loaded immediately
  coreServers: [
    'filesystem',
    'mcp-everything', 
    'mcp-fetch',
    'mcp-time',
    'mcp-sequential-thinking',
    'mcp-memory',
    'github',
    'wix-mcp-remote'
  ],
  
  // Timing configuration
  idleLoadTriggerMs: 60 * 1000,     // 60 seconds
  serverIdleTimeoutMs: 360 * 1000,   // 360 seconds (6 minutes)
  batchLoadDelayMs: 2 * 1000,        // 2 seconds between loads
  
  // Persistence
  persistentRegistryPath: '/app/data/tool-registry.json',
  enablePersistence: true
}
```

### Hub Configuration Override
You can override timeout settings in your `mcp-servers.json`:

```json
{
  "hub": {
    "lazyLoad": true,
    "idleTimeoutMs": 300000
  },
  "mcpServers": {
    // ... your servers
  }
}
```

## API Endpoints

### Server Loading Status
```bash
GET /api/servers/loading-status
```
Returns comprehensive status including:
- Uptime and activity metrics
- Loading queue status
- Server state breakdown
- Persistent registry information

### Manual Server Loading
```bash
POST /api/servers/trigger-load
Content-Type: application/json

{
  "server_name": "aws-s3"
}
```
Manually triggers loading of a specific server, removing it from the batch loading queue.

### Persistent Registry Access
```bash
GET /api/servers/persistent-registry
```
Returns the persistent tool registry with all cached tool information.

### Enhanced Health Check
```bash
GET /api/health
```
Now includes `serverLoadingManager` status in the health response.

## Server States

| State | Description |
|-------|-------------|
| `idle` | Server initialized but not connected |
| `loading` | Server connection in progress |
| `connected` | Server active and ready for tool calls |
| `unloading` | Server disconnection in progress |
| `error` | Server encountered an error |

## Activity Tracking

### Tracked Events
- **Tool calls**: Reset server-specific and system-wide activity timers
- **API requests**: Update system activity counters
- **Manual operations**: Server start/stop, configuration changes
- **Connection events**: Server connect/disconnect

### Timer Reset Logic
- **Server-specific timers**: Reset on tool calls for that server
- **System-wide timers**: Reset on any API activity
- **Batch loading**: Pauses if activity detected during loading

## Persistent Registry

### Storage Location
- **Path**: `/app/data/tool-registry.json`
- **Format**: JSON with Map serialization
- **Permissions**: Owned by `mcp` user (UID 1001)

### Registry Structure
```json
{
  "tools": [
    ["server:tool", {
      "id": "server:tool",
      "name": "tool_name",
      "serverName": "server",
      "description": "Tool description",
      "inputSchema": { /* JSON Schema */ },
      "lastUpdate": "2025-09-04T19:31:22.000Z"
    }]
  ],
  "servers": [
    ["server", {
      "name": "server",
      "config": { /* Server config */ },
      "lastUpdate": "2025-09-04T19:31:22.000Z",
      "toolCount": 5,
      "status": "connected"
    }]
  ],
  "lastUpdate": "2025-09-04T19:31:22.000Z",
  "version": 1
}
```

## Performance Benefits

### Reduced Latency
- **Core tools**: Available in <2 seconds (immediate loading)
- **Cached tools**: Available in <1 second (persistent registry)
- **On-demand tools**: Available in <5 seconds (lazy loading)

### Resource Optimization
- **Memory usage**: Only connected servers consume memory
- **CPU usage**: Staggered loading prevents CPU spikes
- **Network usage**: Batch loading reduces connection overhead

### Scalability
- **Large deployments**: Handles 50+ servers efficiently
- **Dynamic scaling**: Adapts to usage patterns
- **Container restarts**: Fast recovery with persistent registry

## Monitoring and Observability

### Logging
- **Structured logging**: JSON format with timestamps
- **Activity tracking**: Detailed activity and state change logs
- **Performance metrics**: Loading times and success rates
- **Error handling**: Comprehensive error logging with context

### Metrics Available
- Server state distribution
- Activity counters
- Loading queue length
- Registry statistics
- Uptime and performance data

## Docker Integration

### Volume Mounts
```yaml
volumes:
  - mcp-hub-data:/app/data  # Persistent registry storage
  - mcp-hub-logs:/app/logs  # Enhanced logging
```

### Environment Variables
```yaml
environment:
  - NODE_ENV=production
  - ADVANCED_LOADING=true  # Enable advanced loading features
```

## Migration Notes

### From Previous Versions
- **Backward compatible**: Existing configurations work unchanged
- **Automatic migration**: Registry created automatically on first run
- **Progressive enhancement**: Benefits increase with usage patterns

### Configuration Updates
- No breaking changes to existing `mcp-servers.json` files
- Optional configuration overrides available
- Gradual adoption of new features

## Best Practices

### Server Prioritization
1. **Core servers**: Include essential tools in core server list
2. **Frequency-based**: Prioritize frequently used servers
3. **Dependency-aware**: Consider tool interdependencies

### Performance Tuning
1. **Idle timers**: Adjust based on usage patterns
2. **Batch delays**: Reduce for faster full loading, increase for gentler resource usage
3. **Registry size**: Monitor registry size in high-tool-count environments

### Monitoring
1. **Health checks**: Monitor loading manager status
2. **Activity patterns**: Track tool usage for optimization
3. **Resource usage**: Monitor memory and CPU during loading cycles

## Troubleshooting

### Common Issues

#### Slow Tool Availability
- **Check**: Core server list includes your most-used tools
- **Solution**: Add frequently used servers to core list

#### High Memory Usage
- **Check**: Server idle timeout configuration
- **Solution**: Reduce `serverIdleTimeoutMs` for more aggressive unloading

#### Registry Growth
- **Check**: Registry file size in `/app/data/`
- **Solution**: Periodic registry cleanup (automatic in future versions)

### Debug Commands
```bash
# Check loading manager status
curl -s http://localhost:37373/api/servers/loading-status | jq .

# View persistent registry
curl -s http://localhost:37373/api/servers/persistent-registry | jq .

# Monitor server states
curl -s http://localhost:37373/api/health | jq .serverLoadingManager
```

## Future Enhancements

### Planned Features
- **ML-based optimization**: Learn from usage patterns
- **Resource-aware loading**: Adapt to available system resources
- **Network-optimized loading**: Optimize for network-dependent servers
- **Configuration UI**: Web interface for loading management

### Roadmap
- **v4.3**: Enhanced analytics and optimization suggestions
- **v4.4**: Machine learning integration for predictive loading
- **v4.5**: Advanced configuration management UI
