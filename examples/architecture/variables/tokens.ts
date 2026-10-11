/**
 * SPACE: 间距刻度
 * 作用：    全局元素间距的唯一来源
 * 可选值：  4 / 8 / 16 / 24 / 48，禁止刻度以外的间距值
 * 影响范围：所有区块与子盒子的间隔；assert-layout 据此判定快照中间距变量
 * 可调范围：可增删档位，但已用档位不得删除
 */
export const SPACE = { xs: 4, sm: 8, md: 16, lg: 24, xl: 48 } as const;

/**
 * BREAKPOINTS: 断点
 * 作用：    桌面端 / 移动端布局切换
 * 临界参数：视口宽 < 768px → 移动端（纵向堆叠）；≥ 768px → 桌面端（横向排列）
 * 影响范围：所有区块的排列方向与子项尺寸
 * 可调范围：可增删档位，但临界值一旦改动需重算双端 Layout Tree
 */
export const BREAKPOINTS = { mobile: 0, desktop: 768 } as const;

/**
 * ORIGIN: 画布原点
 * 作用：    贴边对齐的基准值
 * 可选值：  0（固定，作为唯一合法取值）
 * 影响范围：所有以画布边缘为基准的 x/y
 * 可调范围：固定为 0；存在的意义是让「贴边」也有变量出处，而不是裸写 0
 */
export const ORIGIN = 0;

/**
 * COLOR: 主题色板
 * 作用：    各区块的强调色与文字层级色，供渲染器读取（设计决策与几何一起归档）
 * 可选值：  十六进制颜色串；主色 4 档 + 墨色 3 档 + 画布底
 * 影响范围：区块卡片、子盒子强调条、标题/正文/注释三级文字
 * 可调范围：可整体替换主题，但保持「主色 4 档 + 墨色 3 档」的结构
 */
export const COLOR = {
  ink: "#0F172A",
  inkSoft: "#475569",
  inkFaint: "#94A3B8",
  canvas: "#F7F9FC",
  surface: "#FFFFFF",
  border: "#E4E9F2",
  workflow: "#2563EB",
  core: "#7C3AED",
  verify: "#059669",
  archive: "#D97706",
} as const;

/**
 * TYPE: 字体层级
 * 作用：    字号阶梯，避免渲染器里出现随手写的字号
 * 可选值：  28 / 15 / 13.5 / 11.5 / 10.5（px）
 * 影响范围：标题带、区块标题、子盒子标题、说明行、脚注
 * 可调范围：整体等比缩放（12 ~ 40px 区间）
 */
export const TYPE = {
  display: 28,
  section: 15,
  item: 13.5,
  note: 11.5,
  caption: 10.5,
} as const;

/**
 * RADIUS: 圆角与描边
 * 作用：    卡片圆角、强调条宽度、留白节奏
 * 可选值：  圆角 14 / 10，强调条 3
 * 影响范围：所有卡片的形状与内边距观感
 * 可调范围：圆角 0 ~ 20；强调条 0 ~ 6
 */
export const RADIUS = { section: 14, item: 10, accent: 3 } as const;

/**
 * SHADOW: 投影分级（elevation）
 * 作用：    卡片层叠高度的唯一来源；渲染器按级别读取，不得自写 dy/blur/alpha
 * 可选值：  elev1 子项卡片 / elev2 区块卡片 / elev3 悬浮徽章；dy 与 blur 单位 px，alpha 0~255
 * 影响范围：所有卡片的纵深层次
 * 可调范围：dy 0~16；blur 0~48；alpha 0~64；级别数量固定为三档
 */
export const SHADOW = {
  elev1: { dy: 2, blur: 8, alpha: 20 },
  elev2: { dy: 5, blur: 18, alpha: 28 },
  elev3: { dy: 10, blur: 32, alpha: 36 },
} as const;

/**
 * GRADIENT: 渐变
 * 作用：    卡片表面的渐变方向与强度，避免平色发闷
 * 可选值：  angle 为角度（度，0=自上而下，顺时针）；cardMix 为卡片末端混入区块色的比例 0~1
 * 影响范围：区块卡片与子项卡片的表面填充
 * 可调范围：angle 0~360；cardMix 0~0.2
 */
export const GRADIENT = { angle: 120, cardMix: 0.06 } as const;

/**
 * FONT: 字体族回退链
 * 作用：    渲染文字的唯一字体来源（逗号分隔，按优先级回退，渲染器跨平台解析）
 * 可选值：  系统字体族名；链尾必须是通用族（sans-serif / serif）
 * 影响范围：所有渲染通道的文字观感
 * 可调范围：可整链替换；保持「CJK 字体在前、通用族兜底」的结构
 */
export const FONT = {
  family: "MiSans,PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif",
} as const;
