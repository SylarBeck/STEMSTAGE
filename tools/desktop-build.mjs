// npm run desktop:build — builds the installer. With the updater signing key (%USERPROFILE%\.tauri\stemstage.key,
// made by `npx tauri signer generate`) the build also produces the signed update files for GitHub Releases;
// without it, update artifacts are skipped so the build still works.
// Set STEMSTAGE_UPDATE_REPO=owner/repo to bake the update feed into the app (the GitHub workflow does this).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const keyFile = process.env.STEMSTAGE_SIGNING_KEY || path.join(os.homedir(), '.tauri', 'stemstage.key');
const env = { ...process.env };
const args = ['tauri', 'build'];
if (!env.TAURI_SIGNING_PRIVATE_KEY && fs.existsSync(keyFile)) {
  env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(keyFile, 'utf8');
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
  console.log(`Signing update files with ${keyFile}`);
} else if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  console.log('No updater signing key — building without update files');
  args.push('--config', JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
}
const r = spawnSync('npx', args, { stdio: 'inherit', env, shell: true });
process.exit(r.status ?? 1);
