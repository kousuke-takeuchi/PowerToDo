import type { GoogleLoginOutcome, GoogleLogoutDto, SyncBackend, SyncRecoverDto, SyncRecoverMode, SyncSettingsDto, SyncStatusDto } from "../types/model";

/** NAS が設定ずみ: 同期先が NAS で、アドレス・ユーザー・パスワードが揃っている。 */
export function isNasConnected(s: SyncSettingsDto | null): boolean {
  return !!s && s.backend === "nas" && !!s.nasUrl && !!s.nasUser && s.nasPasswordSet;
}

/** Google Drive にログイン中: 同期先が Google Drive で、リフレッシュトークンが保存されている。 */
export function isGoogleLoggedIn(s: SyncSettingsDto | null): boolean {
  return !!s && s.backend === "gdrive" && s.googleLoggedIn;
}

/** Google のログインが失敗ではない形で終わったときに、ペインへ出す案内 (`done` は何も出さない)。 */
export function googleLoginNote(outcome: GoogleLoginOutcome): string | null {
  switch (outcome) {
    case "cancelled":
      return "ログインをキャンセルしました";
    case "denied":
      return "Google でのログインが許可されなかったため、ログインしませんでした";
    case "done":
      return null;
  }
}

/** ログアウトの後の案内。`revoked: false` は Google 側の取り消しができなかったとき、`keychainFailed` はキーチェーンからトークンを消せなかったとき。 */
export function googleLogoutNote({ revoked, keychainFailed }: GoogleLogoutDto): string {
  const parts = ["ログアウトしました"];
  if (!revoked) parts.push("ただし Google に接続できず、Google 側のログインは取り消せていません。つながるときに Google アカウントの設定で、PowerToDo のアクセスを取り消してください");
  if (keychainFailed) parts.push("この PC のキーチェーンからログイン情報を削除できませんでした (Google 側では取り消し済みで、使えません)");
  return parts.join("。");
}

/**
 * サイドバーの同期エラーの文言。「今すぐ同期」で直りうるとき (`clickable`) は既定の「同期エラー · クリックで再試行」
 * (undefined)。片方が空に見えて止まっているとき、認証が断られたとき (ログインし直すか「確かめる」まで同期しない)、
 * クリックできないときは、再試行を勧めない。
 */
export function syncErrorText(status: SyncStatusDto | null, clickable: boolean): string | undefined {
  if (status?.state !== "error") return undefined;
  if (status.suspect) return "同期エラー · 同期を止めています";
  if (status.authRejected) return "同期エラー · ログインし直してください";
  return clickable ? undefined : "同期エラー";
}

/** 同期先の名前 (確認ダイアログや「戻す」の文言用)。 */
export function targetName(b: SyncBackend | undefined): string {
  return b === "gdrive" ? "Google Drive" : "NAS";
}

const LOCAL_STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/**
 * `lastSynced` ("YYYY-MM-DDTHH:MM:SS", local time) as 「09:41」, or 「10/16 09:41」 when it is not today.
 * With `long`, today reads 「今日 09:41」 (the settings pane). Anything unreadable gives undefined.
 */
export function formatSynced(lastSynced: string | undefined, { now = new Date(), long = false } = {}): string | undefined {
  const m = lastSynced ? LOCAL_STAMP.exec(lastSynced) : null;
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const time = `${m[4]}:${m[5]}`;
  const today = now.getFullYear() === y && now.getMonth() + 1 === mo && now.getDate() === d;
  if (today) return long ? `今日 ${time}` : time;
  return `${mo}/${d} ${time}`;
}

/** The two recovery choices after a side looked wiped (仕様 §3 / Task 3 ruling). `target` is the sync target's name (「NAS」「Google Drive」). */
export function recoverQuestion(mode: SyncRecoverMode, target: string): { message: string; okLabel: string } {
  return mode === "mirrorRemote"
    ? {
        message: `${target} の内容でこの PC を戻します。\n\nこの PC にだけあるファイルと、${target} と内容が違うファイルは、この PC の archive/ フォルダに残してから置き換えます。${target} は変更しません。`,
        okLabel: "この PC を戻す",
      }
    : {
        message: `この PC の内容で ${target} を戻します。\n\n${target} にだけあるファイルと、この PC と内容が違うファイルは、${target} の archive/ フォルダに残してから置き換えます。この PC は変更しません。`,
        okLabel: `${target} を戻す`,
      };
}

/** What to tell the user after `sync_recover` returned. */
export function recoverResult(r: SyncRecoverDto): { text: string; tone: "info" | "error" } {
  switch (r.outcome) {
    case "done": {
      const parts = [`この PC へ ${r.downloaded} 件`, `同期先へ ${r.uploaded} 件`, `archive/ へ ${r.archived} 件`];
      if (r.failed > 0) return { text: `${r.failed} 件のファイルは戻せませんでした (${parts.join("、")}は完了)。次の同期でもう一度試します`, tone: "error" };
      return { text: `戻しました (${parts.join("、")})`, tone: "info" };
    }
    case "suspect":
      return { text: "まだ片方が空に見えるため、戻しませんでした", tone: "error" };
    case "offline":
      return { text: "同期先に接続できませんでした。接続を確かめてから、もう一度試してください", tone: "error" };
    case "interrupted":
      return { text: "途中で中断しました。もう一度試してください", tone: "error" };
    case "notRun":
      return { text: "同期の状態が変わったため、実行しませんでした", tone: "error" };
    case "failed":
      return { text: "戻せませんでした。もう一度試してください", tone: "error" };
  }
}
