const express = require('express');
const http = require('http');
const path = require('path');
const { scanWorkspaces } = require('./lib/git-scanner');
const { getTelemetry } = require('./lib/ollama-telemetry');
const { getTickets } = require('./lib/gh-bridge');
const { createHandoff } = require('./lib/handoff-engine');
const { checkDestructive } = require('./lib/git-scanner');

const app = express();
const PORT = 3011;
const HOST = '127.0.0.1';

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const WORKSPACE_ROOTS = ['/home/martin/Code/dublin-opendata', '/home/martin/Code/The_Activist3'];

const sseClients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

function startTelemetryBroadcast() {
  setInterval(async () => {
    try {
      const [workspaces, telemetry, tickets] = await Promise.all([
        scanWorkspaces(WORKSPACE_ROOTS),
        getTelemetry(),
        getTickets(WORKSPACE_ROOTS[0]),
      ]);
      broadcast({ type: 'telemetry', workspaces, telemetry, tickets });
    } catch {}
  }, 2000);
}

app.get('/api/workspaces', async (req, res) => {
  try {
    const results = await scanWorkspaces(WORKSPACE_ROOTS);
    res.json({ success: true, data: results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/telemetry', async (req, res) => {
  try {
    const data = await getTelemetry();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/tickets', async (req, res) => {
  try {
    const data = await getTickets(WORKSPACE_ROOTS[0]);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3011');
  res.flushHeaders();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.post('/api/handoff', async (req, res) => {
  try {
    const workspace = req.body.workspace || WORKSPACE_ROOTS[0];
    const result = await createHandoff(workspace);
    res.json({ success: true, data: { filepath: result.filepath, filename: result.filename } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/command', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ success: false, error: 'No command provided' });
  if (checkDestructive(command)) {
    return res.status(403).json({ success: false, error: 'Blocked: destructive command detected' });
  }
  res.json({ success: true, message: 'Command validated', command });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`\n  OverApp Command Center running at http://${HOST}:${PORT}`);
  console.log(`  SSE stream: http://${HOST}:${PORT}/api/stream`);
  console.log(`  Workspaces: ${WORKSPACE_ROOTS.join(', ')}`);
  startTelemetryBroadcast();
});
