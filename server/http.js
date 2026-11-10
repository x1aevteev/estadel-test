const MAX_BODY_SIZE = 16 * 1024;

export function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(data));
}

export function sendError(response, status, message, headers) {
  sendJson(response, status, { error: { message } }, headers);
}

function rejectBody(request, status, message) {
  request.resume();
  return { status, message };
}

export async function readJson(request) {
  const mediaType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return rejectBody(request, 415, 'Используйте Content-Type application/json.');
  }
  if (Number(request.headers['content-length']) > MAX_BODY_SIZE) {
    return rejectBody(request, 413, 'Тело запроса превышает 16 КиБ.');
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      return rejectBody(request, 413, 'Тело запроса превышает 16 КиБ.');
    }
    chunks.push(chunk);
  }

  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return { body: JSON.parse(json) };
  } catch {
    return { status: 400, message: 'Не удалось прочитать JSON.' };
  }
}
