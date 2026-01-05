import { getTauriSql, TauriSqlDatabase } from './tauriSql';

let dbPromise: Promise<TauriSqlDatabase> | null = null;

export async function getDatabase(): Promise<TauriSqlDatabase> {
  if (!dbPromise) {
    const Database = getTauriSql();
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
