// Five broad bands keep presets useful on both headphones and speakers.
export const EQ_FREQUENCIES = [80, 250, 1000, 4000, 12000];
export const EQ_PRESETS = Object.freeze({
  flat: [0, 0, 0, 0, 0],
  bass: [5, 3, 0, -1, -1],
  rock: [3, 1, -2, 2, 3],
  electronic: [4, 1, -1, 2, 4],
  vocal: [-2, -1, 3, 2, 1],
  acoustic: [1, 2, 1, 2, 1],
});
export const EQ_KEYS = ['eq80', 'eq250', 'eq1000', 'eq4000', 'eq12000'];

export function equalizerGains(settings) {
  const preset = EQ_PRESETS[settings.eqPreset];
  return preset || EQ_KEYS.map((key) => Math.max(-12, Math.min(12, Number(settings[key]) || 0)));
}
