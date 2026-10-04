//! Structural check of submitted form data against the form definition
//! (format in packages/forms/schema/form.schema.json): only known item ids,
//! JSON types matching the field types, repeat limits. The full validation
//! with conditions runs in the browser (packages/forms runtime); the
//! secretariat reviews every application anyway.

use serde_json::{Map, Value};

const MAX_TEXT: usize = 2000;
const MAX_LIST: usize = 100;
const MAX_DEPTH: usize = 8;

/// `application_id`: file references must point into this application's folder.
pub fn check(form: &Value, data: &Value, application_id: &str) -> Result<(), String> {
    let items: Vec<&Value> = form["sections"]
        .as_array()
        .ok_or("form has no sections")?
        .iter()
        .flat_map(|s| s["items"].as_array().into_iter().flatten())
        .collect();
    let groups = form["groups"].as_object();
    check_scope(&items, data, groups, "", 0, application_id)
}

fn check_scope(
    items: &[&Value],
    data: &Value,
    groups: Option<&Map<String, Value>>,
    path: &str,
    depth: usize,
    app: &str,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err(format!("{path}: nested too deeply"));
    }
    let object = data
        .as_object()
        .ok_or_else(|| format!("{}: object expected", display(path)))?;
    for (key, value) in object {
        let at = if path.is_empty() {
            key.clone()
        } else {
            format!("{path}.{key}")
        };
        let item = items
            .iter()
            .find(|i| i["id"].as_str() == Some(key))
            .ok_or_else(|| format!("{at}: unknown field"))?;
        match item["kind"].as_str() {
            Some("field") if item["type"] == "file" => check_files(item, value, &at, app)?,
            Some("field") => check_value(item["type"].as_str().unwrap_or(""), value, &at)?,
            Some("group") => {
                let def = item["group"]
                    .as_str()
                    .and_then(|g| groups?.get(g))
                    .ok_or_else(|| format!("{at}: unknown group"))?;
                let inner: Vec<&Value> = def["items"].as_array().into_iter().flatten().collect();
                if item.get("repeat").is_some() {
                    let list = value.as_array().ok_or_else(|| format!("{at}: list expected"))?;
                    let max = item["repeat"]["maxItems"].as_u64().map_or(MAX_LIST, |m| m as usize);
                    if list.len() > max.min(MAX_LIST) {
                        return Err(format!("{at}: too many entries"));
                    }
                    for (i, entry) in list.iter().enumerate() {
                        check_scope(&inner, entry, groups, &format!("{at}[{i}]"), depth + 1, app)?;
                    }
                } else {
                    check_scope(&inner, value, groups, &at, depth + 1, app)?;
                }
            }
            _ => return Err(format!("{at}: invalid item")),
        }
    }
    Ok(())
}

fn check_value(field_type: &str, value: &Value, at: &str) -> Result<(), String> {
    let ok = match field_type {
        "text" | "email" | "phone" | "date" | "select" | "searchselect" => {
            value.as_str().is_some_and(|s| s.chars().count() <= MAX_TEXT)
        }
        "integer" | "year" => value.as_i64().is_some(),
        "boolean" => value.is_boolean(),
        "multiselect" => value
            .as_array()
            .is_some_and(|l| l.len() <= MAX_LIST && l.iter().all(|v| v.as_str().is_some_and(|s| s.len() <= MAX_TEXT))),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(format!("{at}: invalid value for {field_type}"))
    }
}

/// File fields hold references `{id, name, contentType, size}` (a list when
/// `multiple`); ids must belong to the application's upload folder.
fn check_files(item: &Value, value: &Value, at: &str, app: &str) -> Result<(), String> {
    let refs: Vec<&Value> = if item["multiple"] == true {
        value
            .as_array()
            .ok_or_else(|| format!("{at}: list of files expected"))?
            .iter()
            .collect()
    } else {
        vec![value]
    };
    if refs.len() > MAX_LIST {
        return Err(format!("{at}: too many files"));
    }
    let prefix = format!("{app}/");
    for r in refs {
        let valid = r["id"].as_str().is_some_and(|id| {
            id.strip_prefix(&prefix)
                .is_some_and(|file| !file.is_empty() && !file.contains('/') && !file.starts_with('.'))
        }) && r["name"].as_str().is_some_and(|n| n.chars().count() <= 255)
            && r["contentType"]
                .as_str()
                .is_some_and(|c| crate::uploads::ALLOWED.contains(&c))
            && r["size"].is_u64();
        if !valid {
            return Err(format!("{at}: invalid file reference"));
        }
    }
    Ok(())
}

