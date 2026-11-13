#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_LINES = 600;
const TARGET_DIRS = ['src', 'server', 'scripts', 'tests'];
const ALLOWED_EXTS = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.css']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.playwright-cli']);

function walk(dir, results) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
    } else if (ALLOWED_EXTS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
}

const files = [];
for (const dir of TARGET_DIRS) {
  walk(path.resolve(process.cwd(), dir), files);
}

let hasViolation = false;
for (const file of files.sort()) {
  const content = fs.readFileSync(file, 'utf8');
  const lineCount = content.split(/\r?\n/).length;
  const rel = path.relative(process.cwd(), file);
  if (lineCount > MAX_LINES) {
    hasViolation = true;
    console.error(`EXCEEDS ${MAX_LINES} LINES: ${rel} (${lineCount} lines)`);
  }
}

if (hasViolation) {
  process.exit(1);
}

console.log(`File length check passed: ${files.length} files inspected (all <= ${MAX_LINES} lines).`);
