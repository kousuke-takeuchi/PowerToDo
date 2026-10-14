import type React from "react";
import { motion, useReducedMotion } from "motion/react";

/** 全アニメ共通のイージング (Todoist 風の素早い減速)。 */
export const EASE = [0.2, 0, 0, 1] as const;

/**
 * 秒数を返すフック。prefers-reduced-motion のときは 0 (即時) にする。
 * 「動かす量」(x / y / scale) の方は呼び出し側が `reduced` を見て 0 にする。
 */
export function useMotionTiming() {
  const reduced = !!useReducedMotion();
  const t = (seconds: number) => ({ duration: reduced ? 0 : seconds, ease: EASE });
  return { reduced, t };
}

export type CollapseProps = {
  children: React.ReactNode;
  /** 高さ / 不透明度の所要時間 (秒)。 */
  duration?: number;
  /** 出るとき上から降りてくる量 (px)。 */
  enterY?: number;
  /** 消えるとき左へ流れる量 (px)。 */
  exitX?: number;
  style?: React.CSSProperties;
};

/**
 * 高さ 0 <-> auto + フェードで出入りするラッパー。AnimatePresence の直下に key 付きで置いて使う。
 * アニメーション中だけ overflow: hidden にし、終わったら visible に戻す
 * (行の左余白に出るシェブロンなどをクリップしないため)。transform は reduced motion では使わない。
 */
export function Collapse({ children, duration = 0.2, enterY = 0, exitX = 0, style }: CollapseProps) {
  const { reduced, t } = useMotionTiming();
  return (
    <motion.div
      initial={{ opacity: 0, height: 0, y: reduced ? 0 : enterY, overflow: "hidden" }}
      animate={{ opacity: 1, height: "auto", y: 0, transitionEnd: { overflow: "visible" } }}
      exit={{ opacity: 0, height: 0, x: reduced ? 0 : exitX, overflow: "hidden" }}
      transition={t(duration)}
      style={style}
    >
      {children}
    </motion.div>
  );
}
