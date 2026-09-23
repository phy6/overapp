const express = require('express');
const http = require('http');
const path = require('path');
const { scanWorkspaces } = require('./lib/git-scanner');
const { getTelemetry, fetchOllamaModels } = require('./lib/ollama-telemetry');
const { getTickets } = require('./lib/gh-bridge');
const { createHandoff } = require('./lib/handoff-engine');
const { checkDestructive } = require('./lib/git-scanner');
const { getSystemProcesses, getListeningPorts, killProcess, getSystemResources } = require('./lib/process-manager');
const { getMcpServers, getMcpStatus, getEccHooks, getPlugins } = require('./lib/mcp-manager');
const { getOpenCodeConfig, getOpenCodeLogs, getOpenCodeSessions, getOpenCodeAgents, getOpenCodeCommands } = require('./lib/opencode-config');
const { getCPUStats, getNetworkStats, getDiskStats, getProcessTree, getLoadAverage, getUptime, getCPUInfo, getCPUTemp } = require('./lib/system-stats');
const { buildProjectGraph, getProjectDetail, parseWayfinder, getProjectTickets, getProjectState, saveProjectState, getContext, explainDecision, generateProjectFiles, getInfoModals } = require('./lib/project-graph');
const { getGitHubRepos, getGitHubRepoDetail, getGitHubTickets } = require('./lib/github-scanner');
const { getDecisionState, saveDecisionState, getFogState, saveFogState, registerServer, getRegisteredServers, getIdeas, createIdea, updateIdea, deleteIdea } = require('./lib/db');
const { getUsageStats, getSessionSummary } = require('./lib/opencode-usage');
const { classifyTask, selectModel, optimizePrompt, getRoutingPlan, estimateCost, getCostReport } = require('./lib/prompt-router');
const { recordUsage, getCostHistory, getDailySummary, getBudgetStatus, checkBudgetAlerts, getModelRecommendations } = require('./lib/cost-tracker');

const app = express();
const PORT = 3011;
const HOST = '127.0.0.1';
let autoStart = false;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Simple validation helpers for parameters
function validateProjectName(name) {
  if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return false;
  }
  return true;
}

function validateNumericId(idStr) {
  const id = parseInt(idStr, 10);
  if (isNaN(id) || id < 0) {
    return null;
  }
  return id;
}
const WORKSPACE_ROOTS = ['/home/martin/Code/dublin-opendata', '/home/martin/Code/The_Activist3'];

