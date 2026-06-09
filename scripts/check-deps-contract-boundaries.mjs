#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  FEATURES_DIR,
  ROOT_DIR,
  collectFeatureFiles,
  collectSpecifiers,
  normalizePath,
  relativeToRoot,
  resolveRelativeSpecifier,
  stripQueryAndHash,
} from './feature-boundary-context.mjs';
const CONTRACT_FILE_REGEX = /-contract\.(ts|tsx)$/;

function getDepsFileMeta(absolutePath) {
  const relative = relativeToRoot(absolutePath);
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

  const files = collectFeatureFiles();
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
