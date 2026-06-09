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

  const normalizedResolved = relativeToRoot(resolvedPath);
  const targetMatch = normalizedResolved.match(/^src\/features\/([^/]+)\//);
  return targetMatch?.[1] ?? null;
}

function createEdgeBucket() {
  return {
    imports: 0,
    files: new Set(),
  };
}

function addEdge(edgeMap, fromFeature, toFeature, filePath) {
  const key = `${fromFeature} -> ${toFeature}`;
  const bucket = edgeMap.get(key) ?? createEdgeBucket();
  bucket.imports += 1;
  bucket.files.add(filePath);
  edgeMap.set(key, bucket);
}

function toRows(edgeMap) {
  return [...edgeMap.entries()]
    .map(([edge, value]) => ({
      edge,
      imports: value.imports,
      files: value.files.size,
    }))
    .sort(
      (a, b) =>
        b.imports - a.imports ||
        b.files - a.files ||
        a.edge.localeCompare(b.edge)
    );
}

function printTable(title, rows) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }

  for (const row of rows) {
    console.log(
      `  - ${row.edge}: ${row.imports} imports across ${row.files} files`
    );
  }
}

function reportFeatureEdges() {
  if (!fs.existsSync(FEATURES_DIR)) {
    console.error('Cannot find src/features directory.');
    process.exit(1);
  }

  const files = collectFeatureFiles();
  const directEdges = new Map();
  const adapterEdges = new Map();

  for (const file of files) {
    const fromFeature = getFeatureNameFromFeatureFile(file);
    if (!fromFeature) continue;

    const source = fs.readFileSync(file, 'utf8');
    const specifiers = collectSpecifiers(source);
    const isDepsFile = isFeatureDepsFile(file);
    const filePath = relativeToRoot(file);

    for (const specifier of specifiers) {
      const toFeature = resolveTargetFeature(file, specifier);
      if (!toFeature || toFeature === fromFeature) continue;

      if (isDepsFile) {
        addEdge(adapterEdges, fromFeature, toFeature, filePath);
      } else {
        addEdge(directEdges, fromFeature, toFeature, filePath);
      }
    }
  }

  const directRows = toRows(directEdges);
  const adapterRows = toRows(adapterEdges);

  if (process.argv.includes('--json')) {
    const payload = {
      scannedFiles: files.length,
      directCrossFeatureOutsideDeps: directRows,
      adapterCrossFeatureEdges: adapterRows,
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Scanned ${files.length} feature files.`);
  printTable('Direct Cross-Feature Imports Outside deps/*', directRows);
  printTable('Cross-Feature Imports Through deps/* Adapters', adapterRows);
}

reportFeatureEdges();
