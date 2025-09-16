#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Finding all available MCP servers...\n');

// NPM-based servers
const npmServers = [
  '@modelcontextprotocol/server-brave-search',
  '@modelcontextprotocol/server-everything',
  '@modelcontextprotocol/server-filesystem', 
  '@modelcontextprotocol/server-github',
  '@modelcontextprotocol/server-gitlab',
  '@modelcontextprotocol/server-google-maps',
  '@modelcontextprotocol/server-memory',
  '@modelcontextprotocol/server-postgres',
  '@modelcontextprotocol/server-puppeteer',
  '@modelcontextprotocol/server-sequential-thinking',
  '@modelcontextprotocol/server-slack',
  '@modelcontextprotocol/server-cloudflare',
  '@modelcontextprotocol/server-everart',
  '@modelcontextprotocol/server-sentry',
  '@modelcontextprotocol/server-sqlite',
  '@modelcontextprotocol/server-aws-knowledge-base'
];

// Python-based servers (via uv)
const pythonServers = [
  'mcp-server-fetch',
  'mcp-server-git', 
  'mcp-server-time',
  'awslabs-cdk-mcp-server',
  'awslabs-dynamodb-mcp-server',
  'awslabs-api-mcp-server',
  'mcp-server-qdrant',
  'mcp-server-docker',
  'mcp-server-shell',
  'mcp-server-web-browser',
  'mcp-server-web-search'
];

// Check installed npm servers
console.log('=== NPM-based MCP Servers ===\n');
npmServers.forEach(server => {
  const name = server.split('/').pop();
  try {
    // Check if we can resolve the package
    const result = execSync(`npm list ${server} 2>/dev/null`, { encoding: 'utf8' });
    if (result.includes(server)) {
      console.log(`✅ ${name}: Installed`);
    } else {
      console.log(`❌ ${name}: Not installed`);
    }
  } catch {
    console.log(`❌ ${name}: Not installed`);
  }
});

// Check Python servers
console.log('\n=== Python-based MCP Servers (via uv) ===\n');
pythonServers.forEach(server => {
  try {
    const result = execSync(`uv tool list 2>/dev/null | grep "${server}"`, { encoding: 'utf8' });
    if (result) {
      console.log(`✅ ${server}: Installed`);
    } else {
      console.log(`❌ ${server}: Not installed`);
    }
  } catch {
    console.log(`❌ ${server}: Not installed`);
  }
});

// Load current config
const configPath = path.join(__dirname, '..', 'config', 'mcp-servers.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

console.log('\n=== Currently Configured Servers ===\n');
console.log(`Total configured: ${Object.keys(config.mcpServers).length}`);
Object.keys(config.mcpServers).forEach(name => {
  console.log(`  - ${name}`);
});

console.log('\n=== Recommendations ===\n');
console.log('Missing NPM servers that can be installed:');
console.log('  - server-brave-search (requires BRAVE_API_KEY)');
console.log('  - server-gitlab (requires GITLAB_TOKEN)');
console.log('  - server-slack (requires SLACK_TOKEN)');
console.log('  - server-cloudflare (requires auth)');
console.log('  - server-sqlite');
console.log('  - server-sentry (requires SENTRY_DSN)');

console.log('\nMissing Python servers that can be installed:');
console.log('  - mcp-server-qdrant');
console.log('  - mcp-server-docker');
console.log('  - mcp-server-shell');
console.log('  - awslabs-api-mcp-server');
