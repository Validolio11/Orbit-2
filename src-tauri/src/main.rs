#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

// Existing, egui-free core stays in its original location.
#[path = "../../src/catalog.rs"]
mod catalog;
#[path = "../../src/install.rs"]
mod install;
#[path = "../../src/launcher.rs"]
mod launcher;
#[path = "../../src/model.rs"]
mod model;
#[path = "../../src/platform/mod.rs"]
mod platform;
#[path = "../../src/storage.rs"]
mod storage;
#[path = "../../src/updater.rs"]
mod updater;

mod commands;
mod icons;
mod startup;
mod state;
mod wheel;

fn main() {
    if let Err(error) = startup::run() {
        eprintln!("Orbit: {error}");
        std::process::exit(1);
    }
}
