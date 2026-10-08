#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Read once by the allocator at launch (Info.plist `LSEnvironment`); agents,
    // shells and helpers started from here keep their own default.
    std::env::remove_var("MallocLargeCache");
    if std::env::args().any(|argument| argument == "--mcp-browser") {
        std::process::exit(sirus_code_lib::run_browser_mcp());
    }
    if std::env::args().any(|argument| argument == "--mcp-computer") {
        std::process::exit(sirus_code_lib::run_computer_mcp());
    }
    sirus_code_lib::run()
}
