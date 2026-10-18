import type React from "react";
import { useState } from "react";
import { TextField } from "../components/TextField";

export const labelStyle: React.CSSProperties = { fontSize: 13, lineHeight: "19px", fontWeight: 600, color: "var(--color-text-primary)" };
export const hintStyle: React.CSSProperties = { fontSize: 12, lineHeight: "17px", color: "var(--color-text-secondary)" };

export const syncTargetOptions = [
  { value: "google", label: "Google Drive" },
  { value: "nas", label: "Synology NAS (WebDAV)" },
  { value: "none", label: "同期しない" },
] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-secondary)" }}>{label}</span>
      {children}
    </label>
  );
}

export type NasFieldValues = { url: string; user: string; password: string };
export type NasFieldsProps = {
  /** 渡すと入力欄は呼び出し側の値で動く (実アプリ)。無ければ絵コンテ用のサンプル値を内部で持つ。 */
  values?: NasFieldValues;
  onChange?: (v: NasFieldValues) => void;
  /** 実アプリ: 入力欄が空のとき薄く出す例。 */
  placeholders?: boolean;
  /** パスワード欄の下に出す警告 (例: 「パスワードを保存できません (再起動するまで有効)」)。 */
  passwordNote?: string;
};

/** NAS (WebDAV) の接続情報 3 項目 (サーバー URL / ユーザー名 / パスワード)。設定ダイアログと初回起動で共通。 */
export function NasFields({ values, onChange, placeholders, passwordNote }: NasFieldsProps = {}) {
  const [sample, setSample] = useState<NasFieldValues>({ url: "https://nas.local:5006/todo", user: "powertodo", password: "••••••••" });
  const v = values ?? sample;
  const set = (patch: Partial<NasFieldValues>) => {
    const next = { ...v, ...patch };
    if (values) onChange?.(next);
    else setSample(next);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <Field label="サーバー URL">
        <TextField type="url" value={v.url} onChange={(url) => set({ url })} placeholder={placeholders ? "http://nas:5005/powertodo/" : undefined} />
      </Field>
      <Field label="ユーザー名">
        <TextField value={v.user} onChange={(user) => set({ user })} placeholder={placeholders ? "たろう" : undefined} />
      </Field>
      <Field label="パスワード">
        <TextField type="password" value={v.password} onChange={(password) => set({ password })} />
      </Field>
      {passwordNote && (
        <div role="status" style={{ ...hintStyle, color: "var(--color-danger)" }}>
          {passwordNote}
        </div>
      )}
    </div>
  );
}
