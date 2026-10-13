import { TriangleAlert, X } from "lucide-react";
import { Button } from "../components/Button";

export type ConflictBannerProps = { fileName: string; conflictName: string; onOpen?: () => void; onClose?: () => void };

/** 競合バナー (D-09b)。FixBanner と同じ帯 (accent-soft, 下罫線)。AppShell の banner スロットに入れる。 */
export function ConflictBanner({ fileName, conflictName, onOpen, onClose }: ConflictBannerProps) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "10px 24px",
        background: "var(--color-accent-soft)",
        boxShadow: "inset 0 -1px 0 var(--color-border)",
        fontFamily: "var(--font-body)",
      }}
    >
      <span style={{ display: "inline-flex", color: "var(--color-accent)", flex: "0 0 auto" }}>
        <TriangleAlert size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}>
        {`「${fileName}」が別の端末でも変更されていました。新しい方を採用し、古い方を「${conflictName}」として保存しました。`}
      </span>
      <Button variant="secondary" onClick={onOpen}>
        競合ファイルを開く
      </Button>
      <Button variant="icon" icon={X} ariaLabel="閉じる" onClick={onClose} />
    </div>
  );
}
