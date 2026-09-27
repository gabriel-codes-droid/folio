import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Exercise the actual TypeScript route with Node's native type stripping.
// Only Astro's virtual secret module is replaced; no local .env is loaded.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'astro:env/server') {
      return {
        url: `data:text/javascript,${encodeURIComponent('export const getSecret = name => process.env[name];')}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
let POST, prerender;
try {
  ({ POST, prerender } = await import('../src/pages/api/contact.ts'));
} finally {
  hooks.deregister();
}

const validPayload = { email: 'visitor@example.test', message: 'A portfolio enquiry.' };
const unreadable = 'The message could not be read.';
const unavailable = 'The message could not be sent right now.';

beforeEach(t => {
  const names = ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'];
  const previous = new Map(names.map(name => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.RESEND_API_KEY = 'test-only-resend-key';
  process.env.RESEND_FROM_EMAIL = 'Portfolio Tests <sender@example.test>';
  // Every test starts with networking disabled. Sending cases explicitly mock it.
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network request: contact tests must mock fetch.');
  });
});

function submit(payload = validPayload) {
  return submitRaw(JSON.stringify(payload));
}

function submitRaw(body, contentType = 'application/json') {
  return POST({ request: new Request('https://portfolio.example.test/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  }) });
}

async function expectError(response, status, message) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { error: message });
}

function mockSuccess() {
  fetch.mock.mockImplementation(async () => Response.json({ id: 'mock-message-id' }));
}

test('contact remains a server-only route', () => {
  assert.equal(prerender, false);
});

test('non-JSON content is rejected before any provider request', async () => {
  await expectError(await submitRaw('email=visitor@example.test', 'text/plain'), 415, 'Expected a JSON request.');
  assert.equal(fetch.mock.callCount(), 0);
});

test('malformed JSON, null, arrays and primitives return JSON 400', async () => {
  for (const body of ['{', 'null', '[]', '[{}]', '"hello"', '17', 'true']) {
    await expectError(await submitRaw(body), 400, unreadable);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('email validation rejects missing, non-string, invalid and overlong addresses', async () => {
  for (const email of [undefined, 42, '', 'not-an-email', 'has spaces@example.test', `${'a'.repeat(243)}@example.com`]) {
    await expectError(await submit({ ...validPayload, email }), 422, 'Enter a valid email address.');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('message validation rejects missing, non-string and out-of-bounds trimmed text', async () => {
  for (const message of [undefined, 42, '', 'a'.repeat(9), `  ${'a'.repeat(9)}  `, 'a'.repeat(5001)]) {
    await expectError(await submit({ ...validPayload, message }), 422, 'Write a message between 10 and 5,000 characters.');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('254-character email and 10-/5000-character message boundaries are accepted', async () => {
  mockSuccess();
  const email = `${'a'.repeat(242)}@example.com`;
  assert.equal(email.length, 254);
  for (const length of [10, 5000]) {
    const response = await submit({ email, message: 'a'.repeat(length) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test('filled honeypot succeeds silently without secrets or a provider request', async () => {
  delete process.env.RESEND_API_KEY;
  const response = await submit({ website: ' https://bot.example.test ', email: 'invalid', message: '' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(fetch.mock.callCount(), 0);
});

test('missing or empty runtime API key returns 503 without a provider request', async () => {
  delete process.env.RESEND_API_KEY;
  await expectError(await submit(), 503, 'The contact service is not configured yet.');
  process.env.RESEND_API_KEY = '';
  await expectError(await submit(), 503, 'The contact service is not configured yet.');
  assert.equal(fetch.mock.callCount(), 0);
});

test('successful request uses runtime credentials, fixed recipient and trimmed reply-to', async t => {
  mockSuccess();
  const signal = new AbortController().signal;
  const timeout = t.mock.method(AbortSignal, 'timeout', () => signal);
  const response = await submit({
    email: '  visitor@example.test  ',
    message: '  A portfolio enquiry.  ',
    website: '   ',
    to: 'untrusted@example.test',
    from: 'untrusted@example.test',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(fetch.mock.callCount(), 1);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(options.method, 'POST');
  assert.deepEqual(options.headers, {
    Authorization: 'Bearer test-only-resend-key',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(JSON.parse(options.body), {
    from: 'Portfolio Tests <sender@example.test>',
    to: ['nmandrakegabriel@gmail.com'],
    reply_to: 'visitor@example.test',
    subject: 'Portfolio enquiry from visitor@example.test',
    text: 'Reply-to: visitor@example.test\n\nA portfolio enquiry.',
  });
  assert.equal(options.signal, signal);
  assert.deepEqual(timeout.mock.calls.map(call => call.arguments), [[15000]]);
});

test('missing sender uses the existing Resend test-sender fallback', async () => {
  mockSuccess();
  delete process.env.RESEND_FROM_EMAIL;
  assert.equal((await submit()).status, 200);
  assert.equal(JSON.parse(fetch.mock.calls[0].arguments[1].body).from, 'Portfolio <onboarding@resend.dev>');
});

test('provider rejection returns generic JSON 502 without reading or logging its body', async t => {
  const response = new Response('sensitive provider detail', { status: 403 });
  const readBody = t.mock.method(response, 'text', () => { throw new Error('Do not read provider error bodies.'); });
  const log = t.mock.method(console, 'error', () => {});
  fetch.mock.mockImplementation(async () => response);
  await expectError(await submit(), 502, unavailable);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(readBody.mock.callCount(), 0);
  assert.equal(log.mock.callCount(), 0);
});

test('network and timeout failures return generic JSON 502 without logging details', async t => {
  const log = t.mock.method(console, 'error', () => {});
  for (const error of [new TypeError('private network detail'), new DOMException('private timeout detail', 'TimeoutError')]) {
    fetch.mock.mockImplementation(async () => { throw error; });
    await expectError(await submit(), 502, unavailable);
  }
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(log.mock.callCount(), 0);
});
