import { pool } from "@workspace/db";

type RoomState = { code: string; skippedPlayerIds: Set<string> };
type StoredRoom<T extends RoomState> = Omit<T, "skippedPlayerIds"> & { skippedPlayerIds: string[] };

function encode<T extends RoomState>(room: T) {
  return JSON.stringify({ ...room, skippedPlayerIds: [...room.skippedPlayerIds] });
}

function decode<T extends RoomState>(state: StoredRoom<T>): T {
  return { ...state, skippedPlayerIds: new Set(state.skippedPlayerIds) } as T;
}

export async function createStoredRoom<T extends RoomState>(room: T) {
  const result = await pool.query(
    "INSERT INTO rush10_rooms (code, state) VALUES ($1, $2::jsonb) ON CONFLICT (code) DO NOTHING",
    [room.code, encode(room)],
  );
  return result.rowCount === 1;
}

export async function readStoredRoom<T extends RoomState>(code: string): Promise<T | undefined> {
  const result = await pool.query("SELECT state FROM rush10_rooms WHERE code = $1", [code]);
  return result.rows[0] ? decode<T>(result.rows[0].state) : undefined;
}

/** Lock the latest snapshot, apply one move, and acknowledge only after durable commit.
 * A rejected move rolls back completely, including any partially modified hand.
 * Row locks also serialize moves from different server instances during republishing.
 */
export async function changeStoredRoom<T extends RoomState, R>(
  code: string,
  change: (room: T | undefined) => R,
): Promise<R> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT state FROM rush10_rooms WHERE code = $1 FOR UPDATE", [code]);
    const room = result.rows[0] ? decode<T>(result.rows[0].state) : undefined;
    const response = change(room);
    if (room) {
      await client.query("UPDATE rush10_rooms SET state = $2::jsonb, updated_at = now() WHERE code = $1", [code, encode(room)]);
    }
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
