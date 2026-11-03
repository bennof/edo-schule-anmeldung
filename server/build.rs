//! Embeds the built public SPA (apps/public/dist, `make build`) into the
//! binary, so one file serves the registration page and the API. Without a
//! build only the API is served (development: the SPA runs on Vite).

use std::path::{Path, PathBuf};
use std::{env, fs};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = env::var_os("PUBLIC_DIST").map_or_else(|| manifest.join("../apps/public/dist"), PathBuf::from);
    println!("cargo:rerun-if-env-changed=PUBLIC_DIST");
    println!("cargo:rerun-if-changed={}", dist.display());

    let mut files = Vec::new();
    if dist.join("index.html").is_file() {
        collect(&dist, &dist, &mut files);
    } else {
        println!(
            "cargo:warning=public SPA not built ({}): only the API is served",
            dist.display()
        );
    }
    files.sort();

    let entries: String = files
        .iter()
        .map(|(key, path)| format!("    ({key:?}, include_bytes!({:?})),\n", path.display().to_string()))
        .collect();
    let code = format!(
        "/// Files of the public SPA: path below the root, content.\npub static FILES: &[(&str, &[u8])] = &[\n{entries}];\n"
    );
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("public_files.rs"),
        code,
    )
    .unwrap();
}

fn collect(root: &Path, dir: &Path, files: &mut Vec<(String, PathBuf)>) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, files);
        } else {
            let key = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            files.push((key, path.canonicalize().unwrap()));
        }
    }
}
