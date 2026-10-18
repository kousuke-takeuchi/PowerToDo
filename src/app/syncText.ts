import type { SyncRecoverDto, SyncRecoverMode } from "../types/model";

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
