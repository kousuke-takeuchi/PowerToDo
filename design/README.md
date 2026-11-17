# design

OpenDesign のデザインと storyboard メモ。

- `opendesign/`: 全画面のデザイン。OpenDesign の PowerToDo プロジェクトと同じ中身
  - `screens/<画面No>.html`: 画面ごとの HTML (例 `D-01.html`、ダークは `D-01-dark.html`、D-04 期限切れなしは `D-04-no-overdue.html`)
  - `screens/components.html`: 共通コンポーネント (Checkbox、TaskRow など)
  - `tokens.css`: デザイントークン (ライトとダーク)
  - `index.html`: 画面一覧
- `storyboard.md`: 画面一覧、操作項目、遷移表
- `../design.pen` (リポジトリ直下): 移行元の pen.dev ファイル (Phase 0 で作成)。2026-11-17 に `opendesign/` へ移行済み。保存用で、編集しない

OpenDesign 側で直したら、プロジェクトのフォルダ (OpenDesign の `get_project` が返す `resolvedDir`) から `rsync -a <resolvedDir>/ design/opendesign/` でリポジトリへ戻す。逆向きは `rsync -a design/opendesign/ <resolvedDir>/`。
