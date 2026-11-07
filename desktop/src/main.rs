//! Secretariat desktop app: one window on http://localhost:8964, served by a
//! local server in this process together with a CORS proxy for SVWS. All
//! SVWS settings stay in the app's settings (transport "proxy", proxy
//! address http://localhost:8964/svws-proxy).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod local;

use tauri::webview::DownloadEvent;
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            local::start(local::PORT)?;
            let url = format!("http://localhost:{}", local::PORT).parse()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Anmeldung – Sekretariat")
                .inner_size(1280.0, 860.0)
                .min_inner_size(380.0, 500.0)
                // tells the secretariat it runs in the app: SVWS goes through
                // the built-in proxy (apps/secretariat/src/desktop.ts)
                .initialization_script("window.__EDO_DESKTOP__ = true;")
                // exports (JSON, PDF) are downloads: without a handler the
                // webview drops them; with it they land in the Downloads folder
                // under the suggested name ("name (1).json" if it exists).
                // The page shows where the file went (dialogs.svelte.ts).
                .on_download(|webview, event| {
                    if let DownloadEvent::Finished { path, success, .. } = event {
                        let detail = serde_json::json!({ "path": path, "success": success });
                        let script = format!("window.dispatchEvent(new CustomEvent('desktop-download', {{ detail: {detail} }}))");
                        let _ = webview.eval(script);
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Desktop-App konnte nicht starten");
}
