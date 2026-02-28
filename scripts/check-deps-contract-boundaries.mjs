#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const FEATURES_DIR = path.join(ROOT_DIR, 'src', 'features');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const CONTRACT_FILE_REGEX = /-contract\.(ts|tsx)$/;

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

function getDepsFileMeta(absolutePath) {
  const relative = normalizePath(path.relative(ROOT_DIR, absolutePath));
  const match = relative.match(/^src\/features\/([^/]+)\/deps\/(.+)$/);
  if (!match) return null;

  const ownerFeature = match[1];
  const depsFilePath = match[2];
  const depsDir = `src/features/${ownerFeature}/deps`;
  const isContractFile = CONTRACT_FILE_REGEX.test(path.basename(depsFilePath));

  return {
    ownerFeature,
    relativePath: relative,
    depsDir,
    isContractFile,
  };
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

function resolveTargetFeature(fromFile, rawSpecifier) {
  const normalizedSpecifier = stripQueryAndHash(rawSpecifier);

  if (normalizedSpecifier.startsWith('@/features/')) {
    const targetFeature = normalizedSpecifier
      .slice('@/features/'.length)
      .split('/')[0];
    return targetFeature || null;
  }

  if (!normalizedSpecifier.startsWith('.')) {
    return null;
  }

  const resolvedPath = resolveRelativeSpecifier(fromFile, normalizedSpecifier);
  if (!resolvedPath) return null;

  const normalizedResolved = normalizePath(path.relative(ROOT_DIR, resolvedPath));
  const targetMatch = normalizedResolved.match(/^src\/features\/([^/]+)\//);
  return targetMatch?.[1] ?? null;
}

function checkDepsContractBoundaries() {
  if (!fs.existsSync(FEATURES_DIR)) {
    console.error('Cannot find src/features directory.');
    process.exit(1);
  }

  const files = collectFeatureFiles(FEATURES_DIR);
  const depsFiles = files
    .map((absolutePath) => {
      const meta = getDepsFileMeta(absolutePath);
      if (!meta) return null;
      return { absolutePath, ...meta };
    })
    .filter(Boolean);

  const contractFiles = [];
  const regularCrossImports = [];

  for (const file of depsFiles) {
    const source = fs.readFileSync(file.absolutePath, 'utf8');
    const specifiers = collectSpecifiers(source);

    for (const specifier of specifiers) {
      const targetFeature = resolveTargetFeature(file.absolutePath, specifier);
      if (!targetFeature || targetFeature === file.ownerFeature) continue;

      if (file.isContractFile) {
        contractFiles.push(file.relativePath);
      } else {
        regularCrossImports.push({
          file: file.relativePath,
          depsDir: file.depsDir,
          ownerFeature: file.ownerFeature,
          targetFeature,
          specifier,
        });
      }
    }
  }

  if (regularCrossImports.length > 0) {
    console.error(
      `Deps contract check failed. Found ${regularCrossImports.length} cross-feature imports outside *-contract.ts:\n`
    );

    const ordered = regularCrossImports.sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.targetFeature.localeCompare(b.targetFeature) ||
        a.specifier.localeCompare(b.specifier)
    );

    for (const violation of ordered) {
      console.error(`- ${violation.file}: "${violation.specifier}" -> src/features/${violation.targetFeature}`);
    }

    console.error(
      '\nFix: move cross-feature imports into *-contract.ts files and re-export from non-contract deps adapters.'
    );
    process.exit(1);
  }

  console.log(
    `Deps contract check passed (${depsFiles.length} deps files scanned, ${contractFiles.length} contract files).`
  );
}

checkDepsContractBoundaries();
