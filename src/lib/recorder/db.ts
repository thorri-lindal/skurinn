// IndexedDB access layer using idb

import { openDB, type IDBPDatabase } from 'idb';
import type { WorkbenchDB } from './types.js';

const DB_NAME = 'adsb-workbench';
const DB_VERSION = 1;

let _db: IDBPDatabase<WorkbenchDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<WorkbenchDB>> {
	if (_db) return _db;
	_db = await openDB<WorkbenchDB>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			if (!db.objectStoreNames.contains('sessions')) {
				db.createObjectStore('sessions', { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains('events')) {
				const evStore = db.createObjectStore('events', {
					keyPath: ['sessionId', 't'],
				});
				evStore.createIndex('by-session', 'sessionId');
			}
			if (!db.objectStoreNames.contains('coverage')) {
				db.createObjectStore('coverage', { autoIncrement: true });
			}
		},
	});
	return _db;
}
