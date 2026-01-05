import { Database } from '@tauri-apps/plugin-sql';

let dbPromise: Promise<Database> | null = null;

export async function getDatabase(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load('sqlite:overlay.db');
  }
  return dbPromise;
}

export async function execute(query: string, values: unknown[] = []) {
  const db = await getDatabase();
  return db.execute(query, values);
}

export async function select<T = unknown>(query: string, values: unknown[] = []) {
  const db = await getDatabase();
  return db.select<T[]>(query, values);
}
