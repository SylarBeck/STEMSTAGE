# Lyrics Cross-Check

Code: `src/audio/lyrics-align.js` (pure, runs in Node too), lookup in `server/extras.js` (`/api/meta/lyrics`), wiring in `src/audio/pipeline.js` (`fetchLyrics`, `checkLyrics`).

## Sources

- **Whisper** (faster-whisper on the vocal stem): words with start/end times. Good timing, frequent mishearings.
- **[LRCLIB](https://lrclib.net)**: community lyrics, usually **synced** (a timestamp per line, LRC format), sometimes plain text only. Free, no key.

## Lookup (`/api/meta/lyrics?artist&title&album&duration`)

1. `GET /api/get` with artist, title, album and duration (rounded) for an exact match.
2. Otherwise `GET /api/search`. Candidates are scored on title/artist match and duration difference, with a bonus for synced lyrics, and the best is kept if it scores ≥ 0.8.
3. Results are cached per artist/title/duration while the server runs.

## Alignment (`crossref(aiWords, reference, { duration, onsets })`)

1. **Parse** the LRC into lines, then words. Each reference word carries its line's window `[line start, next line start)`, capped at 12 s. Words are compared normalised: lower case, no accents, no punctuation.
2. **Clock offset:** a YouTube upload with a longer intro shifts every line. For offsets −40…+40 s in 0.25 s steps, count Whisper words that fall inside a line containing that word, and keep the best (ties go to the smaller shift). Without Whisper words, line starts are matched against vocal note onsets instead. Lines that end up past the song's end are dropped (a shorter edit of the song).
3. **Needleman–Wunsch** between Whisper's words and the reference words:
   - pair cost 0 for the same word, 0.45 for a near miss (edit similarity ≥ 0.6), 1.0 for a partial match, 1.45 for unrelated words, and **not allowed** if the Whisper word is more than 1.5 s outside the reference word's line window
   - skipping a Whisper word (something invented) costs 0.8, skipping a reference word (something missed) 0.75
4. **Accept or reject:** at least 4 exact matches, and exact + near matches ≥ 30 % (synced) / 40 % (plain) of the shorter list. Otherwise the reference is a different song or version and the AI words are kept.
5. **Build** the result from the reference words: paired words take the Whisper word's timing (so misheard words are corrected in place), and unpaired words are spread over the gap between their neighbours, kept inside their own line. Times are made monotonic, and the first word of each line gets `br: true` (`lyricLines()` in `vocals.js` breaks lines there).

Stats come back as `{ reference, ai, exact, fixed, added, dropped, offset, synced, confidence }`.

## Results

| Test | Before | After |
|---|---|---|
| Synthetic: real LRCLIB lyrics, 3.2 s shift, 20 % misheard, 10 % missed, 5 % invented | 344 / 495 words right | 495 / 495 right word within 0.6 s |
| Wrong song's lyrics | — | rejected (confidence 0.06) |
| Seven Nation Army (real Whisper output) | "Message coming from my eye" | "And a message coming from my eyes", offset 1.75 s found |
| Hotel California | — | 12 fixed, 27 added, confidence 0.97 |
