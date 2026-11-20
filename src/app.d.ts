declare global {
	namespace App {
		interface Locals {
			user: import('./lib/server/auth.js').SessionUser | null;
			ip: string;
		}
	}
}
export {};
