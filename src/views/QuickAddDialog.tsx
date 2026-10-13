import { Bell, Calendar, ChevronDown, Ellipsis, Flag, Tag } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { Button } from "../components/Button";

export type QuickAddToken = { text: string; kind?: "date" | "priority" | "project" | "label" };

export type QuickAddDialogProps = {
  open: boolean;
  tokens: QuickAddToken[];
  project: string;
  section?: string;
  /** プロジェクトのドット色。未指定は muted。 */
  projectColor?: string;
  onClose?: () => void;
  // ---- 実アプリ用 (onSubmit を渡すと有効。無ければ絵コンテと同じ静的な見た目) ----
  /** 入力中の文字列。タスク名の行が本物の <input> になる。tokens は親が parse_quick_add の spans から渡す。 */
  text?: string;
  onChangeText?: (text: string) => void;
  /** Enter または「タスクを追加」ボタンで呼ぶ。空 / busy の間は呼ばない。 */
  onSubmit?: (text: string) => void;
  /** 追加中。ボタンを無効にする。 */
  busy?: boolean;
  /** 追加に失敗したときのメッセージ (ダイアログは開いたまま)。 */
  error?: string;
};

const tokenStyle = {
  date: { color: "var(--color-success)", background: "var(--color-bg-hover)" },
  priority: { color: "var(--color-priority-1)", background: "var(--color-accent-soft)" },
  project: { color: "var(--color-priority-3)", background: "var(--color-bg-hover)" },
  label: { color: "var(--color-text-secondary)", background: "var(--color-bg-hover)" },
} as const;

type Icon = React.ComponentType<{ size?: number }>;

