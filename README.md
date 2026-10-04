# Todoa

Windows x64 Tauri 2 + React + TypeScript 项目。STEP 5 已建立 SQLite Migration 和数据库启动门。当前窗口只显示启动验证结果，尚无待办业务功能。

```powershell
pnpm install --frozen-lockfile
pnpm build
cargo test --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
pnpm lint
pnpm test
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
pnpm tauri dev --config src-tauri/tauri.dev.conf.json --target x86_64-pc-windows-msvc
```

开发配置使用 `com.todoa.desktop.dev`；正式配置使用 `com.todoa.desktop`。隔离测试时显式传入 `src-tauri/tauri.test.conf.json`。权限拒绝验收另用 `src-tauri/tauri.acl-test.conf.json`。请勿用正式 identifier 对真实用户数据运行测试。

开发顺序与验收以根目录执行手册及 `docs/PROJECT_STATE.md` 为准。
