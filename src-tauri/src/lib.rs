//! STEMSTAGE desktop launcher.
//!
//! The game itself is the web app in `dist/`, served by a small Node server (`server/app.js`) that also
//! runs the song library, yt-dlp, metadata and LAN rooms. On start the launcher:
//!   1. starts that game server on 127.0.0.1:5173 (unless one is already running),
//!   2. starts the Python services from %LOCALAPPDATA%\stemstage\venv if installed: the Demucs AI splitter
//!      (:8765) and the DualSense controller bridge built on pydualsense (:8766),
//!   3. shows the splash screen, which switches to the game as soon as the server answers.
//! Everything it started is stopped again when the window closes. Logs: %LOCALAPPDATA%\stemstage\logs.

use serde::Serialize;
use std::fs::{self, File};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent};

const GAME_PORT: u16 = 5173;
const AI_PORT: u16 = 8765;
const BRIDGE_PORT: u16 = 8766;

#[derive(Default, Serialize, Clone)]
struct Status {
    game: String,
    ai: String,
    bridge: String,
    url: String,
    songs: String,
    logs: String,
}

#[derive(Default)]
struct Launcher {
    children: Mutex<Vec<(String, Child)>>,
    status: Mutex<Status>,
}

fn listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

#[cfg(windows)]
fn no_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_console(_: &mut Command) {}

fn spawn(l: &Launcher, name: &str, mut cmd: Command, logs: &Path) -> Result<(), String> {
    no_console(&mut cmd);
    let out = File::create(logs.join(format!("{name}.log"))).map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    cmd.stdin(Stdio::null()).stdout(Stdio::from(out)).stderr(Stdio::from(err));
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    l.children.lock().unwrap().push((name.to_string(), child));
    Ok(())
}

