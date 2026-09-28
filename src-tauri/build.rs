fn main() {
    // App commands get their own permissions (allow-<command>) so the game page — served by the local game
    // server, a "remote" origin to Tauri — can be granted exactly the ones it needs (capabilities/game.json).
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["launcher_status", "check_update", "install_update", "install_ai", "exit_app"]),
        ),
    )
    .expect("failed to run tauri-build");
}
