# ライセンス

PowerToDo が直接使う主なライブラリと、そのライセンスである。版とライセンスは、`package-lock.json` と `src-tauri/Cargo.lock` で入る版の、パッケージの記載から写した (2026-11-19)。依存の依存は載せていない。

## 画面 (npm)

| ライブラリ | 版 | ライセンス |
|---|---|---|
| react, react-dom | 19.3.0 | MIT |
| @tauri-apps/api | 2.12.3 | Apache-2.0 OR MIT |
| @tauri-apps/plugin-dialog | 2.8.2 | MIT OR Apache-2.0 |
| @tauri-apps/plugin-opener | 2.7.1 | MIT OR Apache-2.0 |
| lucide-react | 1.56.0 | ISC |
| motion | 14.2.0 | MIT |
| tailwindcss | 4.3.3 | MIT |

開発だけに使うもの: vite 8.3.4 (MIT)、typescript 6.0.3 (Apache-2.0)、storybook 10.6.2 (MIT)。

## 中身 (Rust)

| ライブラリ | 版 | ライセンス |
|---|---|---|
| tauri | 2.12.3 | Apache-2.0 OR MIT |
| tauri-plugin-notification | 2.7.0 | Apache-2.0 OR MIT |
| tauri-plugin-updater | 2.14.0 | Apache-2.0 OR MIT |
| tauri-plugin-autostart | 2.7.0 | Apache-2.0 OR MIT |
| tauri-plugin-single-instance | 2.5.4 | Apache-2.0 OR MIT |
| tauri-plugin-window-state | 2.5.0 | Apache-2.0 OR MIT |
| calamine (xlsx の読み込み) | 0.36.1 | MIT |
| rust_xlsxwriter (xlsx の書き出し) | 0.99.1 | MIT OR Apache-2.0 |
| chrono | 0.4.45 | MIT OR Apache-2.0 |
| rrule (繰り返し) | 0.14.0 | MIT OR Apache-2.0 |
| notify (ファイルの見張り) | 8.2.0 | CC0-1.0 |
| reqwest | 0.13.5 | MIT OR Apache-2.0 |
| rustls | 0.23.46 | Apache-2.0 OR ISC OR MIT |
| tokio | 1.53.3 | MIT |
| sha2 | 0.10.9 | MIT OR Apache-2.0 |
| quick-xml | 0.42.0 | MIT |
| keyring | 4.2.0 | MIT OR Apache-2.0 |

## Tailscale (Go)

| ライブラリ | 版 | ライセンス |
|---|---|---|
| tailscale.com | v1.104.1 | BSD 3-Clause |

サイドカー `powertodo-tailnet` (デスクトップ) と `libtailnet.a` (iOS) に入る。

## このアプリ

このリポジトリは非公開である。PowerToDo 自体のライセンスは決めていない。