/// Stop everything we started, including grandchildren (the venv's python.exe is a launcher that starts the
/// real interpreter, so killing only the direct child would leave the services running).
fn stop_all(l: &Launcher) {
    let mut kids = l.children.lock().unwrap();
    for (_, child) in kids.iter_mut() {
        #[cfg(windows)]
        {
            let mut tk = Command::new("taskkill");
            tk.args(["/PID", &child.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
            no_console(&mut tk);
            let _ = tk.status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    kids.clear();
}

/// `\\?\C:\dir` → `C:\dir` (`\\?\UNC\server\share` → `\\server\share`).
fn plain_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p
    }
}

fn launch(app: &tauri::AppHandle) {
    let l = app.state::<Launcher>();
    // resource_dir() is a verbatim path (\\?\C:\...) on Windows; Node can't resolve its entry script from one
    let res = app.path().resource_dir().map(|p| plain_path(p).join("app")).unwrap_or_default();
    let home = app
        .path()
        .document_dir()
        .map(|p| p.join("STEMSTAGE"))
        .unwrap_or_else(|_| PathBuf::from("STEMSTAGE"));
    let local = std::env::var("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|_| home.clone()).join("stemstage");
    let logs = local.join("logs");
    let _ = fs::create_dir_all(&logs);
    let songs = home.join("songs");
    let data = home.join("data");
    let _ = fs::create_dir_all(&songs);

    let mut st = Status {
        url: format!("http://127.0.0.1:{GAME_PORT}/"),
        songs: songs.display().to_string(),
        logs: logs.display().to_string(),
        ..Default::default()
    };

    // 1. game server (Node.js)
    if listening(GAME_PORT) {
        st.game = "running".into();
    } else {
        let mut cmd = Command::new("node");
        cmd.arg(res.join("server").join("app.js"))
            .current_dir(&res)
            .env("PORT", GAME_PORT.to_string())
            .env("STEMSTAGE_SONGS", &songs)
            .env("STEMSTAGE_DATA", &data);
        st.game = match spawn(&l, "game-server", cmd, &logs) {
            Ok(()) => "starting".into(),
            Err(e) => format!("error: could not start Node.js ({e}). Install Node.js 20+ from https://nodejs.org"),
        };
    }

    // 2. Python services (AI splitter + DualSense bridge)
    let py = local.join("venv").join("Scripts").join("python.exe");
    let service = |name: &str, script: &str, port: u16| -> String {
        if listening(port) {
            return "running".into();
        }
        if !py.exists() {
            return "not installed (run server\\setup-ai.ps1)".into();
        }
        let mut cmd = Command::new(&py);
        cmd.arg(res.join("server").join(script)).current_dir(res.join("server"));
        match spawn(&l, name, cmd, &logs) {
            Ok(()) => "starting".into(),
            Err(e) => format!("error: {e}"),
        }
    };
    st.ai = service("ai-splitter", "stem_server.py", AI_PORT);
    st.bridge = service("controller-bridge", "controller_bridge.py", BRIDGE_PORT);
    *l.status.lock().unwrap() = st;
}

/// Splash screen: what the launcher did (and where the logs are if something failed).
#[tauri::command]
fn launcher_status(l: tauri::State<'_, Launcher>) -> Status {
    let mut st = l.status.lock().unwrap().clone();
    // a service that already exited: report it with the last line of its log instead of "starting" forever
    for (name, child) in l.children.lock().unwrap().iter_mut() {
        if let Ok(Some(code)) = child.try_wait() {
            let log = PathBuf::from(&st.logs).join(format!("{name}.log"));
            let last = fs::read_to_string(&log).ok().and_then(|s| {
                s.lines().rev().map(str::trim).find(|l| !l.is_empty() && !l.starts_with("Node.js") && !l.starts_with('}') && !l.starts_with("at ")).map(String::from)
            });
            let msg = format!("error: {} stopped ({}){} · log: {}", name, code, last.map(|l| format!(" — {l}")).unwrap_or_default(), log.display());
            match name.as_str() {
                "game-server" => st.game = msg,
                "ai-splitter" => st.ai = msg,
                _ => st.bridge = msg,
            }
        }
    }
    for (name, field) in [("game", GAME_PORT), ("ai", AI_PORT), ("bridge", BRIDGE_PORT)] {
        if listening(field) {
            match name {
                "game" => st.game = "running".into(),
                "ai" => st.ai = "running".into(),
                _ => st.bridge = "running".into(),
            }
        }
    }
    st
}

// ---------------------------------------------------------------- updates (signed, from GitHub Releases)
/// The GitHub repository whose releases carry updates ("owner/name"); the release workflow passes its own.
const UPDATE_REPO: Option<&str> = match option_env!("STEMSTAGE_UPDATE_REPO") {
    Some(r) => Some(r),
    None => Some("SylarBeck/STEMSTAGE"),
};

/// "owner/repo" or a full latest.json URL (from Settings) → the update feed URL.
fn feed_url(feed: Option<String>) -> Option<String> {
    let f = feed.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).or_else(|| UPDATE_REPO.map(String::from))?;
    if f.starts_with("http") {
        Some(f)
    } else {
        let repo = f.trim_start_matches("https://github.com/").trim_matches('/').to_string();
        Some(format!("https://github.com/{repo}/releases/latest/download/latest.json"))
    }
}

fn updater_for(app: &tauri::AppHandle, url: &str) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    let u = tauri::Url::parse(url).map_err(|e| format!("bad update feed: {e}"))?;
    app.updater_builder().endpoints(vec![u]).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct UpdateInfo {
    configured: bool,
    available: bool,
    current: String,
    version: Option<String>,
    notes: Option<String>,
    feed: Option<String>,
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle, feed: Option<String>) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let Some(url) = feed_url(feed) else {
        return Ok(UpdateInfo { configured: false, available: false, current, version: None, notes: None, feed: None });
    };
    let up = updater_for(&app, &url)?.check().await.map_err(|e| e.to_string())?;
    Ok(UpdateInfo {
        configured: true,
        available: up.is_some(),
        current,
        version: up.as_ref().map(|u| u.version.clone()),
        notes: up.and_then(|u| u.body),
        feed: Some(url),
    })
}

/// Download (signature checked), stop the game's services so their files can be replaced, then run the
/// installer; the app restarts on the new version.
#[tauri::command]
async fn install_update(app: tauri::AppHandle, feed: Option<String>) -> Result<(), String> {
    let url = feed_url(feed).ok_or("no update feed configured")?;
    let up = updater_for(&app, &url)?.check().await.map_err(|e| e.to_string())?.ok_or("already up to date")?;
    let bytes = up.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    stop_all(&app.state::<Launcher>());
    up.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Launcher::default())
        .invoke_handler(tauri::generate_handler![launcher_status, check_update, install_update])
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || launch(&handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building STEMSTAGE");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_all(&handle.state::<Launcher>());
        }
    });
}
