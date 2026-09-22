const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function fetchOllamaModels() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:11434/api/ps', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.models || []);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

function parseOpenCodeSessions() {
  const sessions = [];
  const sessionDirs = [
    path.join(process.env.HOME || '/root', '.opencode', 'logs'),
    path.join(process.env.HOME || '/root', '.opencode', 'sessions'),
  ];

  for (const dir of sessionDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') || f.endsWith('.log'));
      for (const file of files.slice(-10)) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          let parsed;
          try { parsed = JSON.parse(content); } catch { parsed = { raw: content }; }
          sessions.push({ file, data: parsed });
        } catch {}
      }
    } catch {}
  }
  return sessions;
}

async function getTelemetry() {
  const models = await fetchOllamaModels();
  const sessions = parseOpenCodeSessions();

  const modelSummaries = models.map(m => ({
    name: m.name || 'unknown',
    size: m.size || 0,
    processor: m.processor || 'unknown',
    contextLength: m.context_length || 0,
    details: m.details || {},
  }));

  const totalVRAM = modelSummaries.reduce((sum, m) => sum + ((m.size || 0) / (1024 * 1024 * 1024)), 0);

  return {
    models: modelSummaries,
    totalVRAM: totalVRAM.toFixed(2),
    sessionCount: sessions.length,
    sessions: sessions.map(s => ({ file: s.file })),
  };
}

module.exports = { fetchOllamaModels, parseOpenCodeSessions, getTelemetry };
