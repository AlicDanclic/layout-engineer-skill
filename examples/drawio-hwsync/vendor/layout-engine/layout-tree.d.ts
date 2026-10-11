/**
 * Layout Tree —— layout-engineer 的布局中间表示（IR）。
 *
 * **Layout Tree 是唯一的几何事实来源**：布局计算函数产出这棵树之后，
 * 定位图、React 渲染、图片渲染、几何校验，全都只是对同一棵树的不同「序列化」。
 *
 * 三项结构性保证：
 *   1. 同源保证：定位图上标的 88px 与最终页面里的 88px 是同一个数字。
 *   2. 可修改保证：改几何只有一条合法路径——改变量、重算树、重出图。
 *   3. 可验证保证：几何集中在一棵树里，越界/重叠/间距刻度才能写成脚本。
 *
 * 生成约定：
 *   - 计算函数必须是纯函数：同一输入 → 同一棵树（无副作用、无随机、无时间依赖）。
 *   - 计算函数体内零几何字面量，所有数字来自 variables/ 或上下文取值。
 *   - 双断点只允许在「构建上下文对象」时体现差异，坐标公式只有一份。
 */

export type Breakpoint = "mobile" | "desktop" | (string & {});

export interface LayoutNode {
  /** 元素唯一 ID：与代码变量名、定位图编号（①②③）、索引表键三处对齐 */
  id: string;
  /** 展示用标签，定位图上直接显示 */
  label: string;
  /** 左上角坐标与宽高，绝对像素，由约束表达式计算得出 */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 每个数值的出处：**带计算结果的算式字符串**，形如
   *   y: "HEADER_H + SPACE.lg = 64 + 24"
   *
   * 服务三个对象：
   *   - 定位图：标注显示为 `88px ⟵ HEADER_H + SPACE.lg = 64 + 24`
   *   - verify-positioning：两侧分别复算，都必须等于节点数值
   *   - 修改回路：diff 预览里的「影响元素」来自对 expr 的依赖分析
   *
   * 把结果写成 `64 + 24` 而不是直接写 `88`，是为了让「中间量」也留在记录里。
   */
  expr: {
    x?: string;
    y?: string;
    w?: string;
    h?: string;
  };
  /** 相对层级：顶层 0，子节点父 +1。决定圈选颜色与重叠检测分组 */
  depth: number;
  /**
   * 显式记录该节点引用了哪些变量。
   *
   * v1 保留字段：indexer 目前用 AST 启发式推断归属，读不到时才回退到这里；
   * v1.1 起布局函数应显式填写，indexer 从「猜归属」退化为「读字段」，误差归零。
   */
  refs?: string[];
  /** 可选的展示说明（多行），仅供预览/定位图渲染，不参与几何计算 */
  note?: string[];
  /**
   * 语义角色（**非几何字段，不进哈希**）。决定 drawio / 架构图渲染器用哪一档配色与形状。
   *
   *   title       标题带（花青）
   *   layer       分层容器（虚线框；tone=focus 时高亮为「重点层」）
   *   app         应用 / 业务节点（宝蓝）
   *   framework   框架 / 中间件节点（靛青）
   *   hardware    硬件 / 物理节点（藏青）
   *   storage     数据 / 存储节点（石青）
   *   bus         总线 / 事件总线（靛青，竖向长条配 textRotate=90）
   *   control     控制 / 调试节点（宝蓝虚线）
   *   legend      图例容器
   *   legendItem  图例项（swatch 由 shape 指定）
   *   edgeLabel   连线动作标签（白底无边框，覆盖在线段之上）
   *   plain       默认
   *
   * 改 kind 只换配色与形状，不动任何坐标，因此不使确认失效。
   */
  kind?: NodeKind;
  /** 形状覆盖 / 图例 swatch 类型（非几何）。缺省时由 kind 推导 */
  shape?: ShapeKind;
  /** 文字旋转（非几何）：0 = 横排；90 = 旋转 90°，用于竖向长条节点 */
  textRotate?: 0 | 90;
  /** 色调（非几何）：normal 普通层 / focus 重点层（靛蓝边框 + 月白底色） */
  tone?: "normal" | "focus";
  /** 文字对齐（非几何） */
  align?: "center" | "left";
  /**
   * 不写文字（非几何）。用于图例里的颜色/线型色样：它只有形状与颜色，没有文案。
   * 置 true 时序列化器不输出 value，因此不参与文字截断/重叠判定。
   */
  silent?: boolean;
  children: LayoutNode[];
}

