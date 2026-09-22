const fs = require('fs');
const path = require('path');

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const frontmatter = {};
  match[1].trim().split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      frontmatter[key.trim()] = rest.join(':').trim().replace(/^["']|["']$/g, '');
    }
  });
  return frontmatter;
}

function parseWayfinder(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    const sections = {};

    const decisionMatches = content.match(/^##\s+(.+)/gm);
    const fogMatches = content.match(/(?:fog|unscoped|todo|undecided)/gi);
    const nodeMatches = content.match(/^-\s*\[[ xX]\]\s+(.+)/gm);

    sections.decisions = decisionMatches ? decisionMatches.map(m => m.replace('## ', '').trim()) : [];
    sections.fogItems = fogMatches ? fogMatches.length : 0;
    sections.nodes = nodeMatches ? nodeMatches.map(m => m.replace(/^-\s*\[[ xX]\]\s*/, '').trim()) : [];
    sections.frontmatter = frontmatter;
    sections.raw = content;

    return sections;
  } catch {
    return null;
  }
}

function parseContext(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);

    const adrMatches = content.match(/(?:ADR|Architectural Decision Record)[^\n]*/gi) || [];
    const domainTerms = content.match(/(?:domain|ubiquitous\s+language|term|concept)[^\n]*/gi) || [];
    const glossaryMatches = content.match(/^###\s+(.+)/gm) || [];

    return {
      frontmatter,
      adrs: adrMatches,
      domainTerms: domainTerms,
      glossarySections: glossaryMatches,
      raw: content,
    };
  } catch {
    return null;
  }
}

function parseSkillManifacts(skillsDir) {
  const skills = [];
  try {
    if (!fs.existsSync(skillsDir)) return skills;
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const frontmatter = parseFrontmatter(content);
          skills.push({
            name: frontmatter.name || entry.name,
            description: frontmatter.description || '',
            disableModelInvocation: frontmatter['disable-model-invocation'] || false,
            path: skillFile,
          });
        } catch {}
      }
    }
  } catch {}
  return skills;
}

module.exports = { parseWayfinder, parseContext, parseSkillManifacts, parseFrontmatter };
