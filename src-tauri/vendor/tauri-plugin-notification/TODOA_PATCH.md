# Todoa local patch of official tauri-plugin-notification 2.5.1

Upstream source: crates.io tauri-plugin-notification 2.5.1 (MIT OR Apache-2.0; licenses retained).

Changes: desktop show waits for notify-rust show and propagates Error::Delivery; Windows permission_state uses ToastNotifier.Setting; app ID detection covers Cargo target-triple directories and matches availability/send identity. No new IPC commands or permissions. Desktop call is run in spawn_blocking by Todoa and awaited before SQLite marking. This cannot prove the user saw a toast. Keep this patch reviewed when upgrading; remove only when upstream provides equivalent awaited errors and availability.

Windows Setting HRESULT 0x80070490 is surfaced as PermissionState::Prompt (unknown) rather than Granted; the UI exposes unknown availability and actual Show must succeed before marking. Other query errors propagate; explicit blocked settings map to Denied.
