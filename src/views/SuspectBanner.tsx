import { useContext } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "../components/Button";
import { NarrowContext } from "../components/NarrowContext";
import { BannerActions, bandNarrow } from "./BannerActions";
import type { SyncRecoverMode } from "../types/model";

export type SuspectBannerProps = {
  /** 空に見える側。 */
  side: "local" | "remote";
  /** 同期先の名前 (「NAS」「Google Drive」)。 */
  target?: string;
  /** 戻している間。 */
  busy?: boolean;
  /** 戻せなかった理由 (日本語、そのまま)。 */
  error?: string | null;
  /** 確認ダイアログと実行は呼び出し側。 */
  onRecover?: (mode: SyncRecoverMode) => void;
};

/**
 * 片方が空に見えて同期が止まっているときの帯 (Task 3 / 4 の決定)。FixBanner と同じ帯。
 * 戻す方向を選ばせる: 同期先の内容でこの PC を戻す / この PC の内容で同期先を戻す。上書きされるファイルは archive/ に残る。
 */
export function SuspectBanner({ side, target = "NAS", busy, error, onRecover }: SuspectBannerProps) {
  const narrow = useContext(NarrowContext);
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "10px 24px",
        background: "var(--color-accent-soft)",
        boxShadow: "inset 0 -1px 0 var(--color-border)",
        fontFamily: "var(--font-body)",
        ...bandNarrow(narrow),
      }}
    >
      <span style={{ display: "inline-flex", color: "var(--color-danger)", flex: "0 0 auto" }}>
        <TriangleAlert size={18} />
      </span>
      <span style={{ flex: narrow ? "1 1 0" : "1 1 320px", minWidth: 0, fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)", overflowWrap: "anywhere" }}>
        {side === "local"
          ? `この PC のデータフォルダが空に見えるため、同期を止めています。${target} の内容で戻すか、この PC の内容を正とするか選んでください。`
          : `${target} が空に見えるため、同期を止めています。この PC の内容で戻すか、${target} の内容を正とするか選んでください。`}
        {error && <span style={{ display: "block", color: "var(--color-danger)" }}>{error}</span>}
      </span>
      <BannerActions>
        <Button variant={side === "local" ? "primary" : "secondary"} onClick={() => onRecover?.("mirrorRemote")} disabled={busy}>
          {`${target} の内容でこの PC を戻す`}
        </Button>
        <Button variant={side === "remote" ? "primary" : "secondary"} onClick={() => onRecover?.("mirrorLocal")} disabled={busy}>
          {`この PC の内容で ${target} を戻す`}
        </Button>
      </BannerActions>
    </div>
  );
}
