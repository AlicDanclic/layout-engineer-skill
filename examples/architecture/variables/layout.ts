import { SPACE } from "./tokens.ts";

/**
 * CANVAS_W_DESKTOP: 桌面端画布宽
 * 作用：    定义桌面端架构图的总宽度
 * 影响范围：所有区块的宽度与横向等分结果
 * 可调范围：1200 ~ 2560（px）
 */
export const CANVAS_W_DESKTOP = 1680;

/**
 * CANVAS_W_MOBILE: 移动端画布宽
 * 作用：    定义移动端架构图的总宽度（窄屏下改为纵向堆叠）
 * 影响范围：所有区块的宽度；各区块高度随子项堆叠而增长
 * 可调范围：320 ~ 640（px）
 */
export const CANVAS_W_MOBILE = 480;

/**
 * MARGIN_DESKTOP: 桌面端外边距
 * 作用：    画布四周留白，同时作为区块内边距
 * 影响范围：所有顶层区块的 x/宽；所有子项的 x/宽
 * 可调范围：取自 SPACE 刻度（16 / 24 / 48）
 */
export const MARGIN_DESKTOP = SPACE.lg;

/**
 * MARGIN_MOBILE: 移动端外边距
 * 作用：    窄屏下收紧四周留白
 * 影响范围：所有顶层区块的 x/宽；所有子项的 x/宽
 * 可调范围：取自 SPACE 刻度（8 / 16 / 24）
 */
export const MARGIN_MOBILE = SPACE.md;

/**
 * GAP_DESKTOP: 桌面端子项间距
 * 作用：    同一行内子盒子之间的水平间距
 * 影响范围：各区块内子盒子的 x 坐标与等分宽度；堆叠方向的 y 步长
 * 可调范围：取自 SPACE 刻度
 */
export const GAP_DESKTOP = SPACE.md;

/**
 * GAP_MOBILE: 移动端子项间距
 * 作用：    同一列内子盒子之间的垂直间距
 * 影响范围：各区块内子盒子的 y 坐标；堆叠方向下的区块总高
 * 可调范围：取自 SPACE 刻度
 */
export const GAP_MOBILE = SPACE.sm;

/**
 * SEC_GAP_DESKTOP: 桌面端区块间距
 * 作用：    相邻区块之间的垂直间距
 * 影响范围：所有区块的 y 坐标与画布总高
 * 可调范围：取自 SPACE 刻度
 */
export const SEC_GAP_DESKTOP = SPACE.lg;

/**
 * SEC_GAP_MOBILE: 移动端区块间距
 * 作用：    窄屏下收紧区块之间的垂直间距
 * 影响范围：所有区块的 y 坐标与画布总高
 * 可调范围：取自 SPACE 刻度
 */
export const SEC_GAP_MOBILE = SPACE.sm;

/**
 * SEC_HEAD_H_DESKTOP: 桌面端区块标题占位高度
 * 作用：    给区块自身的标题留出高度，避免标题压到第一个子盒子
 * 影响范围：每个区块的子项起始 y，以及区块总高
 * 可调范围：24 ~ 40（px）
 */
export const SEC_HEAD_H_DESKTOP = 28;

/**
 * SEC_HEAD_H_MOBILE: 移动端区块标题占位高度
 * 作用：    窄屏下略收紧标题占位
 * 影响范围：每个区块的子项起始 y，以及区块总高
 * 可调范围：20 ~ 32（px）
 */
export const SEC_HEAD_H_MOBILE = 24;

/**
 * TITLE_H_DESKTOP: 桌面端标题带高度
 * 作用：    顶部标题带的高度
 * 影响范围：标题带自身高度；其下所有区块的 y 坐标
 * 可调范围：56 ~ 120（px）
 */
export const TITLE_H_DESKTOP = 72;

/**
 * TITLE_H_MOBILE: 移动端标题带高度
 * 作用：    窄屏下标题带高度
 * 影响范围：标题带自身高度；其下所有区块的 y 坐标
 * 可调范围：48 ~ 88（px）
 */
export const TITLE_H_MOBILE = 56;

/**
 * WORKFLOW_COUNT: 工作流步骤数
 * 作用：    决定工作流区块的子盒子数量
 * 影响范围：工作流区块的总高（堆叠方向）与等分宽度
 * 可调范围：4 ~ 12（整数）
 */
export const WORKFLOW_COUNT = 8;

/**
 * WORKFLOW_ITEM_H_DESKTOP: 桌面端工作流子盒子高度
 * 作用：    桌面端工作流区块单格高度
 * 影响范围：工作流区块总高与其子盒子尺寸
 * 可调范围：40 ~ 96（px）
 */
export const WORKFLOW_ITEM_H_DESKTOP = 54;

/**
 * WORKFLOW_ITEM_H_MOBILE: 移动端工作流子盒子高度
 * 作用：    移动端工作流区块单格高度
 * 影响范围：工作流区块总高与其子盒子尺寸
 * 可调范围：32 ~ 72（px）
 */
export const WORKFLOW_ITEM_H_MOBILE = 44;

/**
 * CORE_COUNT: 核心区块格子数
 * 作用：    决定核心区块的子盒子数量（输入 / 核心 / 产物）
 * 影响范围：核心区块总高与等分宽度
 * 可调范围：2 ~ 4（整数）
 */
export const CORE_COUNT = 3;

/**
 * CORE_ITEM_H_DESKTOP: 桌面端核心格高度
 * 作用：    桌面端核心区块单格高度
 * 影响范围：核心区块总高
 * 可调范围：80 ~ 280（px）
 */
export const CORE_ITEM_H_DESKTOP = 136;

/**
 * CORE_ITEM_H_MOBILE: 移动端核心格高度
 * 作用：    移动端核心区块单格高度
 * 影响范围：核心区块总高
 * 可调范围：64 ~ 160（px）
 */
export const CORE_ITEM_H_MOBILE = 104;

/**
 * VERIFY_COUNT: 验证器数量
 * 作用：    决定验证区块的子盒子数量
 * 影响范围：验证区块总高与等分宽度
 * 可调范围：3 ~ 10（整数）
 */
export const VERIFY_COUNT = 6;

/**
 * VERIFY_ITEM_H_DESKTOP: 桌面端验证格高度
 * 作用：    桌面端验证区块单格高度
 * 影响范围：验证区块总高
 * 可调范围：56 ~ 120（px）
 */
export const VERIFY_ITEM_H_DESKTOP = 78;

/**
 * VERIFY_ITEM_H_MOBILE: 移动端验证格高度
 * 作用：    移动端验证区块单格高度
 * 影响范围：验证区块总高
 * 可调范围：32 ~ 72（px）
 */
export const VERIFY_ITEM_H_MOBILE = 40;

/**
 * ARCHIVE_COUNT: 归档格子数
 * 作用：    决定归档区块的子盒子数量
 * 影响范围：归档区块总高与等分宽度
 * 可调范围：2 ~ 6（整数）
 */
export const ARCHIVE_COUNT = 4;

/**
 * ARCHIVE_ITEM_H_DESKTOP: 桌面端归档格高度
 * 作用：    桌面端归档区块单格高度
 * 影响范围：归档区块总高
 * 可调范围：72 ~ 200（px）
 */
export const ARCHIVE_ITEM_H_DESKTOP = 108;

/**
 * ARCHIVE_ITEM_H_MOBILE: 移动端归档格高度
 * 作用：    移动端归档区块单格高度
 * 影响范围：归档区块总高
 * 可调范围：40 ~ 120（px）
 */
export const ARCHIVE_ITEM_H_MOBILE = 48;
