# Live Notes

*New in 3.0. Settings → Audio → Live notes (on by default).*

With live notes your part plays **note by note as you hit it**, the way a real instrument does:

- **Early or late:** hit a note early and it comes in early, hit it late and it comes in late.
- **Missed:** that note doesn't sound. The note before it rings out and dies away instead of being cut off.
- **Sustains:** let go too soon and the note stops.
- **Whammy:** bends the held note down, up to most of a semitone.
- **Steady playing:** sounds exactly like the record.

Turn it off for the classic behaviour: your part plays along with the band and drops out (muffled) while you miss.

## How it works

STEMSTAGE already has your part as its own stem (the AI split). Live notes cuts that stem into **one slice per note** and starts each slice when you hit it.

- **Cut at the real sound, not the chart.** Charts are snapped to the beat grid, so a charted note can sit tens of milliseconds away from its sound. Each slice starts at the note's actual attack: the charter saves it for new imports (`o` in `song.json`), and older charts find it from the stem's own transients.
- **No added delay on time.** The game measures how long a press takes to reach the audio. A note whose sound starts before an on-time hit could be heard begins on time by itself: your hit keeps it, a miss cuts it. A hit before the note is due still plays it early.
- **Back in time.** A long slice that drifts noticeably from the band (a late hit on a sparse Easy chart) crossfades back into time at a quiet spot between notes.
- **No clicks.** Slices crossfade into each other. A note that rings into a missed one loops its last moment at a matched loop point and fades out.

## When it's off by itself

Live notes needs the part to belong to one player. The classic stem is used when:

- Two local players share a part (two guitarists in a band).
- An online player has the same instrument as you.
- You play a real instrument (audio input or MIDI) or sing with a microphone.

## Tips

- Set your **audio offset** first (Settings → Audio → Calibrate audio offset). Live notes follows your hits relative to what you hear, so a wrong offset makes everything sound early or late.
- Wired headphones or speakers feel tightest. Bluetooth audio adds its own delay to every note you play.
