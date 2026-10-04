//! Microsoft Graph access with the daemon identity (client credentials).

use serde_json::Value;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use ureq::Agent;

const GRAPH: &str = "https://graph.microsoft.com/v1.0";
const MAX_RETRIES: u32 = 3;

pub struct Graph {
    agent: Agent,
    tenant_id: String,
    client_id: String,
    client_secret: String,
    token: Mutex<Option<(String, Instant)>>,
}

enum Body<'a> {
    None,
    Json(&'a Value),
    Raw(&'a [u8], &'a str),
}

pub struct GraphResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

impl GraphResponse {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn json(&self) -> Result<Value, String> {
        serde_json::from_slice(&self.body).map_err(|e| format!("invalid JSON from Graph: {e}"))
    }

    /// Error text for logs: status and Graph error code, never the request.
    pub fn error_text(&self) -> String {
        let code = self
            .json()
            .ok()
            .and_then(|v| v["error"]["code"].as_str().map(str::to_string))
            .unwrap_or_default();
        format!("Graph {} {}", self.status, code)
    }
}

impl Graph {
    pub fn new(tenant_id: &str, client_id: &str, client_secret: &str) -> Graph {
        let agent: Agent = Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(30)))
            .build()
            .into();
        Graph {
            agent,
            tenant_id: tenant_id.to_string(),
            client_id: client_id.to_string(),
            client_secret: client_secret.to_string(),
            token: Mutex::new(None),
        }
    }

    fn token(&self) -> Result<String, String> {
        let mut cached = self.token.lock().map_err(|_| "token lock poisoned")?;
        if let Some((token, expires)) = cached.as_ref()
            && *expires > Instant::now() + Duration::from_secs(60)
        {
            return Ok(token.clone());
        }
        let url = format!("https://login.microsoftonline.com/{}/oauth2/v2.0/token", self.tenant_id);
        let mut res = self
            .agent
            .post(&url)
            .send_form([
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("grant_type", "client_credentials"),
                ("scope", "https://graph.microsoft.com/.default"),
            ])
            .map_err(|e| format!("token request failed: {e}"))?;
        let body: Value = res.body_mut().read_json().map_err(|e| format!("token response: {e}"))?;
        let token = body["access_token"]
            .as_str()
            .ok_or_else(|| format!("token request failed: {}", body["error"].as_str().unwrap_or("unknown")))?
            .to_string();
        let lifetime = body["expires_in"].as_u64().unwrap_or(3600);
        *cached = Some((token.clone(), Instant::now() + Duration::from_secs(lifetime)));
        Ok(token)
    }

    /// Sends a request; `path` is relative to the v1.0 root. Retries throttling.
    pub fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
        if_match: Option<&str>,
    ) -> Result<GraphResponse, String> {
        self.send(method, path, body.map_or(Body::None, Body::Json), if_match)
    }

    /// PUT of raw bytes, e.g. a file upload (simple upload, up to 4 MB).
    pub fn put_bytes(&self, path: &str, bytes: &[u8], content_type: &str) -> Result<GraphResponse, String> {
        self.send("PUT", path, Body::Raw(bytes, content_type), None)
    }

    fn send(&self, method: &str, path: &str, body: Body, if_match: Option<&str>) -> Result<GraphResponse, String> {
        let url = format!("{GRAPH}{path}");
        for attempt in 0.. {
            let bearer = format!("Bearer {}", self.token()?);
            let result = match (method, &body) {
                ("GET", _) => self.agent.get(&url).header("Authorization", &bearer).call(),
                ("DELETE", _) => self.agent.delete(&url).header("Authorization", &bearer).call(),
                ("PATCH", Body::Json(b)) => {
                    let mut req = self.agent.patch(&url).header("Authorization", &bearer);
                    if let Some(etag) = if_match {
                        req = req.header("If-Match", etag);
                    }
                    req.send_json(b)
                }
                ("POST", Body::Json(b)) => self.agent.post(&url).header("Authorization", &bearer).send_json(b),
                ("PUT", Body::Raw(bytes, content_type)) => self
                    .agent
                    .put(&url)
                    .header("Authorization", &bearer)
                    .header("Content-Type", *content_type)
                    .send(*bytes),
                _ => return Err(format!("unsupported request {method}")),
            };
            let mut res = result.map_err(|e| format!("Graph request failed: {e}"))?;
            let status = res.status().as_u16();
            if (status == 429 || status == 503) && attempt < MAX_RETRIES {
                let wait = res
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(2u64.pow(attempt));
                thread::sleep(Duration::from_secs(wait));
                continue;
            }
            let header = |name: &str| {
                res.headers()
                    .get(name)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string)
            };
            let content_type = header("Content-Type");
            let body = res
                .body_mut()
                .with_config()
                .limit(20 * 1024 * 1024)
                .read_to_vec()
                .map_err(|e| format!("reading Graph response: {e}"))?;
            return Ok(GraphResponse {
                status,
                content_type,
                body,
            });
        }
        unreachable!()
    }
}
