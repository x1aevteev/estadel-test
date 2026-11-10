import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createEventJournal } from './events.js';
import { readJson, sendError, sendJson } from './http.js';

const DIST = new URL('../dist/', import.meta.url);
const ASSET_PATH = /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(css|js)$/;
const CONTENT_TYPES = {
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
};

async function serveStatic(request, response, path) {
  const isIndex = path === '/' || path === '/index.html';
  const asset = path?.match(ASSET_PATH);
  if (!isIndex && !asset) return sendError(response, 404, 'Страница не найдена.');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return sendError(response, 405, 'Метод не поддерживается.', { Allow: 'GET, HEAD' });
  }

  const filename = isIndex ? 'index.html' : path.slice(1);
  const format = isIndex ? 'html' : asset[1];
  let contents;
  try {
    contents = await readFile(new URL(filename, DIST));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    if (isIndex) return sendError(response, 503, 'Соберите интерфейс командой npm run build.');
    return sendError(response, 404, 'Файл не найден.');
  }

  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[format],
    'Content-Length': contents.length,
    'Cache-Control': isIndex ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  response.end(request.method === 'HEAD' ? undefined : contents);
}

async function handleRequest(request, response, journal) {
  const path = request.url?.split('?', 1)[0];
  if (path !== '/api/events') return serveStatic(request, response, path);

  if (request.method === 'GET') return sendJson(response, 200, journal.list());
  if (request.method !== 'POST') {
    return sendError(response, 405, 'Метод не поддерживается.', { Allow: 'GET, POST' });
  }

  const parsed = await readJson(request);
  if ('status' in parsed) return sendError(response, parsed.status, parsed.message);
  const result = journal.append(parsed.body);
  if ('error' in result) return sendJson(response, 400, result);
  return sendJson(response, 201, result.event);
}

export function createAppServer() {
  const journal = createEventJournal();
  return createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    handleRequest(request, response, journal).catch(() => {
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendError(response, 500, 'Не удалось обработать запрос.');
    });
  });
}
