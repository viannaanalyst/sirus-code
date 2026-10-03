fn main() {
    // The Speech framework bridge links Swift concurrency; the app needs the
    // OS Swift runtime directory on its rpath when built outside Xcode.
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    tauri_build::build()
}
