#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|argument| argument == "--mcp-browser") {
        std::process::exit(sirus_code_lib::run_browser_mcp());
    }
    if std::env::args().any(|argument| argument == "--mcp-computer") {
        std::process::exit(sirus_code_lib::run_computer_mcp());
    }
    sirus_code_lib::run()
}
