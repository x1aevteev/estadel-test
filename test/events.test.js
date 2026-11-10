import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAppServer } from '../server/app.js';

const EVENT_PATH = '/api/events';
const TEST_EVENT = {
  source: 'Тестовый источник',
  type: 'lead.created',
  status: 'success',
  message: 'Тестовое событие принято.',
};

async function startServer(t) {
  const server = createAppServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server.listen(0, '127.0.0.1'), 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  return (path = EVENT_PATH, options) => fetch(`${origin}${path}`, options);
}

function postEvent(request, payload) {
  return request(EVENT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
}

test('GET returns 12 unique seeded events in reverse chronological order', async (t) => {
  const request = await startServer(t);
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const events = await response.json();
  assert.equal(events.length, 12);
  assert.equal(new Set(events.map(({ id }) => id)).size, 12);
  assert.equal(events.filter(({ status }) => status === 'success').length, 8);
  assert.equal(events.filter(({ status }) => status === 'error').length, 4);
  assert.deepEqual(events.map(({ created_at }) => created_at),
    events.map(({ created_at }) => created_at).sort().reverse());
  for (const event of events) {
    assert.ok(event.source && event.type && event.message);
    assert.ok(Number.isFinite(Date.parse(event.created_at)));
  }
});

test('POST normalizes valid fields, assigns metadata, and prepends the event', async (t) => {
  const request = await startServer(t);
  const original = await (await request()).json();
  const response = await postEvent(request, {
    ...TEST_EVENT,
    source: `  ${TEST_EVENT.source}  `,
    id: original[0].id,
    created_at: original[0].created_at,
    unused: true,
  });
  assert.equal(response.status, 201);
  const event = await response.json();
  assert.deepEqual(event, {
    ...TEST_EVENT,
    id: event.id,
    created_at: event.created_at,
  });
  assert.match(event.id, /^evt-[0-9a-f-]{36}$/);
  assert.ok(original.every(({ id }) => id !== event.id));
  assert.equal(new Date(event.created_at).toISOString(), event.created_at);
  assert.notEqual(event.created_at, original[0].created_at);
  assert.deepEqual(await (await request()).json(), [event, ...original]);

  const secondRequest = await startServer(t);
  assert.deepEqual(await (await secondRequest()).json(), original);
});

test('POST identifies invalid fields and preserves the journal', async (t) => {
  const request = await startServer(t);
  const original = await (await request()).json();
  const invalidFields = [
    ['source', undefined],
    ['source', 'a'.repeat(81)],
    ['type', 7],
    ['status', 'pending'],
    ['message', '  '],
    ['message', 'a'.repeat(501)],
  ];

  for (const [field, value] of invalidFields) {
    const response = await postEvent(request, { ...TEST_EVENT, [field]: value });
    assert.equal(response.status, 400);
    const { error } = await response.json();
    assert.ok(error.message);
    assert.deepEqual(Object.keys(error.fields), [field]);
    assert.ok(error.fields[field]);
  }

  assert.deepEqual(await (await request()).json(), original);
});

test('POST rejects malformed JSON, non-objects, and unsupported media', async (t) => {
  const request = await startServer(t);
  const cases = [
    ['application/json', '{"status":', 400],
    ['application/json', '[]', 400],
    ['application/json', 'null', 400],
    ['application/json', Buffer.from([0xff]), 400],
    ['text/plain', JSON.stringify(TEST_EVENT), 415],
  ];

  for (const [contentType, body, status] of cases) {
    const response = await request(EVENT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
    assert.equal(response.status, status);
    assert.ok((await response.json()).error.message);
  }

  assert.equal((await (await request()).json()).length, 12);
});

test('POST rejects bodies over 16 KiB with a known or streamed length', async (t) => {
  const request = await startServer(t);
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  const knownLength = await request(EVENT_PATH, { ...options, body: 'x'.repeat(17 * 1024) });
  assert.equal(knownLength.status, 413);
  assert.ok((await knownLength.json()).error.message);

  const streamed = await request(EVENT_PATH, {
    ...options,
    body: ReadableStream.from([Buffer.alloc(9 * 1024, 'x'), Buffer.alloc(9 * 1024, 'x')]),
    duplex: 'half',
  });
  assert.equal(streamed.status, 413);
  assert.ok((await streamed.json()).error.message);
  assert.equal((await (await request()).json()).length, 12);
});

test('routing denies unsupported methods and paths outside the allowlist', async (t) => {
  const request = await startServer(t);
  const unsupported = await request(EVENT_PATH, { method: 'DELETE' });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'GET, POST');
  assert.ok((await unsupported.json()).error.message);

  for (const path of ['/server/app.js', '/%2e%2e%2fserver%2fapp.js', '/does-not-exist']) {
    const response = await request(path);
    assert.equal(response.status, 404);
    assert.ok((await response.json()).error.message);
  }
});
