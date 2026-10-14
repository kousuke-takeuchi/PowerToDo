import { TriangleAlert } from "lucide-react";
import { Button } from "../components/Button";

export type ExternalChangeBannerProps = {
  /** 「受信トレイ.xlsx」「共通設定 (_PowerToDo.xlsx)」のような、利用者に見せるファイル名。 */
  fileName: string;
  /** ファイルの内容を読み込む (このアプリでの変更は捨てる)。 */
  onReload?: () => void;
  /** このアプリの内容でファイルを上書きする。 */
  onOverwrite?: () => void;
};

/** 外部変更の帯 (仕様 §5.3)。FixBanner と同じ帯 (accent-soft, 下罫線)。AppShell の banner スロットに入れる。 */
export function ExternalChangeBanner({ fileName, onReload, onOverwrite }: ExternalChangeBannerProps) {
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
        {`「${fileName}」が Excel など別のアプリで変更されました。このアプリの未保存の変更があります。`}
      </span>
      <Button variant="secondary" onClick={onReload}>
        ファイルを読み込む
      </Button>
      <Button variant="primary" onClick={onOverwrite}>
        このアプリの内容で上書き
      </Button>
    </div>
  );
}
