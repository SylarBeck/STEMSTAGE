//! STEMSTAGE desktop launcher.
//!
//! The game itself is the web app in `dist/`, served by a small Node server (`server/app.js`) that also
//! runs the song library, yt-dlp, metadata and LAN rooms. On start the launcher:
//!   1. starts that game server on 127.0.0.1:5173 (unless one is already running),
//!   2. starts the Python services from the STEMSTAGE venv if installed (%LOCALAPPDATA%\stemstage\venv on
//!      Windows, ~/.local/share/stemstage/venv on Linux): the Demucs AI splitter (:8765) and the DualSense
//!      controller bridge built on pydualsense (:8766),
//!   3. shows the splash screen, which switches to the game as soon as the server answers.
//! Everything it started is stopped again when the window closes. Logs: <that folder>\stemstage\logs.
//!
//! The window is created here rather than from tauri.conf.json so the game page can use the microphone (singing,
//! real guitar / bass) and MIDI without a permission prompt: WebView2 otherwise asks — or, fullscreen, silently
//! denies — and WebKitGTK (Linux) has media capture switched off altogether.

use serde::Serialize;
use std::fs::{self, File};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{Manager, RunEvent, WebviewWindowBuilder};

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
    env: Mutex<Option<PyEnv>>,
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

/// STEMSTAGE's Discord application (the same ID as DISCORD_APP_ID in src/net/discord.js).
const DISCORD_APP_ID: &str = "1553872601603117127";

/// Register the link protocols that start STEMSTAGE:
///   stemstage://join/<CODE>   invite links (the website's /join page opens one)
///   discord-<app id>://       Discord starts the game when a friend presses Join and it isn't running (the join
///                             itself arrives once the game connects to Discord)
fn register_protocols() {
    let Ok(exe) = std::env::current_exe().map(plain_path) else { return };
    let schemes = [("stemstage".to_string(), "URL:STEMSTAGE".to_string()), (format!("discord-{DISCORD_APP_ID}"), format!("URL:Run game {DISCORD_APP_ID} protocol"))];
    #[cfg(windows)]
    {
        let exe = exe.display().to_string();
        let reg = |args: &[&str]| {
            let mut c = Command::new("reg");
            c.args(args).stdout(Stdio::null()).stderr(Stdio::null());
            no_console(&mut c);
            let _ = c.status();
        };
        for (scheme, label) in &schemes {
            let key = format!(r"HKCU\Software\Classes\{scheme}");
            reg(&["add", &key, "/ve", "/d", label, "/f"]);
            reg(&["add", &key, "/v", "URL Protocol", "/d", "", "/f"]);
            reg(&["add", &format!(r"{key}\DefaultIcon"), "/ve", "/d", &exe, "/f"]);
            reg(&["add", &format!(r"{key}\shell\open\command"), "/ve", "/d", &format!("\"{exe}\" \"%1\""), "/f"]);
        }
    }
    #[cfg(target_os = "linux")]
    {
        // an AppImage runs from a temporary mount: register the AppImage file itself
        let exe = std::env::var("APPIMAGE").map(PathBuf::from).unwrap_or(exe);
        let Some(apps) = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share"))).map(|d| d.join("applications")) else { return };
        let _ = fs::create_dir_all(&apps);
        for (scheme, _) in &schemes {
            let name = format!("{scheme}-handler.desktop");
            let entry = format!(
                "[Desktop Entry]\nName=STEMSTAGE\nExec=\"{}\" %u\nType=Application\nNoDisplay=true\nCategories=Game;\nMimeType=x-scheme-handler/{scheme};\n",
                exe.display()
            );
            if fs::write(apps.join(&name), entry).is_ok() {
                let _ = Command::new("xdg-mime").args(["default", &name, &format!("x-scheme-handler/{scheme}")]).stdout(Stdio::null()).stderr(Stdio::null()).status();
            }
        }
    }
}

/// The room code in a `stemstage://join/<CODE>` argument, if any.
fn join_code<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().find_map(|a| {
        let code = a.strip_prefix("stemstage://join/")?.trim_end_matches('/').to_uppercase();
        let ok = code.split('-').count() >= 2 && code.split('-').all(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_alphabetic()));
        ok.then_some(code)
    })
}

