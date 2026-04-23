/**
 * Tiny HTTP server that serves a set of local files to the FreeCut tab
 * so the page can fetch them via `importMediaFromUrl`. Binds to 127.0.0.1
 * on an ephemeral port, sends permissive CORS headers so the editor
 * origin can read them.
 *
 * Exists because there's no other safe way to hand raw file bytes to
 * the page — File System Access needs a user gesture, `Runtime.evaluate`
 * with base64 strings chokes on large files.
 */

import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { basename } from 'node:path';

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Serve a map of tokens → absolute file paths. Returns { urls, close }.
 * Tokens are unguessable random strings so only the intended fetcher
 * can read the files (defense-in-depth against drive-by page content).
 */
export async function serveFiles(filePaths) {
  const paths = filePaths.map((p) => path.resolve(p));
  for (const p of paths) {
    const stats = statSync(p);
    if (!stats.isFile()) throw new Error(`not a file: ${p}`);
  }

  const tokenByPath = new Map();
  for (const p of paths) {
    const token = randomToken();
    tokenByPath.set(p, token);
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin ?? '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const [token, ...rest] = parts;
    const match = [...tokenByPath.entries()].find(([, t]) => t === token);
    if (!match) {
      res.writeHead(404);
      res.end('bad token');
      return;
    }
    const [absPath] = match;
    if (rest.join('/') !== encodeURIComponent(basename(absPath))) {
      // Token valid but filename mismatched — harmless but reject.
      res.writeHead(404);
      res.end('name mismatch');
      return;
    }

    let stat;
    try {
      stat = statSync(absPath);
    } catch {
      res.writeHead(500);
      res.end('stat failed');
      return;
    }

    const ext = path.extname(absPath).toLowerCase();
    res.setHeader('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Accept-Ranges', 'bytes');

    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }

    res.writeHead(200);
    createReadStream(absPath).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  const urls = paths.map((p) => {
    const token = tokenByPath.get(p);
    const name = encodeURIComponent(basename(p));
    return `http://127.0.0.1:${port}/${token}/${name}`;
  });

  return {
    urls,
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function randomToken() {
  const bytes = new Uint8Array(16);
  (globalThis.crypto ?? require('node:crypto').webcrypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
