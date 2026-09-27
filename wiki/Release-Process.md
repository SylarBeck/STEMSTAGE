# Release Process

## Workflows

| Workflow | Trigger | What |
|---|---|---|
| `build.yml` | Push to `main`, pull requests (not for site/wiki/docs-only changes) | Builds Windows (NSIS) and Linux (AppImage, deb, rpm) and keeps them as workflow artifacts for 7 days |
| `release.yml` | Tag `v*` | Builds both platforms and publishes one GitHub Release with the installers and `latest.json` for the updater |
| `pages.yml` | Push to `main` touching `site/` | Publishes `site/` to the `gh-pages` branch → <https://stemstage.varconstint.com/> (custom domain: `site/CNAME` + the workflow's `cname`; DNS points at GitHub Pages) |
| `wiki.yml` | Push to `main` touching `wiki/` | Copies `wiki/*.md` to the GitHub wiki |

## Cutting a release

1. Bump the version in **`package.json`**, **`src-tauri/tauri.conf.json`** and **`src-tauri/Cargo.toml`**, then run `cargo check` in `src-tauri` so `Cargo.lock` follows.
2. Commit, and wait for **Build** to be green on `main`.
3. Tag and push: `git tag v1.4.0 && git push origin v1.4.0`
4. **Release** runs about 15–25 minutes. The release appears when the first platform finishes, and the second adds its files.

`tauri-apps/tauri-action` runs `npm run tauri build`, so keep the `"tauri": "tauri"` script in `package.json`.

## Update signing

Installed copies (Windows, Linux AppImage) check `https://github.com/<repo>/releases/latest/download/latest.json` and only install files signed with the key whose public half is in `tauri.conf.json` → `plugins.updater.pubkey`.

- The private key lives in `%USERPROFILE%\.tauri\stemstage.key` on the maintainer's PC (never commit it) and in the repository secret **`TAURI_SIGNING_PRIVATE_KEY`**.
- Without the secret, the workflows still build (they pass `--config` with `{"bundle":{"createUpdaterArtifacts":false}}`), but that release has no update files.
- Lose the key and installed copies can't be updated. Back it up.

Builds made by the workflow get `STEMSTAGE_UPDATE_REPO=${{ github.repository }}` baked in, so forks update from their own releases.

## Website

`site/` is a static page (no build step): `index.html` + `img/`. Download buttons are filled in from the GitHub API (latest release assets) in the visitor's browser. To refresh screenshots, run `node tools/screenshots-real.mjs` / `npm run screenshots`, then convert to WebP:

```bash
ffmpeg -i docs/screenshots/gameplay.png -vf scale=1280:-2 -c:v libwebp -quality 78 site/img/gameplay.webp
```

## Wiki

Edit the pages in `wiki/` (file name = page name, `-` for spaces; `_Sidebar.md` / `_Footer.md` are shared). On push to `main`, `wiki.yml` mirrors them to the GitHub wiki. Edits made on github.com are overwritten, so change `wiki/` instead.
