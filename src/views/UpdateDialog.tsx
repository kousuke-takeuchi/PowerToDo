import { useEffect, useId, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { useMotionTiming } from "../motion";
import type { UpdateProgress } from "../types/model";
import { hintStyle } from "./SyncFields";
import { LiveText } from "./SyncPane";

export type UpdateDialogProps = {
  open: boolean;
  /** いまの版 ("0.1.0"。v は付けない)。 */
  currentVersion: string;
  /** 新しい版 ("0.2.0")。 */
  version: string;
  /** release の本文 (Markdown はそのままプレーンテキストで出す)。 */
  notes?: string;
  /** 「今すぐ更新」を押してから終わるまで。 true のあいだは閉じられない。 */
  installing?: boolean;
  /** `update-progress` の最新。 */
  progress?: UpdateProgress | null;
  /** 更新の失敗 (日本語の文。そのまま出す)。 */
  error?: string | null;
  /** Windows では、インストーラーが開く旨を添える。無ければ `navigator.userAgent` で決める。 */
  windows?: boolean;
  onInstall?: () => void;
  /** 「あとで」「閉じる」・Esc・背景のクリック。更新中は呼ばない。 */
  onClose?: () => void;
};

const MB = 1024 * 1024;

function isWindows(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");
}

/** ダウンロードの割合 (0〜100)。総量が分からなければ null。 */
function percent(p: UpdateProgress): number | null {
  if (!p.total || p.total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor(((p.received ?? 0) / p.total) * 100)));
}

/**
 * 進行中の状態の文。`announce` は読み上げ用で、ダウンロードは 10% (総量が無ければ 10 MB) ごとにしか変えない
 * (進み具合ごとに読み上げると、後ろの読み上げを溜めてしまう)。
 */
export function installingText(progress: UpdateProgress | null | undefined, announce = false): string {
  if (!progress) return "準備しています…";
  if (progress.phase === "waitingSync") return "同期の完了を待っています…";
  if (progress.phase === "installing") return "入れ替えています…";
  const pct = percent(progress);
  if (pct !== null) return `ダウンロード中 ${announce ? Math.floor(pct / 10) * 10 : pct}%`;
  const mb = (progress.received ?? 0) / MB;
  return `ダウンロード中 ${announce ? Math.floor(mb / 10) * 10 : mb.toFixed(1)} MB`;
}

const DATA_KEPT = "データはそのままです";

/**
 * 更新ダイアログ (リリースの仕様 §4.2)。AppShell の overlay スロットに入れる (NasGuideDialog と同じ: 親が位置を持つ要素の中で全面を覆う)。
 * 状態の文は読み上げ領域 (`LiveText`) に出し、要素は置いたまま文だけ変える。進行中は Esc・背景・ボタンで閉じない。
 */
export function UpdateDialog({
  open,
  currentVersion,
  version,
  notes,
  installing = false,
  progress,
  error,
  windows,
  onInstall,
  onClose,
}: UpdateDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const { reduced, t } = useMotionTiming();
  const showWindows = windows ?? isWindows();
  const close = () => {
    if (!installing) onClose?.();
  };
  // Esc は更新中も受けて捨てる (下の設定ダイアログまで閉じないように)。
  useEscLayer(open, close);

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

  // 押したボタンが無効になる / 入れ替わるので、フォーカスをダイアログに戻す (body に落とさない)。
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open, installing, error]);

  const failed = !installing && !!error;
  const pct = installing && progress?.phase === "downloading" ? percent(progress) : null;
  const visible = installing ? installingText(progress) : failed ? error : "";
  // Rust の文が既に「データはそのままです」で終わっているときは、重ねて出さない
  const addKept = failed && !error.includes(DATA_KEPT);
  const announce = installing ? installingText(progress, true) : failed ? (addKept ? `${error} ${DATA_KEPT}` : error) : "";

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="update"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={t(0.15)}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
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
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -8 }}
            transition={t(0.18)}
            style={{
              boxSizing: "border-box",
              width: 480,
              maxWidth: "calc(100% - 32px)",
              maxHeight: "calc(100% - 32px)",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
              padding: "20px 24px",
              background: "var(--color-bg)",
              borderRadius: 12,
              boxShadow: "var(--shadow-dialog)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          >
            <h2 id={titleId} style={{ margin: 0, fontSize: 18, lineHeight: "26px", fontWeight: 700 }}>
              新しいバージョンがあります
            </h2>
            <div style={{ fontSize: 14, lineHeight: "20px", fontWeight: 600 }}>
              v{currentVersion} → v{version}
            </div>
            {notes && notes.trim() !== "" && (
              <div
                role="region"
                aria-label="更新内容"
                tabIndex={0}
                style={{
                  boxSizing: "border-box",
                  maxHeight: 200,
                  overflowY: "auto",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "var(--color-bg-hover)",
                  fontSize: 12,
                  lineHeight: "18px",
                  color: "var(--color-text-secondary)",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {notes}
              </div>
            )}
            {showWindows && !failed && <div style={hintStyle}>インストーラーが開き、終わるとアプリがもう一度起動します</div>}
            <LiveText text={announce} />
            {(installing || failed) && (
              <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                <div style={{ fontSize: 13, lineHeight: "19px", color: failed ? "var(--color-danger)" : "var(--color-text-primary)" }}>{visible}</div>
                {addKept && <div style={hintStyle}>{DATA_KEPT}</div>}
                {pct !== null && (
                  <div style={{ height: 4, borderRadius: 2, background: "var(--color-bg-hover)", overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--color-accent)" }} />
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
              {failed ? (
                <>
                  <Button variant="secondary" onClick={onClose}>
                    閉じる
                  </Button>
                  <Button onClick={onInstall}>もう一度更新</Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={onClose} disabled={installing}>
                    あとで
                  </Button>
                  <Button onClick={onInstall} disabled={installing}>
                    今すぐ更新
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
