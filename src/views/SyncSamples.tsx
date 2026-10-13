import { SyncStatus } from "../components/SyncStatus";
import type { SyncState } from "../components/SyncStatus";

const samples: { name: string; state: SyncState; at?: string }[] = [
  { name: "同期中", state: "syncing" },
  { name: "同期済み", state: "synced", at: "09:41" },
  { name: "オフライン", state: "offline", at: "09:41" },
  { name: "エラー", state: "error" },
];

/** 同期状態の見本 (D-09d)。サイドバー最下部の SyncStatus を状態ごとに並べる。 */
export function SyncSamples() {
  return (
    <div
      style={{
        width: 1440,
        height: 900,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ width: 320, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {samples.map((s) => (
          <div key={s.state} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}>{s.name}</span>
            <div style={{ width: 248, background: "var(--color-bg-sidebar)" }}>
              <SyncStatus state={s.state} lastSyncedAt={s.at} />
            </div>
          </div>
        ))}
        <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-secondary)" }}>
          サイドバー最下部に常設。同期中はアイコンが回転。エラーはクリックで再試行。
        </span>
      </div>
    </div>
  );
}
