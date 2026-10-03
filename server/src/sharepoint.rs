//! SharePoint list and asset access for the public server. Column names
//! follow packages/sharepoint/src/schema.ts.

use crate::graph::Graph;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::Mutex;

pub const CONFIG: &str = "Config";
pub const ASSETS: &str = "Assets";
pub const APPOINTMENTS: &str = "Appointments";
pub const FORMS: &str = "Forms";
pub const PROCEDURES: &str = "Procedures";

pub struct Item {
    pub id: String,
    pub etag: String,
    pub fields: Map<String, Value>,
}

impl Item {
    pub fn text(&self, field: &str) -> Option<&str> {
        self.fields
            .get(field)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
    }

    pub fn bool(&self, field: &str) -> bool {
        self.fields
            .get(field)
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }
}

pub enum Update {
    Done,
    /// eTag mismatch: the item was changed concurrently
    Conflict,
    NotFound,
}

pub struct Site {
    graph: Graph,
    site_id: String,
    list_ids: Mutex<HashMap<String, String>>,
}

impl Site {
    pub fn new(graph: Graph, site_id: &str) -> Site {
        Site {
            graph,
            site_id: site_id.to_string(),
            list_ids: Mutex::new(HashMap::new()),
        }
    }

    fn base(&self) -> String {
        format!("/sites/{}", self.site_id)
    }

    /// Resolves a list by name. Addresses the list directly, so it also works
    /// with list-level grants only (no site-wide read).
    fn list_id(&self, name: &str) -> Result<String, String> {
        if let Some(id) = self.list_ids.lock().map_err(|_| "lock poisoned")?.get(name) {
            return Ok(id.clone());
        }
        let path = format!("{}/lists/{}?$select=id", self.base(), encode(name));
        let res = self.graph.request("GET", &path, None, None)?;
        if !res.ok() {
            return Err(format!("list {name}: {}", res.error_text()));
        }
        let id = res.json()?["id"]
            .as_str()
            .ok_or_else(|| format!("list {name}: no id"))?
            .to_string();
        self.list_ids
            .lock()
            .map_err(|_| "lock poisoned")?
            .insert(name.to_string(), id.clone());
        Ok(id)
    }

    /// Lists items, optionally filtered with an OData expression on indexed fields.
    pub fn list_items(&self, list: &str, filter: Option<&str>) -> Result<Vec<Item>, String> {
        let mut path = format!(
            "{}/lists/{}/items?$expand=fields&$top=500",
            self.base(),
            self.list_id(list)?
        );
        if let Some(f) = filter {
            path.push_str("&$filter=");
            path.push_str(&encode(f));
        }
        let mut items = Vec::new();
        let mut next = Some(path);
        while let Some(p) = next.take() {
            let res = self.graph.request("GET", &p, None, None)?;
            if !res.ok() {
                return Err(res.error_text());
            }
            let page = res.json()?;
            items.extend(
                page["value"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(to_item),
            );
            next = page["@odata.nextLink"]
                .as_str()
                .and_then(|l| l.strip_prefix("https://graph.microsoft.com/v1.0"))
                .map(str::to_string);
        }
        Ok(items)
    }

    pub fn get_item(&self, list: &str, id: &str) -> Result<Option<Item>, String> {
        let path = format!(
            "{}/lists/{}/items/{}?$expand=fields",
            self.base(),
            self.list_id(list)?,
            id
        );
        let res = self.graph.request("GET", &path, None, None)?;
        match res.status {
            404 => Ok(None),
            _ if res.ok() => Ok(to_item(&res.json()?)),
            _ => Err(res.error_text()),
        }
    }

    /// Updates fields only if the item still has the given eTag.
    pub fn update_fields(
        &self,
        list: &str,
        id: &str,
        fields: &Value,
        etag: &str,
    ) -> Result<Update, String> {
        let path = format!(
            "{}/lists/{}/items/{}/fields",
            self.base(),
            self.list_id(list)?,
            id
        );
        let res = self
            .graph
            .request("PATCH", &path, Some(fields), Some(etag))?;
        match res.status {
            412 | 409 => Ok(Update::Conflict),
            404 => Ok(Update::NotFound),
            _ if res.ok() => Ok(Update::Done),
            _ => Err(res.error_text()),
        }
    }

    /// Asset content and content type; None if the key does not exist.
    pub fn get_asset(&self, key: &str) -> Result<Option<(String, Vec<u8>)>, String> {
        let path = format!(
            "{}/lists/{}/drive/root:/{}:/content",
            self.base(),
            self.list_id(ASSETS)?,
            key
        );
        let res = self.graph.request("GET", &path, None, None)?;
        match res.status {
            404 => Ok(None),
            _ if res.ok() => {
                let ct = res
                    .content_type
                    .clone()
                    .unwrap_or_else(|| "application/octet-stream".to_string());
                Ok(Some((ct, res.body)))
            }
            _ => Err(res.error_text()),
        }
    }
}

fn to_item(v: &Value) -> Option<Item> {
    Some(Item {
        id: v["id"].as_str()?.to_string(),
        etag: v["eTag"].as_str().unwrap_or_default().to_string(),
        fields: v["fields"].as_object()?.clone(),
    })
}

/// Percent-encodes everything except RFC 3986 unreserved characters.
pub fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_filters() {
        assert_eq!(
            encode("fields/State eq 'available'"),
            "fields%2FState%20eq%20%27available%27"
        );
    }
}
