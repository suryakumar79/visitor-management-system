import { redirect } from '@sveltejs/kit';

// Visitors enter through the OTP login; the old single-page form was retired.
export function load() {
	throw redirect(307, '/visitor/login');
}
