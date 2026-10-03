//! Public server: the only component the public SPA talks to.
//! It keeps no personal data; SharePoint is the persistent store.

use std::env;
use tiny_http::{Header, Method, Request, Response, Server};

fn main() {
    let addr = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_string());
    let server = Server::http(&addr).unwrap_or_else(|e| panic!("cannot bind {addr}: {e}"));
    println!("anmeldung-server listening on http://{addr}");

    for request in server.incoming_requests() {
        handle(request);
    }
}

fn handle(request: Request) {
    let (status, body) = route(request.method(), request.url());
    let response = Response::from_string(body)
        .with_status_code(status)
        .with_header(json_header());
    if let Err(e) = request.respond(response) {
        eprintln!("failed to send response: {e}");
    }
}

fn route(method: &Method, url: &str) -> (u16, String) {
    let path = url.split('?').next().unwrap_or(url);
    match (method, path) {
        (Method::Get, "/api/health") => (200, r#"{"status":"ok"}"#.to_string()),
        _ => (404, r#"{"error":"not found"}"#.to_string()),
    }
}

fn json_header() -> Header {
    Header::from_bytes("Content-Type", "application/json; charset=utf-8").expect("valid header")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_is_ok() {
        assert_eq!(route(&Method::Get, "/api/health"), (200, r#"{"status":"ok"}"#.to_string()));
    }

    #[test]
    fn unknown_paths_are_404() {
        assert_eq!(route(&Method::Get, "/api/nope").0, 404);
        assert_eq!(route(&Method::Post, "/api/health").0, 404);
    }
}
