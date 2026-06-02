// Dimitri Tauri core.
//
// On startup it launches the two local sidecars — the Python chemistry engine
// (FastAPI on :7842) and the pi assistant (WebSocket on :7843) — then shows the
// window, which loads the web UI. The sidecars are killed when the app exits.
//
// Dev mode spawns them from the repo (uv / tsx). A bundled .app will instead
// point DIMITRI_HOME at its Resources dir with a vendored Python + Node (Step 8).

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct Sidecars(Mutex<Vec<Child>>);

fn dimitri_home() -> String {
    std::env::var("DIMITRI_HOME").unwrap_or_else(|_| env!("CARGO_MANIFEST_DIR").to_string() + "/..")
}

// In a packaged .app the vendored Python + Node + code live under
// Contents/Resources/vendor. If that exists we run fully self-contained (no
// system uv/node, nothing under ~/Documents → no TCC prompt). Otherwise we're
// in the dev repo and fall back to uv/tsx.
fn bundled_vendor(resource_dir: &Path) -> Option<PathBuf> {
    // Only treat as packaged when we're genuinely inside a .app bundle — in the
    // dev repo resource_dir is src-tauri/, which also has a vendor/ dir, and we
    // want dev mode (uv/tsx) there for fast iteration.
    if !resource_dir.components().any(|c| c.as_os_str().to_string_lossy().ends_with(".app")) {
        return None;
    }
    let v = resource_dir.join("vendor");
    if v.join("python/bin/python3").exists() && v.join("node/bin/node").exists() {
        Some(v)
    } else {
        None
    }
}

fn spawn_bundled(vendor: &Path, ppid: &str) -> Vec<Child> {
    let mut children = Vec::new();
    let py = vendor.join("python/bin/python3");
    let modules = vendor.join("modules");

    // Chemistry engine: run the module directly (relocatable — avoids the
    // console-script's build-time absolute shebang).
    match Command::new(&py)
        .args(["-m", "dimitri_chem.server"])
        .env("DIMITRI_PARENT_PID", ppid)
        .env("DIMITRI_MODULES", &modules)
        .spawn()
    {
        Ok(c) => children.push(c),
        Err(e) => eprintln!("[dimitri] failed to spawn vendored engine: {e}"),
    }

    // pi assistant: vendored node running tsx on the bundled source.
    let node = vendor.join("node/bin/node");
    let tsx = vendor.join("assistant/node_modules/tsx/dist/cli.mjs");
    let entry = vendor.join("assistant/src/index.ts");
    match Command::new(&node)
        .arg(&tsx)
        .arg(&entry)
        .current_dir(vendor.join("assistant"))
        .env("DIMITRI_PARENT_PID", ppid)
        .spawn()
    {
        Ok(c) => children.push(c),
        Err(e) => eprintln!("[dimitri] failed to spawn vendored assistant: {e}"),
    }
    children
}

// A GUI-launched .app inherits only a minimal PATH (/usr/bin:/bin:/usr/sbin:
// /sbin) — none of the usual spots where `uv` and `node` live. Prepend them so
// the sidecars can be found whether they came from Homebrew, the uv installer,
// cargo, or nvm. (The vendored-runtime path will make this unnecessary.)
fn child_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let extra = [
        format!("{home}/.local/bin"),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        format!("{home}/.cargo/bin"),
        format!("{home}/.bun/bin"),
    ]
    .join(":");
    match std::env::var("PATH") {
        Ok(p) => format!("{extra}:{p}"),
        Err(_) => extra,
    }
}

fn spawn_sidecars() -> Vec<Child> {
    let home = dimitri_home();
    let ppid = std::process::id().to_string();
    let path = child_path();
    let mut children = Vec::new();

    // Python chemistry engine. DIMITRI_PARENT_PID lets it self-exit if we die
    // in a way that skips the graceful ExitRequested handler (crash/SIGKILL).
    if let Ok(child) = Command::new("sh")
        .arg("-c")
        .arg(format!("uv run --project '{home}/backend' dimitri-engine"))
        .env("DIMITRI_PARENT_PID", &ppid)
        .env("PATH", &path)
        .spawn()
    {
        children.push(child);
    } else {
        eprintln!("[dimitri] failed to spawn engine");
    }

    // pi assistant sidecar
    let assistant = format!(
        "'{home}/assistant/node_modules/.bin/tsx' '{home}/assistant/src/index.ts'"
    );
    if let Ok(child) = Command::new("sh")
        .arg("-c")
        .arg(assistant)
        .env("DIMITRI_PARENT_PID", &ppid)
        .env("PATH", &path)
        .spawn()
    {
        children.push(child);
    } else {
        eprintln!("[dimitri] failed to spawn assistant");
    }

    children
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Sidecars(Mutex::new(Vec::new())))
        .setup(|app| {
            let ppid = std::process::id().to_string();
            let children = match app
                .path()
                .resource_dir()
                .ok()
                .and_then(|r| bundled_vendor(&r))
            {
                Some(vendor) => {
                    eprintln!("[dimitri] bundled mode: {}", vendor.display());
                    spawn_bundled(&vendor, &ppid)
                }
                None => {
                    eprintln!("[dimitri] dev mode (uv/tsx)");
                    spawn_sidecars()
                }
            };
            *app.state::<Sidecars>().0.lock().unwrap() = children;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Dimitri")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<Sidecars>() {
                    for mut child in state.0.lock().unwrap().drain(..) {
                        let _ = child.kill();
                    }
                }
            }
        });
}
