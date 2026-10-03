# STEMSTAGE on itch.io

Everything for the game's itch.io page, in the same look as the game and the website.

| File | What it's for |
| --- | --- |
| `description.html` | The page text: paste it into the description |
| `theme.css` | Custom CSS for the page (stencil headings, tape labels, polaroid screenshots, red buttons) |
| `cover.png` | Cover image (630×500, drawn at 2× so it's sharp on high-DPI screens) |
| `banner.png` | Banner at the top of the page (960 wide) |
| `background.png` | Page background (the stage, darkened) |
| `screenshots/` | Screenshots to upload, in the order to show them |
| `preview.html` | A local look at the finished page: open it in a browser |

The images are drawn by `tools/render-itch.mjs` from the brand kit (`brand/`). Run `npm run itch` after changing the
description or the CSS to rebuild `preview.html` and the images.

## Setting up the page

**Create new project** on itch.io, then:

1. **Title:** STEMSTAGE
2. **Short description or tagline:** `The rhythm game that plays any song: AI splits it into stems and charts every part`
3. **Classification:** Games. **Kind of project:** Downloadable.
4. **Release status:** Released. **Pricing:** No payments, or "$0 or donate" if you'd like tips.
5. **Uploads:** the files from the [latest GitHub release](https://github.com/SylarBeck/STEMSTAGE/releases/latest).
   - `STEMSTAGE_x.y.z_x64-setup.exe`: tick **Windows**.
   - `STEMSTAGE_x.y.z_amd64.AppImage`, `.deb` and `.rpm`: tick **Linux**.
   - The game updates itself from GitHub, so players only need the itch download once.
6. **Description:** in the description editor, switch to editing the HTML (the `</>` button), paste all of
   `description.html`, and switch back. The pictures in it load from the website. If itch removes them, upload the
   files from `screenshots/` with the editor's image button instead.
7. **Genre:** Rhythm. **Tags** (up to 10): `rhythm`, `music`, `guitar-hero`, `rock-band`, `multiplayer`,
   `local-multiplayer`, `singleplayer`, `controller`, `open-source`, `ai`.
8. **Cover image:** `cover.png`.
9. **Screenshots:** the files in `screenshots/`, in their numbered order.
10. **Links** (or put them under "More information"): the website `https://stemstage.varconstint.com/`, the source
    `https://github.com/SylarBeck/STEMSTAGE` and the wiki.

## The theme (Edit game → Edit theme)

These settings give the page most of its look on their own, with or without the custom CSS.

| Setting | Value |
| --- | --- |
| Banner | `banner.png` |
| Background | `background.png`, no repeat, fixed, top center |
| Background colour (BG) | `#0b0a09` |
| Column background (BG2) | `#12100e` |
| Text | `#ece5d3` |
| Links | `#f0b429` |
| Buttons | `#df3a2c` |
| Borders | `#2a2520` |
| Fonts | A bold condensed font for headers (Anton or Oswald, if the list has them) and a condensed one for text (Barlow Condensed or Roboto Condensed), size large |

## Custom CSS

Paste `theme.css` into the theme editor's CSS box. itch.io only shows that box once it has switched custom CSS on for
the account; if it isn't there, ask for it through itch.io support. The page still looks right without it, thanks
to the theme settings above.

The CSS only uses itch's own page classes under the page wrapper (`.inner_column`, `.formatted_description`,
`.buy_row`, `.uploads`, `.screenshot_list`…), so it works whether or not itch puts a prefix in front of each rule. If
itch changes its page layout, those class names are the place to look.
