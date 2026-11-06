//! Public server: serves the registration page (embedded at build time)
//! and the API it talks to. It keeps no personal data; SharePoint is the
//! persistent store.

mod api;
mod formdata;
mod graph;
mod mail;
mod public;
mod settings;
mod sharepoint;
mod token;
mod uploads;

use std::io::Read;
use std::sync::Arc;
use std::thread;
use tiny_http::{Header, Request, Response, Server};

const MAX_BODY: u64 = 128 * 1024;

fn main() {
    let settings = settings::Settings::load().unwrap_or_else(|e| {
        eprintln!("configuration error: {e}");
        std::process::exit(1);
    });
    let graph = graph::Graph::new(&settings.tenant_id, &settings.client_id, &settings.client_secret);
    let trust_proxy = settings.trust_proxy;
    let mail = match (&settings.mail_redirect, settings.mail_disabled) {
        (_, true) => api::MailMode::Disabled,
        (Some(address), false) => api::MailMode::Redirect(address.clone()),
        (None, false) => api::MailMode::Send,
    };
    let api = Arc::new(api::Api::new(sharepoint::Site::new(graph, &settings.site_id), mail));
    let csp: Arc<str> = public::csp(&settings.frame_ancestors).into();

    let server = Arc::new(Server::http(&settings.bind_addr).unwrap_or_else(|e| {
        eprintln!("cannot bind {}: {e}", settings.bind_addr);
        std::process::exit(1);
    }));
    println!("edo-anmeldung-server listening on http://{}", settings.bind_addr);
    if !public::embedded() {
        println!("registration page not embedded (built without `make build`): API only");
    }

    let workers: Vec<_> = (0..settings.workers)
        .map(|_| {
            let (server, api, csp) = (Arc::clone(&server), Arc::clone(&api), Arc::clone(&csp));
            thread::spawn(move || {
                while let Ok(request) = server.recv() {
                    if request.url().starts_with("/api/") {
                        handle(&api, request, trust_proxy);
                    } else {
                        serve_page(request, &csp);
                    }
                }
            })
        })
        .collect();
    for w in workers {
        let _ = w.join();
    }
}

fn handle(api: &api::Api, mut request: Request, trust_proxy: bool) {
    let method = request.method().as_str().to_uppercase();
    let (path, query) = match request.url().split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (request.url().to_string(), String::new()),
    };
    // uploads may be larger than ordinary JSON requests
    let max_body = if method == "POST" && path.ends_with("/uploads") {
        uploads::MAX_SIZE as u64 + 1
    } else {
        MAX_BODY
    };
    let header = |name: &'static str| {
        request
            .headers()
            .iter()
            .find(|h| h.field.equiv(name))
            .map(|h| h.value.as_str().to_string())
    };
    let forwarded = header("X-Forwarded-For");
    let bearer = header("Authorization").and_then(|v| v.strip_prefix("Bearer ").map(|t| t.trim().to_string()));
    let content_type = header("Content-Type");
    let ip = client_ip(request.remote_addr().map(|a| a.ip()), forwarded.as_deref(), trust_proxy);

    let mut body = Vec::new();
    let too_large = request.body_length().is_some_and(|l| l as u64 > max_body)
        || request.as_reader().take(max_body + 1).read_to_end(&mut body).is_err()
        || body.len() as u64 > max_body;

    let reply = if too_large {
        api::Reply {
            status: 413,
            content_type: "text/plain".into(),
            body: b"payload too large".to_vec(),
        }
    } else {
        api.handle(&api::ApiRequest {
            method: method.clone(),
            path: path.clone(),
            body,
            client_ip: ip,
            bearer,
            query,
            content_type,
        })
    };
    // log method, path and status only, never bodies (personal data)
    println!("{method} {path} {}", reply.status);
    let mut response = Response::from_data(reply.body)
        .with_status_code(reply.status)
        .with_header(Header::from_bytes("Content-Type", reply.content_type.as_bytes()).expect("valid header"))
        .with_header(Header::from_bytes("Cache-Control", "no-store").expect("valid header"));
    // the secretariat (another origin) may test the connection; no data in these replies
    if method == "GET" && (path == "/api/health" || path == "/api/status") {
        response.add_header(Header::from_bytes("Access-Control-Allow-Origin", "*").expect("valid header"));
    }
    if let Err(e) = request.respond(response) {
        eprintln!("failed to send response: {e}");
    }
}

/// Files of the registration page, with cache and security headers.
fn serve_page(request: Request, csp: &str) {
    let method = request.method().as_str().to_uppercase();
    let path = request.url().split(['?', '#']).next().unwrap_or("/").to_string();
    let header = |name: &str, value: &str| Header::from_bytes(name, value).expect("valid header");
    let response = match (method.as_str(), public::lookup(&path)) {
        ("GET" | "HEAD", Some(file)) => {
            let cache = if file.immutable {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            };
            let mut r = Response::from_data(file.body)
                .with_header(header("Content-Type", file.content_type))
                .with_header(header("Cache-Control", cache));
            if file.content_type.starts_with("text/html") {
                r.add_header(header("Content-Security-Policy", csp));
            }
            r
        }
        ("GET" | "HEAD", None) => Response::from_string("Nicht gefunden").with_status_code(404),
        _ => Response::from_string("Methode nicht erlaubt").with_status_code(405),
    }
    .with_header(header("X-Content-Type-Options", "nosniff"))
    .with_header(header("Referrer-Policy", "no-referrer"));
    println!("{method} {path} {}", response.status_code().0);
    if let Err(e) = request.respond(response) {
        eprintln!("failed to send response: {e}");
    }
}

/// Client address: the socket peer, or the first X-Forwarded-For entry when
/// running behind a trusted reverse proxy.
fn client_ip(peer: Option<std::net::IpAddr>, forwarded: Option<&str>, trust_proxy: bool) -> String {
    if trust_proxy
        && let Some(first) = forwarded.and_then(|f| f.split(',').next())
        && let Ok(ip) = first.trim().parse::<std::net::IpAddr>()
    {
        return ip.to_string();
    }
    peer.map(|ip| ip.to_string()).unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_ip_uses_forwarded_only_when_trusted() {
        let peer = Some("10.0.0.5".parse().unwrap());
        assert_eq!(client_ip(peer, Some("203.0.113.7, 10.0.0.1"), true), "203.0.113.7");
        assert_eq!(client_ip(peer, Some("203.0.113.7"), false), "10.0.0.5");
        assert_eq!(client_ip(peer, Some("not an ip"), true), "10.0.0.5");
        assert_eq!(client_ip(None, None, false), "unknown");
    }
}
