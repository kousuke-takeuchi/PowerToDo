import type React from "react";
import { ChevronLeft, CloudOff, Ellipsis, LoaderCircle, Menu, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "./Button";
import type { SyncState } from "./SyncStatus";

export type MobileHeaderProps = {
  title: string;
  onMenu?: () => void;
  onMore?: () => void;
  sync?: SyncState;
  showBack?: boolean;
  /** showBack のときの戻るボタン。 */
  onBack?: () => void;
  /** 指定すると title の代わりに表示する (M-03 のパンくず)。title は aria-label になる。 */
  breadcrumb?: React.ReactNode;
  /** 上の空き 47 (StatusBar) を、実機の上のセーフエリア (env(safe-area-inset-top)) に置き換える。 */
  safeArea?: boolean;
  /** 指定すると同期アイコンがボタンになり、押すと呼ぶ (今すぐ同期 / エラーのときは設定の同期を開く: 呼び出し側が決める)。同期済みのときも小さな更新アイコンを出す。同期先がない (off) ときは出さない。 */
  onSync?: () => void;
}; // 右端に同期アイコン (syncing 回転 / offline・error アイコン / synced 非表示)

const syncIcon = {
  syncing: { Icon: LoaderCircle, color: "var(--color-text-secondary)", label: "同期中", spin: true },
  offline: { Icon: CloudOff, color: "var(--color-text-secondary)", label: "オフライン", spin: false },
  error: { Icon: TriangleAlert, color: "var(--color-danger)", label: "同期エラー", spin: false },
} as const;
/** onSync があるときだけ出す、同期済みの更新アイコン。 */
const syncedIcon = { Icon: RefreshCw, color: "var(--color-text-secondary)", label: "今すぐ同期", spin: false } as const;

/** モバイルのヘッダー (pen の MobileHeader): StatusBar 47 (空) + Row 44。同期アイコンは More の左 (synced / off は出さない)。 */
export function MobileHeader({ title, onMenu, onMore, sync, showBack, onBack, breadcrumb, safeArea, onSync }: MobileHeaderProps) {
  const s = sync === "syncing" || sync === "offline" || sync === "error" ? syncIcon[sync] : onSync && sync === "synced" ? syncedIcon : undefined;
  return (
    <header style={{ display: "flex", flexDirection: "column", background: "var(--color-bg)", fontFamily: "var(--font-body)", flex: "0 0 auto" }}>
      <div aria-hidden style={{ height: safeArea ? "env(safe-area-inset-top)" : 47 }} />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "6px 12px" }}>
        {showBack ? (
          <Button variant="icon" icon={ChevronLeft} ariaLabel="戻る" onClick={onBack} />
        ) : (
          <Button variant="icon" icon={Menu} ariaLabel="メニュー" onClick={onMenu} />
        )}
        {breadcrumb ? (
          <div aria-label={title} style={{ flex: 1, minWidth: 0 }}>
            {breadcrumb}
          </div>
        ) : (
          <h1 style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 20, lineHeight: "29px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            {title}
          </h1>
        )}
        {s && onSync ? (
          // タップで今すぐ同期。押す範囲は 44 (見た目は 18 のまま)。同期中は押しても重ねない (呼び出し側が busy を見る)
          <button
            type="button"
            aria-label={s.label}
            onClick={onSync}
            style={{
              display: "grid",
              placeItems: "center",
              flex: "0 0 auto",
              width: 44,
              height: 44,
              margin: "-6px -4px -6px 0",
              padding: 0,
              border: 0,
              background: "none",
              color: s.color,
              cursor: "pointer",
            }}
          >
            <span aria-hidden style={{ display: "inline-flex", animation: s.spin ? "spin 1s linear infinite" : undefined }}>
              <s.Icon size={18} />
            </span>
          </button>
        ) : (
          s && (
            // pen の HeaderSync は x 318 (More の 28 左) にあるので右に 2px の余白を取る
            <span
              role="img"
              aria-label={s.label}
              style={{
                display: "inline-flex",
                flex: "0 0 auto",
                marginRight: 2,
                color: s.color,
                animation: s.spin ? "spin 1s linear infinite" : undefined,
              }}
            >
              <s.Icon size={18} />
            </span>
          )
        )}
        <Button variant="icon" icon={Ellipsis} ariaLabel="その他" onClick={onMore} />
      </div>
    </header>
  );
}
