import { FileX } from "lucide-react";
import { Button } from "../components/Button";

export type ErrorStateProps = { fileName: string; onRetry?: () => void; onReveal?: () => void };

export function ErrorState({ fileName, onRetry, onReveal }: ErrorStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "80px 0",
        fontFamily: "var(--font-body)",
      }}
    >
      <span style={{ display: "inline-flex", color: "var(--color-danger)" }}>
        <FileX size={56} />
      </span>
      <div style={{ fontSize: 16, lineHeight: "23px", fontWeight: 600, color: "var(--color-text-primary)" }}>
        「{fileName}」を読み込めません
      </div>
      <div style={{ width: 480, textAlign: "center", fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>
        ファイルが別のアプリで開かれているか、壊れています。このファイルは上書きしません。
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button onClick={onRetry}>再試行</Button>
        <Button variant="secondary" onClick={onReveal}>
          ファイルの場所を開く
        </Button>
      </div>
    </div>
  );
}
