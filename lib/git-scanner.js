const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const DESTRUCTIVE_PATTERNS = [
  /git\s+push\s+--force/i,
  /git\s+reset\s+--hard/i,
  /rm\s+-rf/i,
  /rm\s+-r\s+-f/i,
];

function execGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(stderr || error.message);
      resolve(stdout.trim());
    });
  });
}

function execGh(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(stderr || error.message);
      resolve(stdout.trim());
    });
  });
}

function checkDestructive(cmd) {
  return DESTRUCTIVE_PATTERNS.some(p => p.test(cmd));
}

async function getWorkspaceStatus(workspaceRoot) {
  const result = { root: workspaceRoot, artifacts: {}, git: {} };

  try {
    const status = await execGit(['status', '--porcelain'], workspaceRoot);
    result.git.status = status;
    result.git.uncommittedChanges = status.length > 0;
  } catch (e) {
    result.git.status = '';
    result.git.uncommittedChanges = false;
  }

  try {
    result.git.branch = await execGit(['branch', '--show-current'], workspaceRoot);
  } catch (e) {
    result.git.branch = '';
  }

  try {
    result.git.lastCommit = await execGit(['log', '-1', '--oneline'], workspaceRoot);
  } catch (e) {
    result.git.lastCommit = '';
  }

  const artifactFiles = ['CONTEXT.md', 'WAYFINDER.md', 'TODO.md', 'AGENT.md', '.agents/', '.claude/skills/', 'WAYFINDER.md'];
  for (const artifact of artifactFiles) {
    const fullPath = path.join(workspaceRoot, artifact);
    try {
      if (artifact.endsWith('/')) {
        fs.accessSync(fullPath);
        result.artifacts[artifact.replace(/\/$/, '')] = true;
      } else {
        fs.accessSync(fullPath);
        result.artifacts[artifact] = true;
      }
    } catch {
      result.artifacts[artifact] = false;
    }
  }

  return result;
}

async function scanWorkspaces(roots) {
  const results = [];
  for (const root of roots) {
    try {
      const status = await getWorkspaceStatus(root);
      results.push(status);
    } catch (e) {
      results.push({ root, error: e.message });
    }
  }
  return results;
}

module.exports = { execGit, execGh, checkDestructive, getWorkspaceStatus, scanWorkspaces };
