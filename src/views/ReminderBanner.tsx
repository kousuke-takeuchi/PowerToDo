import type React from "react";
import { useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Bell, ChevronDown, X } from "lucide-react";
import { formatDue, snoozeChoices } from "../app/dates";
import { useEscLayer } from "../app/layers";
import { Collapse } from "../motion";
import type { ReminderItem } from "../types/model";
import { useOutsideClose } from "./crossList";

export type ReminderBannerProps = {
  items: ReminderItem[];
  /** 完了にする。 */
  onDone: (item: ReminderItem) => void;
  /** `until` (ローカルの YYYY-MM-DDTHH:MM) にもう一度知らせる。 */
  onSnooze: (item: ReminderItem, until: string) => void;
  /** そのタスクの詳細を開く。 */
  onOpen: (item: ReminderItem) => void;
  /** 帯から消すだけ。 */
  onDismiss: (item: ReminderItem) => void;
  onDismissAll: () => void;
  today: string;
  /** 「明日」の時刻 "HH:MM" (設定の通知時刻)。既定 09:00。 */
  notifyTime?: string;
};

const keyOf = (r: ReminderItem) => `${r.project}/${r.no}/${r.code}`;

const smallButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: "4px 12px",
  border: 0,
  borderRadius: "var(--radius)",
  background: "var(--color-bg-hover)",
  color: "var(--color-text-primary)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  cursor: "pointer",
  flex: "0 0 auto",
};

const menuItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "6px 12px",
  border: 0,
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  color: "var(--color-text-primary)",
  textAlign: "left",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

/** 「後で」: 10 分 / 1 時間 / 明日 9:00 のポップオーバー。外側クリックと Esc で閉じる。 */
function SnoozeButton({ item, notifyTime, onSnooze }: { item: ReminderItem; notifyTime: string; onSnooze: ReminderBannerProps["onSnooze"] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscLayer(open, () => setOpen(false));
  useOutsideClose(ref, open, () => setOpen(false));
  return (
    <div ref={ref} style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`「${item.title}」を後で通知`}
        className="hover:brightness-95"
        style={smallButton}
        onClick={() => setOpen((v) => !v)}
      >
        後で
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="あとで通知する時間"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            zIndex: 10,
            minWidth: 120,
            padding: "4px 0",
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            boxShadow: "var(--shadow-popover)",
          }}
        >
          {snoozeChoices(new Date(), notifyTime).map((c) => (
            <button
              key={c.label}
              type="button"
              role="menuitem"
              className="bg-transparent hover:bg-[var(--color-bg-hover)]"
              style={menuItem}
              onClick={() => {
                setOpen(false);
                onSnooze(item, c.until);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 「<タスク名> · <プロジェクト> · 期限 10/20 15:00」 (期限が無ければ期限の部分を省く)。 */
function Summary({ item, today }: { item: ReminderItem; today: string }) {
  const rest = [item.project, ...(item.due ? [`期限 ${formatDue(item.due, item.dueTime, today)}`] : [])].join(" · ");
  // 狭いときは折り返す (省略するとプロジェクトや期限が読めなくなる)
  return (
    <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontSize: 13, lineHeight: "19px" }}>
      <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{item.title}</span>
      <span style={{ color: "var(--color-text-secondary)" }}>{` · ${rest}`}</span>
    </span>
  );
}

function Row({ item, today, notifyTime, onDone, onSnooze, onOpen, onDismiss }: Omit<ReminderBannerProps, "items" | "onDismissAll"> & { item: ReminderItem; notifyTime: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minHeight: 28 }}>
      <Summary item={item} today={today} />
      <button type="button" className="hover:brightness-95" style={smallButton} onClick={() => onDone(item)} aria-label={`「${item.title}」を完了`}>
        完了
      </button>
      <SnoozeButton item={item} notifyTime={notifyTime} onSnooze={onSnooze} />
      <button type="button" className="hover:brightness-95" style={smallButton} onClick={() => onOpen(item)} aria-label={`「${item.title}」を開く`}>
        開く
      </button>
      <button
        type="button"
        aria-label={`「${item.title}」のリマインダーを閉じる`}
        className="bg-transparent hover:bg-[var(--color-bg-hover)]"
        style={{ display: "grid", placeItems: "center", width: 28, height: 28, padding: 0, border: 0, borderRadius: 6, color: "var(--color-text-secondary)", cursor: "pointer", flex: "0 0 auto" }}
        onClick={() => onDismiss(item)}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/**
 * リマインダーの帯 (仕様 §4.4)。FixBanner と同じ帯 (accent-soft, 下罫線)。AppShell の banner スロットに入れる。
 * 1 件なら 1 行、2 件以上は「N 件のリマインダー」の見出し + 各行 (既定は展開、見出しの矢印で畳める) + 「すべて閉じる」。
 */
export function ReminderBanner({ items, onDone, onSnooze, onOpen, onDismiss, onDismissAll, today, notifyTime = "09:00" }: ReminderBannerProps) {
  const [expanded, setExpanded] = useState(true);
  if (items.length === 0) return null;
  const rowProps = { today, notifyTime, onDone, onSnooze, onOpen, onDismiss };
  const bell = (
    <span style={{ display: "inline-flex", color: "var(--color-accent)", flex: "0 0 auto" }}>
      <Bell size={18} />
    </span>
  );
  return (
    <div
      role="region"
      aria-label="リマインダー"
      aria-live="polite"
      style={{
        padding: "10px 24px",
        background: "var(--color-accent-soft)",
        boxShadow: "inset 0 -1px 0 var(--color-border)",
        fontFamily: "var(--font-body)",
      }}
    >
      {items.length === 1 ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          {bell}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Row item={items[0]} {...rowProps} />
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            {bell}
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="bg-transparent"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: 0, border: 0, fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", fontWeight: 600, color: "var(--color-text-primary)", cursor: "pointer" }}
            >
              {`${items.length} 件のリマインダー`}
              <ChevronDown size={14} style={{ transform: expanded ? undefined : "rotate(-90deg)" }} />
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onDismissAll}
              className="bg-transparent hover:underline"
              style={{ padding: 0, border: 0, fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)", cursor: "pointer" }}
            >
              すべて閉じる
            </button>
          </div>
          <AnimatePresence initial={false}>
            {expanded && (
              <Collapse key="list" duration={0.15}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 6, paddingLeft: 18 + 12 }}>
                  <AnimatePresence initial={false}>
                    {items.map((item) => (
                      <Collapse key={keyOf(item)} duration={0.15}>
                        <Row item={item} {...rowProps} />
                      </Collapse>
                    ))}
                  </AnimatePresence>
                </div>
              </Collapse>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
