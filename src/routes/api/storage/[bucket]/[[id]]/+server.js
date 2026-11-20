// src/routes/api/storage/[bucket]/[[id]]/+server.js — file upload / view
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { SELFIE_BUCKET } from '$lib/collections.js';
import { throttle } from '$lib/server/auth.js';

const MAX_BYTES = 4 * 1024 * 1024;

/** Identify an image by its first bytes - never trust the client-declared type. */
function sniffImage(buf) {
	if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
	if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
	if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
	return null;
}

export async function POST(event) {
	const { params, locals, request } = event;
	const { bucket } = params;
	if (bucket !== SELFIE_BUCKET) {
		if (!locals.user) return json({ message: 'Please sign in' }, { status: 401 });
		return json({ message: 'Unknown bucket' }, { status: 404 });
	}
	if (!locals.user) {
		const blocked = await throttle(event, 'upload', 10, 10 * 60 * 1000);
		if (blocked) return blocked;
	}
	const declared = Number(request.headers.get('content-length') || 0);
	if (declared > MAX_BYTES + 64 * 1024) return json({ message: 'File is too large (max 4 MB)' }, { status: 413 });

	let form;
	try { form = await request.formData(); } catch { return json({ message: 'Invalid upload' }, { status: 400 }); }
	const file = form.get('file');
	if (!file || typeof file === 'string') return json({ message: 'file is required' }, { status: 400 });
	if (file.size > MAX_BYTES) return json({ message: 'File is too large (max 4 MB)' }, { status: 413 });

	const data = Buffer.from(await file.arrayBuffer());
	const mime = sniffImage(data);
	if (!mime) return json({ message: 'Only JPEG, PNG or WebP images are allowed' }, { status: 415 });

	// ids are always generated here, a client cannot overwrite an existing file
	const saved = await store.saveFile(bucket, 'unique()', { name: 'selfie', mime, data });
	return json(saved);
}

export async function GET({ params, locals, url }) {
	const signed = await store.validFileSignature(params.bucket, params.id, url.searchParams.get('exp'), url.searchParams.get('sig'));
	if (!locals.user && !signed) return json({ message: 'Please sign in' }, { status: 401 });
	try {
		const f = await store.readFile(params.bucket, params.id);
		return new Response(f.data, {
			headers: {
				'Content-Type': f.mime,
				'Cache-Control': 'private, no-store',
				'X-Content-Type-Options': 'nosniff',
				'Content-Security-Policy': "default-src 'none'; sandbox"
			}
		});
	} catch (e) {
		return json({ message: 'File not found' }, { status: 404 });
	}
}

export async function DELETE({ params, locals }) {
	if (!locals.user || !(locals.user.roles.admin || locals.user.roles.hr || locals.user.roles.reception)) {
		return json({ message: 'Not allowed' }, { status: 403 });
	}
	await store.removeFile(params.bucket, params.id);
	return json({});
}
