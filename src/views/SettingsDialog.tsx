import { Bell, Calendar, Cloud, Download, Folder, Keyboard, Palette, User } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionTiming } from "../motion";
import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { Segmented } from "../components/Segmented";
import { AccountPane, DataPane, DateTimePane, Desc, KeyboardPane, LaterPane, NotificationsPane, Row, Section } from "./SettingsPanes";
import type { AccountPaneProps, DataPaneProps, DateTimePaneProps, NotificationsPaneProps } from "./SettingsPanes";
import { NasGuideDialog } from "./NasGuideDialog";
import { NasFields, syncTargetOptions } from "./SyncFields";
import { isNasConnected } from "../app/syncText";
import { SyncPane } from "./SyncPane";
import type { SyncPaneProps } from "./SyncPane";
import { UpdatesPane } from "./UpdatesPane";
import type { UpdatesPaneProps } from "./UpdatesPane";

export type SyncTarget = "google" | "nas" | "none";
export type SettingsPane = "account" | "sync" | "data" | "notifications" | "appearance" | "datetime" | "keyboard" | "updates";
export type SettingsDialogProps = {
  open: boolean;
  initialTarget?: SyncTarget;
  connected?: boolean;
  onClose?: () => void;
  // ---- 実アプリ用 (全部 optional。無ければ Storybook と同じ見た目だけの挙動) ----
  /** 最初に開くペイン。既定は「同期」。 */
  initialPane?: SettingsPane;
  /** 「同期」ペインの先頭に「実装前で表示のみ」の注記を出す。 */
  syncPlaceholder?: boolean;
  /** 「同期」ペインの実データ (src/app/useSync.ts)。渡すと絵コンテ用の内部状態の代わりにこれで動く。無ければ従来の見た目だけの挙動。 */
  syncPane?: SyncPaneProps;
  /** 「データ」ペインに渡す値とハンドラ (src/app/useSettingsPanes.ts)。無ければ見た目だけ。 */
  dataPane?: DataPaneProps;
  /** 「アカウント」ペインに渡す値とハンドラ。無ければ見た目だけ。 */
  accountPane?: AccountPaneProps;
  /** 「通知」ペイン。無ければ従来の「実装予定」の表示。 */
  notificationsPane?: NotificationsPaneProps;
  /** 「日付と時刻」ペイン。無ければ従来の「実装予定」の表示。 */
  datetimePane?: DateTimePaneProps;
  /** 「アップデート」ペイン (src/app/useUpdates.ts)。渡したときだけ左の一覧に「アップデート」が出る。 */
  updatesPane?: UpdatesPaneProps;
};

type Icon = React.ComponentType<{ size?: number }>;

const navItems: { pane: SettingsPane; label: string; icon: Icon }[] = [
  { pane: "account", label: "アカウント", icon: User },
  { pane: "sync", label: "同期", icon: Cloud },
  { pane: "data", label: "データ", icon: Folder },
  { pane: "notifications", label: "通知", icon: Bell },
  { pane: "appearance", label: "外観", icon: Palette },
  { pane: "datetime", label: "日付と時刻", icon: Calendar },
  { pane: "keyboard", label: "キーボード", icon: Keyboard },
  { pane: "updates", label: "アップデート", icon: Download },
];

const titles: Record<SyncTarget, string> = { google: "Google Drive", nas: "Synology NAS (WebDAV)", none: "同期" };
const CACHE_PATH = "~/Library/Application Support/PowerToDo/data/";

function StatusRow({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: "var(--color-success)", flex: "0 0 auto" }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}>{text}</span>
      <Button variant="secondary" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}

/**
 * 設定ダイアログ (D-09 / D-09c / D-09e / D-09f)。AppShell の overlay スロットに入れる。
 * 左の SettingsNav 180 (「同期」が選択) + 右の SettingsBody。「同期先」セグメントで本文が切り替わり、NAS の接続前は高さ 640、それ以外は 560。
 * 接続状態は同期先ごとに内部で持つ (Google でログイン / 接続 → 接続済み、ログアウト / 切断 → 未接続。絵コンテの操作確認用で実際には通信しない)。
 * scrim クリック / Esc で onClose。scrim は pointerEvents: "auto" (AppShell の overlay ラッパーは "none")。
 */
