//! Public server: the only component the public SPA talks to.
//! It keeps no personal data; SharePoint is the persistent store.

mod api;
mod graph;
mod settings;
mod sharepoint;

use std::io::Read;
use std::sync::Arc;
use std::thread;
use tiny_http::{Header, Request, Response, Server};

const MAX_BODY: u64 = 16 * 1024;

fn main() {
    let settings = settings::Settings::load().unwrap_or_else(|e| {
        eprintln!("configuration error: {e}");
        std::process::exit(1);
    });
    let graph = graph::Graph::new(
        &settings.tenant_id,
        &settings.client_id,
        &settings.client_secret,
    );
    let api = Arc::new(api::Api::new(sharepoint::Site::new(
        graph,
        &settings.site_id,
    )));

    let server = Arc::new(Server::http(&settings.bind_addr).unwrap_or_else(|e| {
        eprintln!("cannot bind {}: {e}", settings.bind_addr);
        std::process::exit(1);
    }));
    println!(
        "anmeldung-server listening on http://{}",
        settings.bind_addr
    );

    let workers: Vec<_> = (0..settings.workers)
        .map(|_| {
            let (server, api) = (Arc::clone(&server), Arc::clone(&api));
            thread::spawn(move || {
                while let Ok(request) = server.recv() {
                    handle(&api, request);
                }
            })
        })
        .collect();
    for w in workers {
        let _ = w.join();
    }
}

fn handle(api: &api::Api, mut request: Request) {
    let method = request.method().as_str().to_uppercase();
    let path = request.url().split('?').next().unwrap_or("").to_string();

    let mut body = Vec::new();
    let too_large = request.body_length().is_some_and(|l| l as u64 > MAX_BODY)
        || request
            .as_reader()
            .take(MAX_BODY + 1)
            .read_to_end(&mut body)
            .is_err()
        || body.len() as u64 > MAX_BODY;

    let reply = if too_large {
        api::Reply {
            status: 413,
            content_type: "text/plain".into(),
            body: b"payload too large".to_vec(),
        }
    } else {
        api.handle(&method, &path, &body)
    };
    // log method, path and status only, never bodies (personal data)
    println!("{method} {path} {}", reply.status);
    let response = Response::from_data(reply.body)
        .with_status_code(reply.status)
        .with_header(
            Header::from_bytes("Content-Type", reply.content_type.as_bytes())
                .expect("valid header"),
        )
        .with_header(Header::from_bytes("Cache-Control", "no-store").expect("valid header"));
    if let Err(e) = request.respond(response) {
        eprintln!("failed to send response: {e}");
    }
}
