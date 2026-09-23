const { execFile } = require('child_process');

let cachedRepos = null;
let cacheTime = 0;
const CACHE_TTL = 60000; // 60 seconds

function ghCli(args) {
  return new Promise((resolve, reject) => {
    const proc = execFile('gh', args, { timeout: 8000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(stderr || error.message);
      try { resolve(JSON.parse(stdout)); } catch { resolve(JSON.parse('[]')); }
    });
    proc.on('error', () => reject('Process error'));
  });
}

async function getGitHubRepos(owner) {
  const now = Date.now();
  if (cachedRepos && (now - cacheTime < CACHE_TTL)) {
    return cachedRepos;
  }
  try {
    const repos = await ghCli(['repo', 'list', owner || 'phy6', '--limit', '50', '--json', 'name,description,stargazerCount,primaryLanguage,defaultBranchRef,pushedAt,visibility']);
    cachedRepos = repos.map(r => ({
      name: r.name,
      fullName: `${owner || 'phy6'}/${r.name}`,
      description: r.description || '',
      stars: r.stargazerCount || 0,
      language: r.primaryLanguage?.name || 'Unknown',
      defaultBranch: r.defaultBranchRef?.name || 'main',
      visibility: r.visibility || 'public',
      lastUpdated: r.pushedAt || null,
      url: `https://github.com/${owner || 'phy6'}/${r.name}`,
      source: 'github',
    }));
    cacheTime = now;
    return cachedRepos;
  } catch (e) {
    return cachedRepos || [];
  }
}

async function getGitHubRepoDetail(owner, repoName) {
  try {
    const repo = await ghCli(['repo', 'view', `${owner}/${repoName}`, '--json', 'name,description,stargazerCount,primaryLanguage,defaultBranchRef,pushedAt,visibility,licenseInfo,topics,readmePath']);
    return {
      name: repo.name,
      fullName: `${owner}/${repoName}`,
      description: repo.description || '',
      stars: repo.stargazerCount || 0,
      language: repo.primaryLanguage?.name || 'Unknown',
      defaultBranch: repo.defaultBranchRef?.name || 'main',
      visibility: repo.visibility || 'public',
      license: repo.licenseInfo?.name || null,
      topics: repo.topics || [],
      lastUpdated: repo.pushedAt || null,
      readmePath: repo.readmePath || null,
      url: repo.url || `https://github.com/${owner}/${repoName}`,
    };
  } catch {
    return null;
  }
}

async function getGitHubTickets(owner, repoName) {
  try {
    const [issues, prs] = await Promise.all([
      ghCli(['issue', 'list', '--repo', `${owner}/${repoName}`, '--json', 'number,title,state,labels,assignees', '--limit', '10']).catch(() => []),
      ghCli(['pr', 'list', '--repo', `${owner}/${repoName}`, '--json', 'number,title,state,author,headRefName', '--limit', '10']).catch(() => []),
    ]);
    return { issues: issues.map(i => ({ type: 'issue', number: i.number, title: i.title, state: i.state, labels: i.labels || [], assignees: (i.assignees || []).map(a => a.login) })), pullRequests: prs.map(p => ({ type: 'pullRequest', number: p.number, title: p.title, state: p.state, author: p.author?.login || '', branch: p.headRefName || '' })) };
  } catch {
    return { issues: [], pullRequests: [] };
  }
}

module.exports = { getGitHubRepos, getGitHubRepoDetail, getGitHubTickets };
