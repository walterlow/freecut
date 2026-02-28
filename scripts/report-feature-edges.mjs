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

  const files = collectFeatureFiles(FEATURES_DIR);
  const directEdges = new Map();
  const adapterEdges = new Map();

  for (const file of files) {
    const fromFeature = getFeatureNameFromFeatureFile(file);
    if (!fromFeature) continue;

    const source = fs.readFileSync(file, 'utf8');
    const specifiers = collectSpecifiers(source);
    const isDepsFile = isFeatureDepsFile(file);
    const filePath = normalizePath(path.relative(ROOT_DIR, file));

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
