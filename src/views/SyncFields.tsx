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

/** NAS (WebDAV) の接続情報 3 項目 (サーバー URL / ユーザー名 / パスワード)。設定ダイアログと初回起動で共通。 */
export function NasFields() {
  const [url, setUrl] = useState("https://nas.local:5006/todo");
  const [user, setUser] = useState("powertodo");
  const [pass, setPass] = useState("••••••••");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <Field label="サーバー URL">
        <TextField type="url" value={url} onChange={setUrl} />
      </Field>
      <Field label="ユーザー名">
        <TextField value={user} onChange={setUser} />
      </Field>
      <Field label="パスワード">
        <TextField type="password" value={pass} onChange={setPass} />
      </Field>
    </div>
  );
}
