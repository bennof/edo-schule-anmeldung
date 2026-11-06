//! Secretariat desktop app: one window on http://localhost:8964, served by a
//! local server in this process together with a CORS proxy for SVWS. All
//! SVWS settings stay in the app's settings (transport "proxy", proxy
//! address http://localhost:8964/svws-proxy).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod local;

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
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Desktop-App konnte nicht starten");
}
