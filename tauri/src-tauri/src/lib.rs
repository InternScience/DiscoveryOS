use std::{
    fs,
    net::TcpListener,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

// ── constants ──────────────────────────────────────────────────────────────

/// Port the embedded Next.js server listens on.
/// Chosen to be unlikely to collide with common development ports.
const SERVER_PORT: u16 = 38495;

/// Maximum time to wait for the server to respond before giving up.
const SERVER_TIMEOUT_SECS: u64 = 45;

// ── shared state ───────────────────────────────────────────────────────────

/// Holds the handle to the running Node.js sidecar so it can be stopped on exit.
#[derive(Default)]
pub struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
}

// ── path helpers ───────────────────────────────────────────────────────────

/// Directory that contains the Next.js standalone server files bundled as
/// Tauri resources.  Layout inside: `server.js`, `.next/`, `node_modules/`,
/// `public/`, `.next/static/`.
fn next_server_root(app: &AppHandle) -> tauri::Result<PathBuf> {
    let base = app.path().resource_dir()?;
    // In a packaged .deb the Tauri resources glob (`resources/next-standalone/**/*`)
    // preserves the relative path, so files land at <resource_dir>/resources/next-standalone/.
    // In development (tauri dev) they are served from the src-tauri directory directly.
    let packaged = base.join("resources").join("next-standalone");
    if packaged.join("server.js").exists() {
        return Ok(packaged);
    }
    Ok(base.join("next-standalone"))
}

/// Persistent, writable data directory for this installation.
/// SQLite database and `.env.local` (user settings) live here.
fn app_data_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| tauri::Error::Anyhow(e.into()))?;
    Ok(dir)
}

/// Default workspace root: `~/DiscoveryOS/`.
/// Placed directly in the user's home directory so it is easy to find.
/// The user can add or change roots in Settings → Workspace Roots.
fn default_workspace_roots(app: &AppHandle) -> tauri::Result<String> {
    // Honour an explicit env-var override (useful for power users / testing).
    if let Ok(v) = std::env::var("WORKSPACE_ROOTS") {
        if !v.trim().is_empty() {
            return Ok(v);
        }
    }
    // Default to ~/DiscoveryOS — visible and easy to find in the home directory.
    let home = app.path().home_dir()?;
    let dir = home.join("DiscoveryOS").join("workspace");
    fs::create_dir_all(&dir).map_err(|e| tauri::Error::Anyhow(e.into()))?;
    Ok(dir.to_string_lossy().into_owned())
}

// ── error / loading display ────────────────────────────────────────────────

