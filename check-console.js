// check-console.js — boots index.html in headless Chrome is done separately;
// this script scans a captured chrome stderr log for page problems.
const fs = require('fs');
const log = fs.readFileSync(process.argv[2] || 'console-capture.log', 'utf8');
const lines = log.split(/\r?\n/);
const interesting = [];
for (const ln of lines) {
  if (/CONSOLE|Failed to load resource|net::ERR|Uncaught|404|is not defined|Cannot read|SyntaxError|ReferenceError|TypeError/.test(ln)) {
    // drop chrome-internal enterprise/DM noise
    if (/cloud_management|DM token|devtools.*listening|VERBOSE/.test(ln)) continue;
    interesting.push(ln.trim());
  }
}
const uniq = [...new Set(interesting)];
console.log('console/network problems: ' + uniq.length);
uniq.slice(0, 40).forEach(l => console.log('  ' + l));