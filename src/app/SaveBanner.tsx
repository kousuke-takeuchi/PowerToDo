import { TriangleAlert, X } from "lucide-react";
import { Button } from "../components/Button";

const band = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "10px 24px",
  background: "var(--color-accent-soft)",
  boxShadow: "inset 0 -1px 0 var(--color-border)",
  fontFamily: "var(--font-body)",
} as const;

const text = { flex: 1, minWidth: 0, fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)", overflowWrap: "anywhere" } as const;

/** 保存失敗 (save-status: error) の帯。FixBanner と同じ見た目。再試行は retry_save (保存済みになれば save-status: saved で消える)。 */
export function SaveBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" style={band}>
      <span style={{ display: "inline-flex", color: "var(--color-danger)", flex: "0 0 auto" }}>
        <TriangleAlert size={18} />
      </span>
      <span style={text}>保存できません: {message}</span>
      <Button variant="secondary" onClick={onRetry}>
        再試行
      </Button>
    </div>
  );
}

/** コマンドの失敗などを短く知らせる帯 (簡易トースト)。tone="info" は成功の補足 (別プロジェクトに追加した、など)。 */
export function NoticeBanner({ message, tone = "error", onDismiss }: { message: string; tone?: "error" | "info"; onDismiss?: () => void }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} style={band}>
      {tone === "error" && (
        <span style={{ display: "inline-flex", color: "var(--color-danger)", flex: "0 0 auto" }}>
          <TriangleAlert size={18} />
        </span>
      )}
      <span style={text}>{message}</span>
      <Button variant="icon" icon={X} ariaLabel="閉じる" onClick={onDismiss} />
    </div>
  );
}
