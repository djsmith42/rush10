import { sqlite } from "@workspace/db";

type RoomState = { code: string; skippedPlayerIds: Set<string> };
type StoredRoom<T extends RoomState> = Omit<T, "skippedPlayerIds"> & { skippedPlayerIds: string[] };

function encode<T extends RoomState>(room: T) {
  return JSON.stringify({ ...room, skippedPlayerIds: [...room.skippedPlayerIds] });
}

function decode<T extends RoomState>(state: string): T {
  const stored = JSON.parse(state) as StoredRoom<T>;
  return { ...stored, skippedPlayerIds: new Set(stored.skippedPlayerIds) } as T;
}

const insertRoom = sqlite.prepare("INSERT INTO rush10_rooms (code, state) VALUES (?, ?) ON CONFLICT (code) DO NOTHING");
const selectRoom = sqlite.prepare<[string], { state: string }>("SELECT state FROM rush10_rooms WHERE code = ?");
const updateRoom = sqlite.prepare(
  "UPDATE rush10_rooms SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = ?",
);

export async function createStoredRoom<T extends RoomState>(room: T) {
  return insertRoom.run(room.code, encode(room)).changes === 1;
}

export async function readStoredRoom<T extends RoomState>(code: string): Promise<T | undefined> {
  const row = selectRoom.get(code);
  return row ? decode<T>(row.state) : undefined;
}

/** Lock the latest snapshot, apply one move, and acknowledge only after durable commit.
 * A rejected move rolls back completely, including any partially modified hand.
 * BEGIN IMMEDIATE takes SQLite's write lock up front, serializing moves even across processes.
 */
export async function changeStoredRoom<T extends RoomState, R>(
  code: string,
  change: (room: T | undefined) => R,
): Promise<R> {
  return sqlite.transaction(() => {
    const row = selectRoom.get(code);
    const room = row ? decode<T>(row.state) : undefined;
    const response = change(room);
    if (room) updateRoom.run(encode(room), code);
    return response;
  }).immediate();
}
