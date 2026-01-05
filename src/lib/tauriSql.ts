export type TauriSqlDatabase = {
  execute: (query: string, values?: unknown[]) => Promise<unknown>;
  select: <T = unknown>(query: string, values?: unknown[]) => Promise<T[]>;
};

export type TauriSqlGlobal = {
  load: (connection: string) => Promise<TauriSqlDatabase>;
};

export function getTauriSql(): TauriSqlGlobal {
  const sqlGlobal = (window as any).__TAURI__?.sql;
  if (!sqlGlobal) {
    throw new Error(
      'Tauri SQL global API not available; ensure withGlobalTauri is enabled'
    );
  }
  return sqlGlobal as TauriSqlGlobal;
}
