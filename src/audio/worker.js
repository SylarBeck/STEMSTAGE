// Heavy audio work off the main thread: DSP stem splitting, chart generation, time stretching.
import { splitDSP } from './splitter.js';
import { buildCharts } from './charter.js';
import { stretchStereo } from './stretch.js';

self.onmessage = (e) => {
  const { id, type, payload } = e.data;
  const progress = (p, msg) => self.postMessage({ id, type: 'progress', p, msg });
  try {
    if (type === 'split') {
      const stems = splitDSP(payload.L, payload.R, payload.sampleRate, (p) => progress(p));
      const transfer = [];
      for (const chans of Object.values(stems)) for (const c of chans) transfer.push(c.buffer);
      self.postMessage({ id, type: 'result', result: stems }, transfer);
    } else if (type === 'chart') {
      const result = buildCharts(payload, progress);
      self.postMessage({ id, type: 'result', result });
    } else if (type === 'stretch') {
      const out = stretchStereo(payload.L, payload.R, payload.rate, (p) => progress(p));
      self.postMessage({ id, type: 'result', result: out }, [out.L.buffer, out.R.buffer]);
    } else {
      throw new Error(`unknown job ${type}`);
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: err?.stack || String(err) });
  }
};
