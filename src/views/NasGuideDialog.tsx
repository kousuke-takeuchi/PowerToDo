import { X } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { useMotionTiming } from "../motion";

export type NasGuideDialogProps = { open: boolean; onClose?: () => void };

const code: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 };

/** 仕様 §4.3 の 5 ステップ。 */
const steps: { title: string; body: React.ReactNode }[] = [
  {
    title: "WebDAV Server を入れる",
    body: "Synology DSM のパッケージセンターで「WebDAV Server」をインストールし、HTTP (ポート 5005) を有効にします。",
  },
  {
    title: "共有フォルダを作る",
    body: (
      <>
        共有フォルダ <span style={code}>powertodo</span> を作ります。
      </>
    ),
  },
  {
    title: "専用ユーザーを作る",
    body: (
      <>
        PowerToDo 専用のユーザーを作り、<span style={code}>powertodo</span> だけ読み書き可、ほかのフォルダは「アクセスなし」にします。
      </>
    ),
  },
  {
    title: "NAS に Tailscale を入れる",
    body: "パッケージセンターで「Tailscale」をインストールしてログインし、NAS の名前を控えます。",
  },
  {
    title: "このアプリでつなぐ",
    body: (
      <>
        同期先で「Synology NAS」を選び、NAS と同じアカウントで Tailscale にログインします。サーバー URL に{" "}
        <span style={{ ...code, whiteSpace: "nowrap" }}>{"http://<NAS の名前>:5005/powertodo/"}</span> とユーザー名・パスワードを入れて「確かめる」を押します。
      </>
    ),
  },
];

/**
 * NAS の準備手順 (仕様 §4.3 の 5 ステップ)。設定ダイアログ / 初回起動の上に重ねる。
 * 親が位置を持つ要素 (AppShell の overlay、Onboarding の根) の中に置く: 全面を覆う absolute。
 * scrim クリック / Esc / 閉じるで onClose。
 */
export function NasGuideDialog({ open, onClose }: NasGuideDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const { reduced, t } = useMotionTiming();
  useEscLayer(open, () => onClose?.());

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !ref.current?.contains(active)) restoreRef.current = active;
    ref.current?.focus();
    return () => {
      const el = restoreRef.current;
      if (el?.isConnected) el.focus();
    };
  }, [open]);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="nas-guide"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={t(0.15)}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose?.();
          }}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--color-scrim)",
            pointerEvents: "auto",
            fontFamily: "var(--font-body)",
          }}
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label="NAS の準備手順"
            tabIndex={-1}
            initial={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -8 }}
            transition={t(0.18)}
            style={{
              boxSizing: "border-box",
              width: 520,
              maxWidth: "calc(100% - 32px)",
              maxHeight: "calc(100% - 32px)",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
              padding: "20px 24px",
              background: "var(--color-bg)",
              borderRadius: 12,
              boxShadow: "var(--shadow-dialog)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <h2 style={{ flex: 1, margin: 0, fontSize: 18, lineHeight: "26px", fontWeight: 700 }}>NAS の準備手順</h2>
              <Button variant="icon" icon={X} ariaLabel="閉じる" onClick={onClose} />
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {steps.map((s, i) => (
                <li key={s.title} style={{ display: "flex", gap: "var(--space-3)" }}>
                  <span
                    aria-hidden
                    style={{
                      flex: "0 0 auto",
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      display: "grid",
                      placeItems: "center",
                      background: "var(--color-bg-hover)",
                      color: "var(--color-text-secondary)",
                      fontSize: 11,
                      lineHeight: "16px",
                      fontWeight: 700,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, lineHeight: "19px", fontWeight: 600 }}>{s.title}</span>
                    <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>{s.body}</span>
                  </div>
                </li>
              ))}
            </ol>
            <div style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-secondary)" }}>
              Tailscale の管理画面で端末の承認が有効なときは、<span style={code}>powertodo-</span> で始まるこの PC の端末を承認してください。キーの有効期限が切れたら、もう一度ログインします。
              アドレスは <span style={code}>https</span> ではなく <span style={code}>http</span> で書きます。
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button onClick={onClose}>閉じる</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
