import { useId } from "react";
import { RELEASE_URL } from "../app/releaseUrl";
import { Button } from "../components/Button";
import type { UpdateStatusDto } from "../types/model";
import { hintStyle } from "./SyncFields";
import { Desc, Row, Section } from "./SettingsPanes";
import { LiveText } from "./SyncPane";

export type UpdatesPaneProps = {
  /** 版と、この入れ方で更新できるか。読み込むまで null。 */
  status: UpdateStatusDto | null;
  /** 「更新を確認」の実行中。 */
  checking?: boolean;
  /** 手動の確認で「最新です」だった。 */
  upToDate?: boolean;
  /** 確認の失敗など (日本語の文。そのまま出す)。 */
  error?: string | null;
  onToggleAutoCheck?: (enabled: boolean) => void;
  onCheck?: () => void;
  /** `manual` のリンク。release ページを開く。 */
  onOpenReleasePage?: () => void;
};

function Switch({ id, checked, disabled, onChange }: { id: string; checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      style={{
        position: "relative",
        flex: "0 0 auto",
        width: 36,
        height: 20,
        padding: 0,
        border: 0,
        borderRadius: 10,
        background: checked ? "var(--color-accent)" : "var(--color-text-muted)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        aria-hidden
        style={{ position: "absolute", top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: "#FFFFFF", transition: "left 120ms" }}
      />
    </button>
  );
}

/**
 * 設定の「アップデート」ペイン (リリースの仕様 §4.3): いまの版、起動時の確認のスイッチ、「更新を確認」。
 * `dev` は確認しない旨、`manual` は release ページから入れ直す旨とリンク。結果の文は読み上げ領域に置いたまま文だけ変える。
 * 更新が見つかったときのダイアログは親が出す (`UpdateDialog`)。
 */
export function UpdatesPane({ status, checking = false, upToDate = false, error, onToggleAutoCheck, onCheck, onOpenReleasePage }: UpdatesPaneProps) {
  const switchId = useId();
  if (!status) return <Desc>{error ?? "読み込み中…"}</Desc>;
  const supported = status.support === "supported";
  const result = checking ? "確認しています…" : error ? error : upToDate ? `最新です (v${status.currentVersion})` : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <Section label="いまのバージョン">
        <div style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}>v{status.currentVersion}</div>
      </Section>
      <Section label="更新の確認">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Switch id={switchId} checked={status.autoCheck} disabled={!supported} onChange={onToggleAutoCheck} />
          <label htmlFor={switchId} style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}>
            起動時に更新を確認する
          </label>
        </div>
        {status.support === "dev" && <Desc>開発版のため更新を確認しません</Desc>}
        {status.support === "manual" && (
          <>
            <Desc>この入れ方では自動更新できません。release ページから入れ直してください</Desc>
            <div>
              <a
                href={RELEASE_URL}
                onClick={(e) => {
                  e.preventDefault();
                  onOpenReleasePage?.();
                }}
                style={{ ...hintStyle, color: "var(--color-accent)", textDecoration: "underline", cursor: "pointer" }}
              >
                release ページを開く
              </a>
            </div>
          </>
        )}
        <Row>
          <Button variant="secondary" onClick={onCheck} disabled={!supported || checking}>
            更新を確認
          </Button>
        </Row>
        <LiveText text={result} />
        {result && (
          <div aria-hidden style={{ ...hintStyle, ...(error && !checking ? { color: "var(--color-danger)" } : {}) }}>
            {result}
          </div>
        )}
      </Section>
    </div>
  );
}
