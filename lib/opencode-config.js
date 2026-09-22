const fs = require('fs');
const path = require('path');

const OPENCODE_CONFIG_PATH = '/home/martin/.config/opencode/opencode.json';
const OPENCODE_LOG_DIRS = ['/home/martin/.local/share/opencode/log', '/home/martin/.config/opencode/logs'];
const OPENCODE_SESSION_DIRS = ['/tmp/opencode', '/home/martin/.opencode/sessions', '/home/martin/.config/opencode/sessions'];

function getOpenCodeConfig() {
  try {
    if (!fs.existsSync(OPENCODE_CONFIG_PATH)) return null;
    const config = JSON.parse(fs.readFileSync(OPENCODE_CONFIG_PATH, 'utf-8'));
    return {
      model: config.model || 'unknown',
      provider: Object.keys(config.provider || {})[0] || 'unknown',
      providerConfig: config.provider || {},
      agents: Object.keys(config.agent || {}),
      commands: Object.keys(config.command || {}),
      skillsPaths: config.skills?.paths || [],
      plugins: config.plugin || [],
      instructions: config.instructions || [],
      defaultAgent: config.defaultAgent || 'build',
      permissions: config.permission || {},
    };
  } catch {
    return null;
  }
}

function getOpenCodeLogs() {
  const logs = [];
  for (const dir of OPENCODE_LOG_DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.log') || f.endsWith('.json'));
      for (const file of files.slice(-20)) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          logs.push({
            file,
            path: path.join(dir, file),
            size: fs.statSync(path.join(dir, file)).size,
            lines: content.split('\n').length,
            preview: content.split('\n').slice(-20).join('\n'),
          });
        } catch {}
      }
    } catch {}
  }

  return logs;
}

function getOpenCodeSessions() {
  const sessions = [];
  for (const dir of OPENCODE_SESSION_DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const file of files.slice(-10)) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          let parsed;
          try { parsed = JSON.parse(content); } catch { parsed = null; }
          sessions.push({
            file,
            path: path.join(dir, file),
            size: fs.statSync(path.join(dir, file)).size,
            hasData: !!parsed,
          });
        } catch {}
      }
    } catch {}
  }
  return sessions;
}

function getOpenCodeAgents() {
  const agentsDir = '/home/martin/.config/opencode/agents';
  const agents = [];
  try {
    if (!fs.existsSync(agentsDir)) return agents;
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const files = fs.readdirSync(path.join(agentsDir, entry.name)).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
        agents.push({
          name: entry.name,
          files,
        });
      }
    }
  } catch {}
  return agents;
}

function getOpenCodeCommands() {
  const commandsDir = '/home/martin/.config/opencode/commands';
  const commands = [];
  try {
    if (!fs.existsSync(commandsDir)) return commands;
    const entries = fs.readdirSync(commandsDir);
    for (const entry of entries) {
      try {
        const content = fs.readFileSync(path.join(commandsDir, entry), 'utf-8');
        const titleMatch = content.match(/^#\s+(.+)/m);
        commands.push({
          name: entry,
          title: titleMatch ? titleMatch[1].trim() : entry,
          hasDescription: content.length > 100,
        });
      } catch {}
    }
  } catch {}
  return commands;
}

module.exports = { getOpenCodeConfig, getOpenCodeLogs, getOpenCodeSessions, getOpenCodeAgents, getOpenCodeCommands };
