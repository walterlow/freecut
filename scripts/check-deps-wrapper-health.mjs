#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');
const FEATURES_DIR = path.join(SRC_DIR, 'features');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const CONTRACT_FILE_REGEX = /-contract\.(ts|tsx)$/;
const WRAPPER_EXPORT_REGEX = /^export\s+\*\s+from\s+["'](\.\/[^"']+-contract(?:\.[a-z]+)?)["'];?$/;

const IMPORT_EXPORT_SPEC_REGEX =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_SPEC_REGEX = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has('--json');
const failOnUnused = args.has('--fail-on-unused');

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function stripQueryAndHash(specifier) {
  const [withoutHash] = specifier.split('#');
  const [withoutQuery] = withoutHash.split('?');
  return withoutQuery;
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

function resolveAliasSpecifier(rawSpecifier) {
  const specifier = stripQueryAndHash(rawSpecifier);
  if (!specifier.startsWith('@/')) return null;

  const relative = specifier.slice(2);
  const basePath = path.join(ROOT_DIR, 'src', relative);
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

function resolveImportTarget(fromFile, rawSpecifier) {
  const specifier = stripQueryAndHash(rawSpecifier);
  if (specifier.startsWith('.')) {
    return resolveRelativeSpecifier(fromFile, specifier);
  }
  if (specifier.startsWith('@/')) {
    return resolveAliasSpecifier(specifier);
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

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function detectWrapperContractSpecifier(source) {
  const stripped = stripComments(source)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  const match = stripped.match(WRAPPER_EXPORT_REGEX);
  return match?.[1] ?? null;
}

function getDepsFileMeta(absolutePath) {
  const relative = normalizePath(path.relative(ROOT_DIR, absolutePath));
  const match = relative.match(/^src\/features\/([^/]+)\/deps\/(.+)$/);
  if (!match) return null;

  const ownerFeature = match[1];
  const depsFilePath = match[2];
  const isContractFile = CONTRACT_FILE_REGEX.test(path.basename(depsFilePath));
  return {
    ownerFeature,
    relativePath: relative,
    isContractFile,
    absolutePath,
  };
}

function main() {
  if (!fs.existsSync(FEATURES_DIR)) {
    console.error('Cannot find src/features directory.');
    process.exit(1);
  }

  const allSourceFiles = collectSourceFiles(SRC_DIR);
  const depsFiles = collectSourceFiles(FEATURES_DIR)
    .map(getDepsFileMeta)
    .filter(Boolean);

  const importersByTarget = new Map();
  for (const file of allSourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const specifiers = collectSpecifiers(source);
    for (const specifier of specifiers) {
      const target = resolveImportTarget(file, specifier);
      if (!target) continue;

      if (!importersByTarget.has(target)) {
        importersByTarget.set(target, new Set());
      }
      importersByTarget.get(target).add(file);
    }
  }

  const wrappers = [];
  for (const file of depsFiles) {
    if (file.isContractFile) continue;

    const source = fs.readFileSync(file.absolutePath, 'utf8');
    const contractSpecifier = detectWrapperContractSpecifier(source);
    if (!contractSpecifier) continue;

    const contractPath = resolveRelativeSpecifier(file.absolutePath, contractSpecifier);
    const importerSet = importersByTarget.get(file.absolutePath) ?? new Set();
    const importers = [...importerSet]
      .filter((importer) => importer !== file.absolutePath)
      .map((importer) => normalizePath(path.relative(ROOT_DIR, importer)))
      .sort();

    wrappers.push({
      file: file.relativePath,
      contract: contractPath
        ? normalizePath(path.relative(ROOT_DIR, contractPath))
        : null,
      importers,
      importerCount: importers.length,
      ownerFeature: file.ownerFeature,
    });
  }

  wrappers.sort((a, b) => {
    if (a.importerCount !== b.importerCount) {
      return a.importerCount - b.importerCount;
    }
    return a.file.localeCompare(b.file);
  });

  const unusedWrappers = wrappers.filter((wrapper) => wrapper.importerCount === 0);

  if (jsonOutput) {
    console.log(JSON.stringify({
      scannedDepsFiles: depsFiles.length,
      passThroughWrappers: wrappers.length,
      unusedPassThroughWrappers: unusedWrappers.length,
      wrappers,
    }, null, 2));
  } else {
    console.log(
      `Deps wrapper health: ${wrappers.length} pass-through wrappers, ${unusedWrappers.length} unused.`
    );
    if (unusedWrappers.length > 0) {
      for (const wrapper of unusedWrappers) {
        const contract = wrapper.contract ?? '(unresolved contract)';
        console.log(`- [UNUSED] ${wrapper.file} -> ${contract}`);
      }
    }
  }

  if (failOnUnused && unusedWrappers.length > 0) {
    process.exit(1);
  }
}

main();
