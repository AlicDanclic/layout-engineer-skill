import { SPACE } from "./tokens.ts";

/**
 * CANVAS_DESKTOP: 桌面端画布尺寸
 * 作用：    定义桌面端布局的坐标系与总宽高
 * 影响范围：① header 与 ④ footer 的通栏宽；②③ 内容区可用宽高
 * 可调范围：宽 1024 ~ 2560，高 640 ~ 1600（px）
 */
export const CANVAS_DESKTOP = { w: 1440, h: 900 } as const;

/**
 * CANVAS_MOBILE: 移动端画布尺寸
 * 作用：    定义移动端布局的坐标系与总宽高
 * 影响范围：① header 与 ④ footer 的通栏宽；③ card-list 的可用宽高
 * 可调范围：宽 320 ~ 480，高 568 ~ 926（px），建议取主流机型
 */
export const CANVAS_MOBILE = { w: 390, h: 844 } as const;

/**
 * HEADER_H: 页头高度
 * 作用：    控制页头区域高度
 * 影响范围：① header 高度；②③④ 的 y 坐标（footer 除外，它贴底）
 * 可调范围：48 ~ 96（px），建议取 8 的倍数
 */
export const HEADER_H = 64;

/**
 * FOOTER_H: 页脚高度
 * 作用：    控制页脚区域高度
 * 影响范围：④ footer 高度；②③ 内容区的可用高度
 * 可调范围：48 ~ 96（px），建议取 8 的倍数
 */
export const FOOTER_H = 64;

/**
 * GAP_LG: 区域级间距
 * 作用：    定义区域之间的留白与画布边距
 * 影响范围：①②③④ 的 y 坐标、②③ 的 x 与宽度
 * 可调范围：取自 SPACE 刻度（8 / 16 / 24 / 48），默认 SPACE.lg
 */
export const GAP_LG = SPACE.lg;

/**
 * PAD: 容器内边距
 * 作用：    定义容器与子元素之间的内边距
 * 影响范围：②a nav-item 与 ③a card 相对各自容器的内缩量
 * 可调范围：取自 SPACE 刻度（8 / 16 / 24 / 48），默认 SPACE.lg
 */
export const PAD = SPACE.lg;

/**
 * SIDEBAR_W_DESKTOP: 桌面端侧边栏宽度
 * 作用：    控制桌面端② sidebar 的宽度，并决定 ③ card-list 的起始 x
 * 影响范围：② sidebar 宽度；②a nav-item 宽度；③ card-list 的 x 与宽度
 * 可调范围：0 或 200 ~ 320（px）；取 0 时侧边栏整块不出现在树里（移动端即用此机制）
 */
export const SIDEBAR_W_DESKTOP = 240;

/**
 * SIDEBAR_W_MOBILE: 移动端侧边栏宽度
 * 作用：    移动端不显示侧边栏时把宽度取 0，让同一套公式自然退化
 * 影响范围：② 是否出现；③ card-list 的 x 与宽度
 * 可调范围：固定 0（移动端不做侧栏）；若要开启移动端侧栏可改为 160 ~ 220
 */
export const SIDEBAR_W_MOBILE = 0;

/**
 * COLUMNS_DESKTOP: 桌面端卡片列数
 * 作用：    决定 ③a card 网格的列数
 * 影响范围：所有 card 的 x/y 排布、单张卡片宽度与整体行数
 * 可调范围：2 ~ 4（整数）
 */
export const COLUMNS_DESKTOP = 3;

/**
 * COLUMNS_MOBILE: 移动端卡片列数
 * 作用：    决定移动端 ③a card 网格的列数
 * 影响范围：所有 card 的 x/y 排布、单张卡片宽度与整体行数
 * 可调范围：1 ~ 2（整数）
 */
export const COLUMNS_MOBILE = 2;

/**
 * COLUMN_RATIO_DESKTOP: 桌面端单卡宽度占区域宽度的比例
 * 作用：    以百分比方式决定卡片宽度，避免双端各写一套硬编码宽度
 * 影响范围：③a card 的宽度，进而影响其 x 坐标与网格总宽
 * 可调范围：0.25 ~ 0.5（比例）
 */
export const COLUMN_RATIO_DESKTOP = 1 / 3;

/**
 * COLUMN_RATIO_MOBILE: 移动端单卡宽度占区域宽度的比例
 * 作用：    以百分比方式决定卡片宽度
 * 影响范围：③a card 的宽度，进而影响其 x 坐标与网格总宽
 * 可调范围：0.5 ~ 1（比例）
 */
export const COLUMN_RATIO_MOBILE = 1 / 2;

/**
 * CARD_COUNT: 卡片总数
 * 作用：    决定 ③a card 的数量
 * 影响范围：卡片行数；与列数共同决定网格总高
 * 可调范围：1 ~ 24（整数）
 */
export const CARD_COUNT = 6;

/**
 * CARD_H_DESKTOP: 桌面端卡片高度
 * 作用：    控制桌面端单张卡片高度
 * 影响范围：③a card 的高度、行间距与网格总高
 * 可调范围：120 ~ 260（px），建议取 8 的倍数
 */
export const CARD_H_DESKTOP = 180;

/**
 * CARD_H_MOBILE: 移动端卡片高度
 * 作用：    控制移动端单张卡片高度
 * 影响范围：③a card 的高度、行间距与网格总高
 * 可调范围：96 ~ 200（px），建议取 8 的倍数
 */
export const CARD_H_MOBILE = 120;

/**
 * NAV_ITEM_H: 导航项高度
 * 作用：    控制 ②a nav-item 的单项高度
 * 影响范围：nav-item 高度与垂直排列的 y 坐标
 * 可调范围：32 ~ 64（px），建议取 8 的倍数
 */
export const NAV_ITEM_H = 40;

/**
 * NAV_ITEM_COUNT: 导航项数量
 * 作用：    决定 ②a nav-item 的个数
 * 影响范围：导航列表总高，可能影响 sidebar 的最小高度
 * 可调范围：1 ~ 12（整数）
 */
export const NAV_ITEM_COUNT = 5;
