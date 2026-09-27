# Contributing

Thanks for helping! Bug reports, charts that come out wrong, controller mappings and code are all welcome.

## Reporting bugs

[Open an issue](https://github.com/SylarBeck/STEMSTAGE/issues) with:
- the version (Settings → Updates) and OS
- what you did, what you expected, what happened
- the relevant log from `%LOCALAPPDATA%\stemstage\logs` (Windows) or `~/.local/share/stemstage/logs` (Linux)
- for controller problems: the controller, connection (USB/Bluetooth) and what *Test controller bridge* shows

## Code

- Plain modern JavaScript (ES modules, no framework, no TypeScript), Python 3.11 for the AI and bridge, Rust for the launcher.
- Match the surrounding style: two-space indent, single quotes, short comments that explain *why*, one module per concern.
- Keep logic that doesn't need the DOM in its own module so it can be tested in Node (see [Development Setup](Development-Setup#testing-changes)).
- The UI must work with a controller alone. Every new screen element needs `data-nav` so D-pad navigation reaches it.
- Local server APIs must check `isLocal(req)`.
- Don't commit songs, profiles, logs or keys. `.gitignore` covers `songs/`, `data/` and `*.key`.

## Pull requests

1. Fork, branch from `main`, keep the change focused.
2. Run the game (`npm run dev`) and check your change on the screens it touches, with a controller if it's UI.
3. The **Build** workflow must pass on Windows and Linux.
4. Describe what changed and how you tested it. Screenshots help for visual changes.

## Licence

STEMSTAGE is [MIT](https://github.com/SylarBeck/STEMSTAGE/blob/main/LICENSE). By contributing you agree your contribution is released under it. Only add third-party assets whose licence allows it, and credit them in the README.
