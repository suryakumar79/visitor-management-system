// Per-key async mutex (single process). Used where a check + insert must not interleave.
export function makeMutex() {
	const tails = new Map();
	return async function withLock(key, fn) {
		const prev = tails.get(key) || Promise.resolve();
		let release;
		const next = new Promise((r) => (release = r));
		tails.set(key, prev.then(() => next));
		await prev;
		try {
			return await fn();
		} finally {
			release();
			if (tails.get(key) === next) tails.delete(key);
		}
	};
}