/// Percent-encode every byte that is not an unreserved URI character so the
/// result can be safely embedded in a `data:text/html` URL.
fn percent_encode(html: &str) -> String {
    html.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn data_url(html: &str) -> tauri::WebviewUrl {
    let url_str = format!("data:text/html;charset=utf-8,{}", percent_encode(html));
    match url_str.parse::<tauri::Url>() {
        Ok(u)  => tauri::WebviewUrl::External(u),
        Err(_) => tauri::WebviewUrl::App(PathBuf::from("/")),
    }
}

/// Build a polished error page with clear visual hierarchy.
///
/// Sections: icon header → error-detail box → recovery checklist.
fn error_webview_url(heading: &str, msg: &str) -> tauri::WebviewUrl {
    fn esc(s: &str) -> String {
        s.replace('&', "&amp;")
         .replace('<', "&lt;")
         .replace('>', "&gt;")
         .replace('"', "&quot;")
    }

    // Derive a short human-readable category and a recovery hint from the
    // error message so the window is immediately actionable.
    let (category, hint) = if msg.contains("already in use") || msg.contains("Port") {
        (
            "Port Conflict",
            "Close any other DiscoveryOS instances, or kill the process\n\
             occupying the port:\n\n  lsof -ti :38495 | xargs kill -9",
        )
    } else if msg.contains("resource") || msg.contains("server.js") || msg.contains("No such file") {
        (
            "Missing Resource",
            "The bundled Next.js server could not be located.\n\
             Re-install DiscoveryOS to restore the required files.",
        )
    } else if msg.contains("did not become ready") || msg.contains("timeout") || msg.contains("45s") {
        (
            "Startup Timeout",
            "The embedded server took too long to start.\n\
             Check system logs for Node.js errors:\n\n  journalctl -xe | grep discoveryos",
        )
    } else {
        (
            "Startup Error",
            "Relaunch DiscoveryOS. If the problem persists, check the\n\
             system log or file a bug at github.com/your-org/discoveryos.",
        )
    };

    let html = format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{min-height:100vh;display:flex;align-items:center;justify-content:center;
     background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}}
.card{{width:580px;background:#181818;border:1px solid #2e1a1a;border-radius:14px;overflow:hidden;
       box-shadow:0 24px 64px rgba(0,0,0,.6)}}
.hd{{padding:22px 26px;background:linear-gradient(135deg,#220d0d,#181818);
     border-bottom:1px solid #2e1a1a;display:flex;align-items:center;gap:14px}}
.ico{{width:44px;height:44px;flex-shrink:0;border-radius:10px;background:#c0392b;
      display:flex;align-items:center;justify-content:center}}
.ico svg{{width:24px;height:24px;fill:#fff}}
.hd-text .title{{font-size:15px;font-weight:600;color:#f0f0f0;line-height:1.3}}
.hd-text .badge{{display:inline-block;margin-top:5px;padding:2px 8px;border-radius:4px;
                  font-size:11px;font-weight:600;letter-spacing:.05em;
                  background:#3a1212;color:#f87171;border:1px solid #5a2020}}
.body{{padding:22px 26px}}
.section-label{{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
                color:#555;margin-bottom:8px}}
.msg-box{{background:#101010;border:1px solid #232323;border-radius:8px;
          padding:14px 16px;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;
          font-size:12.5px;line-height:1.65;color:#d4d4d4;white-space:pre-wrap;
          word-break:break-word;max-height:120px;overflow-y:auto}}
.divider{{border:none;border-top:1px solid #222;margin:18px 0}}
.hint-box{{background:#0d1a0d;border:1px solid #1a2e1a;border-radius:8px;
           padding:14px 16px;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;
           font-size:12.5px;line-height:1.65;color:#86efac;white-space:pre-wrap;
           word-break:break-word}}
.footer{{padding:14px 26px;border-top:1px solid #222;display:flex;justify-content:flex-end}}
.btn{{padding:7px 16px;border-radius:6px;font-size:13px;cursor:pointer;
      border:1px solid #333;background:#222;color:#bbb;transition:background .15s}}
.btn:hover{{background:#2a2a2a;color:#e0e0e0}}
</style>
</head><body>
<div class="card">
  <div class="hd">
    <div class="ico">
      <svg viewBox="0 0 24 24"><path d="M13 14H11V9h2zm0 4H11v-2h2zM1 21L12 2l11 19z"/></svg>
    </div>
    <div class="hd-text">
      <div class="title">{heading}</div>
      <span class="badge">{category}</span>
    </div>
  </div>
  <div class="body">
    <div class="section-label">Error Details</div>
    <div class="msg-box">{msg_esc}</div>
    <hr class="divider">
    <div class="section-label">Recovery Steps</div>
    <div class="hint-box">{hint_esc}</div>
  </div>
  <div class="footer">
    <button class="btn" onclick="window.close()">Dismiss</button>
  </div>
</div>
</body></html>"#,
        heading  = esc(heading),
        category = category,
        msg_esc  = esc(msg),
        hint_esc = esc(hint),
    );

    data_url(&html)
}

/// Build an animated splash/loading page shown while the server warms up.
fn loading_webview_url(message: &str) -> tauri::WebviewUrl {
    fn esc(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
    }
    let html = format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{min-height:100vh;display:flex;align-items:center;justify-content:center;
     background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
     color:#e0e0e0;overflow:hidden}}
.wrap{{text-align:center;user-select:none}}
.logo-ring{{position:relative;width:72px;height:72px;margin:0 auto 28px}}
.ring{{position:absolute;inset:0;border-radius:50%;border:3px solid transparent;
       border-top-color:#7c3aed;animation:spin 1.1s linear infinite}}
.ring2{{position:absolute;inset:8px;border-radius:50%;border:2px solid transparent;
        border-top-color:#4f46e5;animation:spin .75s linear infinite reverse}}
.dot{{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}}
.dot-inner{{width:16px;height:16px;border-radius:50%;
            background:linear-gradient(135deg,#7c3aed,#4f46e5);
            box-shadow:0 0 16px rgba(124,58,237,.5)}}
@keyframes spin{{to{{transform:rotate(360deg)}}}}
.name{{font-size:22px;font-weight:700;letter-spacing:-.02em;
       background:linear-gradient(135deg,#a78bfa,#818cf8);
       -webkit-background-clip:text;-webkit-text-fill-color:transparent}}
.msg{{margin-top:10px;font-size:13px;color:#555;letter-spacing:.01em}}
.dots{{display:inline-block}}
.dots span{{animation:blink 1.4s ease-in-out infinite}}
.dots span:nth-child(2){{animation-delay:.2s}}
.dots span:nth-child(3){{animation-delay:.4s}}
@keyframes blink{{0%,80%,100%{{opacity:0}}40%{{opacity:1}}}}
</style>
</head><body>
<div class="wrap">
  <div class="logo-ring">
    <div class="ring"></div>
    <div class="ring2"></div>
    <div class="dot"><div class="dot-inner"></div></div>
  </div>
  <div class="name">DiscoveryOS</div>
  <div class="msg">{msg}<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>
</div>
</body></html>"#,
        msg = esc(message),
    );
    data_url(&html)
}

/// Show a non-blocking splash window during startup.
fn show_loading_window(app: &AppHandle) {
    let _ = tauri::WebviewWindowBuilder::new(
        app,
        "splash",
        loading_webview_url("Starting"),
    )
    .title("DiscoveryOS")
    .inner_size(360.0, 260.0)
    .resizable(false)
    .decorations(true)
    .center()
    .build();
}

/// Close the splash window once the app is ready.
fn close_loading_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("splash") {
        let _ = w.close();
    }
}

/// Open a detailed error window.  Silently ignores window-creation failures
/// (e.g. if the runtime is already shutting down).
fn show_error_window(app: &AppHandle, heading: &str, msg: &str) {
    let _ = tauri::WebviewWindowBuilder::new(
        app,
        "error",
        error_webview_url(heading, msg),
    )
    .title("DiscoveryOS — Startup Error")
    .inner_size(600.0, 460.0)
    .center()
    .build();
}

// ── server lifecycle ───────────────────────────────────────────────────────

/// Spawn the Node.js sidecar that runs the Next.js production server.
///
/// Environment variables injected at launch:
/// - `NODE_ENV=production`
/// - `HOSTNAME=127.0.0.1`          (bind only to loopback)
/// - `PORT`                        (server port)
/// - `DATABASE_URL`                (SQLite path in app-data dir)
/// - `WORKSPACE_ROOTS`             (comma-separated allowed roots)
/// - `APP_DATA_DIR`                (writable dir; .env.local and user data go here)
fn spawn_server(app: &AppHandle) -> anyhow::Result<CommandChild> {
    let server_root = next_server_root(app)?;
    let server_js   = server_root.join("server.js");
    let data_dir    = app_data_dir(app)?;
    let db_url      = data_dir.join("discoveryos.sqlite").to_string_lossy().into_owned();
    let ws_roots    = default_workspace_roots(app)?;
    let data_dir_s  = data_dir.to_string_lossy().into_owned();

    // Fail fast with an actionable message if the port is already occupied.
    // TcpListener::bind succeeds only when the port is free; we drop the
    // listener immediately so Node.js can bind the same port moments later.
    // (A short TOCTOU window remains, but is acceptable for a desktop app.)
    TcpListener::bind(("127.0.0.1", SERVER_PORT)).map_err(|_| {
        anyhow::anyhow!(
            "Port {SERVER_PORT} is already in use.\n\
             Another instance of DiscoveryOS may be running, or a different \
             application has claimed this port.\n\
             Close it and relaunch DiscoveryOS."
        )
    })?;

    let (mut rx, child) = app
        .shell()
        .sidecar("node")?
        .args([server_js.to_string_lossy().as_ref()])
        // server.js calls process.chdir(__dirname) immediately after loading,
        // which overrides any CWD we set here.  APP_DATA_DIR is the canonical
        // way for the Next.js app to locate the writable user data directory.
        .env("NODE_ENV",        "production")
        .env("HOSTNAME",        "127.0.0.1")
        .env("PORT",            SERVER_PORT.to_string())
        .env("DATABASE_URL",    &db_url)
        .env("WORKSPACE_ROOTS", &ws_roots)
        .env("APP_DATA_DIR",    &data_dir_s)
        .env("NEXT_SHARP_PATH", server_root.join("node_modules/sharp").to_string_lossy().as_ref())
        .spawn()?;

    // Forward stdout/stderr to the host console for debugging.
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) =>
                    println!("[next] {}", String::from_utf8_lossy(&line)),
                CommandEvent::Stderr(line) =>
                    eprintln!("[next] {}", String::from_utf8_lossy(&line)),
                CommandEvent::Error(msg) =>
                    eprintln!("[next:error] {msg}"),
                CommandEvent::Terminated(p) => {
                    eprintln!("[next:exit] code={:?} signal={:?}", p.code, p.signal);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// Poll `GET /api/health` until the server responds with 200 or we time out.
async fn wait_for_server() -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let url     = format!("http://127.0.0.1:{SERVER_PORT}/api/health");
    let started = Instant::now();

    loop {
        match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => return Ok(()),
            _ => {
                if started.elapsed() >= Duration::from_secs(SERVER_TIMEOUT_SECS) {
                    return Err(format!(
                        "Next.js server did not become ready within {SERVER_TIMEOUT_SECS}s.\n\
                         Check system logs for Node.js errors:\n\
                         journalctl -xe | grep discoveryos"
                    ));
                }
                tokio::time::sleep(Duration::from_millis(400)).await;
            }
        }
    }
}

/// Kill the sidecar gracefully.
fn stop_server(app: &AppHandle) {
    let state = app.state::<ServerState>();
    let mut slot = state.child.lock().expect("server state mutex poisoned");
    if let Some(child) = slot.take() {
        let _ = child.kill();
    }
}

// ── app entry point ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerState::default())
        .setup(|app| {
            let handle = app.handle().clone();

            // Show a splash screen immediately so the user sees something
            // while the Node.js sidecar warms up.
            show_loading_window(&handle);

            // Spawn the server and show the main window asynchronously so the
            // main thread is never blocked (avoids "not responding" on slow machines).
            tauri::async_runtime::spawn(async move {
                // 1. Start Node.js sidecar.
                let child = match spawn_server(&handle) {
                    Ok(c)  => c,
                    Err(e) => {
                        let msg = e.to_string();
                        eprintln!("[desktop] failed to spawn server: {msg}");
                        close_loading_window(&handle);
                        show_error_window(&handle, "DiscoveryOS failed to start", &msg);
                        return;
                    }
                };

                {
                    let state = handle.state::<ServerState>();
                    let mut slot = state.child.lock().expect("mutex poisoned");
                    *slot = Some(child);
                }

                // 2. Wait for the server to be ready.
                if let Err(msg) = wait_for_server().await {
                    eprintln!("[desktop] server readiness check failed: {msg}");
                    stop_server(&handle);
                    close_loading_window(&handle);
                    show_error_window(&handle, "DiscoveryOS failed to start", &msg);
                    return;
                }

                // 3. Swap splash → main window.
                // WebKit may have cached a "Connection refused" error from when the
                // hidden window tried to load the URL before the server was ready.
                // Navigate explicitly to force a fresh page load, then show.
                close_loading_window(&handle);
                if let Some(window) = handle.get_webview_window("main") {
                    let server_url = format!("http://127.0.0.1:{SERVER_PORT}");
                    if let Ok(url) = server_url.parse::<tauri::Url>() {
                        let _ = window.navigate(url);
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build DiscoveryOS desktop app")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                stop_server(app_handle);
            }
        });
}