/// Give the game every bit of CPU it asks for: this process and everything it started (the WebView2 renderer
/// and GPU processes, the game server, the controller bridge) run at High priority, so a busy PC doesn't delay
/// frames or controller input. The AI splitter goes the other way (Below normal): splitting or transcribing in
/// the background must never take time from a song being played. Called a few times as processes appear.
#[cfg(windows)]
fn boost_priority(app: &tauri::AppHandle) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows::Win32::System::Threading::{OpenProcess, SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS, HIGH_PRIORITY_CLASS, PROCESS_SET_INFORMATION};
    let me = std::process::id();
    let ai_root = app.state::<Launcher>().children.lock().unwrap().iter().find(|(n, _)| n == "ai-splitter").map(|(_, c)| c.id());
    let mut parents: Vec<(u32, u32)> = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                parents.push((e.th32ProcessID, e.th32ParentProcessID));
                if Process32NextW(snap, &mut e).is_err() { break; }
            }
        }
        let _ = CloseHandle(snap);
    }
    // everything descended from a process
    let descendants = |root: u32| {
        let mut tree = vec![root];
        let mut i = 0;
        while i < tree.len() {
            let p = tree[i];
            for &(pid, parent) in &parents {
                if parent == p && pid != p && !tree.contains(&pid) { tree.push(pid); }
            }
            i += 1;
        }
        tree
    };
    let ai = ai_root.map(descendants).unwrap_or_default();
    for pid in descendants(me) {
        let class = if ai.contains(&pid) { BELOW_NORMAL_PRIORITY_CLASS } else { HIGH_PRIORITY_CLASS };
        unsafe {
            if let Ok(h) = OpenProcess(PROCESS_SET_INFORMATION, false, pid) {
                let _ = SetPriorityClass(h, class);
                let _ = CloseHandle(h);
            }
        }
    }
}
#[cfg(not(windows))]
fn boost_priority(_: &tauri::AppHandle) {}

/// Exit Program (after the game asked "are you sure?"): stop the services and quit.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    stop_all(&app.state::<Launcher>());
    app.exit(0);
}

/// The game server's /api/health answer on GAME_PORT, if something answers there.
fn game_health() -> Option<serde_json::Value> {
    use std::io::{Read, Write};
    let mut s = TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], GAME_PORT)), Duration::from_millis(500)).ok()?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    s.write_all(b"GET /api/health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").ok()?;
    let mut text = String::new();
    let _ = s.read_to_string(&mut text);
    serde_json::from_str(text.split("\r\n\r\n").nth(1)?).ok()
}

/// Who listens on GAME_PORT (Windows: from netstat), for servers too old to report their pid.
fn port_owner() -> Option<u32> {
    if !cfg!(windows) {
        return None;
    }
    let mut c = Command::new("netstat");
    c.args(["-ano", "-p", "TCP"]);
    no_console(&mut c);
    let out = String::from_utf8_lossy(&c.output().ok()?.stdout).to_string();
    out.lines().find_map(|l| {
        let f: Vec<&str> = l.split_whitespace().collect();
        (f.len() >= 5 && f[1].ends_with(&format!(":{GAME_PORT}")) && f[3] == "LISTENING").then(|| f[4].parse().ok()).flatten()
    })
}

