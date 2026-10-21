import { useContext } from "react";
import { TriangleAlert, X } from "lucide-react";
import { Button } from "../components/Button";
import { NarrowContext } from "../components/NarrowContext";
import { BannerActions, bandNarrow } from "./BannerActions";

export type ConflictBannerProps = { fileName: string; conflictName: string; onOpen?: () => void; onClose?: () => void };

/** 競合バナー (D-09b)。FixBanner と同じ帯 (accent-soft, 下罫線)。AppShell の banner スロットに入れる。 */
export function ConflictBanner({ fileName, conflictName, onOpen, onClose }: ConflictBannerProps) {
  const narrow = useContext(NarrowContext);
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
        ...bandNarrow(narrow),
      }}
    >
      <span style={{ display: "inline-flex", color: "var(--color-accent)", flex: "0 0 auto" }}>
        <TriangleAlert size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}>
        {`「${fileName}」が別の端末でも変更されていました。新しい方を採用し、古い方を「${conflictName}」として保存しました。`}
      </span>
      {/* 狭いときは閉じるを文の隣に残し、ボタンは次の行へ */}
      {narrow && <Button variant="icon" icon={X} ariaLabel="閉じる" onClick={onClose} />}
      <BannerActions>
        <Button variant="secondary" onClick={onOpen}>
          競合ファイルを開く
        </Button>
      </BannerActions>
      {!narrow && <Button variant="icon" icon={X} ariaLabel="閉じる" onClick={onClose} />}
    </div>
  );
}