function ToolbarChip({ icon: Icon, label, color = "var(--color-text-secondary)" }: { icon: Icon; label?: string; color?: string }) {
  return (
    <button
      type="button"
      aria-label={label ?? "その他"}
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "4px 8px",
        border: 0,
        boxShadow: "inset 0 0 0 1px var(--color-border)",
        borderRadius: 6,
        fontFamily: "var(--font-body)",
        fontSize: 13,
        lineHeight: "19px",
        color,
        cursor: "pointer",
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

/**
 * クイック追加ダイアログ (D-02)。AppShell の overlay スロットに入れる。
 * 背面の scrim (#00000055) + 幅 560 のダイアログ (上 160)。キャンセル / scrim クリック / Esc で onClose。保存はしない。
 * トークンは kind で色分けし、ツールバーの 4 チップも同じトークンから文言を取る。
 * 開いたら「説明」入力にフォーカスし、閉じたら開く前にフォーカスしていた要素へ戻す。
 * scrim は pointerEvents: "auto" (AppShell の overlay ラッパーは "none")。
 */
export function QuickAddDialog({
  open,
  tokens,
  project,
  section,
  projectColor = "var(--color-text-muted)",
  onClose,
  text = "",
  onChangeText,
  onSubmit,
  busy,
  error,
}: QuickAddDialogProps) {
  const live = onSubmit !== undefined;
  const submit = () => {
    if (live && !busy && text.trim()) onSubmit(text);
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    // StrictMode の再実行でダイアログ内の要素を戻り先にしないよう、外側の要素だけ覚える。
    const inside = inputRef.current?.closest('[role="dialog"]')?.contains(active) ?? false;
    if (active instanceof HTMLElement && !inside) restoreRef.current = active;
    inputRef.current?.focus();
    return () => {
      const el = restoreRef.current;
      if (el?.isConnected) el.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const of = (kind: NonNullable<QuickAddToken["kind"]>) => tokens.find((t) => t.kind === kind)?.text;
  const dateText = of("date");
  const priorityText = of("priority");
  const labelText = of("label");
  const priorityNo = priorityText?.match(/[1-4]/)?.[0];

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 160,
        background: "var(--color-scrim)",
        pointerEvents: "auto",
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="クイック追加"
        style={{
          boxSizing: "border-box",
          width: 560,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          padding: "var(--space-4)",
          background: "var(--color-bg)",
          borderRadius: 12,
          boxShadow: "var(--shadow-dialog)",
          color: "var(--color-text-primary)",
        }}
      >
        {live ? (
          <>
            <input
              ref={inputRef}
              aria-label="タスク名"
              value={text}
              placeholder="タスク名 (例: 牛乳を買う 明日 p1 #買い物 @急ぎ)"
              onChange={(e) => onChangeText?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="placeholder:text-[var(--color-text-muted)]"
              style={{
                boxSizing: "border-box",
                width: "100%",
                padding: 0,
                border: 0,
                outline: "none",
                background: "transparent",
                fontFamily: "var(--font-body)",
                fontSize: 16,
                lineHeight: "23px",
                color: "var(--color-text-primary)",
              }}
            />
            {tokens.some((t) => t.kind) && (
              <div role="group" aria-label="認識した項目" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", fontSize: 13, lineHeight: "19px" }}>
                {tokens
                  .filter((t) => t.kind)
                  .map((t, i) => (
                    <span key={i} style={{ padding: "1px 4px", borderRadius: 4, whiteSpace: "pre", ...tokenStyle[t.kind!] }}>
                      {t.text}
                    </span>
                  ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div role="group" aria-label="タスク名" style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: 16, lineHeight: "23px" }}>
              {tokens.map((t, i) =>
                t.kind ? (
                  <span key={i} style={{ padding: "1px 4px", borderRadius: 4, whiteSpace: "pre", ...tokenStyle[t.kind] }}>
                    {t.text}
                  </span>
                ) : (
                  <span key={i} style={{ whiteSpace: "pre", color: "var(--color-text-primary)" }}>
                    {t.text}
                  </span>
                ),
              )}
              <span aria-hidden style={{ width: 2, height: 20, background: "var(--color-text-primary)", flex: "0 0 auto" }} />
            </div>
            <input
              ref={inputRef}
              aria-label="説明"
              placeholder="説明"
              className="placeholder:text-[var(--color-text-muted)]"
              style={{
                boxSizing: "border-box",
                width: "100%",
                padding: 0,
                border: 0,
                outline: "none",
                background: "transparent",
                fontFamily: "var(--font-body)",
                fontSize: 14,
                lineHeight: "20px",
                color: "var(--color-text-primary)",
              }}
            />
          </>
        )}
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <ToolbarChip icon={Calendar} label={dateText ?? "期限"} color={dateText ? "var(--color-success)" : undefined} />
          <ToolbarChip
            icon={Flag}
            label={priorityNo ? `P${priorityNo}` : "優先度"}
            color={priorityNo ? `var(--color-priority-${priorityNo})` : undefined}
          />
          <ToolbarChip icon={Bell} label="リマインダー" />
          <ToolbarChip icon={Tag} label={labelText ?? "ラベル"} />
          <ToolbarChip icon={Ellipsis} />
        </div>
        {error && (
          <div role="alert" style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-danger)" }}>
            {error}
          </div>
        )}
        <div style={{ height: 1, background: "var(--color-border)" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            type="button"
            aria-label="プロジェクトを選ぶ"
            className="bg-transparent hover:bg-[var(--color-bg-hover)]"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-1)",
              padding: "4px 8px",
              border: 0,
              borderRadius: 6,
              fontFamily: "var(--font-body)",
              fontSize: 13,
              lineHeight: "19px",
              color: "var(--color-text-primary)",
              cursor: "pointer",
            }}
          >
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: projectColor, flex: "0 0 auto" }} />
            {section ? `${project} / ${section}` : project}
            <ChevronDown size={14} color="var(--color-text-secondary)" />
          </button>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="secondary" onClick={onClose}>
              キャンセル
            </Button>
            <Button onClick={live ? submit : undefined} disabled={live && (busy || !text.trim())}>
              タスクを追加
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
