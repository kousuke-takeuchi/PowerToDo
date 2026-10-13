import { Check } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../components/Button";
import { Segmented } from "../components/Segmented";
import { TextField } from "../components/TextField";
import type { SyncTarget } from "./SettingsDialog";
import { NasFields, hintStyle, labelStyle, syncTargetOptions } from "./SyncFields";

export type OnboardingProps = { step: 1 | 2 | 3; target?: SyncTarget };

const stepNames = ["保存先", "同期先", "受信トレイ"] as const;

const subs: Record<1 | 2 | 3, string> = {
  1: "タスクは Excel ファイルとして保存されます。保存先を選びましょう。",
  2: "同期先を選ぶと、ほかの端末とタスクを同期できます。あとからでも設定できます。",
  3: "最初のプロジェクト「受信トレイ」を作成します。買い物メモなど、分類前のタスクはここに入ります。",
};

function Steps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div role="list" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-2)" }}>
      {stepNames.map((name, i) => {
        const n = i + 1;
        const active = n === current;
        return (
          <div key={name} role="listitem" aria-current={active ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                display: "grid",
                placeItems: "center",
                background: active ? "var(--color-accent)" : "var(--color-bg-hover)",
                color: active ? "#FFFFFF" : "var(--color-text-secondary)",
                fontSize: 11,
                lineHeight: "16px",
                fontWeight: 700,
              }}
            >
              {n}
            </span>
            <span style={{ fontSize: 13, lineHeight: "19px", color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}>{name}</span>
            {n < 3 && <span aria-hidden style={{ width: 32, height: 1, background: "var(--color-border)" }} />}
          </div>
        );
      })}
    </div>
  );
}

function Block({ label, children, hint }: { label: string; children: React.ReactNode; hint: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={labelStyle}>{label}</div>
      {children}
      <div style={hintStyle}>{hint}</div>
    </div>
  );
}

const skipStyle: React.CSSProperties = {
  padding: 0,
  border: 0,
  background: "none",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

/**
 * 初回起動 (D-12 / D-12b / D-12c / D-12d)。1440x900 の bg-sidebar 上に Card 560 を中央に置く。
 * step 1 保存先 / step 2 同期先 (セグメントで Google ログイン ⇔ NAS 入力) / step 3 受信トレイ。
 * step と同期先は props で初期値を受け、次へ / スキップ / ログイン / 接続 / セグメントは内部状態で動く (絵コンテの操作確認用で保存はしない)。
 */
export function Onboarding({ step, target = "google" }: OnboardingProps) {
  const [cur, setCur] = useState<1 | 2 | 3>(step);
  const [sync, setSync] = useState<SyncTarget>(target);
  const [dataDir, setDataDir] = useState("~/Library/Application Support/PowerToDo/data");
  const [inbox, setInbox] = useState("受信トレイ.xlsx");

  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (cur === 1) {
    body = (
      <Block label="データフォルダ" hint="Google Drive との同期は次のステップで設定できます。あとからでも変更できます。">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextField value={dataDir} onChange={setDataDir} />
          </div>
          <Button variant="secondary">選択</Button>
        </div>
      </Block>
    );
    footer = <Button onClick={() => setCur(2)}>次へ</Button>;
  } else if (cur === 2) {
    body = (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={labelStyle}>同期先</div>
          <Segmented options={[...syncTargetOptions]} value={sync} onChange={setSync} />
        </div>
        {sync === "google" && (
          <Block label="Google Drive と同期" hint="ログイン画面がブラウザで開きます。同期を使わない場合はスキップできます。">
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Button onClick={() => setCur(3)}>Google でログイン</Button>
            </div>
          </Block>
        )}
        {sync === "nas" && (
          <Block label="Synology NAS (WebDAV) と同期" hint="NAS 側で WebDAV Server を有効にしておいてください。あとからでも設定できます。">
            <NasFields />
          </Block>
        )}
      </>
    );
    footer = (
      <>
        <button type="button" onClick={() => setCur(3)} style={skipStyle}>
          スキップ
        </button>
        {sync === "nas" && <Button onClick={() => setCur(3)}>接続して次へ</Button>}
        {sync === "none" && <Button onClick={() => setCur(3)}>次へ</Button>}
      </>
    );
  } else {
    body = (
      <Block label="受信トレイのファイル名" hint="Drive 上の PowerToDo フォルダに作成されます。">
        <TextField value={inbox} onChange={setInbox} />
      </Block>
    );
    footer = <Button>はじめる</Button>;
  }

  return (
    <div
      style={{
        width: 1440,
        height: 900,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg-sidebar)",
        fontFamily: "var(--font-body)",
        color: "var(--color-text-primary)",
      }}
    >
      <div
        style={{
          boxSizing: "border-box",
          width: 560,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
          padding: "32px 40px",
          background: "var(--color-bg)",
          borderRadius: 16,
          boxShadow: "var(--shadow-welcome)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--color-accent)", color: "#FFFFFF" }}>
            <Check size={28} />
          </div>
          <h1 style={{ margin: 0, fontSize: 22, lineHeight: "32px", fontWeight: 700, color: "var(--color-text-primary)" }}>PowerToDo へようこそ</h1>
          <p style={{ margin: 0, textAlign: "center", fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>{subs[cur]}</p>
        </div>
        <Steps current={cur} />
        {body}
        <div style={{ display: "flex", alignItems: "center", justifyContent: cur === 2 ? "space-between" : "flex-end", minHeight: 36 }}>{footer}</div>
      </div>
    </div>
  );
}
