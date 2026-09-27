// Icons: Font Awesome Free (fonts SIL OFL 1.1, icons CC BY 4.0 — https://fontawesome.com/license/free),
// bundled from npm (@fortawesome/fontawesome-free). One place for every icon name the UI uses.

/** <i> markup for a solid Font Awesome icon. */
export const fa = (name, cls = '') => `<i class="fa-solid fa-${name}${cls ? ` ${cls}` : ''}" aria-hidden="true"></i>`;

export const INST_ICON_NAME = { guitar: 'guitar', bass: 'guitar', drums: 'drum', keys: 'music', vocals: 'microphone' };
export const instIcon = (inst) => fa(INST_ICON_NAME[inst] || 'music', `inst-ico inst-${inst}`);

/** ★★★☆☆ as icons: filled stars + faint ones. */
export const stars = (n, of = 5, gold = false) =>
  `<span class="fa-stars${gold ? ' gold' : ''}">${Array.from({ length: of }, (_, i) => `<i class="fa-${i < n ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i>`).join('')}</span>`;
export const starsOnly = (n) => (n > 0 ? `<span class="fa-stars">${Array.from({ length: n }, () => '<i class="fa-solid fa-star" aria-hidden="true"></i>').join('')}</span>` : '');

export const ACH_ICON = {
  first_song: 'microphone', five_stars: 'star', gold_stars: 'trophy', full_combo: 'gem', fc_expert: 'crown',
  streak_100: 'fire', streak_500: 'meteor', accuracy_99: 'bullseye', overdrive_3: 'bolt', all_instruments: 'music',
  expert_drums: 'drum', band_play: 'guitar', online_play: 'earth-americas', online_win: 'medal', songs_10: 'compact-disc',
  plays_50: 'van-shuttle', marathon: 'stopwatch', importer: 'download', youtube_import: 'tv', level_10: 'ranking-star',
  setlist_marathon: 'person-running', tour_gig: 'ticket', tour_arena: 'building', tour_festival: 'campground',
  tour_legend: 'wand-magic-sparkles', daily_1: 'calendar-day', daily_7: 'calendar-check', ghost_beat: 'ghost',
  replay_watch: 'film', fc_hard: 'mountain', streak_1000: 'certificate', stars_100: 'award', band_4: 'people-group',
  night_owl: 'moon', importer_batch: 'folder-open',
};
export const achIcon = (id) => fa(ACH_ICON[id] || 'award');

export const VENUE_ICON = { garage: 'door-open', club: 'sliders', bar: 'beer-mug-empty', theater: 'masks-theater', arena: 'building', stadium: 'city', festival: 'campground' };
