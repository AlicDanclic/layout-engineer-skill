import { SPACE } from "./tokens.ts";

/**
 * CANVAS_DESKTOP: 桌面端画布尺寸
 * 作用：    定义桌面端布局的坐标系与总宽高
 * 影响范围：① header 与 ③ footer 的通栏宽；② 内容区与侧栏的可用宽高
 * 可调范围：宽 1024 ~ 2560，高 640 ~ 1600（px）
 */
export const CANVAS_DESKTOP = { w: 1440, h: 900 } as const;

/**
 * CANVAS_MOBILE: 移动端画布尺寸
 * 作用：    定义移动端布局的坐标系与总宽高
 * 影响范围：① header 与 ③ footer 的通栏宽；② 内容区的可用宽高
 * 可调范围：宽 320 ~ 480，高 568 ~ 926（px），建议取主流机型
 */
export const CANVAS_MOBILE = { w: 390, h: 844 } as const;

/**
 * HEADER_H: 页头高度
 * 作用：    控制页头区域高度
 * 影响范围：① header 高度；② 内容区与其下元素的 y 坐标
 * 可调范围：48 ~ 96（px），建议取 8 的倍数
 */
export const HEADER_H = 64;

/**
 * FOOTER_H: 页脚高度
 * 作用：    控制页脚区域高度
 * 影响范围：③ footer 高度；② 内容区的可用高度
 * 可调范围：48 ~ 96（px），建议取 8 的倍数
 */
export const FOOTER_H = 64;

/**
 * GAP_LG: 区域级间距
 * 作用：    定义区域之间的留白与画布边距
 * 影响范围：① ② ③ 的 y 坐标与 x 坐标
 * 可调范围：取自 SPACE 刻度（8 / 16 / 24 / 48），默认 SPACE.lg
 */
export const GAP_LG = SPACE.lg;

/**
 * PAD: 容器内边距
 * 作用：    定义容器与子元素之间的内边距
 * 影响范围：② 内容区内子元素相对容器的内缩量
 * 可调范围：取自 SPACE 刻度（8 / 16 / 24 / 48），默认 SPACE.lg
 */
export const PAD = SPACE.lg;

/**
 * SIDEBAR_W_DESKTOP: 桌面端侧边栏宽度
 * 作用：    控制桌面端侧边栏宽度，并决定内容区起始 x
 * 影响范围：② 侧栏与内容区的 x 与宽度
 * 可调范围：0 或 200 ~ 320（px）；取 0 时侧栏整块不出现在树里
 */
export const SIDEBAR_W_DESKTOP = 240;

/**
 * SIDEBAR_W_MOBILE: 移动端侧边栏宽度
 * 作用：    移动端不显示侧栏时取 0，让同一套公式自然退化
 * 影响范围：② 侧栏是否出现；内容区的 x 与宽度
 * 可调范围：固定 0（移动端不做侧栏）；要开启可改为 160 ~ 220
 */
export const SIDEBAR_W_MOBILE = 0;
