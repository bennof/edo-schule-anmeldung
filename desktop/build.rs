//! Embeds the built secretariat SPA (apps/secretariat/dist) into the binary,
//! like server/build.rs does with the registration page.

use std::path::{Path, PathBuf};
use std::{env, fs};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = env::var_os("SECRETARIAT_DIST")
        .map_or_else(|| manifest.join("../apps/secretariat/dist"), PathBuf::from);
    println!("cargo:rerun-if-env-changed=SECRETARIAT_DIST");
    println!("cargo:rerun-if-changed={}", dist.display());

    let mut files = Vec::new();
    if dist.join("index.html").is_file() {
        collect(&dist, &dist, &mut files);
    } else {
        println!(
            "cargo:warning=secretariat SPA not built ({}): the window stays empty",
            dist.display()
        );
    }
    files.sort();
    let entries: String = files
        .iter()
        .map(|(key, path)| {
            format!(
                "    ({key:?}, include_bytes!({:?})),\n",
                path.display().to_string()
            )
        })
        .collect();
    let code = format!("pub static FILES: &[(&str, &[u8])] = &[\n{entries}];\n");
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("secretariat_files.rs"),
        code,
    )
    .unwrap();

    tauri_build::build();
}

fn collect(root: &Path, dir: &Path, files: &mut Vec<(String, PathBuf)>) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, files);
        } else {
            let key = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            files.push((key, path.canonicalize().unwrap()));
        }
    }
}
