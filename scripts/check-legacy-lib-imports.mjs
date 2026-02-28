#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

const IMPORT_EXPORT_SPEC_REGEX =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_SPEC_REGEX = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const ALLOWED_FACADE_FILES = new Set();

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function collectSourceFiles(dirPath, out = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(absolutePath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(absolutePath);
    }
  }
  return out;
}

function collectSpecifiers(fileContent) {
  const specifiers = new Set();

  for (const regex of [IMPORT_EXPORT_SPEC_REGEX, DYNAMIC_IMPORT_SPEC_REGEX]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(fileContent)) !== null) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function isAllowedLegacyLibImporter(relativePath) {
  if (ALLOWED_FACADE_FILES.has(relativePath)) return true;
  return false;
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('Cannot find src directory.');
    process.exit(1);
  }

  const files = collectSourceFiles(SRC_DIR);
  const violations = [];

  for (const absolutePath of files) {
    const relativePath = normalizePath(path.relative(ROOT_DIR, absolutePath));
    if (isAllowedLegacyLibImporter(relativePath)) continue;

    const source = fs.readFileSync(absolutePath, 'utf8');
    const specifiers = collectSpecifiers(source);
    const legacyImports = specifiers.filter((specifier) => specifier.startsWith('@/lib/'));
    if (legacyImports.length === 0) continue;

    for (const specifier of legacyImports) {
      violations.push({ file: relativePath, specifier });
    }
  }

  if (violations.length > 0) {
    console.error(
      `Legacy lib import check failed. Found ${violations.length} import(s):\n`
    );

    const ordered = violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier)
    );
    for (const violation of ordered) {
      console.error(`- ${violation.file}: "${violation.specifier}"`);
    }

    console.error(
      '\nFix: import from shared/domain/infrastructure modules instead of "@/lib/*".'
    );
    process.exit(1);
  }

  console.log('Legacy lib import check passed: no unauthorized "@/lib/*" imports found.');
}

main();
