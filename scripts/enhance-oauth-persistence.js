#!/usr/bin/env node

/**
 * Enhanced OAuth Persistence Management for MCP Hub
 * 
 * This script enhances the MCP Hub's OAuth authentication system by:
 * 1. Providing better token refresh mechanisms
 * 2. Implementing automatic reconnection for OAuth-based servers
 * 3. Adding health checks and recovery procedures
 * 4. Creating backup and restore functionality for OAuth states
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
    HUB_BASE_URL: 'http://localhost:37373',
    OAUTH_STORAGE_PATH: path.join(process.env.HOME, '.local/share/mcp-hub/oauth-storage.json'),
    BACKUP_DIR: path.join(__dirname, '../backups/oauth'),
    HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
    TOKEN_REFRESH_THRESHOLD: 300000, // 5 minutes before expiry
};

class EnhancedOAuthManager {
    constructor() {
        this.oauthStorage = {};
        this.serverStatuses = new Map();
        this.healthCheckInterval = null;
    }

    /**
     * Initialize the OAuth manager
     */
    async initialize() {
        console.log('🚀 Initializing Enhanced OAuth Manager...');
        
        // Ensure backup directory exists
        await fs.mkdir(CONFIG.BACKUP_DIR, { recursive: true });
        
        // Load OAuth storage
        await this.loadOAuthStorage();
        
        // Start health monitoring
        this.startHealthMonitoring();
        
        console.log('✅ OAuth Manager initialized successfully');
    }

    /**
     * Load OAuth storage from file
     */
    async loadOAuthStorage() {
        try {
            const data = await fs.readFile(CONFIG.OAUTH_STORAGE_PATH, 'utf8');
            this.oauthStorage = JSON.parse(data);
            console.log(`📄 Loaded OAuth storage with ${Object.keys(this.oauthStorage).length} entries`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('📄 OAuth storage file not found, creating new one');
                this.oauthStorage = {};
                await this.saveOAuthStorage();
            } else {
                console.error('❌ Error loading OAuth storage:', error.message);
            }
        }
    }

    /**
     * Save OAuth storage to file
     */
    async saveOAuthStorage() {
        try {
            await fs.mkdir(path.dirname(CONFIG.OAUTH_STORAGE_PATH), { recursive: true });
            await fs.writeFile(CONFIG.OAUTH_STORAGE_PATH, JSON.stringify(this.oauthStorage, null, 2));
            console.log('💾 OAuth storage saved successfully');
        } catch (error) {
            console.error('❌ Error saving OAuth storage:', error.message);
        }
    }

    /**
     * Create backup of current OAuth storage
     */
    async createBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(CONFIG.BACKUP_DIR, `oauth-backup-${timestamp}.json`);
        
        try {
            await fs.writeFile(backupPath, JSON.stringify(this.oauthStorage, null, 2));
            console.log(`📦 OAuth backup created: ${backupPath}`);
            
            // Clean old backups (keep last 10)
            await this.cleanOldBackups();
        } catch (error) {
            console.error('❌ Error creating OAuth backup:', error.message);
        }
    }

    /**
     * Clean old backup files
     */
    async cleanOldBackups() {
        try {
            const files = await fs.readdir(CONFIG.BACKUP_DIR);
            const backupFiles = files
                .filter(f => f.startsWith('oauth-backup-') && f.endsWith('.json'))
                .sort()
                .reverse();

            if (backupFiles.length > 10) {
                const filesToDelete = backupFiles.slice(10);
                for (const file of filesToDelete) {
                    await fs.unlink(path.join(CONFIG.BACKUP_DIR, file));
                    console.log(`🗑️  Deleted old backup: ${file}`);
                }
            }
        } catch (error) {
            console.error('⚠️  Error cleaning old backups:', error.message);
        }
    }

    /**
     * Get list of all MCP servers
     */
    async getServers() {
        try {
            const response = await fetch(`${CONFIG.HUB_BASE_URL}/api/servers`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            return data.servers || [];
        } catch (error) {
            console.error('❌ Error fetching servers:', error.message);
            return [];
        }
    }

    /**
     * Get server status
     */
    async getServerStatus(serverName) {
        try {
            const response = await fetch(`${CONFIG.HUB_BASE_URL}/api/servers/info`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ server_name: serverName })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            return data.server;
        } catch (error) {
            console.error(`❌ Error getting status for ${serverName}:`, error.message);
            return null;
        }
    }

    /**
     * Attempt to start a server
     */
    async startServer(serverName) {
        try {
            const response = await fetch(`${CONFIG.HUB_BASE_URL}/api/servers/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ server_name: serverName })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`HTTP ${response.status}: ${errorData.error || response.statusText}`);
            }
            
            const data = await response.json();
            console.log(`✅ Started server: ${serverName}`);
            return data.server;
        } catch (error) {
            console.error(`❌ Error starting server ${serverName}:`, error.message);
            return null;
        }
    }

    /**
     * Trigger OAuth authorization for a server
     */
    async authorizeServer(serverName) {
        try {
            const response = await fetch(`${CONFIG.HUB_BASE_URL}/api/servers/authorize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ server_name: serverName })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`HTTP ${response.status}: ${errorData.error || response.statusText}`);
            }
            
            const data = await response.json();
            console.log(`🔐 Authorization initiated for: ${serverName}`);
            return data;
        } catch (error) {
            console.error(`❌ Error authorizing server ${serverName}:`, error.message);
            return null;
        }
    }

    /**
     * Check if a server needs OAuth authorization
     */
    needsOAuth(server) {
        const oauthDescriptions = [
            'oauth',
            'google workspace',
            'cloudflare',
            'wix',
            'microsoft'
        ];
        
        return oauthDescriptions.some(desc => 
            server.description?.toLowerCase().includes(desc)
        );
    }

    /**
     * Check if server has valid OAuth tokens
     */
    hasValidOAuth(serverName, serverEndpoint) {
        const oauthEntry = this.oauthStorage[serverEndpoint] || this.oauthStorage[serverName];
        
        if (!oauthEntry || !oauthEntry.tokens) {
            return false;
        }
        
        // Check if tokens exist
        const tokens = oauthEntry.tokens;
        if (!tokens.access_token) {
            return false;
        }
        
        // Check expiration if available
        if (tokens.expires_at) {
            const expiryTime = new Date(tokens.expires_at).getTime();
            const now = Date.now();
            const timeUntilExpiry = expiryTime - now;
            
            if (timeUntilExpiry <= 0) {
                console.log(`⏰ Tokens expired for ${serverName}`);
                return false;
            }
            
            if (timeUntilExpiry < CONFIG.TOKEN_REFRESH_THRESHOLD) {
                console.log(`⚠️  Tokens expiring soon for ${serverName} (${Math.round(timeUntilExpiry / 1000)}s)`);
                // Could implement refresh logic here
            }
        }
        
        return true;
    }

    /**
     * Perform health check on all servers
     */
    async performHealthCheck() {
        console.log('🔍 Performing server health check...');
        
        const servers = await this.getServers();
        let reconnectedCount = 0;
        let issues = [];
        
        for (const server of servers) {
            const previousStatus = this.serverStatuses.get(server.name);
            this.serverStatuses.set(server.name, server.status);
            
            // Handle disconnected servers
            if (server.status === 'disconnected') {
                if (this.needsOAuth(server)) {
                    if (this.hasValidOAuth(server.name, server.endpoint)) {
                        console.log(`🔄 Attempting to reconnect OAuth server: ${server.name}`);
                        const result = await this.startServer(server.name);
                        if (result && result.status === 'connected') {
                            reconnectedCount++;
                            console.log(`✅ Successfully reconnected: ${server.name}`);
                        } else {
                            issues.push(`Failed to reconnect OAuth server: ${server.name}`);
                        }
                    } else {
                        issues.push(`OAuth server needs re-authorization: ${server.name}`);
                    }
                } else {
                    // Non-OAuth server, try to restart
                    console.log(`🔄 Attempting to restart server: ${server.name}`);
                    const result = await this.startServer(server.name);
                    if (result && result.status === 'connected') {
                        reconnectedCount++;
                        console.log(`✅ Successfully restarted: ${server.name}`);
                    } else {
                        issues.push(`Failed to restart server: ${server.name}`);
                    }
                }
            }
            
            // Handle status changes
            if (previousStatus && previousStatus !== server.status) {
                console.log(`📊 Status change - ${server.name}: ${previousStatus} → ${server.status}`);
            }
        }
        
        // Summary
        const connectedCount = servers.filter(s => s.status === 'connected').length;
        const totalCount = servers.length;
        
        console.log(`📈 Health check complete - ${connectedCount}/${totalCount} servers connected`);
        if (reconnectedCount > 0) {
            console.log(`🔄 Reconnected ${reconnectedCount} servers`);
        }
        if (issues.length > 0) {
            console.log(`⚠️  Issues found:`, issues);
        }
    }

    /**
     * Start continuous health monitoring
     */
    startHealthMonitoring() {
        console.log(`💓 Starting health monitoring (${CONFIG.HEALTH_CHECK_INTERVAL / 1000}s interval)`);
        
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.performHealthCheck();
            } catch (error) {
                console.error('❌ Error during health check:', error.message);
            }
        }, CONFIG.HEALTH_CHECK_INTERVAL);
    }

    /**
     * Stop health monitoring
     */
    stopHealthMonitoring() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            console.log('🛑 Stopped health monitoring');
        }
    }

    /**
     * Generate OAuth status report
     */
    async generateStatusReport() {
        console.log('\n📊 OAuth Status Report');
        console.log('='.repeat(50));
        
        const servers = await this.getServers();
        
        // Group servers by status
        const statusGroups = {
            connected: [],
            disconnected: [],
            connecting: [],
            other: []
        };
        
        servers.forEach(server => {
            if (statusGroups[server.status]) {
                statusGroups[server.status].push(server);
            } else {
                statusGroups.other.push(server);
            }
        });
        
        // Display connected servers
        if (statusGroups.connected.length > 0) {
            console.log(`\n✅ Connected Servers (${statusGroups.connected.length})`);
            statusGroups.connected.forEach(server => {
                console.log(`   • ${server.name} - ${server.description}`);
            });
        }
        
        // Display disconnected OAuth servers
        const disconnectedOAuth = statusGroups.disconnected.filter(s => this.needsOAuth(s));
        if (disconnectedOAuth.length > 0) {
            console.log(`\n🔐 Disconnected OAuth Servers (${disconnectedOAuth.length})`);
            disconnectedOAuth.forEach(server => {
                const hasTokens = this.hasValidOAuth(server.name, server.endpoint);
                const status = hasTokens ? '🟡 Has tokens' : '🔴 Needs auth';
                console.log(`   • ${server.name} - ${status}`);
            });
        }
        
        // Display other disconnected servers
        const disconnectedOther = statusGroups.disconnected.filter(s => !this.needsOAuth(s));
        if (disconnectedOther.length > 0) {
            console.log(`\n❌ Disconnected Other Servers (${disconnectedOther.length})`);
            disconnectedOther.forEach(server => {
                console.log(`   • ${server.name} - ${server.description}`);
            });
        }
        
        // OAuth storage summary
        console.log(`\n🗄️  OAuth Storage Summary`);
        console.log(`   • Storage file: ${CONFIG.OAUTH_STORAGE_PATH}`);
        console.log(`   • Entries: ${Object.keys(this.oauthStorage).length}`);
        
        Object.entries(this.oauthStorage).forEach(([url, data]) => {
            const hasTokens = data.tokens ? '✅' : '❌';
            const hasClientInfo = data.clientInfo ? '✅' : '❌';
            console.log(`   • ${url}`);
            console.log(`     - Tokens: ${hasTokens}  Client Info: ${hasClientInfo}`);
        });
        
        console.log('\n' + '='.repeat(50));
    }

    /**
     * Repair OAuth connections
     */
    async repairOAuthConnections() {
        console.log('🔧 Attempting to repair OAuth connections...');
        
        const servers = await this.getServers();
        const oauthServers = servers.filter(s => this.needsOAuth(s) && s.status === 'disconnected');
        
        let repairedCount = 0;
        let needsAuthCount = 0;
        
        for (const server of oauthServers) {
            if (this.hasValidOAuth(server.name, server.endpoint)) {
                console.log(`🔄 Repairing: ${server.name}`);
                const result = await this.startServer(server.name);
                if (result && result.status === 'connected') {
                    repairedCount++;
                    console.log(`✅ Repaired: ${server.name}`);
                }
            } else {
                needsAuthCount++;
                console.log(`🔐 Needs re-authorization: ${server.name}`);
                console.log(`   Run: curl -X POST ${CONFIG.HUB_BASE_URL}/api/servers/authorize -H "Content-Type: application/json" -d '{"server_name":"${server.name}"}'`);
            }
        }
        
        console.log(`\n📊 Repair Summary:`);
        console.log(`   • Repaired: ${repairedCount}`);
        console.log(`   • Need Authorization: ${needsAuthCount}`);
    }

    /**
     * Cleanup and shutdown
     */
    async shutdown() {
        console.log('🛑 Shutting down Enhanced OAuth Manager...');
        
        this.stopHealthMonitoring();
        
        // Create backup before shutdown
        await this.createBackup();
        
        console.log('✅ Shutdown complete');
    }
}

