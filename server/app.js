import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { seedEvents } from './events.js';

const MAX_BODY_SIZE = 16 * 1024;
const EVENT_ID_PREFIX = 'evt-';
const STATUSES = ['success', 'error'];
const TEXT_FIELDS = { source: 80, type: 80, message: 500 };
const STATIC_ROUTES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function sendError(response, status, message, headers) {
  sendJson(response, status, { error: { message } }, headers);
}

function sendBodyLimitError(response) {
  sendError(response, 413, 'Тело запроса превышает 16 КиБ.');
}

async function addEvent(request, response, journal) {
  const mediaType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    request.resume();
    return sendError(response, 415, 'Используйте Content-Type application/json.');
  }

  if (Number(request.headers['content-length']) > MAX_BODY_SIZE) {
    request.resume();
    return sendBodyLimitError(response);
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      request.resume();
      return sendBodyLimitError(response);
    }
    chunks.push(chunk);
  }

  let input;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    input = JSON.parse(json);
  } catch {
    return sendError(response, 400, 'Не удалось прочитать JSON.');
  }

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return sendError(response, 400, 'Тело запроса должно быть JSON-объектом.');
  }

  const fields = {};
  const data = {};
  for (const [field, limit] of Object.entries(TEXT_FIELDS)) {
    const value = typeof input[field] === 'string' ? input[field].trim() : '';
    if (!value || value.length > limit) {
      fields[field] = `Укажите непустую строку длиной до ${limit} символов.`;
    } else {
      data[field] = value;
    }
  }

  const status = typeof input.status === 'string' ? input.status.trim() : '';
  if (!STATUSES.includes(status)) {
    fields.status = 'Укажите статус success или error.';
  }

  if (Object.keys(fields).length > 0) {
    return sendJson(response, 400, { error: { message: 'Проверьте поля события.', fields } });
  }

  const event = {
    id: `${EVENT_ID_PREFIX}${journal.nextEventNumber}`,
    source: data.source,
    type: data.type,
    status,
    created_at: new Date().toISOString(),
    message: data.message,
  };
  journal.events.unshift(event);
  journal.nextEventNumber += 1;
  sendJson(response, 201, event);
}

async function handleRequest(request, response, journal) {
  const path = request.url?.split('?', 1)[0];

  if (path === '/api/events') {
    if (request.method === 'GET') return sendJson(response, 200, journal.events);
    if (request.method === 'POST') return addEvent(request, response, journal);
    return sendError(response, 405, 'Метод не поддерживается.', { Allow: 'GET, POST' });
  }

  const asset = STATIC_ROUTES.get(path);
  if (!asset) return sendError(response, 404, 'Страница не найдена.');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return sendError(response, 405, 'Метод не поддерживается.', { Allow: 'GET, HEAD' });
  }

  const [filename, contentType] = asset;
  const contents = await readFile(new URL(`../public/${filename}`, import.meta.url));
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': contents.length,
  });
  response.end(request.method === 'HEAD' ? undefined : contents);
}

export function createAppServer() {
  const lastSeedNumber = Math.max(...seedEvents.map(({ id }) => Number(id.slice(EVENT_ID_PREFIX.length))));
  const journal = { events: [...seedEvents], nextEventNumber: lastSeedNumber + 1 };

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
