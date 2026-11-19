# 技術

| 層 | 使うもの | 役割 |
|---|---|---|
| 器 | Tauri 2 | デスクトップ (macOS、Windows、Linux) と iOS のアプリにする。画面と Rust をつなぐ |
| 画面 | React 19、TypeScript、Tailwind CSS 4、lucide-react、motion | 画面、アイコン、動き |
| 画面の確認 | Storybook 10 | 画面一覧 (`design/storyboard.md`) を触って確かめる |
| 中身 | Rust | データ、同期、通知、OS との違い |
| xlsx | calamine (読む)、rust_xlsxwriter (書く) | プロジェクトと共通ファイル |
| 繰り返し | rrule | RRULE から次の期限を求める |
| ファイルの見張り | notify | Excel での変更を見つける |
| 通信 | reqwest、rustls | WebDAV と Google Drive |
| 秘密 | keyring | NAS のパスワードと Google のトークンを OS のキーチェーンに置く |
| Tailscale | tailscale.com (Go) | NAS へつなぐ。デスクトップはサイドカー、iOS はライブラリ |
| iOS の追加 | Swift のプラグイン (`src-tauri/plugins/ios`) | Google ログイン (`ASWebAuthenticationSession`)、Quick Look、回線の切り替えの検知 |
| テスト | `cargo test`、`node --test` | Rust と、画面の純粋な処理 |
| CI | GitHub Actions | `ci.yml` (web: 型、ビルド、Storybook の確かめ、`test:web`、`test:docs`。Ubuntu、Windows、macOS: Go のテスト、サイドカーのビルド、`cargo test` と `cargo build`。macOS では iOS ターゲットの `cargo check` も)、`release.yml` (配布物) |

ライセンスは [ライセンス](third-party-licenses.md) にある。
