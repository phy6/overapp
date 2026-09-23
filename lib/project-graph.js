const fs = require('fs');
const path = require('path');
const { execGit, getWorkspaceStatus, scanWorkspaces } = require('./git-scanner');
const { getTickets } = require('./gh-bridge');
const { getDecisionState, saveDecisionState, getFogState, saveFogState, redact } = require('./db');
const { getGitHubRepos, getGitHubTickets } = require('./github-scanner');

const WORKSPACE_ROOTS = ['/home/martin/Code/dublin-opendata', '/home/martin/Code/The_Activist3'];
const ALL_ARTIFACTS = ['CONTEXT.md', 'WAYFINDER.md', 'TODO.md', 'AGENT.md', 'AGENTS.md', 'ROADMAP.md'];
const RECOMMENDED_RESOLUTIONS = {
    'Authentication Strategy': { Status: 'Resolved', Resolution: 'Use centralized .env vault, validate all keys on server startup', Note: 'Recommended: centralized key vault validated at startup' },
    'Search Architecture': { Status: 'In Progress', Resolution: 'Implement multi-portal fan-out with Promise.all, cache results', Note: 'Recommended: fan-out pattern with parallel Promise.all calls' },
    'Data Caching': { Status: 'In Progress', Resolution: 'Add Redis in-memory cache with TTL for CKAN API responses', Note: 'Recommended: Redis cache with configurable TTL per portal' },
    'Error Handling Strategy': { Status: 'In Progress', Resolution: 'Standardize error format: { error: string, details?: object } with HTTP status codes', Note: 'Recommended: consistent error format across all route handlers' },
};

function getProjectRoot(name) {
    return WORKSPACE_ROOTS.find(r => path.basename(r) === name) || discoverProjectRoots().find(r => path.basename(r) === name);
}

