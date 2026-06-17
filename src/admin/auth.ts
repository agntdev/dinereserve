import { getPool } from "../db/pool.js";

export async function hasAnyAdmins(): Promise<boolean> {
  const pool = getPool();
  if (!pool) {
    return false;
  }

  const result = await pool.query("SELECT 1 FROM admins LIMIT 1");
  return (result.rowCount ?? 0) > 0;
}

export async function isAdmin(telegramUserId: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) {
    return false;
  }

  const result = await pool.query(
    "SELECT 1 FROM admins WHERE telegram_user_id = $1",
    [telegramUserId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** First-run setup is open when no admins exist; afterwards admins only. */
export async function canAccessSetup(telegramUserId: number): Promise<boolean> {
  const hasAdmins = await hasAnyAdmins();
  if (!hasAdmins) {
    return true;
  }

  return isAdmin(telegramUserId);
}