fn display(path: &str) -> &str {
    if path.is_empty() { "data" } else { path }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn form() -> Value {
        json!({
            "formatVersion": 1, "title": "T",
            "groups": {
                "person": { "items": [{ "kind": "field", "id": "name", "type": "text", "label": "N" }] },
                "schule": { "items": [{ "kind": "field", "id": "von", "type": "year", "label": "V" }] }
            },
            "sections": [{ "id": "s", "title": "S", "items": [
                { "kind": "field", "id": "nachname", "type": "text", "label": "N" },
                { "kind": "field", "id": "sprachen", "type": "multiselect", "label": "S", "options": [{ "key": "en", "value": "E" }] },
                { "kind": "field", "id": "ok", "type": "boolean", "label": "O" },
                { "kind": "group", "id": "mutter", "group": "person", "label": "M" },
                { "kind": "group", "id": "schulen", "group": "schule", "label": "S", "repeat": { "maxItems": 2 } }
            ]}]
        })
    }

    #[test]
    fn accepts_matching_data() {
        let data = json!({ "nachname": "A", "sprachen": ["en"], "ok": true, "mutter": { "name": "B" }, "schulen": [{ "von": 2020 }] });
        assert_eq!(check(&form(), &data, "7"), Ok(()));
        assert_eq!(check7(&json!({})), Ok(()));
    }

    #[test]
    fn rejects_unknown_keys_and_wrong_types() {
        assert!(check7(&json!({ "evil": 1 })).unwrap_err().contains("unknown field"));
        assert!(
            check7(&json!({ "mutter": { "x": "y" } }))
                .unwrap_err()
                .contains("mutter.x")
        );
        assert!(check7(&json!({ "nachname": 5 })).is_err());
        assert!(check7(&json!({ "ok": "yes" })).is_err());
        assert!(check7(&json!({ "sprachen": "en" })).is_err());
        assert!(
            check7(&json!({ "schulen": [{ "von": "x" }] }))
                .unwrap_err()
                .contains("schulen[0].von")
        );
        assert!(
            check7(&json!({ "schulen": [{}, {}, {}] }))
                .unwrap_err()
                .contains("too many")
        );
        assert!(check7(&json!({ "nachname": "x".repeat(MAX_TEXT + 1) })).is_err());
        assert!(check7(&json!([1])).is_err());
    }
}

#[cfg(test)]
fn check7(data: &Value) -> Result<(), String> {
    check(&tests_form(), data, "7")
}

#[cfg(test)]
fn tests_form() -> Value {
    serde_json::json!({
        "formatVersion": 1, "title": "T",
        "groups": {
            "person": { "items": [{ "kind": "field", "id": "name", "type": "text", "label": "N" }] },
            "schule": { "items": [{ "kind": "field", "id": "von", "type": "year", "label": "V" }] }
        },
        "sections": [{ "id": "s", "title": "S", "items": [
            { "kind": "field", "id": "nachname", "type": "text", "label": "N" },
            { "kind": "field", "id": "sprachen", "type": "multiselect", "label": "S", "options": [{ "key": "en", "value": "E" }] },
            { "kind": "field", "id": "ok", "type": "boolean", "label": "O" },
            { "kind": "field", "id": "foto", "type": "file", "label": "F", "role": "photo" },
            { "kind": "field", "id": "docs", "type": "file", "label": "D", "multiple": true },
            { "kind": "group", "id": "mutter", "group": "person", "label": "M" },
            { "kind": "group", "id": "schulen", "group": "schule", "label": "S", "repeat": { "maxItems": 2 } }
        ]}]
    })
}

#[cfg(test)]
mod file_tests {
    use super::*;
    use serde_json::json;

    fn r(id: &str) -> Value {
        json!({ "id": id, "name": "a.jpg", "contentType": "image/jpeg", "size": 10 })
    }

    #[test]
    fn accepts_own_file_references() {
        assert_eq!(
            check7(&json!({ "foto": r("7/abc.jpg"), "docs": [r("7/d1.pdf"), r("7/d2.png")] })),
            Ok(())
        );
    }

    #[test]
    fn rejects_foreign_or_malformed_references() {
        assert!(check7(&json!({ "foto": r("8/abc.jpg") })).is_err());
        assert!(check7(&json!({ "foto": r("7/../8/x.jpg") })).is_err());
        assert!(check7(&json!({ "foto": r("7/") })).is_err());
        assert!(check7(&json!({ "docs": r("7/d1.pdf") })).is_err());
        assert!(check7(&json!({ "foto": { "id": "7/a.exe", "name": "a", "contentType": "application/x-msdownload", "size": 1 } })).is_err());
    }
}
