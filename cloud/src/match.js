// Matchmaking (v2): which open room suits a player looking for a match. Pure functions, so they're tested on
// their own (tests/match.test.js) and used by the worker's POST /v1/match.
//
// A room can be offered when it runs the same minor version, has room for one more, isn't mid-song and (unless the
// player said "any") plays the mode they want. Among those, the best room is the closest in skill rating, then on
// the same continent, then the fullest (people would rather join a lively lobby), then a matchmaking room.
// The rating window starts at ±200 and widens with every second the player has waited, so nobody waits forever.

export const MODES = ['versus', 'battle', 'band'];
export const minor = (v) => String(v || '').split('.').slice(0, 2).join('.');
export const ratingWindow = (waited = 0) => 200 + Math.max(0, waited) * 40;

/** A score for one room (lower is better), or null when it can't be offered. */
export function scoreRoom(room, want) {
  if (!room || room.playing || room.locked) return null;
  if ((room.players || 0) >= (room.max || 8)) return null;
  if (want.version && minor(room.version) !== minor(want.version)) return null;
  if (want.mode && want.mode !== 'any' && room.mode !== want.mode) return null;
  const gap = Math.abs((room.rating || 1000) - (want.rating || 1000));
  if (gap > ratingWindow(want.waited)) return null;
  const far = want.continent && room.continent && room.continent !== want.continent ? 1 : 0;
  // with no wait the continent matters a lot; after a while any room is better than none
  return gap + far * Math.max(50, 300 - (want.waited || 0) * 20) - (room.players || 0) * 15 - (room.mm ? 10 : 0);
}

/** The best room for a player, or null. */
export function pickRoom(rooms, want) {
  let best = null, bestScore = Infinity;
  for (const r of rooms) {
    const s = scoreRoom(r, want);
    if (s !== null && s < bestScore) { best = r; bestScore = s; }
  }
  return best;
}