function startTelemetryBroadcast() {
  setInterval(async () => {
    if (sseClients.size === 0) return;
    try {
      const telemetry = await getTelemetry();
      broadcast({ type: 'telemetry', data: telemetry });
    } catch (e) {
      // Ignore broadcast errors during loop
    }
  }, 5000);
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

app.get('/api/system/cpu', async (req, res) => {
  try { const cpu = await getCPUStats(); const load = await getLoadAverage(); const uptime = await getUptime(); res.json({ success: true, data: { ...cpu, load, uptime } }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/system/network', async (req, res) => {
  try { const network = await getNetworkStats(); const disk = await getDiskStats(); res.json({ success: true, data: { interfaces: network, disks: disk } }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/system/process-tree', async (req, res) => {
  try { const tree = await getProcessTree(); res.json({ success: true, data: tree }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/projects/graph', async (req, res) => {
  try { res.json({ success: true, data: await buildProjectGraph(WORKSPACE_ROOTS) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/projects/overview', async (req, res) => {
  try { res.json({ success: true, data: { workspaces: await scanWorkspaces(WORKSPACE_ROOTS), telemetry: await getTelemetry(), tickets: await getTickets(WORKSPACE_ROOTS[0]), graph: await buildProjectGraph(WORKSPACE_ROOTS) } }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/projects/github', async (req, res) => {
  try {
    const repos = await getGitHubRepos();
    res.json({ success: true, data: repos });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/projects/:name/tickets', async (req, res) => {
  try { 
    if (!validateProjectName(req.params.name)) return res.status(400).json({ success: false, error: 'Invalid project name' });
    const tickets = await getTickets(WORKSPACE_ROOTS.find(r => path.basename(r) === req.params.name) || WORKSPACE_ROOTS[0]);
    res.json({ success: true, data: { project: req.params.name, tickets } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/projects/:name/wayfinder', async (req, res) => {
  try { 
    if (!validateProjectName(req.params.name)) return res.status(400).json({ success: false, error: 'Invalid project name' });
    const wf = parseWayfinder(req.params.name);
    res.json({ success: true, data: wf });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/projects/:name', async (req, res) => {
   try { 
     if (!validateProjectName(req.params.name)) return res.status(400).json({ success: false, error: 'Invalid project name' });
     const detail = await getProjectDetail(req.params.name);
     if (!detail) return res.status(404).json({ success: false, error: 'Project not found' });
     res.json({ success: true, data: detail });
   } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.patch('/api/projects/:name/decision/:index', async (req, res) => {
   try {
       if (!validateProjectName(req.params.name)) return res.status(400).json({ success: false, error: 'Invalid project name' });
       const index = validateNumericId(req.params.index);
       if (index === null) return res.status(400).json({ success: false, error: 'Invalid index' });
       const { Status, Resolution, Note } = req.body;
       const state = await getProjectState(req.params.name);
       const overrides = state || {};
       const override = {};
       if (Status) override.Status = Status;
       if (Resolution) override.Resolution = Resolution;
       if (Note) override.Note = Note;
       overrides[String(index)] = override;
       const saved = await saveProjectState(req.params.name, { decisionOverrides: overrides });
       if (!saved) return res.status(500).json({ success: false, error: 'Failed to save state' });
       const detail = await getProjectDetail(req.params.name);
       res.json({ success: true, data: detail });
   } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/servers', async (req, res) => {
   try { const servers = await getRegisteredServers();
     res.json({ success: true, data: servers });
   } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/servers', async (req, res) => {
     try {
         const { name, processName, port, pid, status, metadata } = req.body;
         const registered = await registerServer(name, { processName, port, pid, status, metadata });
         if (!registered) return res.status(500).json({ success: false, error: 'Failed to register server' });
         res.json({ success: true, message: `Server ${name} registered` });
     } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/projects/:name/context', async (req, res) => {
   try { 
     if (!validateProjectName(req.params.name)) return res.status(400).json({ success: false, error: 'Invalid project name' });
     const ctx = getContext(req.params.name);
     res.json({ success: true, data: ctx });
   } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/projects/:name/decision/:index/explain', async (req, res) => {
   try {
       if (!validateProjectName(req.params.name)) return res.status(400).json({ success: false, error: 'Invalid project name' });
       const index = validateNumericId(req.params.index);
       if (index === null) return res.status(400).json({ success: false, error: 'Invalid index' });
       const explanation = explainDecision(req.params.name, index);
       if (!explanation) return res.status(404).json({ success: false, error: 'Decision not found' });
       res.json({ success: true, data: explanation });
   } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.patch('/api/projects/:name/fog/:index', async (req, res) => {
   try {
       if (!validateProjectName(req.params.name)) return res.status(400).json({ success: false, error: 'Invalid project name' });
       const index = validateNumericId(req.params.index);
       if (index === null) return res.status(400).json({ success: false, error: 'Invalid index' });
       const { Status, Note } = req.body;
       const saved = await saveFogState(req.params.name, index, { Status, Note });
       if (!saved) return res.status(500).json({ success: false, error: 'Failed to save fog state' });
       const detail = await getProjectDetail(req.params.name);
       res.json({ success: true, data: detail });
   } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/projects/init', async (req, res) => {
   try {
       const { name, description } = req.body;
       if (!name) return res.status(400).json({ success: false, error: 'Project name is required' });
       const result = await generateProjectFiles(name, description);
       if (!result.success) return res.status(500).json({ success: false, error: result.error });
       res.json({ success: true, data: result });
   } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/projects/from-html', async (req, res) => {
    try {
        const { name, description, htmlContent } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Project name is required' });
        let desc = description || '';
        if (!desc && htmlContent) {
            const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
            const metaMatch = htmlContent.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
            desc = titleMatch ? titleMatch[1] : (metaMatch ? metaMatch[1] : '');
        }
        const result = await generateProjectFiles(name, desc);
        if (!result.success) return res.status(500).json({ success: false, error: result.error });
        res.json({ success: true, data: result });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/ideas', async (req, res) => {
    try {
        const project = req.query.project || null;
        const ideas = await getIdeas(project);
        res.json({ success: true, data: ideas });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/ideas', async (req, res) => {
    try {
        const { project_name, content, weight, category } = req.body;
        if (!content) return res.status(400).json({ success: false, error: 'Content is required' });
        const idea = await createIdea(project_name || null, content, weight || 0, category || 'general');
        if (!idea) return res.status(500).json({ success: false, error: 'Failed to create idea' });
        res.json({ success: true, data: idea });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.patch('/api/ideas/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const idea = await updateIdea(id, req.body);
        if (!idea) return res.status(404).json({ success: false, error: 'Idea not found' });
        res.json({ success: true, data: idea });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/ideas/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const ok = await deleteIdea(id);
        if (!ok) return res.status(404).json({ success: false, error: 'Idea not found' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/system/info', async (req, res) => {
  try { const cpu = await getCPUInfo(); const temp = await getCPUTemp(); res.json({ success: true, data: { ...cpu, temp } }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/system/resources', async (req, res) => {
  try { const resources = await getSystemResources(); res.json({ success: true, data: resources }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/model/switch', async (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ success: false, error: 'No model specified' });
  currentModel = model;
  res.json({ success: true, model, message: `Switched to ${model}` });
});

app.get('/api/model/current', (req, res) => { res.json({ success: true, model: currentModel }); });

app.get('/api/models', async (req, res) => {
  try { const models = await fetchOllamaModels(); res.json({ success: true, data: models }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/info', (req, res) => { res.json({ success: true, data: getInfoModals() }); });
app.get('/api/info/:id', (req, res) => {
  const modal = getInfoModals().find(m => m.id === req.params.id);
  if (!modal) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, data: modal });
});

app.get('/api/startup-config', (req, res) => { res.json({ success: true, autoStart }); });
app.post('/api/startup-config', async (req, res) => { const { autoStart: val } = req.body; autoStart = val; res.json({ success: true, autoStart: val }); });

app.get('/api/usage', async (req, res) => {
  try { res.json({ success: true, data: getUsageStats() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/usage/sessions', async (req, res) => {
  try { res.json({ success: true, data: getSessionSummary() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/usage/record', async (req, res) => {
  try { recordUsage(req.body); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/usage/cost-report', async (req, res) => {
  try { res.json({ success: true, data: getCostReport() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/usage/budget', async (req, res) => {
  try { res.json({ success: true, data: getBudgetStatus() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/usage/alerts', async (req, res) => {
  try { res.json({ success: true, data: checkBudgetAlerts() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/usage/cost-history', async (req, res) => {
  try { const days = parseInt(req.query.days) || 30; res.json({ success: true, data: getCostHistory(days) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/usage/daily-summary', async (req, res) => {
  try { const days = parseInt(req.query.days) || 7; res.json({ success: true, data: getDailySummary(days) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/usage/model-recommendations', async (req, res) => {
  try { const budget = parseFloat(req.query.budget) || 0.50; res.json({ success: true, data: getModelRecommendations(budget) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/prompt/routing-plan', (req, res) => { res.json({ success: true, data: getRoutingPlan() }); });

app.get('/api/prompt/select-model', async (req, res) => {
  try {
    const { prompt, budget } = req.query;
    if (!prompt) return res.status(400).json({ success: false, error: 'No prompt provided' });
    const result = selectModel(prompt, budget ? parseFloat(budget) : undefined);
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/prompt/optimize', async (req, res) => {
  try {
    const { prompt } = req.query;
    if (!prompt) return res.status(400).json({ success: false, error: 'No prompt provided' });
    res.json({ success: true, data: optimizePrompt(prompt) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/prompt/classify', async (req, res) => {
  try {
    const { prompt } = req.query;
    if (!prompt) return res.status(400).json({ success: false, error: 'No prompt provided' });
    res.json({ success: true, data: classifyTask(prompt) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/prompt/estimate', async (req, res) => {
  try {
    const { model, inputTokens, outputTokens } = req.query;
    const result = estimateCost(model, parseInt(inputTokens) || 0, parseInt(outputTokens) || 0);
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/workspaces', async (req, res) => {
  try { res.json({ success: true, data: await scanWorkspaces(WORKSPACE_ROOTS) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/telemetry', async (req, res) => {
  try { res.json({ success: true, data: await getTelemetry() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/tickets', async (req, res) => {
  try { res.json({ success: true, data: await getTickets(WORKSPACE_ROOTS[0]) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/processes', async (req, res) => {
  try {
    const processes = await getSystemProcesses();
    const ports = await getListeningPorts();
    const resources = await getSystemResources();
    res.json({ success: true, data: { processes, ports, resources } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/processes/kill', async (req, res) => {
  const { pid } = req.body;
  if (!pid) return res.status(400).json({ success: false, error: 'No PID provided' });
  const result = await killProcess(pid);
  res.json(result);
});

app.get('/api/mcp', async (req, res) => {
  try { const { servers, count } = getMcpServers(); const status = await getMcpStatus(); res.json({ success: true, data: { servers, status, count } }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/hooks', async (req, res) => {
  try { res.json({ success: true, data: getEccHooks() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/plugins', async (req, res) => {
  try { res.json({ success: true, data: getPlugins() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/opencode/config', async (req, res) => {
  try {
    const cfg = getOpenCodeConfig();
    res.json({ success: true, data: cfg || { model: 'none', provider: 'none', agents: [], commands: [] } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/opencode/logs', async (req, res) => {
  try { res.json({ success: true, data: getOpenCodeLogs() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/opencode/sessions', async (req, res) => {
  try { res.json({ success: true, data: getOpenCodeSessions() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/opencode/agents', async (req, res) => {
  try { res.json({ success: true, data: getOpenCodeAgents() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/opencode/commands', async (req, res) => {
  try { res.json({ success: true, data: getOpenCodeCommands() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3011');
  res.flushHeaders();
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (e) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
  req.on('error', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

app.post('/api/handoff', async (req, res) => {
  try {
    const workspace = req.body.workspace || WORKSPACE_ROOTS[0];
    const result = await createHandoff(workspace);
    res.json({ success: true, data: { filepath: result.filepath, filename: result.filename } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/command', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ success: false, error: 'No command provided' });
  if (checkDestructive(command)) return res.status(403).json({ success: false, error: 'Blocked: destructive command detected' });
  res.json({ success: true, message: 'Command validated', command });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`\n  OverApp Command Center running at http://${HOST}:${PORT}`);
  console.log(`  SSE stream: http://${HOST}:${PORT}/api/stream`);
  console.log(`  Workspaces: ${WORKSPACE_ROOTS.join(', ')}`);
  console.log(`  Auto-start: ${autoStart}`);
  if (autoStart) { startTelemetryBroadcast(); }
});
