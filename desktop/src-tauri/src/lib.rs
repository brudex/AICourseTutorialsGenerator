//! SOURCE OF TRUTH KEYWORDS: desktop shell, Tauri, sidecar, local runtime,
//!   READY line, startup splash, runtime shutdown
//!
//! WHAT:  The native window of Penrose Studio. On launch it shows the
//!        splash page, starts the bundled Node runtime (sidecar `node` running
//!        app/runtime/main.mjs) with the per-user data folder, and switches
//!        the window to the local studio when the runtime prints
//!        `READY <url>`. `FAILED <reason>` is shown on the splash instead.
//!        On quit it stops the runtime gracefully, which stops the server,
//!        the worker and the embedded database.
//! WHY:   Everything runs on the client's machine; the shell only owns the
//!        window and the runtime's lifetime. A graceful stop matters: killing
//!        the runtime outright would leave PostgreSQL running.
//! WHERE: Built by `npm run build` in desktop/ (tauri build).

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct Runtime(Mutex<Option<CommandChild>>);

/// Appends one line to <app data>/logs/<file>, so support can see what the
/// runtime and the window did on a client's machine.
fn append_log(dir: &PathBuf, file: &str, line: &str) {
    let logs = dir.join("logs");
    let _ = std::fs::create_dir_all(&logs);
    if let Ok(mut handle) = std::fs::OpenOptions::new().create(true).append(true).open(logs.join(file)) {
        let _ = writeln!(handle, "{line}");
    }
}

/// Asks the runtime to shut down (SIGTERM on macOS/Linux) so it can stop
/// PostgreSQL cleanly; on Windows the whole process tree is ended.
fn stop_runtime(child: CommandChild) {
    let pid = child.pid();
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill").args(["-TERM", &pid.to_string()]).status();
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill").args(["/PID", &pid.to_string(), "/T"]).status();
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
    let _ = child.kill();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Runtime(Mutex::new(None)))
        .on_page_load(|webview, payload| {
            if let Ok(dir) = webview.app_handle().path().app_data_dir() {
                append_log(&dir, "shell.log", &format!("page {:?} {}", payload.event(), payload.url()));
            }
        })
        .setup(|app| {
            let resources = app.path().resource_dir()?;
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let entry = resources.join("app").join("runtime").join("main.mjs");

            let (mut events, child) = app
                .shell()
                .sidecar("node")?
                .args([entry.to_string_lossy().to_string()])
                .env("AI_COURSE_DATA_DIR", data_dir.to_string_lossy().to_string())
                .spawn()?;
            *app.state::<Runtime>().0.lock().unwrap() = Some(child);

            let window = app.get_webview_window("main").expect("main window");
            let log_dir = data_dir.clone();
            tauri::async_runtime::spawn(async move {
                /* Until READY, an exit without a FAILED line still gets a message,
                 * so the splash never spins forever. */
                let mut settled = false;
                while let Some(event) = events.recv().await {
                    if let CommandEvent::Terminated(status) = &event {
                        append_log(&log_dir, "shell.log", &format!("runtime exited: {status:?}"));
                        if !settled {
                            let message = serde_json::to_string(&format!("The local runtime stopped while starting ({status:?}).")).unwrap_or_default();
                            let _ = window.eval(&format!("window.showStartupError({message})"));
                        }
                        continue;
                    }
                    if let CommandEvent::Stderr(bytes) = &event {
                        append_log(&log_dir, "runtime.log", String::from_utf8_lossy(bytes).trim_end());
                    }
                    if let CommandEvent::Stdout(bytes) = event {
                        append_log(&log_dir, "runtime.log", String::from_utf8_lossy(&bytes).trim_end());
                        for line in String::from_utf8_lossy(&bytes).lines() {
                            if let Some(url) = line.trim().strip_prefix("READY ") {
                                settled = true;
                                match url.parse() {
                                    Ok(parsed) => {
                                        let result = window.navigate(parsed);
                                        append_log(&log_dir, "shell.log", &format!("navigate {url}: {result:?}"));
                                    }
                                    Err(error) => append_log(&log_dir, "shell.log", &format!("bad url {url}: {error}")),
                                }
                            } else if let Some(reason) = line.trim().strip_prefix("FAILED ") {
                                settled = true;
                                let message = serde_json::to_string(reason).unwrap_or_default();
                                let _ = window.eval(&format!("window.showStartupError({message})"));
                            }
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Penrose Studio");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(child) = handle.state::<Runtime>().0.lock().unwrap().take() {
                stop_runtime(child);
            }
        }
    });
}
