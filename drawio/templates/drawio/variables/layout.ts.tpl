import { DRAWIO_METRICS, SPACE } from "./tokens.ts";

/**
 * CANVAS_W: 画布宽度
 * 作用：    定义架构图的坐标系宽度
 * 影响范围：标题带、四个层容器与图例的通栏宽；所有 x 坐标
 * 可调范围：960 ~ 2000（px），建议取 16 的倍数
 */
export const CANVAS_W = 1280;

/**
 * MARGIN: 画布边距
 * 作用：    定义内容与画布四边的留白
 * 影响范围：标题 / 层容器 / 图例的 x 与 y；左侧绕行走廊位置
 * 可调范围：取自 SPACE 刻度（48 / 64），默认 SPACE.xxl
 */
export const MARGIN = SPACE.xxl;

/**
 * SEC_GAP: 层间距
 * 作用：    定义层与层之间的留白，同时是连线标签的落脚空间
 * 影响范围：各层容器的 y 坐标；连线标签的 y
 * 可调范围：取自 SPACE 刻度（48 / 64），默认 SPACE.xxl（规范下限 60px）
 */
export const SEC_GAP = SPACE.xxl;

/**
 * GAP: 同层节点间距
 * 作用：    定义同一层内相邻节点的间隔
 * 影响范围：同层节点的 x 与宽度
 * 可调范围：取自 SPACE 刻度（24 / 48），默认 SPACE.lg（规范下限 40px 的下限；密度优先）
 */
export const GAP = SPACE.lg;

/**
 * PAD: 容器内边距
 * 作用：    定义层容器与内部节点之间的内缩量
 * 影响范围：节点的起始 x 与可用宽度
 * 可调范围：取自 SPACE 刻度（16 / 24 / 48），默认 SPACE.md（规范下限 20px 的下限；密度优先）
 */
export const PAD = SPACE.md;

/**
 * HEAD_H: 层标题带高度
 * 作用：    定义层容器左上角标题占用的高度
 * 影响范围：层容器高度；内部节点的 y 坐标
 * 可调范围：24 ~ 48（px）；必须 ≥ DRAWIO_METRICS.layerHeadH
 */
export const HEAD_H = DRAWIO_METRICS.layerHeadH;

/**
 * NODE_H: 节点高度
 * 作用：    定义所有功能节点卡片的高度
 * 影响范围：层容器高度；连线端点 y
 * 可调范围：48 ~ 96（px），需容纳最多 3 行说明文字
 */
export const NODE_H = 64;

/**
 * TITLE_H: 标题带高度
 * 作用：    定义图标题占用的高度
 * 影响范围：第一个层容器的 y 坐标
 * 可调范围：40 ~ 72（px），需容纳 TYPE.display 字号
 */
export const TITLE_H = 48;

/**
 * TITLE_GAP: 标题与第一层之间的间距
 * 作用：    把标题带与图层分开
 * 影响范围：第一个层容器的 y 坐标
 * 可调范围：取自 SPACE 刻度（24 / 48 / 64），默认 SPACE.xxl
 */
export const TITLE_GAP = SPACE.xxl;

/**
 * LABEL_W: 连线标签宽度
 * 作用：    定义连线动作文字的白色底衬宽度
 * 影响范围：连线标签盒的宽度（须容纳最长动作文字）
 * 可调范围：72 ~ 160（px）
 */
export const LABEL_W = 96;

/**
 * LABEL_H: 连线标签高度
 * 作用：    定义连线动作文字底衬的高度
 * 影响范围：连线标签盒的高度；须小于 SEC_GAP 才放得进层间空隙
 * 可调范围：20 ~ 32（px）
 */
export const LABEL_H = 24;

/**
 * LEGEND_ROWS: 图例行数
 * 作用：    定义图例需要解释几条颜色语义
 * 影响范围：图例容器高度
 * 可调范围：2 ~ 8 行
 */
export const LEGEND_ROWS = 3;

/**
 * LEGEND_ROW_H: 图例行高
 * 作用：    定义图例每行的垂直节奏
 * 影响范围：图例容器高度与图例项的 y 坐标
 * 可调范围：24 ~ 40（px）
 */
export const LEGEND_ROW_H = 32;

/**
 * LEGEND_SWATCH_W: 图例色样宽度
 * 作用：    定义图例中颜色/线型示意块的宽度
 * 影响范围：图例色样与说明文字的 x 与宽度
 * 可调范围：16 ~ 48（px）
 */
export const LEGEND_SWATCH_W = 28;

/**
 * LEGEND_SWATCH_H: 图例色样高度
 * 作用：    定义图例中颜色/线型示意块的高度
 * 影响范围：图例色样的 y 与高度
 * 可调范围：8 ~ 20（px）
 */
export const LEGEND_SWATCH_H = 12;

/**
 * LEGEND_SWATCH_GAP: 图例色样与说明文字的间距
 * 作用：    分开色样与文字
 * 影响范围：图例说明文字的 x 坐标
 * 可调范围：取自 SPACE 刻度（8 / 16），默认 SPACE.md
 */
export const LEGEND_SWATCH_GAP = SPACE.md;

/**
 * CORRIDOR_X: 左侧绕行走廊
 * 作用：    为长距离回环连线定义一条确认无节点的竖直通道
 * 影响范围：绕行连线的途经点 x
 * 可调范围：0 < CORRIDOR_X < MARGIN（必须落在层容器之外）
 */
export const CORRIDOR_X = MARGIN / 2;
