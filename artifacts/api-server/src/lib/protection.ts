import { rateLimit, type Options } from "express-rate-limit";
import { deleteStaleRooms } from "./room-store";
import { logger } from "./logger";

const MINUTE = 60_000;

/** Per-IP limit; over it, the request gets a 429 and a logged warning with the IP. */
function limit(name: string, windowMs: number, limit: number, message: string, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn({ ip: req.ip, limiter: name, method: req.method, path: req.path }, "Rate limit exceeded");
      res.status(429).json({ error: message });
    },
    ...extra,
  });
}

// One player polls about 67 times a minute; this leaves room for six behind one home router.
export const generalLimit = limit("general", MINUTE, 600, "Too many requests. Slow down and try again in a minute.");
export const createLimit = limit("create", 60 * MINUTE, 10, "Too many new games from your network. Try again later.");
// The join page checks the code every 3 seconds (20 a minute) while someone waits on it.
export const joinLimit = limit("join", MINUTE, 60, "Too many join attempts. Try again in a minute.");

export const MAX_WAITING_ROOMS = 200;
export const MAX_DATABASE_BYTES = 200 * 1024 * 1024;

/** Delete idle games now and every hour after. */
export function startStaleRoomCleanup() {
  const sweep = () => {
    try {
      const deleted = deleteStaleRooms();
      if (deleted) logger.info({ deleted }, "Deleted stale games");
    } catch (err) {
      logger.error({ err }, "Stale game cleanup failed");
    }
  };
  sweep();
  setInterval(sweep, 60 * MINUTE).unref();
}
