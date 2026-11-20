// Shared query builder (browser + server). Produces plain JSON objects that the
// SQL layer (src/lib/server/db.js) translates into WHERE / ORDER BY / LIMIT.
const q = (method, attribute, values) => ({ method, attribute, values });
const arr = (v) => (Array.isArray(v) ? v : [v]);

export const Query = {
	equal: (a, v) => q('equal', a, arr(v)),
	notEqual: (a, v) => q('notEqual', a, arr(v)),
	lessThan: (a, v) => q('lessThan', a, [v]),
	lessThanEqual: (a, v) => q('lessThanEqual', a, [v]),
	greaterThan: (a, v) => q('greaterThan', a, [v]),
	greaterThanEqual: (a, v) => q('greaterThanEqual', a, [v]),
	between: (a, s, e) => q('between', a, [s, e]),
	startsWith: (a, v) => q('startsWith', a, [v]),
	endsWith: (a, v) => q('endsWith', a, [v]),
	contains: (a, v) => q('contains', a, arr(v)),
	search: (a, v) => q('search', a, [v]),
	isNull: (a) => q('isNull', a, []),
	isNotNull: (a) => q('isNotNull', a, []),
	or: (queries) => q('or', undefined, queries),
	and: (queries) => q('and', undefined, queries),
	limit: (n) => q('limit', undefined, [n]),
	offset: (n) => q('offset', undefined, [n]),
	orderAsc: (a) => q('orderAsc', a, []),
	orderDesc: (a) => q('orderDesc', a, []),
	select: (attrs) => q('select', undefined, attrs),
	cursorAfter: (id) => q('cursorAfter', undefined, [id]),
	cursorBefore: (id) => q('cursorBefore', undefined, [id])
};

let counter = 0;
export const ID = {
	unique() {
		const rnd =
			typeof crypto !== 'undefined' && crypto.randomUUID
				? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
				: Math.random().toString(16).slice(2, 22).padEnd(20, '0');
		return Date.now().toString(16) + rnd.slice(0, 8) + (counter++ % 4096).toString(16).padStart(3, '0');
	},
	custom: (id) => id
};

export class ApiError extends Error {
	constructor(message, code = 500, type = 'general_error') {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.type = type;
	}
}
