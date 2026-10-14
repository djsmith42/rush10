import { getGetRush10RoomQueryKey } from '@workspace/api-client-react';

/** Request options that send the player token as a header; tokens must never appear in URLs, where access logs record them. */
export const playerAuth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/** One cached view per seat. Keyed by player id, not token, so credentials stay out of cache keys and devtools. */
export const roomQueryKey = (code: string, playerId: string | undefined) => [...getGetRush10RoomQueryKey(code), playerId ?? ''] as const;
