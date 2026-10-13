import { FileX } from "lucide-react";
import { Button } from "../components/Button";

export type ErrorStateProps = {
  fileName: string;
  onRetry?: () => void;
  /** 省略時は「ファイルの場所を開く」を出さない。 */
  onReveal?: () => void;
  /** 追加の詳細 (実アプリのエラーメッセージ)。省略時は絵コンテと同じ表示。 */
  detail?: string;
  /** 起動時の致命エラー用: 別のデータフォルダを選び直す。省略時はボタンを出さない。 */
  onChangeFolder?: () => void;
};

export function ErrorState({ fileName, onRetry, onReveal, detail, onChangeFolder }: ErrorStateProps) {
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
      {detail && (
        <div style={{ width: 480, textAlign: "center", fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)", wordBreak: "break-all" }}>{detail}</div>
      )}
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button onClick={onRetry}>再試行</Button>
        {onChangeFolder && (
          <Button variant="secondary" onClick={onChangeFolder}>
            フォルダを選び直す
          </Button>
        )}
        {onReveal && (
          <Button variant="secondary" onClick={onReveal}>
            ファイルの場所を開く
          </Button>
        )}
      </div>
    </div>
  );
}
