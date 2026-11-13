#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const filterFile = path.resolve(process.cwd(), 'server/data/baseline-filters.txt');

if (!fs.existsSync(filterFile)) {
  console.error('Missing baseline filter file:', filterFile);
  process.exit(1);
}

const content = fs.readFileSync(filterFile, 'utf8');
const lines = content.split(/\r?\n/);

const hasTitle = lines.some((l) => l.startsWith('! Title:'));
const hasAttribution = lines.some((l) => l.startsWith('! Attribution:'));
const hasLicense = lines.some((l) => l.startsWith('! License:'));
const activeRules = lines.filter((l) => {
  const t = l.trim();
  return t.length > 0 && !t.startsWith('!') && !t.startsWith('[');
});

if (!hasTitle || !hasAttribution || !hasLicense) {
  console.error('Filter file missing required metadata headers (! Title, ! Attribution, ! License).');
  process.exit(1);
}

if (activeRules.length < 10) {
  console.error('Filter file has unexpectedly few active rules:', activeRules.length);
  process.exit(1);
}

console.log(
  `Filter source validation passed: ${activeRules.length} rules verified with Title, Attribution, and License headers.`,
);
