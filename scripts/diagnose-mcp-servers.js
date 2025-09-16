#!/usr/bin/env node

/**
 * MCP Server Connection Diagnostic Tool
 * Tests each configured MCP server to identify connection issues
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const color = level === 'error' ? colors.red : 
                level === 'success' ? colors.green :
                level === 'warn' ? colors.yellow :
                level === 'info' ? colors.cyan : '';
  
  console.log(`${color}[${timestamp}] [${level.toUpperCase()}] ${message}${colors.reset}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function testStdioServer(name, config) {
  return new Promise((resolve) => {
    log('info', `Testing stdio server: ${name}`);
    
    const timeout = setTimeout(() => {
      child.kill();
      resolve({
        server: name,
        status: 'timeout',
        error: 'Server did not respond within 5 seconds'
      });
    }, 5000);

    const child = spawn(config.command, config.args || [], {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let initialized = false;

    // Send initialization request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'mcp-hub-diagnostic',
          version: '1.0.0'
        }
      },
      id: 1
    }) + '\n';

    child.stdin.write(initRequest);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      
      // Check if we received a valid initialization response
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            if (response.id === 1 && response.result) {
              initialized = true;
              clearTimeout(timeout);
              child.kill();
              resolve({
                server: name,
                status: 'success',
                capabilities: response.result
              });
            }
          } catch (e) {
            // Not valid JSON, continue
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        server: name,
        status: 'error',
        error: error.message,
        details: { stdout, stderr }
      });
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (!initialized) {
        resolve({
          server: name,
          status: 'failed',
          exitCode: code,
          signal,
          error: stderr || 'Server exited without initializing',
          details: { stdout, stderr }
        });
      }
    });
  });
}

async function testHttpServer(name, config) {
  log('info', `Testing HTTP/SSE server: ${name}`);
  
  try {
    const response = await fetch(config.url, {
      method: 'GET',
      headers: {
        ...config.headers,
        'Accept': 'text/event-stream'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      return {
        server: name,
        status: 'success',
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries())
      };
    } else {
      return {
        server: name,
        status: 'http_error',
        statusCode: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
  } catch (error) {
    return {
      server: name,
      status: 'error',
      error: error.message
    };
  }
}

async function checkDependencies(server, config) {
  const deps = [];
  
  // Check command availability
  const checkCommand = (cmd) => {
    return new Promise((resolve) => {
      const child = spawn('which', [cmd], { stdio: 'pipe' });
      child.on('exit', (code) => {
        resolve(code === 0);
      });
    });
  };

  if (config.command) {
    const available = await checkCommand(config.command);
    deps.push({
      type: 'command',
      name: config.command,
      available,
      required: true
    });
  }

  // Check environment variables
  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      const isSet = value && value.length > 0;
      const isSecret = key.includes('TOKEN') || key.includes('KEY') || key.includes('SECRET');
      deps.push({
        type: 'env',
        name: key,
        available: isSet,
        required: !key.includes('OPTIONAL'),
        secret: isSecret
      });
    }
  }

  return deps;
}

async function diagnoseServers() {
  try {
    // Load configuration
    const configPath = path.join(__dirname, '..', 'config', 'mcp-servers.json');
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    log('info', `Found ${Object.keys(config.mcpServers || {}).length} configured servers`);

    const results = [];
    
    // Test each server
    for (const [name, serverConfig] of Object.entries(config.mcpServers || {})) {
      log('info', `\n${'='.repeat(60)}`);
      log('info', `Testing server: ${name}`);
      log('info', `${'='.repeat(60)}`);
      
      // Check dependencies first
      const deps = await checkDependencies(name, serverConfig);
      const missingDeps = deps.filter(d => !d.available && d.required);
      
      if (missingDeps.length > 0) {
        log('warn', `Missing dependencies for ${name}:`);
        for (const dep of missingDeps) {
          if (dep.secret) {
            log('warn', `  - ${dep.type}: ${dep.name} (not set or empty)`);
          } else {
            log('warn', `  - ${dep.type}: ${dep.name}`);
          }
        }
      }

      // Test connection
      let result;
      if (serverConfig.url) {
        result = await testHttpServer(name, serverConfig);
      } else if (serverConfig.command) {
        result = await testStdioServer(name, serverConfig);
      } else {
        result = {
          server: name,
          status: 'skipped',
          error: 'Invalid configuration (no command or url)'
        };
      }

      result.dependencies = deps;
      results.push(result);

      // Log result
      if (result.status === 'success') {
        log('success', `✅ ${name}: Connected successfully`);
      } else if (result.status === 'timeout') {
        log('warn', `⏱️ ${name}: Connection timeout`);
      } else if (result.status === 'error' || result.status === 'failed') {
        log('error', `❌ ${name}: Connection failed - ${result.error}`);
      } else {
        log('warn', `⚠️ ${name}: ${result.status}`);
      }
    }

    // Summary
    log('info', `\n${'='.repeat(60)}`);
    log('info', 'SUMMARY');
    log('info', `${'='.repeat(60)}`);
    
    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'error' || r.status === 'failed');
    const timeout = results.filter(r => r.status === 'timeout');
    const other = results.filter(r => !['success', 'error', 'failed', 'timeout'].includes(r.status));

    log('info', `Total servers tested: ${results.length}`);
    log('success', `✅ Successful: ${successful.length}`);
    log('error', `❌ Failed: ${failed.length}`);
    log('warn', `⏱️ Timeout: ${timeout.length}`);
    if (other.length > 0) {
      log('warn', `⚠️ Other issues: ${other.length}`);
    }

    // List successful servers
    if (successful.length > 0) {
      log('success', '\nWorking servers:');
      for (const result of successful) {
        console.log(`  - ${result.server}`);
      }
    }

    // List problematic servers with recommendations
    if (failed.length > 0 || timeout.length > 0) {
      log('warn', '\nProblematic servers and fixes:');
      
      for (const result of [...failed, ...timeout]) {
        console.log(`\n  ${result.server}:`);
        console.log(`    Status: ${result.status}`);
        if (result.error) {
          console.log(`    Error: ${result.error}`);
        }
        
        // Provide specific recommendations
        const missingDeps = result.dependencies.filter(d => !d.available && d.required);
        if (missingDeps.length > 0) {
          console.log('    Fixes needed:');
          for (const dep of missingDeps) {
            if (dep.type === 'command') {
              if (dep.name === 'uv') {
                console.log(`      - Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh`);
              } else if (dep.name === 'uvx') {
                console.log(`      - uvx is part of uv, install uv first`);
              } else if (dep.name === 'npx') {
                console.log(`      - npx should be available with Node.js`);
              }
            } else if (dep.type === 'env') {
              if (dep.secret) {
                console.log(`      - Set environment variable: ${dep.name}`);
              }
            }
          }
        }
        
        // Server-specific recommendations
        if (result.server.includes('postgres')) {
          console.log('      - Check PostgreSQL connection string');
          console.log('      - Ensure PostgreSQL is running');
        }
        if (result.server.includes('python') || result.server.includes('uv')) {
          console.log('      - Check Python/uv installation');
          console.log('      - Try: uv tool install <package-name>');
        }
      }
    }

    // Save detailed results
    const reportPath = path.join(__dirname, '..', 'mcp-server-diagnostic-report.json');
    await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
    log('info', `\nDetailed report saved to: ${reportPath}`);

  } catch (error) {
    log('error', 'Diagnostic failed:', error);
  }
}

// Run diagnostics
log('info', 'Starting MCP Server Diagnostics...\n');
diagnoseServers().then(() => {
  log('info', '\nDiagnostics complete!');
  process.exit(0);
}).catch((error) => {
  log('error', 'Fatal error:', error);
  process.exit(1);
});
