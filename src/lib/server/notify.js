// src/lib/server/notify.js — outgoing messages that never block the app.
//
//  * E-mail: your own SMTP server (Admin -> Settings: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).
//  * Other channels (SMS, WhatsApp, chat ...): optional generic webhook. Set NOTIFY_WEBHOOK_URL and the
//    app POSTs JSON { type, ...fields } there, signed with HMAC-SHA256 in the `X-VMS-Signature` header
//    (key: NOTIFY_WEBHOOK_SECRET). Connect it to whatever provider you use. No third party is contacted
//    unless you configure one.
//  * In test mode (PUBLIC_SHOW_TEST_OTP=true), or when nothing is configured, messages are printed to
//    the server console instead.
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { env as priv } from '$env/dynamic/private';
import { env as pub } from '$env/dynamic/public';
import * as store from './db.js';
import { Query } from '$lib/query.js';
import { C } from '$lib/collections.js';
import { decryptSecret } from './secrets.js';

export const isTestMode = () => pub.PUBLIC_SHOW_TEST_OTP === 'true';

export async function getSettings() {
	const settings = {};
	try {
		const list = await store.listDocs(C.systemSettings, [Query.limit(200)]);
		for (const d of list.documents) settings[d.settingKey] = d.settingType === 'password' ? await decryptSecret(d.settingValue) : d.settingValue;
	} catch { /* empty settings */ }
	return settings;
}

let cached = { key: '', transporter: null };

function getTransport(settings) {
	if (!settings.SMTP_HOST || !settings.SMTP_USER || !settings.SMTP_PASS) return null;
	const key = [settings.SMTP_HOST, settings.SMTP_PORT, settings.SMTP_USER, settings.SMTP_PASS].join('|');
	if (cached.key !== key) {
		const port = Number(settings.SMTP_PORT) || 587;
		cached = {
			key,
			transporter: nodemailer.createTransport({
				host: settings.SMTP_HOST,
				port,
				secure: port === 465,
				requireTLS: port !== 465,
				auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASS },
				connectionTimeout: 10000,
				socketTimeout: 15000
			})
		};
	}
	return cached.transporter;
}

// header / address injection guard
const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').slice(0, 300);

/** Always resolves; returns { sent, simulated, error? } */
export async function sendEmail({ to, subject, text, html }, settings) {
	settings ??= await getSettings();
	const transport = isTestMode() ? null : getTransport(settings);
	if (!transport) {
		console.log(`[vms:mail simulated] to=${oneLine(to)} subject="${oneLine(subject)}"\n${text || ''}`);
		return { sent: false, simulated: true };
	}
	try {
		await transport.sendMail({ from: settings.SMTP_FROM || settings.SMTP_USER, to: oneLine(to), subject: oneLine(subject), text, html });
		return { sent: true, simulated: false };
	} catch (error) {
		console.error('[vms:mail] failed:', error.message);
		return { sent: false, simulated: false, error: 'E-mail could not be delivered' };
	}
}

/** Optional signed webhook for SMS / WhatsApp / chat. Simulated (console) in test mode or when not configured. */
export async function sendWebhook(payload) {
	const url = priv.NOTIFY_WEBHOOK_URL;
	if (isTestMode() || !url) {
		console.log('[vms:webhook simulated]', JSON.stringify(payload));
		return { success: true, simulated: true };
	}
	try {
		const u = new URL(url);
		if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') throw new Error('NOTIFY_WEBHOOK_URL must use https');
		const body = JSON.stringify(payload);
		const headers = { 'Content-Type': 'application/json' };
		if (priv.NOTIFY_WEBHOOK_SECRET) headers['X-VMS-Signature'] = crypto.createHmac('sha256', priv.NOTIFY_WEBHOOK_SECRET).update(body).digest('hex');
		const res = await fetch(u, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000), redirect: 'error' });
		if (!res.ok) throw new Error(`webhook returned ${res.status}`);
		return { success: true };
	} catch (error) {
		console.error('[vms:webhook] failed:', error.message);
		return { success: false, error: 'Message could not be delivered' };
	}
}