export function SettingsDialog({
  open,
  initialTarget = "google",
  connected = false,
  onClose,
  initialPane = "sync",
  syncPlaceholder,
  syncPane,
  dataPane,
  accountPane,
  notificationsPane,
  datetimePane,
  updatesPane,
}: SettingsDialogProps) {
  const [pane, setPane] = useState<SettingsPane>(initialPane);
  const [target, setTarget] = useState<SyncTarget>(initialTarget);
  const [conn, setConn] = useState<Record<SyncTarget, boolean>>({ google: false, nas: false, none: false, [initialTarget]: connected });
  const [guideOpen, setGuideOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const inside = dialogRef.current?.contains(active) ?? false;
    if (active instanceof HTMLElement && !inside) restoreRef.current = active;
    dialogRef.current?.focus();
    return () => {
      const el = restoreRef.current;
      if (el?.isConnected) el.focus();
    };
  }, [open]);

  useEscLayer(open, () => onClose?.());
  const { reduced, t } = useMotionTiming();

  // 閉じたら開き直したときのために初期状態へ戻す (閉じるアニメーション中の表示は固まった要素なので影響しない)。
  useEffect(() => {
    if (open) return;
    setPane(initialPane);
    setTarget(initialTarget);
    setConn({ google: false, nas: false, none: false, [initialTarget]: connected });
    setGuideOpen(false);
  }, [open, initialPane, initialTarget, connected]);

  const set = (t: SyncTarget, v: boolean) => setConn((c) => ({ ...c, [t]: v }));
  const isConnected = conn[target];
  const liveBackend = syncPane?.settings?.backend;
  const nasForm = pane === "sync" && (syncPane ? liveBackend === "nas" && !isNasConnected(syncPane.settings) : target === "nas" && !isConnected);
  const heading = syncPane ? titles[liveBackend === "gdrive" ? "google" : (liveBackend ?? "none")] : titles[target];

  const localCache = (
    <Section label="ローカルキャッシュ">
      <Desc>{CACHE_PATH}</Desc>
      <Row>
        <Button variant="secondary">フォルダを開く</Button>
      </Row>
    </Section>
  );

  const syncNow = (desc: string, folderLabel: string) => (
    <Section label="同期">
      <Desc>{desc}</Desc>
      <Row>
        <Button>今すぐ同期</Button>
        <Button variant="secondary">{folderLabel}</Button>
      </Row>
    </Section>
  );

  let middle: React.ReactNode = null;
  if (target === "google" && !isConnected) {
    middle = (
      <>
        <Section label="接続状態">
          <Desc>Google アカウントでログインすると、タスクのファイルが Google Drive の PowerToDo フォルダに同期されます。</Desc>
          <Row>
            <Button onClick={() => set("google", true)}>Google でログイン</Button>
          </Row>
        </Section>
        <Section label="同期">
          <Desc>ログインすると同期を開始できます。</Desc>
        </Section>
      </>
    );
  } else if (target === "google") {
    middle = (
      <>
        <Section label="接続状態">
          <StatusRow text="ログイン中 · user@example.com" action="ログアウト" onAction={() => set("google", false)} />
        </Section>
        {syncNow("最終同期: 今日 09:41 · Drive フォルダ: PowerToDo/", "Drive フォルダを変更")}
      </>
    );
  } else if (target === "nas" && !isConnected) {
    middle = (
      <>
        <Section label="接続">
          <NasFields />
          <Row>
            <Button variant="secondary">接続テスト</Button>
            <Button onClick={() => set("nas", true)}>接続</Button>
          </Row>
          <Desc>
            NAS 側で「WebDAV Server」パッケージを有効にし、HTTPS を推奨します。外出先から使うには QuickConnect / DDNS か VPN が必要です。パスワードは OS のキーチェーンに保存されます。
          </Desc>
        </Section>
        <Section label="同期">
          <Desc>接続すると同期を開始できます。</Desc>
        </Section>
      </>
    );
  } else if (target === "nas") {
    middle = (
      <>
        <Section label="接続状態">
          <StatusRow text="接続中 · https://nas.local:5006 · powertodo" action="切断" onAction={() => set("nas", false)} />
        </Section>
        {syncNow("最終同期: 今日 09:41 · フォルダ: /todo/PowerToDo/", "フォルダを変更")}
      </>
    );
  }

  // 開閉: scrim は 150ms でフェード、ダイアログは 180ms で scale 0.96 / y -8 から。最初から開いている描画 (Storybook) では動かさない。
  return (
    <>
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="settings"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={t(0.15)}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose?.();
          }}
          style={{
            boxSizing: "border-box",
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--color-scrim)",
            pointerEvents: "auto",
            fontFamily: "var(--font-body)",
          }}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="設定"
            tabIndex={-1}
            initial={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -8 }}
            transition={t(0.18)}
            style={{
              boxSizing: "border-box",
              width: "min(760px, calc(100vw - 32px))",
              height: nasForm ? 640 : 560,
              display: "flex",
              overflow: "hidden",
              background: "var(--color-bg)",
              borderRadius: 12,
              boxShadow: "var(--shadow-dialog)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          >
            <nav
              aria-label="設定の項目"
              style={{
                boxSizing: "border-box",
                flex: "0 0 auto",
                width: "min(180px, 30vw)",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "16px 8px",
                background: "var(--color-bg-sidebar)",
              }}
            >
              <div style={{ fontSize: 16, lineHeight: "23px", fontWeight: 700, color: "var(--color-text-primary)" }}>設定</div>
              {navItems.filter((n) => n.pane !== "updates" || updatesPane).map(({ pane: p, label, icon: I }) => {
                const active = p === pane;
                return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setPane(p)}
                  aria-current={active ? "page" : undefined}
                  className={active ? undefined : "bg-transparent hover:bg-[var(--color-bg-hover)]"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "6px 8px",
                    border: 0,
                    borderRadius: 6,
                    background: active ? "var(--color-bg-hover)" : undefined,
                    fontFamily: "var(--font-body)",
                    fontSize: 13,
                    lineHeight: "19px",
                    color: "var(--color-text-primary)",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "inline-flex", color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}>
                    <I size={16} />
                  </span>
                  {label}
                </button>
                );
              })}
            </nav>
            <div
              style={{
                boxSizing: "border-box",
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
                padding: "20px 24px",
                ...(syncPane ? { overflowY: "auto" } : {}),
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18, lineHeight: "26px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                {pane === "sync" ? heading : navItems.find((n) => n.pane === pane)?.label}
              </h2>
              {pane === "sync" && syncPane && <SyncPane {...syncPane} onOpenGuide={() => setGuideOpen(true)} />}
              {pane === "sync" && !syncPane && (
                <>
                  {syncPlaceholder && <Desc>同期は Phase 4 で実装予定。この画面は表示のみ</Desc>}
                  <Section label="同期先">
                    <Segmented options={[...syncTargetOptions]} value={target} onChange={setTarget} />
                  </Section>
                  {middle}
                  {localCache}
                </>
              )}
              {pane === "account" && <AccountPane {...accountPane} />}
              {pane === "data" && <DataPane {...dataPane} />}
              {pane === "keyboard" && <KeyboardPane />}
              {pane === "notifications" && (notificationsPane ? <NotificationsPane {...notificationsPane} /> : <LaterPane pane={pane} />)}
              {pane === "datetime" && (datetimePane ? <DateTimePane {...datetimePane} /> : <LaterPane pane={pane} />)}
              {pane === "appearance" && <LaterPane pane={pane} />}
              {pane === "updates" && updatesPane && <UpdatesPane {...updatesPane} />}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    {syncPane && <NasGuideDialog open={open && guideOpen} onClose={() => setGuideOpen(false)} />}
    </>
  );
}
