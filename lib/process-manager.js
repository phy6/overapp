const { execFile } = require('child_process');

function parsePsOutput(output) {
  const lines = output.trim().split('\n');
  const header = lines[0].split(/\s+/);
  return lines.slice(1).map(line => {
    const parts = line.trim().split(/\s+/);
    return {
      user: parts[0] || '',
      pid: parts[1] || '',
      cpu: parts[2] || '0',
      mem: parts[3] || '0',
      vsz: parts[4] || '0',
      rss: parts[5] || '0',
      tty: parts[6] || '?',
      stat: parts[7] || '',
      start: parts[8] || '',
      time: parts[9] || '',
      command: parts.slice(10).join(' ') || '',
    };
  }).filter(p => p.pid && p.command);
}

function getSystemProcesses() {
  return new Promise((resolve) => {
    execFile('ps', ['aux', '--sort=-%cpu'], { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve([]);
      try {
        const processes = parsePsOutput(stdout);
        resolve(processes);
      } catch {
        resolve([]);
      }
    });
  });
}

function getListeningPorts() {
  return new Promise((resolve) => {
    execFile('ss', ['-tlnp'], { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve([]);
      const ports = [];
      const lines = stdout.trim().split('\n').slice(1);
      for (const line of lines) {
        const match = line.match(/LISTEN\s+\d+\s+\d+\s+([^\s:]+):(\d+)\s+([^\s]+).*users:\(\("([^"]+)",pid=(\d+)/);
        if (match) {
          ports.push({
            localAddress: match[1],
            port: match[2],
            process: match[4],
            pid: match[5],
          });
        }
      }
      resolve(ports);
    });
  });
}

async function killProcess(pid) {
  return new Promise((resolve) => {
    execFile('kill', ['-9', pid], { timeout: 5000 }, (error) => {
      if (error) return resolve({ success: false, error: error.message });
      resolve({ success: true, pid });
    });
  });
}

async function getSystemResources() {
  return new Promise((resolve) => {
    execFile('cat', ['/proc/meminfo'], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve({});
      const memInfo = {};
      for (const line of stdout.trim().split('\n')) {
        const [key, val] = line.split(':');
        if (key && val) {
          const num = parseInt(val.trim().split(/\s/)[0]);
          memInfo[key.trim()] = num;
        }
      }
      const totalMem = memInfo['MemTotal'] || 0;
      const availMem = memInfo['MemAvailable'] || 0;
      const usedMem = totalMem - availMem;

      execFile('df', ['-h', '/'], { timeout: 3000 }, (error, stdout) => {
        let diskInfo = {};
        if (!error) {
          const lines = stdout.trim().split('\n');
          if (lines.length > 1) {
            const parts = lines[1].split(/\s+/);
            diskInfo = { total: parts[1], used: parts[2], avail: parts[3], pct: parts[4] };
          }
        }
        resolve({
          memory: {
            totalGB: (totalMem / 1024 / 1024).toFixed(1),
            usedGB: (usedMem / 1024 / 1024).toFixed(1),
            availableGB: (availMem / 1024 / 1024).toFixed(1),
            usagePct: totalMem > 0 ? ((usedMem / totalMem) * 100).toFixed(1) : '0',
          },
          disk: diskInfo,
          uptime: Math.floor(Date.now() / 1000),
        });
      });
    });
  });
}

module.exports = { getSystemProcesses, getListeningPorts, killProcess, getSystemResources };
