// What the world API (api.stemstage.varconstint.com) answers, made safe to show. Screens escape names and titles,
// but they put counts, scores and instruments straight into the page, so those are checked here once: a field
// that should be a number is a number, an instrument / difficulty / mode is one of the known ones, an avatar is
// a Discord CDN address. Anything else stays as the API sent it (text is escaped where it's shown).
const INSTRUMENTS = ['guitar', 'bass', 'drums', 'keys', 'vocals'];
const ENUMS = {
  instrument: INSTRUMENTS,
  difficulty: ['easy', 'medium', 'hard', 'expert'],
  mode: ['versus', 'battle', 'band', 'ranked', 'chart', 'unranked', 'all'],
};
const NUMBERS = new Set([
  'score', 'stars', 'accuracy', 'maxStreak', 'date', 'total', 'fcs', 'charts', 'last', 'entries', 'best', 'ranked', 'players', 'max',
  'runs', 'votes', 'notes', 'duration', 'updated', 'rank', 'points', 'weeks', 'wins', 'week', 'season', 'starts', 'ends', 'voteMin',
  'otherCharts', 'created', 'since', 'level', 'xp', 'progress', 'records', 'rankedVotes', 'listedFor', 'fc', 'playing', 'edited', 'offset',
]);
const AVATAR = /^https:\/\/cdn\.discordapp\.com\/[\w/.-]+(\?size=\d{1,4})?$/;

export function cleanApi(v, key = '') {
  if (Array.isArray(v)) {
    const list = v.slice(0, 2000);
    return key === 'parts' ? list.filter((x) => INSTRUMENTS.includes(x)) : list.map((x) => cleanApi(x, key));
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (k !== '__proto__') out[k] = cleanApi(x, k);
    return out;
  }
  if (NUMBERS.has(key)) return typeof v === 'boolean' || v === null || (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
  if (ENUMS[key]) return ENUMS[key].includes(v) ? v : ENUMS[key][0];
  if (key === 'avatar') return typeof v === 'string' && AVATAR.test(v) ? v : null;
  if (key === 'code') return typeof v === 'string' && /^[A-Z]{2,20}(-[A-Z]{2,20}){1,9}$/.test(v) ? v : '';
  if (key === 'version') return typeof v === 'string' && /^[\w.-]{1,16}$/.test(v) ? v : null;
  if (key === 'color') return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  return v;
}
