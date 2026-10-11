/**
 * SPACE: 间距刻度
 * 作用：    全局元素间距的唯一来源；assert-layout 据此判定快照里的间距变量
 * 可选值：  4 / 8 / 16 / 24 / 48 / 64，禁止刻度以外的间距值
 * 影响范围：画布边距、层间距、同层节点间距、容器内边距
 * 可调范围：可增删档位，但已用档位不得删除（会阻断构建）
 */
export const SPACE = { xs: 4, sm: 8, md: 16, lg: 24, xl: 48, xxl: 64 } as const;

/**
 * BREAKPOINTS: 断点 / 画布档位
 * 作用：    声明本项目要产出哪几张画布
 * 临界参数：drawio 架构图为单画布产物，只声明一个档位；响应式页面才需要多档
 * 影响范围：build-tree 构建哪些树（以 layout.config.json 为准）
 * 可调范围：可增删档位；drawio 项目增档位等于多出一张图
 */
export const BREAKPOINTS = { hwsync: 0 } as const;

/**
 * ORIGIN: 画布原点
 * 作用：    贴边对齐的基准值
 * 可选值：  0（固定，作为唯一合法取值）
 * 影响范围：所有以画布边缘为基准的 x/y
 * 可调范围：固定为 0；存在的意义是让「贴边」也有变量出处，而不是裸写 0
 */
export const ORIGIN = 0;

/**
 * DRAWIO: 中国色 · 蓝色系色板
 * 作用：    架构图的语义配色唯一来源（渲染器只从快照读，不写死颜色）
 * 可选值：  十一档色值 —— 花青 / 靛蓝 / 宝蓝 / 靛青 / 藏青 / 石青 / 蓝灰 / 月白 / 雪白 / 墨
 * 影响范围：所有节点的描边与填充、连线颜色、层容器底色、图例
 * 可调范围：可整体换主题，但保持十一档结构（语义槽位与节点 kind 一一对应）
 */
export const DRAWIO = {
  huaQing: "#003472", // 标题 / 供电线
  dianLan: "#065279", // 数据流实线 / 重点层边框
  baoLan: "#4B5CC4", // 应用·业务节点 / 控制·调试虚线
  dianQing: "#177CB0", // 框架·中间件节点 / 总线
  zangQing: "#2E4E7E", // 硬件·物理节点
  shiQing: "#1685A9", // 数据·存储节点
  lanHui: "#A1AFC9", // 普通层容器虚线框
  yueBai: "#D6ECF0", // 重点层底色
  xueBai: "#F0FCFF", // 普通层底色 / 连线标签底
  mo: "#1F2A3D", // 节点文字
  base: "#FFFFFF", // 节点填充的混合底（描边色 : base = fillMix : 1-fillMix）
} as const;

/**
 * COLOR: 通用视觉 token
 * 作用：    供 drawio 之外的序列化器（preview / react）使用的基础色
 * 可选值：  十六进制颜色串；墨色 3 档 + 画布底与描边
 * 影响范围：预览图的底纹与文字层级
 * 可调范围：可整体替换主题，但保持「墨色 3 档」的结构以免对比度失控
 */
export const COLOR = {
  ink: "#1F2A3D",
  inkSoft: "#4A5568",
  inkFaint: "#94A3B8",
  canvas: "#FFFFFF",
  surface: "#F0FCFF",
  border: "#A1AFC9",
} as const;

/**
 * TYPE: 字体层级
 * 作用：    字号阶梯，避免渲染器里出现随手写的字号
 * 可选值：  28 / 15 / 13.5 / 11.5（px）
 * 影响范围：标题带、层标题、节点标题、说明行 / 连线标签
 * 可调范围：整体等比缩放（10 ~ 40px 区间）
 */
export const TYPE = {
  display: 28,
  section: 15,
  item: 13.5,
  note: 11.5,
} as const;

/**
 * RADIUS: 圆角与描边
 * 作用：    卡片圆角与线宽
 * 可选值：  圆角 14 / 10，线宽 1
 * 影响范围：层容器与节点卡片的形状观感
 * 可调范围：圆角 0 ~ 24；线宽 1 ~ 3
 */
export const RADIUS = { section: 14, item: 10, stroke: 1 } as const;

/**
 * SHADOW: 节点投影
 * 作用：    卡片纵深的唯一来源；drawio XML 通道用原生 shadow，自研 PNG 通道按 dy/blur/alpha 绘制
 * 可选值：  dy 与 blur 单位 px，alpha 0~255
 * 影响范围：普通节点卡片的投影（层容器与图例不投影，保持「背景」感）
 * 可调范围：dy 0~8；blur 0~24；alpha 0~64
 */
export const SHADOW = { node: { dy: 2, blur: 8, alpha: 26 } } as const;

/**
 * GRADIENT: 节点填充渐变
 * 作用：    卡片填充从 fillMix 到 endMix 的渐变，避免平色发闷
 * 可选值：  angle 为角度（度，映射到 mxGraph 四向）；endMix 为末端「描边色 : base」混合比 0~1
 * 影响范围：普通节点卡片的填充（填充起点仍由 DRAWIO_METRICS.fillMix 决定）
 * 可调范围：angle 0~360；endMix 须 ≥ fillMix 且 ≤ 0.5，否则失去淡彩
 */
export const GRADIENT = { angle: 120, endMix: 0.3 } as const;

/**
 * DRAWIO_METRICS: 架构图版面与文字度量
 * 作用：    把架构图特有的版面规矩（标题带、标签内边距、最小边距、填充混合比、图标度量）变成可追溯的 token
 * 可选值：  见下方各字段；数值单位均为 px，fillMix 为 0~1 比例
 * 影响范围：层标题带高度、文字不截断判定、四周边距判定、节点填充深浅、图标盒与文字左移量
 * 可调范围：layerHeadH 24~48；labelPad 4~16；minMargin / minLayerGap 32~96；fillMix 0.08~0.30；
 *           iconSize 16~40；iconPad / iconGap / iconTextGap 必须取自 SPACE 刻度（assert-layout 会检查）
 */
export const DRAWIO_METRICS = {
  fillMix: 0.16, // 节点填充 = 描边色与白色按 16:84 混合
  arcSizeItem: 30, // drawio 圆角百分比（相对短边）
  arcSizeSection: 12,
  strokeW: 1,
  layerHeadH: 32,
  labelPad: 8,
  lineHeight: 1.35, // 行高倍数（文字竖向溢出的判定基准）
  minMargin: 64,
  minLayerGap: 64,
  minNodeGap: 48,
  fontFamily: "Noto Sans CJK SC",
  // 技术栈图标（框架 / 编程语言 / 平台）：逻辑名见 assets/icons/catalog.json
  iconSize: 28, // 图标盒边长（px）；须 ≤ NODE_H - 2×iconPad
  iconPad: 16, // 图标距卡片左边；SPACE.md
  iconGap: 8, // 同一卡片多个图标的间距；SPACE.sm
  iconTextGap: 8, // 最后一个图标与文字之间的间距；SPACE.sm
} as const;
