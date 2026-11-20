// Settings that should exist from the first start, so the Admin -> Settings page is never empty.
import * as store from './db.js';
import { Query } from '$lib/query.js';
import { C } from '$lib/collections.js';

const DEFAULTS = [
	['SMTP_HOST', '', 'email', 'text', 'Mail server host name (leave empty to log e-mails to the server console)'],
	['SMTP_PORT', '587', 'email', 'text', 'Mail server port (587 for STARTTLS, 465 for SSL)'],
	['SMTP_USER', '', 'email', 'text', 'Mail server user name'],
	['SMTP_PASS', '', 'email', 'password', 'Mail server password (stored encrypted, never shown again)'],
	['SMTP_FROM', '', 'email', 'text', 'Sender address, e.g. visitors@your-company.com (defaults to the user name)'],
	['PREBOOK_OPEN', '09:00', 'bookings', 'text', 'First bookable time of the day (HH:MM)'],
	['PREBOOK_CLOSE', '18:00', 'bookings', 'text', 'End of the last slot (HH:MM)'],
	['PREBOOK_SLOT_MINUTES', '30', 'bookings', 'text', 'Length of one slot in minutes'],
	['PREBOOK_DAYS_AHEAD', '14', 'bookings', 'text', 'How many days ahead visitors can book'],
	['PREBOOK_SLOT_CAPACITY', '1', 'bookings', 'text', 'Visitors per host per slot'],
	['PREBOOK_MAX_ACTIVE', '3', 'bookings', 'text', 'Open bookings one visitor may hold'],
	['PREBOOK_WORK_DAYS', '1,2,3,4,5,6', 'bookings', 'text', 'Bookable weekdays, 0 = Sunday (e.g. 1,2,3,4,5)']
];

export async function ensureDefaultSettings() {
	const have = new Set((await store.listDocs(C.systemSettings, [Query.limit(500)])).documents.map((d) => d.settingKey));
	for (const [settingKey, settingValue, category, settingType, description] of DEFAULTS) {
		if (have.has(settingKey)) continue;
		await store.createDoc(C.systemSettings, 'unique()', {
			settingKey, settingValue, category, settingType, description, isEncrypted: settingType === 'password'
		});
	}
}
