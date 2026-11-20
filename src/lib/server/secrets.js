// Encrypts secret settings (SMTP password ...) at rest with AES-256-GCM.
import crypto from 'node:crypto';
import { secretKey } from './db.js';

const PREFIX = 'enc:v1:';

export async function encryptSecret(plain) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', await secretKey(), iv);
	const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
	return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export async function decryptSecret(value) {
	const s = String(value ?? '');
	if (!s.startsWith(PREFIX)) return s; // not encrypted (older or non-secret value)
	try {
		const [iv, tag, ct] = s.slice(PREFIX.length).split(':').map((x) => Buffer.from(x, 'base64'));
		const decipher = crypto.createDecipheriv('aes-256-gcm', await secretKey(), iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
	} catch {
		return ''; // wrong key or tampered value
	}
}