function parseWayfinder(name) {
  const root = getProjectRoot(name);
  if (!root) return null;
  const wfPath = path.join(root, 'WAYFINDER.md');
  try {
    const content = fs.readFileSync(wfPath, 'utf-8');
    const lines = content.split('\n');
    const result = { name, decisionNodes: [], fogItems: [], priorityPaths: [], rawPath: wfPath };
    let currentSection = null;
    let currentNode = null;
    for (const line of lines) {
      if (line.startsWith('## Decision Nodes')) { currentSection = 'decisionNodes'; continue; }
      if (line.startsWith('## Fog Items')) { currentSection = 'fogItems'; continue; }
      if (line.startsWith('## Priority Paths')) { currentSection = 'priorityPaths'; continue; }
      if (line.startsWith('### ') && (currentSection === 'decisionNodes' || currentSection === 'fogItems')) {
        currentNode = { title: line.replace('### ', '').trim(), section: currentSection };
        continue;
      }
      if (currentNode && line.match(/^-\s+\*\*(\w+)\*\*:\s*(.*)/)) {
        const keyMatch = line.match(/^-\s+\*\*(\w+)\*\*:\s*(.*)/);
        currentNode[keyMatch[1]] = keyMatch[2].trim();
        continue;
      }
      if (line.trim() === '' && currentNode && Object.keys(currentNode).length > 1) {
        result.decisionNodes.push(currentNode);
        currentNode = null;
        continue;
      }
    }
    if (currentNode && Object.keys(currentNode).length > 1) {
      result.decisionNodes.push(currentNode);
    }
    const fogSectionMatch = content.match(/## Fog Items\n([\s\S]*?)(?=\n## |\n$)/);
    if (fogSectionMatch) {
      fogSectionMatch[1].split('\n').forEach(l => {
        const trimmed = l.trim();
        if (trimmed && !trimmed.startsWith('##')) {
          result.fogItems.push(trimmed.replace(/^[1-9]\.\s*/, ''));
        }
      });
    }
    if (result.fogItems.length === 0) {
      const fogSection = content.split('## Fog Items')[1];
      if (fogSection) {
        fogSection.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('##')).forEach(l => {
          if (l.trim().startsWith('- ')) result.fogItems.push(l.trim().replace(/^- /, ''));
        });
      }
    }
    const pathSectionMatch = content.match(/## Priority Paths\n([\s\S]*?)(?=\n## |\n$)/);
    if (pathSectionMatch) {
      pathSectionMatch[1].split('\n').forEach(l => {
        const trimmed = l.trim();
        if (trimmed && trimmed.match(/^\d+\.\s/)) {
          result.priorityPaths.push(trimmed.replace(/^\d+\.\s/, ''));
        }
      });
    }
    return result;
  } catch {
    return { name, decisionNodes: [], fogItems: [], priorityPaths: [], rawPath: wfPath, error: 'Could not parse WAYFINDER.md' };
  }
}

function getProjectTickets(name) {
  const root = getProjectRoot(name);
  if (!root) return { issues: [], pullRequests: [] };
  return getTickets(root);
}

async function getProjectState(name) {
    return getDecisionState(name);
}

async function saveProjectState(name, state) {
  const overrides = state.decisionOverrides || {};
  let success = true;
  for (const [indexStr, data] of Object.entries(overrides)) {
    const ok = await saveDecisionState(name, parseInt(indexStr), data);
    if (!ok) success = false;
  }
  return success;
}

function getArtifactInfo(root, artifact) {
  const fullPath = path.join(root, artifact);
  try {
    const stat = fs.statSync(fullPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { exists: true, size: stat.size, modified: stat.mtime.toISOString(), lines: content.split('\n').length, path: fullPath };
  } catch {
    return { exists: false };
  }
}

function getContext(name) {
    const root = getProjectRoot(name);
    if (!root) return null;
   const ctxPath = path.join(root, 'CONTEXT.md');
   const wfPath = path.join(root, 'WAYFINDER.md');
   let currentState = null;
   try {
       const wfContent = fs.readFileSync(wfPath, 'utf-8');
       const wfMatch = wfContent.match(/## Current State\n([\s\S]*?)(?=\n## |\n$)/);
       if (wfMatch) currentState = wfMatch[1].trim();
   } catch {}
   try {
       const content = fs.readFileSync(ctxPath, 'utf-8');
       const sections = {};
       const termsMatch = content.match(/## Core Terms\n([\s\S]*?)(?=\n## |\n$)/);
       if (termsMatch) sections.coreTerms = termsMatch[1].trim().split('\n').filter(l => l.trim().length > 0).slice(0, 20).join('\n');
       const openQuestionsMatch = content.match(/## Open Questions\n([\s\S]*?)(?=\n## |\n$)/);
       if (openQuestionsMatch) sections.openQuestions = openQuestionsMatch[1].trim().split('\n').filter(l => l.trim().length > 0).slice(0, 10);
       return { name, currentState, ...sections, redacted: redact(content).slice(0, 3000) };
   } catch {}
   return { name, currentState, coreTerms: null, openQuestions: null, redacted: '' };
}

function explainDecision(name, index) {
    const root = getProjectRoot(name);
    if (!root) return null;
   const wf = parseWayfinder(name);
   const ctx = getContext(name);
   if (!wf || !wf.decisionNodes[index]) return null;
   const node = wf.decisionNodes[index];
   const titleKey = node.title.replace(/^\d+\.\s*/, '').trim();
   const recommended = RECOMMENDED_RESOLUTIONS[titleKey] || null;
   const nodeWords = titleKey.toLowerCase().split(/\s+/);
   return {
     node,
     index,
     context: ctx.currentState || '',
     coreTerms: ctx.coreTerms || '',
     openQuestions: ctx.openQuestions || [],
     recommended,
     relatedFogItems: wf.fogItems.filter(f => {
       const lower = f.toLowerCase();
       return nodeWords.some(w => lower.includes(w) || w.includes(lower));
     }).slice(0, 3),
   };
 }

async function generateProjectFiles(name, description) {
  const root = path.join('/home/martin/Code', name);
  try {
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    const title = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const contextLines = description
      ? `# ${title} — Domain Glossary\n\n## Project Description\n${description}\n\n## Core Terms\n\n### ${title}\nA project focused on ${description}.\n\n## Core Operations\n\n1. **List Items** — Returns all available items\n2. **Create Item** — Creates a new item\n3. **Search Items** — Searches items by keyword\n\n## Open Questions\n\n1. What is the primary data source?\n2. What authentication model is needed?\n3. What is the target deployment environment?\n`
      : `# ${title} — Domain Glossary\n\n## Project Description\n${title} is a new project.\n\n## Core Terms\n\n### ${title}\nA project.\n\n## Core Operations\n\n1. **List Items** — Returns all available items\n2. **Create Item** — Creates a new item\n3. **Search Items** — Searches items by keyword\n\n## Open Questions\n\n1. What is the primary data source?\n2. What authentication model is needed?\n3. What is the target deployment environment?\n`;
    fs.writeFileSync(path.join(root, 'CONTEXT.md'), contextLines);
    const wayfinderLines = `# ${title} — Decision Framework\n\n## Current State\n${description || title + ' is being initialized.'}\n\n## Decision Nodes\n\n### 1. Project Architecture\n- **Status**: Active\n- **Options**: Monolith vs. Modular\n- **Priority**: High\n\n### 2. Data Source\n- **Status**: Open question\n- **Options**: Local vs. API\n- **Priority**: High\n\n### 3. Authentication\n- **Status**: Not started\n- **Options**: None vs. API Key vs. OAuth\n- **Priority**: Medium\n\n### 4. Deployment Target\n- **Status**: Not started\n- **Options**: Local vs. Cloud\n- **Priority**: Medium\n\n## Fog Items\n- What is the primary data source?\n- What authentication model is needed?\n- What is the target deployment environment?\n- Is there a preferred framework?\n\n## Priority Paths\n1. Initialize project structure → Define data sources → Implement core operations\n2. Set up authentication → Add security → Deploy and test\n`;
    fs.writeFileSync(path.join(root, 'WAYFINDER.md'), wayfinderLines);
    fs.writeFileSync(path.join(root, 'TODO.md'), `# ${title} — Task List\n\n## Priority Tasks\n- [ ] Initialize project structure\n- [ ] Define core operations\n- [ ] Set up authentication\n- [ ] Add security measures\n- [ ] Deploy and test\n`);
    fs.writeFileSync(path.join(root, 'AGENT.md'), `# ${title} — Agent Configuration\n\n## Project Name\n${title}\n\n## Description\n${description || 'New project.'}\n\n## Agent Settings\n- Mode: Active\n- Auto-refresh: Enabled\n- Notification: On completion\n`);
    fs.writeFileSync(path.join(root, '.project-state.json'), '{"decisionOverrides":{}}');
    return { success: true, root, files: ['CONTEXT.md', 'WAYFINDER.md', 'TODO.md', 'AGENT.md'] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getNextAction(name) {
  const wf = parseWayfinder(name);
  if (!wf || wf.decisionNodes.length === 0) return null;
  const resolved = wf.decisionNodes.filter(n => n.Status === 'Resolved');
  const unresolved = wf.decisionNodes.filter(n => n.Status !== 'Resolved');
  if (unresolved.length === 0) return null;
  const highPriority = unresolved.find(n => n.Priority === 'High');
  if (highPriority) return highPriority.title;
  return unresolved[0].title;
}

function getProjectInfo(root) {
  const name = path.basename(root);
  const info = { name, root, status: 'unknown', progress: 0, blockages: [], dependencies: [], artifacts: {}, lastActivity: null };
  try {
    const branch = fs.readdirSync(root).length > 0 ? 'active' : 'empty';
    info.status = branch;
  } catch {}
  const artifactFiles = ['CONTEXT.md', 'WAYFINDER.md', 'TODO.md', 'AGENT.md'];
  for (const artifact of artifactFiles) {
    try { fs.accessSync(path.join(root, artifact)); info.artifacts[artifact] = true; } catch { info.artifacts[artifact] = false; }
  }
  const hasWayfinder = info.artifacts['WAYFINDER.md'];
  const hasContext = info.artifacts['CONTEXT.md'];
  const hasTodo = info.artifacts['TODO.md'];
  if (hasWayfinder && hasContext) info.progress = 70;
  else if (hasWayfinder || hasContext) info.progress = 40;
  else if (hasTodo) info.progress = 20;
  else info.progress = 10;
  if (!hasWayfinder) info.blockages.push('Missing WAYFINDER.md - no decision framework');
  if (!hasContext) info.blockages.push('Missing CONTEXT.md - no domain context');
  if (!hasTodo) info.blockages.push('Missing TODO.md - no task tracking');
  info.lastActivity = new Date().toISOString();
  return info;
}

function getProjectDependencies() {
  const deps = [];
  for (const root of WORKSPACE_ROOTS) {
    const pkgPath = path.join(root, 'package.json');
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.dependencies || pkg.devDependencies) {
          const allDeps = Object.keys(pkg.dependencies || {}).concat(Object.keys(pkg.devDependencies || {}));
          deps.push({ project: path.basename(root), dependencies: allDeps.slice(0, 20) });
        }
      }
    } catch {}
  }
  return deps;
}



async function getProjectDetail(name) {
    const root = WORKSPACE_ROOTS.find(r => path.basename(r) === name) || discoverProjectRoots().find(r => path.basename(r) === name);
    if (!root) return null;
   const project = getProjectInfo(root);
   const workspaceStatus = await getWorkspaceStatus(root);
   const pkgPath = path.join(root, 'package.json');
   let pkg = null;
   try { if (fs.existsSync(pkgPath)) pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); } catch {}
   const artifactDetails = {};
   let totalArtifactSize = 0;
   let totalArtifactLines = 0;
   ALL_ARTIFACTS.forEach(a => {
       const info = getArtifactInfo(root, a);
       artifactDetails[a] = info;
       if (info.exists) { totalArtifactSize += info.size; totalArtifactLines += info.lines; }
   });
   let topLevelFiles = [];
   try {
       const entries = fs.readdirSync(root);
       topLevelFiles = entries.filter(e => {
           const fullPath = path.join(root, e);
           try { return fs.statSync(fullPath).isFile(); } catch { return false; }
       }).sort();
   } catch {}
   const deps = getProjectDependencies().find(d => d.project === name);
   const wf = parseWayfinder(name);
   const state = await getProjectState(name);
   const overrides = state || {};
   const fogState = await getFogState(name);
   const mergedDecisionNodes = wf ? wf.decisionNodes.map((node, i) => {
       const override = overrides[String(i)];
       return override ? { ...node, ...override, hasOverride: true } : node;
   }) : [];
   const nextAction = getNextAction(name);
   return {
       ...project, root,
       git: { branch: workspaceStatus.git.branch || 'N/A', lastCommit: workspaceStatus.git.lastCommit || 'N/A', uncommittedChanges: workspaceStatus.git.uncommittedChanges, status: workspaceStatus.git.status || '' },
       artifactsDetail: artifactDetails, totalArtifactSize, totalArtifactLines,
       packageJson: pkg ? { name: pkg.name, version: pkg.version, scripts: Object.keys(pkg.scripts || {}), devDependenciesCount: Object.keys(pkg.devDependencies || {}).length, dependenciesCount: Object.keys(pkg.dependencies || {}).length } : null,
       topLevelFiles: topLevelFiles.slice(0, 20), dependencies: deps ? deps.dependencies : [],
       lastActivity: project.lastActivity || new Date().toISOString(),
       wayfinder: wf ? { decisionNodes: mergedDecisionNodes, fogItems: wf.fogItems, priorityPaths: wf.priorityPaths, hasOverrides: Object.keys(overrides).length > 0, fogStates: fogState } : null,
       nextAction,
   };
}

let graphCache = null;
let graphCacheTime = 0;
const GRAPH_CACHE_TTL = 5000; // 5 seconds TTL cache

const OVERAPP_ROOT = '/home/martin/Code';

function discoverProjectRoots() {
    try {
        const entries = fs.readdirSync(OVERAPP_ROOT, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory())
            .map(e => path.join(OVERAPP_ROOT, e.name))
            .filter(root => {
                try { return fs.existsSync(path.join(root, 'CONTEXT.md')) || fs.existsSync(path.join(root, 'WAYFINDER.md')); } catch { return false; }
            });
    } catch { return []; }
}

async function buildProjectGraph(workspaceRoots) {
    const now = Date.now();
    if (graphCache && (now - graphCacheTime < GRAPH_CACHE_TTL)) {
        return graphCache;
    }
    const extraRoots = discoverProjectRoots().filter(r => !WORKSPACE_ROOTS.includes(r));
    const roots = [...WORKSPACE_ROOTS, ...extraRoots];
    const localProjects = roots.map(root => {
        const info = getProjectInfo(root);
        const name = path.basename(root);
        const wf = parseWayfinder(name);
        const tickets = getProjectTickets(name);
        const nextAction = getNextAction(name);
        return { ...info, wayfinder: wf ? { decisionNodes: wf.decisionNodes.length, fogItems: wf.fogItems.length, priorityPaths: wf.priorityPaths.length } : { decisionNodes: 0, fogItems: 0, priorityPaths: 0 }, ticketCount: (tickets.issues || []).length + (tickets.pullRequests || []).length, nextAction };
    });

    const githubProjects = [];
    getGitHubRepos().then(repos => {
        for (const repo of repos) {
            githubProjects.push({
                name: repo.name,
                fullName: repo.fullName,
                description: repo.description,
                stars: repo.stars,
                language: repo.language,
                visibility: repo.visibility,
                lastUpdated: repo.lastUpdated,
                url: repo.url,
                source: 'github',
                artifacts: { CONTEXT_MD: false, WAYFINDER_MD: false, TODO_MD: false, AGENT_MD: false },
                progress: 0,
                blockages: [],
                wayfinder: null,
                ticketCount: 0,
                nextAction: null,
            });
        }
        // Update cache with GitHub projects if cache is stale
        const cached = graphCache;
        if (cached && (Date.now() - graphCacheTime < GRAPH_CACHE_TTL)) {
            cached.projects = [...localProjects, ...githubProjects];
            cached.summary.totalProjects = cached.projects.length;
        }
    }).catch(() => {});

    const allProjects = [...localProjects];
    const deps = getProjectDependencies();
    graphCache = { projects: allProjects, dependencies: deps, connections: [{ from: 'dublin-opendata', to: 'The_Activist3', type: 'shared-skills', strength: 0.6 }], summary: { totalProjects: allProjects.length, activeProjects: allProjects.filter(p => p.progress > 50).length, blockedProjects: allProjects.filter(p => p.blockages.length > 0).length, totalArtifacts: allProjects.reduce((sum, p) => sum + Object.keys(p.artifacts).filter(k => p.artifacts[k]).length, 0) } };
    graphCacheTime = now;
    return graphCache;
}

function getInfoModals() {
   return [
       { id: 'layer-concept', title: 'What is a Layer?', content: 'Layers represent the depth of context your agent maintains.', category: 'education' },
       { id: 'blockage', title: 'Blockages', content: 'Blockages are obstacles preventing project progress.', category: 'education' },
       { id: 'model-selection', title: 'Model Selection', content: 'Switch between locally loaded models in Ollama.', category: 'education' },
       { id: 'telemetry', title: 'Performance Telemetry', content: 'Real-time telemetry tracks TPS, VRAM usage, and active context.', category: 'education' },
       { id: 'handoff', title: 'Handoff Engine', content: 'Generates a structured markdown document capturing session state.', category: 'education' },
       { id: 'skills', title: 'Skills System', content: 'Skills are reusable agent behaviors stored in .claude/skills/.', category: 'education' },
       { id: 'mode-toggle', title: 'LLM Mode', content: 'Passive Mode uses rule-based logic with zero LLM calls.', category: 'education' },
       { id: 'process-tree', title: 'Process Tree', content: 'Shows parent-child relationships between running processes.', category: 'education' },
   ];
}

module.exports = { getProjectInfo, getProjectDetail, getProjectDependencies, buildProjectGraph, getInfoModals, parseWayfinder, getProjectTickets, getProjectState, saveProjectState, getContext, explainDecision, generateProjectFiles, getNextAction, getFogState, saveFogState };
