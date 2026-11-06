//! Local server on 127.0.0.1:8964: the embedded secretariat SPA and
//! `/svws-proxy`, which forwards to the SVWS server named in the
//! `X-SVWS-Target` header. School SVWS servers mostly use self-signed
//! certificates, so the proxy does not verify them.

use std::io::Read;
use std::thread;
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server};
use ureq::Agent;
use ureq::http;
use ureq::tls::TlsConfig;

include!(concat!(env!("OUT_DIR"), "/secretariat_files.rs"));

pub const PORT: u16 = 8964;
const PROXY: &str = "/svws-proxy";
/// request headers passed on to SVWS
const FORWARD: [&str; 3] = ["authorization", "content-type", "accept"];
const MAX_BODY: u64 = 50 * 1024 * 1024;

pub fn start(port: u16) -> Result<(), String> {
    let server = Server::http(("127.0.0.1", port))
        .map_err(|e| format!("Port {port} ist belegt – läuft die App bereits? ({e})"))?;
    let agent = agent();
    thread::spawn(move || {
        for request in server.incoming_requests() {
            let agent = agent.clone();
            thread::spawn(move || handle(request, port, &agent));
        }
    });
    Ok(())
}

fn agent() -> Agent {
    Agent::config_builder()
        .tls_config(TlsConfig::builder().disable_verification(true).build())
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(120)))
        .build()
        .new_agent()
}

fn handle(mut request: Request, port: u16, agent: &Agent) {
    // only our own window: blocks DNS rebinding from websites
    let host = header(&request, "host").unwrap_or_default();
    if host != format!("localhost:{port}") && host != format!("127.0.0.1:{port}") {
        let _ = request.respond(Response::empty(403));
        return;
    }
    let url = request.url().to_owned();
    if let Some(rest) = url
        .strip_prefix(PROXY)
        .filter(|r| r.is_empty() || r.starts_with(['/', '?']))
    {
        let response = proxy(&mut request, rest, agent).unwrap_or_else(|e| text(502, &e));
        let _ = request.respond(response);
    } else {
        let response = page(&request, &url);
        let _ = request.respond(response);
    }
}

fn header(request: &Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_owned())
}

fn text(status: u16, message: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(message)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "text/plain; charset=utf-8").unwrap())
}

/// Forwards one request to `X-SVWS-Target` + path and returns the answer.
fn proxy(
    request: &mut Request,
    path: &str,
    agent: &Agent,
) -> Result<Response<std::io::Cursor<Vec<u8>>>, String> {
    let target = header(request, "x-svws-target").ok_or("X-SVWS-Target fehlt")?;
    let target = target.trim_end_matches('/');
    if !(target.starts_with("https://") || target.starts_with("http://")) {
        return Err("X-SVWS-Target muss eine http(s)-Adresse sein".into());
    }
    let mut builder = http::Request::builder()
        .method(request.method().as_str())
        .uri(format!("{target}{path}"));
    for name in FORWARD {
        if let Some(value) = header(request, name) {
            builder = builder.header(name, value);
        }
    }
    let mut body = Vec::new();
    request
        .as_reader()
        .take(MAX_BODY)
        .read_to_end(&mut body)
        .map_err(|e| e.to_string())?;
    let sent = if matches!(request.method(), Method::Get | Method::Head) || body.is_empty() {
        agent.run(builder.body(()).map_err(|e| e.to_string())?)
    } else {
        agent.run(builder.body(body).map_err(|e| e.to_string())?)
    };
    let mut answer = sent.map_err(|e| format!("SVWS nicht erreichbar: {e}"))?;
    let status = answer.status().as_u16();
    let content_type = answer
        .headers()
        .get(http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let data = answer
        .body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_vec()
        .map_err(|e| e.to_string())?;
    let mut response = Response::from_data(data).with_status_code(status);
    if let Some(ct) = content_type {
        response.add_header(Header::from_bytes("Content-Type", ct).unwrap());
    }
    Ok(response)
}

/// The embedded SPA; unknown paths without extension get index.html.
fn page(request: &Request, url: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    if !matches!(request.method(), Method::Get | Method::Head) {
        return text(405, "Methode nicht erlaubt");
    }
    let path = url.split(['?', '#']).next().unwrap_or("");
    let Some((key, body)) = lookup(path) else {
        return text(404, "Nicht gefunden");
    };
    let cache = if key.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Response::from_data(body.to_vec())
        .with_header(Header::from_bytes("Content-Type", content_type(key)).unwrap())
        .with_header(Header::from_bytes("Cache-Control", cache).unwrap())
        .with_header(Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap())
}

fn lookup(path: &str) -> Option<(&'static str, &'static [u8])> {
    let key = path.trim_start_matches('/');
    let key = if key.is_empty() { "index.html" } else { key };
    let find = |k: &str| FILES.iter().find(|(f, _)| *f == k).copied();
    find(key).or_else(|| {
        (!key.rsplit('/').next().unwrap_or(key).contains('.'))
            .then(|| find("index.html"))
            .flatten()
    })
}

fn content_type(key: &str) -> &'static str {
    match key.rsplit_once('.').map(|(_, ext)| ext) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("ttf") => "font/ttf",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> Agent {
        Agent::config_builder()
            .http_status_as_error(false)
            .build()
            .new_agent()
    }

    #[test]
    fn serves_page_and_rejects_foreign_hosts() {
        start(28964).unwrap();
        let mut res = client().get("http://127.0.0.1:28964/").call().unwrap();
        if FILES.is_empty() {
            assert_eq!(res.status(), 404);
        } else {
            assert_eq!(res.status(), 200);
            assert!(
                res.body_mut()
                    .read_to_string()
                    .unwrap()
                    .contains("<div id=\"app\">")
            );
        }
        let res = client()
            .get("http://127.0.0.1:28964/")
            .header("Host", "evil.example:28964")
            .call()
            .unwrap();
        assert_eq!(res.status(), 403);
        assert_eq!(
            client()
                .get("http://127.0.0.1:28964/svws-proxy/x")
                .call()
                .unwrap()
                .status(),
            502
        );
        assert_eq!(
            client()
                .get("http://127.0.0.1:28964/assets/../../x.js")
                .call()
                .unwrap()
                .status(),
            404
        );
    }

    /// needs the SVWS server with a self-signed certificate (SVWS_URL, default https://localhost:8443)
    #[test]
    #[ignore]
    fn proxy_reaches_svws_with_self_signed_certificate() {
        start(28965).unwrap();
        let target = std::env::var("SVWS_URL").unwrap_or("https://localhost:8443".into());
        let mut res = client()
            .get("http://localhost:28965/svws-proxy/status/alive")
            .header("X-SVWS-Target", &target)
            .call()
            .unwrap();
        assert_eq!(
            res.status(),
            200,
            "{}",
            res.body_mut().read_to_string().unwrap_or_default()
        );
        // Basic auth is passed on: GymAbi test school, user Admin, empty password
        let res = client()
            .get("http://localhost:28965/svws-proxy/db/gymabi/schule/stammdaten")
            .header("X-SVWS-Target", &target)
            .header("Authorization", "Basic QWRtaW46")
            .call()
            .unwrap();
        assert_eq!(res.status(), 200);
        assert!(
            res.headers()
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap()
                .contains("json")
        );
    }
}
