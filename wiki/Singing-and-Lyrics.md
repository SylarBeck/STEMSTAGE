# Singing and Lyrics

## Singing

Choose **🎤 Sing** on the vocals part (or Settings → Singing → Vocals: *mic*). Pick your microphone under **Settings → Singing → Microphone** and try **Test microphone**.

- The karaoke track shows the melody as bars and your voice as an arrow. Scoring is octave-free, and each phrase is rated from Messy to Awesome.
- **Guide vocals** keeps the original singer in the mix. Off, it's karaoke.
- In a band, one player sings on the mic and other vocalists use buttons.

If the game can't use the microphone, see [Troubleshooting → Microphone](Troubleshooting#microphone).

## AI lyrics (Whisper)

With the AI splitter installed, [faster-whisper](https://github.com/SYSTRAN/faster-whisper) listens to the separated vocal stem and writes down every word with its timing. New imports get lyrics automatically. For older songs, use Song options → **Get lyrics (AI)**. The Whisper "small" model (~480 MB) downloads on first use. Set `STEMSTAGE_WHISPER=medium` for better accuracy at a slower speed.

## Lyrics check (new in 1.4.0)

Whisper hears *when* each word is sung very well, but often mishears *what* is sung. After Whisper runs, STEMSTAGE looks the song up in the [LRCLIB](https://lrclib.net) lyrics database (free, no account) and cross-checks the two:

- **Misheard words are replaced** with the real lyrics, keeping Whisper's timing.
- **Words Whisper missed are added**, timed inside their line.
- **Words Whisper imagined** (breaths, backing vocals, echoes) are removed.
- Line breaks follow the real lyrics.
- If the database's clock is offset from your copy (a longer intro, for example), the offset is found automatically.
- If the lyrics found online don't match your recording (wrong song, live version, other language), the AI lyrics are kept as they are.

On a test with four songs, Seven Nation Army's "Message coming from my eye" became "And a message coming from my eyes", and Whenever, Wherever had 60 misheard words fixed.

You can run the check on any song at any time: Song options → **Check lyrics online**. It works **without the AI too**: if LRCLIB has time-synced lyrics, they're placed on the song using the vocal chart.

For a good match, the song's **title and artist** need to be right (Song options → Edit song info → look it up online).
