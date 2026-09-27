// Song metadata: embedded tags (ID3 / MP4 / FLAC / Vorbis via music-metadata), YouTube title cleanup,
// and online lookup (MusicBrainz + Cover Art Archive + iTunes, through the local server).
import { parseBlob } from 'music-metadata';

/** Embedded tags from an audio file. Returns { title, artist, album, year, genre, picture: { data, format } } (fields may be null). */
export async function readTags(file) {
  try {
    const { common } = await parseBlob(file, { duration: false, skipCovers: false });
    const pic = common.picture?.[0];
    return {
      title: common.title || null,
      artist: common.artist || common.albumartist || null,
      album: common.album || null,
      year: common.year ? String(common.year) : null,
      genre: common.genre?.[0] || null,
      picture: pic ? { data: pic.data, format: pic.format || 'image/jpeg' } : null,
    };
  } catch {
    return {};
  }
}

const JUNK = /\s*[([](official\s*(music\s*)?(video|audio|lyric(s)?\s*video|visualizer)|lyrics?|audio|hd|hq|4k|remaster(ed)?(\s*\d{4})?|visuali[sz]er|explicit|clean|video|mv|m\/v|live|full\s*album)[)\]]/gi;

/** "Artist - Title (Official Video) [HD]" -> { artist, title } */
export function parseVideoTitle(raw, uploader) {
  let s = String(raw || '').replace(JUNK, '').replace(/\s*\|\s*.*$/, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*(ft\.?|feat\.?)\s+[^-–—]+$/i, '').trim();
  const m = /^(.+?)\s+[-–—~]\s+(.+)$/.exec(s);
  if (m) return { artist: m[1].trim(), title: m[2].replace(/^["“]|["”]$/g, '').trim() };
  const artist = String(uploader || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  return { artist: artist || null, title: s || String(raw || 'Unknown') };
}

export function parseFileName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const parsed = parseVideoTitle(base);
  return { artist: parsed.artist, title: parsed.title || base };
}

/** Online lookup through the local server. Returns the best match or null. */
export async function lookupOnline(artist, title, duration) {
  if (!title) return null;
  try {
    const qs = new URLSearchParams({ title, artist: artist || '', duration: String(Math.round(duration || 0)) });
    const r = await fetch(`/api/meta/lookup?${qs}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return (await r.json()).best || null;
  } catch {
    return null;
  }
}

/**
 * Merge metadata sources in priority order: embedded tags > online lookup > video info > file name.
 * Returns { title, artist, album, year, genre, coverUrl, picture, mbid, sources[] }.
 */
export async function gatherMetadata({ file, fileName, video, duration }) {
  const tags = file ? await readTags(file) : {};
  const fromVideo = video ? {
    title: video.track || parseVideoTitle(video.title, video.uploader).title,
    artist: video.artist || parseVideoTitle(video.title, video.uploader).artist,
    album: video.album || null,
    year: video.releaseYear ? String(video.releaseYear) : null,
  } : {};
  const fromName = fileName ? parseFileName(fileName) : {};
  const title = tags.title || fromVideo.title || fromName.title || 'Unknown Song';
  const artist = tags.artist || fromVideo.artist || fromName.artist || null;
  const online = await lookupOnline(artist, title, duration);
  const pick = (k) => tags[k] || online?.[k] || fromVideo[k] || null;
  const sources = [];
  if (tags.title || tags.artist) sources.push('file tags');
  if (online) sources.push(...(online.sources || ['online']));
  if (video) sources.push('YouTube');
  return {
    title: tags.title || (online && !fromVideo.track ? online.title : null) || title,
    artist: tags.artist || online?.artist || artist || 'Unknown Artist',
    album: pick('album'),
    year: pick('year'),
    genre: tags.genre || online?.genre || null,
    mbid: online?.mbid || null,
    picture: tags.picture || null,
    coverUrl: online?.cover || video?.thumbnail || null,
    sources,
  };
}
