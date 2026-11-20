// src/routes/api/events/+server.js — server-sent events
import { bus } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

export function GET({ url, locals }) {
	if (!locals.user) return json({ message: 'Please sign in' }, { status: 401 });
	const wanted = new Set((url.searchParams.get('channels') || '').split(',').filter(Boolean));
	if (!wanted.size) return json({ message: 'channels required' }, { status: 400 });

	let cleanup = () => {};
	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			const send = (s) => { try { controller.enqueue(enc.encode(s)); } catch { cleanup(); } };
			const onChange = (evt) => {
				if (evt.channels.some((c) => wanted.has(c))) send(`data: ${JSON.stringify(evt)}\n\n`);
			};
			bus.on('change', onChange);
			const ping = setInterval(() => send(': ping\n\n'), 25000);
			cleanup = () => { bus.off('change', onChange); clearInterval(ping); };
			send('retry: 3000\n\n: connected\n\n');
		},
		cancel() { cleanup(); }
	});
	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' }
	});
}