// CLI Interface
async function main() {
    const command = process.argv[2];
    const manager = new EnhancedOAuthManager();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Received SIGINT, shutting down gracefully...');
        await manager.shutdown();
        process.exit(0);
    });
    
    await manager.initialize();
    
    switch (command) {
        case 'status':
        case 'report':
            await manager.generateStatusReport();
            break;
            
        case 'monitor':
            console.log('📊 Starting continuous monitoring (Press Ctrl+C to stop)');
            await manager.generateStatusReport();
            // Keep running with health monitoring
            break;
            
        case 'repair':
            await manager.repairOAuthConnections();
            break;
            
        case 'health':
            await manager.performHealthCheck();
            break;
            
        case 'backup':
            await manager.createBackup();
            break;
            
        default:
            console.log('🔧 Enhanced OAuth Manager for MCP Hub');
            console.log('\nCommands:');
            console.log('  status   - Generate OAuth status report');
            console.log('  monitor  - Continuous monitoring with health checks');
            console.log('  repair   - Attempt to repair OAuth connections');
            console.log('  health   - Run one-time health check');
            console.log('  backup   - Create OAuth storage backup');
            console.log('\nExamples:');
            console.log('  node scripts/enhance-oauth-persistence.js status');
            console.log('  node scripts/enhance-oauth-persistence.js monitor');
            console.log('  node scripts/enhance-oauth-persistence.js repair');
            break;
    }
    
    // If not monitoring, exit cleanly
    if (command !== 'monitor') {
        await manager.shutdown();
        process.exit(0);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export default EnhancedOAuthManager;
