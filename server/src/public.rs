//! The public SPA, embedded at build time (build.rs). Only the embedded
//! files can be served, so request paths never reach the file system.

include!(concat!(env!("OUT_DIR"), "/public_files.rs"));

pub struct File {
    pub content_type: &'static str,
    pub body: &'static [u8],
    /// file names under assets/ carry a content hash and never change
    pub immutable: bool,
}

/// Whether the binary contains the SPA (false when built without `make build`).
pub fn embedded() -> bool {
    !FILES.is_empty()
}

/// The file for a request path; paths without a file extension get
/// index.html (SPA routes), unknown files none.
pub fn lookup(path: &str) -> Option<File> {
    let key = path.trim_start_matches('/');
    let key = if key.is_empty() { "index.html" } else { key };
    let found = find(key).or_else(|| {
        let last = key.rsplit('/').next().unwrap_or(key);
        (!last.contains('.')).then(|| find("index.html")).flatten()
    })?;
    Some(File {
        content_type: content_type(found.0),
        body: found.1,
        immutable: found.0.starts_with("assets/"),
    })
}

fn find(key: &str) -> Option<(&'static str, &'static [u8])> {
    FILES.iter().find(|(k, _)| *k == key).copied()
}

fn content_type(key: &str) -> &'static str {
    match key.rsplit_once('.').map(|(_, ext)| ext) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("ttf") => "font/ttf",
        Some("woff2") => "font/woff2",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// Content-Security-Policy of the page; `frame_ancestors` decides who may
/// embed it (FRAME_ANCESTORS, e.g. the school's website).
pub fn csp(frame_ancestors: &str) -> String {
    format!(
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; \
         connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors {frame_ancestors}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_types() {
        assert_eq!(content_type("index.html"), "text/html; charset=utf-8");
        assert_eq!(content_type("assets/index-abc.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type("assets/DejaVuSans-x.ttf"), "font/ttf");
        assert_eq!(content_type("noext"), "application/octet-stream");
    }

    #[test]
    fn lookup_is_limited_to_embedded_files() {
        if !embedded() {
            assert!(lookup("/").is_none());
            return;
        }
        assert!(lookup("/").is_some_and(|f| f.content_type.starts_with("text/html") && !f.immutable));
        // SPA routes fall back to index.html, unknown files do not
        assert!(lookup("/fortsetzen").is_some_and(|f| f.content_type.starts_with("text/html")));
        assert!(lookup("/assets/nope.js").is_none());
        assert!(lookup("/../.env").is_none());
        assert!(lookup("/assets/../../.env").is_none());
        let asset = FILES.iter().find(|(k, _)| k.starts_with("assets/")).unwrap().0;
        assert!(lookup(&format!("/{asset}")).is_some_and(|f| f.immutable));
    }
}
