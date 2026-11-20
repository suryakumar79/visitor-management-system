// src/lib/server/documents.js
// Small document-style API (list/get/create/update/delete by collection) used by the visitor and
// reception routes. It is a thin wrapper over the engine-neutral functions in db.js.
import * as store from './db.js';
import { Query, ID } from '$lib/query.js';

export { Query, ID };

export class Databases {
	async listDocuments(_db, collectionId, queries = []) { return store.listDocs(collectionId, queries); }
	async getDocument(_db, collectionId, id) { return store.getDoc(collectionId, id); }
	async createDocument(_db, collectionId, id, data) { return store.createDoc(collectionId, id, data); }
	async updateDocument(_db, collectionId, id, data) { return store.updateDoc(collectionId, id, data); }
	async deleteDocument(_db, collectionId, id) { return store.deleteDoc(collectionId, id); }
}
