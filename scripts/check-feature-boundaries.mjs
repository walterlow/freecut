#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import {
  FEATURES_DIR,
  collectFeatureFiles,
  collectSpecifiers,
  relativeToRoot,
  resolveRelativeSpecifier,
  stripQueryAndHash,
} from './feature-boundary-context.mjs';

function getFeatureNameFromFeatureFile(absolutePath) {
  const relative = relativeToRoot(absolutePath);
  const match = relative.match(/^src\/features\/([^/]+)\//);
  return match?.[1] ?? null;
}

function isFeatureDepsFile(absolutePath) {
  const relative = relativeToRoot(absolutePath);
  return /^src\/features\/[^/]+\/deps\//.test(relative);
}

function checkFeatureBoundaries() {
  if (!fs.existsSync(FEATURES_DIR)) {
    console.error('Cannot find src/features directory.');
    process.exit(1);
  }

  const files = collectFeatureFiles();
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
            file: relativeToRoot(file),
            specifier,
            target: `src/features/${targetFeature}`,
          });
        }
        continue;
      }

      if (!normalizedSpecifier.startsWith('.')) continue;

      const resolvedPath = resolveRelativeSpecifier(file, normalizedSpecifier);
      if (!resolvedPath) continue;

      const normalizedResolved = relativeToRoot(resolvedPath);
      const targetMatch = normalizedResolved.match(/^src\/features\/([^/]+)\//);
      if (!targetMatch) continue;

      const targetFeature = targetMatch[1];
      if (targetFeature !== fromFeature) {
        violations.push({
          type: 'relative',
          file: relativeToRoot(file),
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
