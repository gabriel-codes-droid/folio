import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';

const recipient = 'nmandrakegabriel@gmail.com';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return Response.json({ error: 'Expected a JSON request.' }, { status: 415 });
  }

  let payload: { email?: unknown; message?: unknown; website?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'The message could not be read.' }, { status: 400 });
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return Response.json({ error: 'The message could not be read.' }, { status: 400 });
  }

  // Quietly accept the honeypot so simple bots do not learn whether they were caught.
  if (typeof payload.website === 'string' && payload.website.trim()) {
    return Response.json({ ok: true });
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (!emailPattern.test(email) || email.length > 254) {
    return Response.json({ error: 'Enter a valid email address.' }, { status: 422 });
  }
  if (message.length < 10 || message.length > 5000) {
    return Response.json({ error: 'Write a message between 10 and 5,000 characters.' }, { status: 422 });
  }

  const apiKey = getSecret('RESEND_API_KEY');
  if (!apiKey) {
    return Response.json({ error: 'The contact service is not configured yet.' }, { status: 503 });
  }

  const from = getSecret('RESEND_FROM_EMAIL') || 'Portfolio <onboarding@resend.dev>';
  let resendResponse: Response;
  try {
    resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        reply_to: email,
        subject: `Portfolio enquiry from ${email}`,
        text: `Reply-to: ${email}\n\n${message}`,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return Response.json({ error: 'The message could not be sent right now.' }, { status: 502 });
  }

  if (!resendResponse.ok) {
    return Response.json({ error: 'The message could not be sent right now.' }, { status: 502 });
  }

  return Response.json({ ok: true });
};
