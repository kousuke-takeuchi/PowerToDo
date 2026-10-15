import { useEffect, useState } from "react";
import { useSearch } from "./useSearch";

/** 検索ダイアログの開閉・検索条件・選択位置。 */
export function useSearchDialog() {
  const [searchOpen, setSearchOpen] = useState(false);
  const search = useSearch(searchOpen);
  const [searchSel, setSearchSel] = useState(0);
  // 選択位置: 開くとき / 検索条件が変わったときは先頭、結果が入れ替わっただけ (チェック後の再取得) なら範囲内に収める。
  useEffect(() => {
    if (searchOpen) setSearchSel(0);
  }, [searchOpen]);
  useEffect(() => setSearchSel((s) => Math.min(s, Math.max(search.hits.length - 1, 0))), [search.hits]);
  return { searchOpen, setSearchOpen, search, searchSel, setSearchSel };
}
