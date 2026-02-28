#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const FEATURES_DIR = path.join(ROOT_DIR, 'src', 'features');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const IMPORT_EXPORT_SPEC_REGEX =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_SPEC_REGEX = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function stripQueryAndHash(specifier) {
  const [withoutHash] = specifier.split('#');
  const [withoutQuery] = withoutHash.split('?');
  return withoutQuery;
}

function collectFeatureFiles(dirPath, out = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectFeatureFiles(absolutePath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(absolutePath);
    }
  }
  return out;
}

function getFeatureNameFromFeatureFile(absolutePath) {
  const relative = normalizePath(path.relative(ROOT_DIR, absolutePath));
  const match = relative.match(/^src\/features\/([^/]+)\//);
  return match?.[1] ?? null;
}

function isFeatureDepsFile(absolutePath) {
  const relative = normalizePath(path.relative(ROOT_DIR, absolutePath));
  return /^src\/features\/[^/]+\/deps\//.test(relative);
}

function resolveRelativeSpecifier(fromFile, rawSpecifier) {
  const specifier = stripQueryAndHash(rawSpecifier);
  const basePath = path.resolve(path.dirname(fromFile), specifier);

  const candidates = [
    basePath,
    ...RESOLVE_EXTENSIONS.map((ext) => `${basePath}${ext}`),
    ...RESOLVE_EXTENSIONS.map((ext) => path.join(basePath, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
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

function checkFeatureBoundaries() {
  if (!fs.existsSync(FEATURES_DIR)) {
    console.error('Cannot find src/features directory.');
    process.exit(1);
  }

  const files = collectFeatureFiles(FEATURES_DIR);
  const violations = [];

  for (const file of files) {
    if (isFeatureDepsFile(file)) continue;

    const fromFeature = getFeatureNameFromFeatureFile(file);
    if (!fromFeature) continue;

    const source = fs.readFileSync(file, 'utf8');
    const specifiers = collectSpecifiers(source);

    for (const specifier of specifiers) {
      const normalizedSpecifier = stripQueryAndHash(specifier);

      if (normalizedSpecifier.startsWith('@/features/')) {
        const targetFeature = normalizedSpecifier
          .slice('@/features/'.length)
          .split('/')[0];

        if (targetFeature && targetFeature !== fromFeature) {
          violations.push({
            type: 'alias',
            file: normalizePath(path.relative(ROOT_DIR, file)),
            specifier,
            target: `src/features/${targetFeature}`,
          });
        }
        continue;
      }

      if (!normalizedSpecifier.startsWith('.')) continue;

      const resolvedPath = resolveRelativeSpecifier(file, normalizedSpecifier);
      if (!resolvedPath) continue;

      const normalizedResolved = normalizePath(path.relative(ROOT_DIR, resolvedPath));
      const targetMatch = normalizedResolved.match(/^src\/features\/([^/]+)\//);
      if (!targetMatch) continue;

      const targetFeature = targetMatch[1];
      if (targetFeature !== fromFeature) {
        violations.push({
          type: 'relative',
          file: normalizePath(path.relative(ROOT_DIR, file)),
          specifier,
          target: normalizedResolved,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `Boundary check failed. Found ${violations.length} direct cross-feature imports outside deps/*:\n`
    );

    const ordered = violations.sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.specifier.localeCompare(b.specifier) ||
        a.target.localeCompare(b.target)
    );

    for (const violation of ordered) {
      console.error(
        `- [${violation.type}] ${violation.file}: "${violation.specifier}" -> ${violation.target}`
      );
    }

    console.error(
      '\nFix: route cross-feature dependencies through src/features/<feature>/deps/* adapter modules.'
    );
    process.exit(1);
  }

  console.log(
    `Boundary check passed (${files.length} files scanned): no direct cross-feature imports outside deps/* detected.`
  );
}

checkFeatureBoundaries();
