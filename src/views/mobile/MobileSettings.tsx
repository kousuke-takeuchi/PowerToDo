import type React from "react";
import { Bell, Calendar, ChevronRight, Cloud, Clock3, Folder, Palette, RefreshCw, User } from "lucide-react";
import { MobileHeader } from "../../components/MobileHeader";
import { MobileShell } from "./MobileShell";

type Icon = React.ComponentType<{ size?: number }>;
type Item = { icon: Icon; key: string; value: string };
type Group = { title: string; items: Item[] };

const groups: Group[] = [
  {
    title: "同期",
    items: [
      { icon: Cloud, key: "同期先", value: "Google Drive" },
      { icon: Cloud, key: "Google Drive", value: "接続済み" },
      { icon: RefreshCw, key: "最終同期", value: "09:41" },
      { icon: Folder, key: "Drive フォルダ", value: "PowerToDo/" },
    ],
  },
  {
    title: "通知",
    items: [
      { icon: Bell, key: "リマインダー", value: "許可" },
      { icon: Clock3, key: "既定のリマインダー", value: "期限と同時刻" },
    ],
  },
  {
    title: "外観",
    items: [
      { icon: Palette, key: "テーマ", value: "システム" },
      { icon: Calendar, key: "週の開始", value: "月曜" },
    ],
  },
  { title: "アカウント", items: [{ icon: User, key: "表示名", value: "たろう" }] },
];

/** M-07: 設定。同期 / 通知 / 外観 / アカウントのグループ (行 44)。ヘッダーの同期アイコンは cloud-off (オフラインの例)。タブは選択なし。 */
export function MobileSettings() {
  return (
    <MobileShell header={<MobileHeader title="設定" sync="offline" />} tab="none">
      <div style={{ padding: "0 16px" }}>
        {groups.map((g) => (
          <section key={g.title} style={{ paddingTop: 12 }}>
            <h2 style={{ margin: 0, fontSize: 12, lineHeight: "17px", fontWeight: 700, color: "var(--color-text-secondary)" }}>{g.title}</h2>
            {g.items.map(({ icon: Icon, key, value }) => (
              <button
                key={key}
                type="button"
                className="bg-transparent hover:bg-[var(--color-bg-hover)]"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "12px 0",
                  border: 0,
                  boxShadow: "inset 0 -1px 0 var(--color-border)",
                  fontFamily: "var(--font-body)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "inline-flex", color: "var(--color-text-secondary)", flex: "0 0 auto" }}>
                  <Icon size={18} />
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", color: "var(--color-text-primary)" }}>{key}</span>
                <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>{value}</span>
                <span style={{ display: "inline-flex", color: "var(--color-text-muted)", flex: "0 0 auto" }}>
                  <ChevronRight size={16} />
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </MobileShell>
  );
}
