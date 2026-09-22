const { execGh } = require('./git-scanner');

async function getIssues(workspaceRoot) {
  try {
    const output = await execGh(['issue', 'list', '--json', 'number,title,state,labels,assignees'], workspaceRoot);
    return JSON.parse(output || '[]');
  } catch (e) {
    return [];
  }
}

async function getPullRequests(workspaceRoot) {
  try {
    const output = await execGh(['pr', 'list', '--json', 'number,title,state,author,headRefName'], workspaceRoot);
    return JSON.parse(output || '[]');
  } catch (e) {
    return [];
  }
}

async function getTickets(workspaceRoot) {
  const [issues, prs] = await Promise.all([
    getIssues(workspaceRoot),
    getPullRequests(workspaceRoot),
  ]);

  return {
    issues: issues.map(i => ({
      type: 'issue',
      number: i.number,
      title: i.title,
      state: i.state,
      labels: i.labels || [],
      assignees: (i.assignees || []).map(a => a.login),
    })),
    pullRequests: prs.map(p => ({
      type: 'pr',
      number: p.number,
      title: p.title,
      state: p.state,
      author: p.author?.login || '',
      branch: p.headRefName || '',
    })),
  };
}

module.exports = { getIssues, getPullRequests, getTickets };