/// A game server left running by another STEMSTAGE (an older install, a crashed session, a test build) would
/// serve its own copy of the game in this window. Stop it so this app starts its own. Kept: a developer's Vite
/// server (`dev: true`) and a server that already serves this app's game folder.
fn replace_stale_server(res: &Path) {
    let Some(h) = game_health() else { return };
    let mine = res.join("dist").to_string_lossy().to_string();
    let same = h["dist"].as_str().map(|d| if cfg!(windows) { d.eq_ignore_ascii_case(&mine) } else { d == mine });
    if h["app"] != "stemstage" || h["dev"] == true || same == Some(true) {
        return;
    }
    let Some(pid) = h["pid"].as_u64().map(|p| p as u32).or_else(port_owner) else { return };
    if pid == std::process::id() {
        return;
    }
    #[cfg(windows)]
    {
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        no_console(&mut c);
        let _ = c.status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
    for _ in 0..30 {
        if !listening(GAME_PORT) { break; }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn launch(app: &tauri::AppHandle) {
    register_protocols();

    let l = app.state::<Launcher>();
    // resource_dir() is a verbatim path (\\?\C:\...) on Windows; Node can't resolve its entry script from one
    let res = app.path().resource_dir().map(|p| plain_path(p).join("app")).unwrap_or_default();
    replace_stale_server(&res);
    let home = app
        .path()
        .document_dir()
        .map(|p| p.join("STEMSTAGE"))
        .unwrap_or_else(|_| PathBuf::from("STEMSTAGE"));
    // %LOCALAPPDATA% on Windows, ~/.local/share on Linux
    let local = app.path().local_data_dir().map(plain_path).unwrap_or_else(|_| home.clone()).join("stemstage");
    let logs = local.join("logs");
    let _ = fs::create_dir_all(&logs);
    let songs = home.join("songs");
    let data = home.join("data");
    let _ = fs::create_dir_all(&songs);

    let mut st = Status {
        // opened from an invite link: the game joins that room once it has loaded
        url: match join_code(std::env::args()) {
            Some(code) => format!("http://127.0.0.1:{GAME_PORT}/?join={code}"),
            None => format!("http://127.0.0.1:{GAME_PORT}/"),
        },
        songs: songs.display().to_string(),
        logs: logs.display().to_string(),
        ..Default::default()
    };

    // 1. game server, on the Node.js the app ships with (bin/node) — or one on PATH for builds without it
    if listening(GAME_PORT) {
        st.game = "running".into();
    } else {
        let bundled = res.parent().map(|r| r.join("bin").join(if cfg!(windows) { "node.exe" } else { "node" })).filter(|p| p.exists());
        let mut cmd = Command::new(bundled.unwrap_or_else(|| PathBuf::from("node")));
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

    // 2. Python services (DualSense bridge + AI splitter): the installer sets them up; whatever is missing (setup
    // was offline, or Linux, which has no setup wizard) is installed here in the background while the game runs
    let env = PyEnv { res: res.clone(), local: local.clone(), logs: logs.clone() };
    st.bridge = if env.has_core() { "starting".into() } else { "installing (first start)…".into() };
    st.ai = if env.has_ai() { "starting".into() } else if env.ai_declined() { "not installed (Settings → AI splitter → Install)".into() } else { "installing (first start, large download)…".into() };
    *l.status.lock().unwrap() = st;
    *l.env.lock().unwrap() = Some(env.clone());
    python_services(app, &env, !env.ai_declined());
}

/// Where the game's Python environment lives and how to (re)build it.
#[derive(Clone)]
struct PyEnv {
    res: PathBuf,   // <resources>/app (server scripts)
    local: PathBuf, // %LOCALAPPDATA%\stemstage | ~/.local/share/stemstage
    logs: PathBuf,
}

impl PyEnv {
    fn venv(&self) -> PathBuf { self.local.join("venv") }
    fn python(&self) -> PathBuf {
        if cfg!(windows) { self.venv().join("Scripts").join("python.exe") } else { self.venv().join("bin").join("python") }
    }
    /// A package in the venv (installs from before the markers existed have no markers).
    fn has_pkg(&self, name: &str) -> bool {
        if cfg!(windows) {
            self.venv().join("Lib").join("site-packages").join(name).exists()
        } else {
            fs::read_dir(self.venv().join("lib")).map(|d| d.flatten().any(|e| e.path().join("site-packages").join(name).exists())).unwrap_or(false)
        }
    }
    fn has_core(&self) -> bool { self.python().exists() && (self.venv().join("stemstage-core.ok").exists() || self.has_pkg("pydualsense")) }
    fn has_ai(&self) -> bool { self.python().exists() && (self.venv().join("stemstage-ai.ok").exists() || self.has_pkg("demucs")) }
    fn ai_declined(&self) -> bool { self.local.join("ai-declined").exists() }

    /// Run the setup script ("core" or "ai") with the bundled uv and wait; output goes to logs/setup.log.
    fn setup(&self, mode: &str) -> Result<(), String> {
        let bin = self.res.parent().map(|r| r.join("bin")).unwrap_or_default();
        let uv = bin.join(if cfg!(windows) { "uv.exe" } else { "uv" });
        let log = fs::OpenOptions::new().create(true).append(true).open(self.logs.join("setup.log")).map_err(|e| e.to_string())?;
        let err = log.try_clone().map_err(|e| e.to_string())?;
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("powershell");
            c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(self.res.join("server").join("setup-ai.ps1")).args(["-Mode", mode, "-Uv"]).arg(&uv);
            c
        } else {
            let mut c = Command::new("bash");
            c.arg(self.res.join("server").join("setup-ai.sh")).arg(mode).arg(&uv);
            c
        };
        no_console(&mut cmd);
        let ok = cmd.stdin(Stdio::null()).stdout(Stdio::from(log)).stderr(Stdio::from(err)).status().map_err(|e| e.to_string())?;
        if ok.success() { Ok(()) } else { Err(format!("setup {mode} failed ({ok}) · log: {}", self.logs.join("setup.log").display())) }
    }
}

fn set_status(app: &tauri::AppHandle, f: impl FnOnce(&mut Status)) { f(&mut app.state::<Launcher>().status.lock().unwrap()); }

/// Start the bridge and the AI splitter, installing what's missing first (install_ai: the AI too).
fn python_services(app: &tauri::AppHandle, env: &PyEnv, install_ai: bool) {
    let l = app.state::<Launcher>();
    let start = |name: &str, script: &str, port: u16| -> String {
        if listening(port) {
            return "running".into();
        }
        let mut cmd = Command::new(env.python());
        cmd.arg(env.res.join("server").join(script)).current_dir(env.res.join("server"));
        match spawn(&l, name, cmd, &env.logs) {
            Ok(()) => "starting".into(),
            Err(e) => format!("error: {e}"),
        }
    };
    if !env.has_core() {
        if let Err(e) = env.setup("core") {
            set_status(app, |s| s.bridge = format!("error: {e}"));
            return;
        }
    }
    let bridge = start("controller-bridge", "controller_bridge.py", BRIDGE_PORT);
    set_status(app, |s| s.bridge = bridge);
    if !env.has_ai() && install_ai {
        set_status(app, |s| s.ai = "installing (large download)…".into());
        if let Err(e) = env.setup("ai") {
            set_status(app, |s| s.ai = format!("error: {e}"));
            return;
        }
    }
    let ai = if env.has_ai() { start("ai-splitter", "stem_server.py", AI_PORT) } else { "not installed (Settings → AI splitter → Install)".into() };
    set_status(app, |s| s.ai = ai);
}

/// Settings → AI splitter → Install: set it up in the background (the game polls launcher_status).
#[tauri::command]
fn install_ai(app: tauri::AppHandle) -> Result<(), String> {
    let env = app.state::<Launcher>().env.lock().unwrap().clone().ok_or("the launcher isn't ready yet")?;
    if env.has_ai() {
        return Err("the AI splitter is already installed".into());
    }
    let _ = fs::remove_file(env.local.join("ai-declined"));
    set_status(&app, |s| s.ai = "installing (large download)…".into());
    std::thread::spawn(move || python_services(&app, &env, true));
    Ok(())
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

/// Pages the launcher trusts with the microphone: the bundled splash screen and the local game server.
fn is_local_page(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "tauri" | "asset")
        || matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "tauri.localhost" | "[::1]"))
}

/// The main window from tauri.conf.json (`create: false` there), plus microphone / MIDI access for the game.
fn create_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let cfg = app.config().app.windows.iter().find(|w| w.label == "main").cloned().expect("main window config");
    let window = WebviewWindowBuilder::from_config(app, &cfg)?
        .on_permission_request(|webview, kind| {
            let local = webview.url().map(|u| is_local_page(&u)).unwrap_or(false);
            match kind {
                PermissionKind::Microphone | PermissionKind::Midi if local => PermissionResponse::Allow,
                _ => PermissionResponse::Default,
            }
        })
        .build()?;
    #[cfg(target_os = "linux")]
    {
        // WebKitGTK ships with getUserMedia (and WebRTC) disabled
        let _ = window.with_webview(|wv| {
            use webkit2gtk::{SettingsExt, WebViewExt};
            if let Some(s) = wv.inner().settings() {
                s.set_enable_media_stream(true);
                s.set_media_playback_requires_user_gesture(false);
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    let _ = window;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // must come first: a second STEMSTAGE (an invite link, Discord's Join) passes its arguments here and quits
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
                if let Some(code) = join_code(argv) {
                    let _ = w.eval(format!("window.__stemstageJoin && window.__stemstageJoin('{code}')"));
                }
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Launcher::default())
        .invoke_handler(tauri::generate_handler![launcher_status, check_update, install_update, install_ai, exit_app])
        .setup(|app| {
            create_main_window(app.handle())?;
            let handle = app.handle().clone();
            std::thread::spawn(move || launch(&handle));
            // High priority for the game and everything it starts (webview processes and services come up over time)
            let h2 = app.handle().clone();
            std::thread::spawn(move || {
                for secs in [1, 4, 10, 25, 60] {
                    std::thread::sleep(Duration::from_secs(secs));
                    boost_priority(&h2);
                }
                // services can restart or be installed later (Settings → Install AI splitter)
                loop {
                    std::thread::sleep(Duration::from_secs(120));
                    boost_priority(&h2);
                }
            });
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
