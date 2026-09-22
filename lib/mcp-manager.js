const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MCP_CONFIG_PATH = '/home/martin/.config/opencode/mcp-configs/mcp-servers.json';

function getMcpServers() {
  try {
    if (!fs.existsSync(MCP_CONFIG_PATH)) return { servers: [], count: 0 };
    const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
    const servers = config.mcpServers || {};
    const serverList = Object.entries(servers).map(([name, config]) => ({
      name,
      command: config.command || 'unknown',
      args: config.args || [],
      type: config.type || 'stdio',
      url: config.url || '',
      description: config.description || '',
      env: config.env ? Object.keys(config.env) : [],
      hasEnv: !!config.env,
    }));
    return { servers: serverList, count: serverList.length };
  } catch {
    return { servers: [], count: 0 };
  }
}

function getMcpStatus() {
  return new Promise((resolve) => {
    const { servers } = getMcpServers();
    const statusList = [];
    let completed = 0;

    if (servers.length === 0) return resolve({ servers: [], total: 0 });

    for (const server of servers) {
      execFile('pgrep', ['-f', server.command], { timeout: 2000 }, (error) => {
        statusList.push({
          name: server.name,
          command: server.command,
          running: !error,
        });
        completed++;
        if (completed === servers.length) {
          resolve({ servers: statusList, total: statusList.length });
        }
      });
    }
  });
}

function getEccHooks() {
  const hooksPath = '/home/martin/.config/opencode/hooks/hooks.json';
  try {
    if (!fs.existsSync(hooksPath)) return [];
    const config = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
    const hooks = config.hooks || {};
    const hookList = [];
    for (const [matcher, hookGroups] of Object.entries(hooks)) {
      for (const hook of hookGroups) {
        hookList.push({
          matcher,
          type: hook.type || 'command',
          command: hook.command ? hook.command.substring(0, 80) + '...' : '',
          fullCommand: hook.command || '',
        });
      }
    }
    return hookList;
  } catch {
    return [];
  }
}

function getPlugins() {
  const pluginsDir = '/home/martin/.config/opencode/plugins';
  const localPluginsDir = '/home/martin/Code/OverApp/plugins';
  const plugins = [];

  for (const dir of [pluginsDir, localPluginsDir]) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          plugins.push({
            name: entry.name,
            path: path.join(dir, entry.name),
            type: entry.name.endsWith('.ts') ? 'TypeScript' : 'JavaScript',
            size: fs.statSync(path.join(dir, entry.name)).size,
          });
        } else if (entry.isDirectory()) {
          plugins.push({
            name: entry.name,
            path: path.join(dir, entry.name),
            type: 'directory',
            size: 0,
          });
        }
      }
    } catch {}
  }
  return plugins;
}

module.exports = { getMcpServers, getMcpStatus, getEccHooks, getPlugins };
