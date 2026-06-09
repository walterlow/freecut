import fs from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const IMPORT_EXPORT_SPEC_REGEX =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_SPEC_REGEX = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

export function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

export function stripQueryAndHash(specifier) {
  const [withoutHash] = specifier.split('#');
  const [withoutQuery] = withoutHash.split('?');
  return withoutQuery;
}

export function collectSourceFiles(dirPath, out = []) {
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

export function resolveRelativeSpecifier(fromFile, rawSpecifier) {
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

function resolveAliasSpecifier(rootDir, rawSpecifier) {
  const specifier = stripQueryAndHash(rawSpecifier);
  if (!specifier.startsWith('@/')) return null;

  const relative = specifier.slice(2);
  const basePath = path.join(rootDir, 'src', relative);
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

export function resolveImportTarget(rootDir, fromFile, rawSpecifier) {
  const specifier = stripQueryAndHash(rawSpecifier);
  if (specifier.startsWith('.')) {
    return resolveRelativeSpecifier(fromFile, specifier);
  }
  if (specifier.startsWith('@/')) {
    return resolveAliasSpecifier(rootDir, specifier);
  }
  return null;
}

export function collectSpecifiers(fileContent) {
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