/** 语义角色，见 LayoutNode.kind */
export type NodeKind =
  | "title"
  | "layer"
  | "app"
  | "framework"
  | "hardware"
  | "storage"
  | "bus"
  | "control"
  | "legend"
  | "legendItem"
  | "edgeLabel"
  // 图例专用的「连线色样」
  | "edgeData"
  | "edgeControl"
  | "edgePower"
  | "plain";

/** 形状覆盖（非几何） */
export type ShapeKind =
  | "rounded"
  | "rect"
  | "cylinder"
  | "process"
  | "hexagon"
  | "parallelogram"
  | "ellipse"
  | "bar"
  | "solid"
  | "dashed";

/** 连线锚点所在边 */
export type Side = "N" | "E" | "S" | "W";

/** 连线语义：数据流实线 / 控制调试虚线 / 供电线 */
export type EdgeRole = "data" | "control" | "power";

export interface LayoutEdgePoint {
  x: number;
  y: number;
}

/**
 * 一条连线。
 *
 * 关键约束：**端点与途经点全部是数据**（由布局纯函数经 builder 的 edge()/anchor()/route() 算出），
 * 渲染器只做字段映射，不自己算锚点、不自己找路由。
 */
export interface LayoutEdge {
  id: string;
  from: { node: string; side: Side };
  to: { node: string; side: Side };
  /** 起点（落在 from 节点边框上），绝对像素 */
  fromPt: LayoutEdgePoint;
  /** 终点（落在 to 节点边框上），绝对像素 */
  toPt: LayoutEdgePoint;
  /** 起点/终点的出处（两段式，与节点 expr 同规范） */
  fromPtExpr: { x: string; y: string };
  toPtExpr: { x: string; y: string };
  /** 显式途经点（不含端点），保证连线绕开节点 */
  via: LayoutEdgePoint[];
  /** 与 via 等长的出处数组 */
  viaExpr?: { x: string; y: string }[];
  role: EdgeRole;
  arrow?: "forward" | "both" | "none";
  /** 动作标签所在的节点 id（该节点 kind 应为 edgeLabel） */
  labelNode?: string;
}

export interface LayoutTree {
  /** 画布：坐标系与总宽高。断点差异只体现在这里与变量取值上 */
  canvas: { w: number; h: number; breakpoint: Breakpoint };
  /** 变量快照：本次计算时每个变量的取值（归档 + 复算验证的依据） */
  variableSnapshot: Record<string, number | string>;
  elements: LayoutNode[];
  /** 连线（可选）。架构图 / 流程图为必填，普通页面可省略 */
  edges?: LayoutEdge[];
}

export interface NodeSpec {
  id: string;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  expr?: Partial<LayoutNode["expr"]>;
  /** 预留：见 LayoutNode.refs */
  refs?: string[];
  note?: string[];
  /** 非几何展示字段，见 LayoutNode */
  kind?: NodeKind;
  shape?: ShapeKind;
  textRotate?: 0 | 90;
  tone?: "normal" | "focus";
  align?: "center" | "left";
  silent?: boolean;
  children?: NodeSpec[];
  depth?: number;
}

/** builder.edge() 的输入：from/to 传节点矩形对象，锚点由 builder 计算 */
export interface EdgeSpec {
  id: string;
  from: LayoutNode | { id: string; x: number; y: number; w: number; h: number; expr?: Partial<LayoutNode["expr"]> };
  fromSide: Side;
  to: EdgeSpec["from"];
  toSide: Side;
  /** 途经点（含出处）；通常由 builder.route() 产出 */
  via?: { x: number; y: number; expr?: { x?: string; y?: string } }[];
  role?: EdgeRole;
  arrow?: "forward" | "both" | "none";
  labelNode?: string;
}
