import { TriangleAlert } from "lucide-react";
import { Button } from "../components/Button";

export type FixBannerProps = {
  message?: string;
  onOpenExcel?: () => void;
  /** 渡すと「再読み込み」を出す (Excel で直したあと、ファイルを読み直す)。 */
  onReload?: () => void;
};

export function FixBanner({
  message = "1 行に型の不整合があります。Excel で修正するまで、その行はアプリから編集できません。",
  onOpenExcel,
  onReload,
}: FixBannerProps) {
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
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}>{message}</span>
      {onReload && (
        <Button variant="secondary" onClick={onReload}>
          再読み込み
        </Button>
      )}
      <Button variant="secondary" onClick={onOpenExcel}>
        Excel で開く
      </Button>
    </div>
  );
}
