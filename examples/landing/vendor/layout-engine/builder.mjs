/**
 * layout-engine 构建工具（零依赖，Node 与浏览器同构）。
 *
 * 用法（在项目的 src/layout/index.ts 中）：
 *   import { node, tree, canvas, pct, round } from ".../layout-engine/builder.mjs";
 *
 * 所有几何数值必须来自 variables/ 或对其他节点的引用，禁止裸字面量。
 */

/** @typedef {import("./layout-tree.d.ts").LayoutNode} LayoutNode */
/** @typedef {import("./layout-tree.d.ts").LayoutTree} LayoutTree */
/** @typedef {import("./layout-tree.d.ts").NodeSpec} NodeSpec */

/** 数值取整，消除浮点噪声（保证同一输入产出同一棵树）。 */
export function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** 父容器尺寸 × 比例 -> 像素。用于响应式百分比参数。 */
export function pct(parentSize, ratio) {
  return round(parentSize * ratio);
}

/** 求和，用于把若干约束项拼成一个坐标。 */
export function sum(...parts) {
  return round(parts.reduce((a, b) => a + b, 0));
}

/**
 * 中点与居中辅助。
 *
 * 为什么放在这里而不是让布局函数写 `(a + b) / 2`：lint-geometry 禁止布局代码里出现
 * 0/1 以外的数字字面量，`/ 2` 会被判定为几何裸字面量。把这类「通用的几何运算」
 * 收进布局引擎，既守住了规则，也让布局函数读起来是坐标系描述而不是算术。
 */
export function half(v) {
  return round(v / 2);
}

/** 居中内缩量：(outer − inner) / 2。 */
export function inset(outer, inner) {
  return round((outer - inner) / 2);
}

/** 两个数的中点。 */
export function midNum(a, b) {
  return round((a + b) / 2);
}

/** 节点横向 / 纵向中心。 */
export function centerX(n) {
  return round(n.x + n.w / 2);
}
export function centerY(n) {
  return round(n.y + n.h / 2);
}

/** 两个节点的横向 / 纵向中点（取中心值的中点）。 */
export function midX(a, b) {
  return midNum(centerX(a), centerX(b));
}
export function midY(a, b) {
  return midNum(centerY(a), centerY(b));
}

/** 上下相邻两个节点之间的空隙中点（用于把连线拐点压进层间空隙）。 */
export function gapMid(upper, lower) {
  return round((upper.y + upper.h + lower.y) / 2);
}

/** 数字格式化：保留两位小数，用于拼接 expr 的数值段。 */
export function num(v) {
  return String(round(v, 2));
}

/**
 * 估算一行文字的像素宽度（布局期用，让连线标签盒贴合文字，而不是写死一个宽度）。
 *
 * 规则与 check-drawio.measureLine 保持一致：CJK/全角按字号，拉丁/数字按 0.55 字号，空格更窄。
 * 它只用于“算盒子宽度”这个布局决策，不冒充真实字体度量；偏差由 pad 吸收。
 *
 * @param {string} text
 * @param {number} fontSize
 * @returns {number}
 */
export function textWidth(text, fontSize) {
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    w += ch === " " ? fontSize * 0.3 : c >= 0x2e80 ? fontSize : fontSize * 0.55;
  }
  return round(w, 2);
}

/**
 * 水平等分一排矩形。
 * @param {{x:number, y:number, innerW:number, h:number, count:number, gap:number}} spec
 * @returns {{x:number, y:number, w:number, h:number}[]}
 */
export function rowRects(spec) {
  const { x, y, innerW, h, count, gap } = spec;
  const w = Math.floor(((innerW - (count - 1) * gap) / count) * 100) / 100;
  return Array.from({ length: count }, (_, i) => ({ x: round(x + i * (w + gap)), y, w, h }));
}

/**
 * 垂直堆叠一列矩形。
 * @param {{x:number, y:number, w:number, itemH:number, count:number, gap:number}} spec
 * @returns {{x:number, y:number, w:number, h:number}[]}
 */
export function colRects(spec) {
  const { x, y, w, itemH, count, gap } = spec;
  return Array.from({ length: count }, (_, i) => ({ x, y: round(y + i * (itemH + gap)), w, h: itemH }));
}

/** 画布描述。 */
export function canvas(spec) {
  const { w, h, breakpoint } = spec;
  if (!(w > 0) || !(h > 0)) throw new Error(`canvas 尺寸非法: ${w}x${h}`);
  // 断点值不再限定为 mobile|desktop：drawio 架构图项目用视图名（如 hwsync）
  // 作为单画布标识。约束只剩「非空、小写字母起头」这个可归档性要求。
  if (typeof breakpoint !== "string" || !/^[a-z][a-z0-9-]*$/.test(breakpoint)) {
    throw new Error(`canvas.breakpoint 非法: ${breakpoint}（应匹配 /^[a-z][a-z0-9-]*$/，如 desktop / mobile / hwsync）`);
  }
  return { w, h, breakpoint };
}

/**
 * 创建一个布局节点。depth 由 tree() 统一计算，此处给的会被覆盖。
 * @param {NodeSpec} spec
 * @returns {LayoutNode}
 */
export function node(spec) {
  const { id, label, x, y, w, h, expr = {}, refs, note, children = [], depth = 0,
          kind, shape, textRotate, tone, align, silent, icon, accent } = spec;
  if (!id) throw new Error("node 缺少 id");
  for (const [k, v] of Object.entries({ x, y, w, h })) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`节点 ${id} 的 ${k} 不是有限数值: ${v}`);
    }
  }
  for (const k of Object.keys(expr)) {
    if (!["x", "y", "w", "h"].includes(k)) {
      throw new Error(`节点 ${id} 的 expr 含非法键: ${k}`);
    }
  }
  const out = {
    id,
    label: label ?? id,
    x,
    y,
    w,
    h,
    expr: { ...expr },
    depth,
    children: children.map((c) => node(c)),
  };
  // refs 是预留的变量引用声明（indexer 优先读它，读不到才做 AST 推断）
  if (refs !== undefined) out.refs = Array.isArray(refs) ? [...refs] : [String(refs)];
  // note 是可选的展示字段，不参与几何与校验
  if (note !== undefined) out.note = Array.isArray(note) ? [...note] : [String(note)];
  // 语义/展示字段（kind / shape / textRotate / tone / align）：非几何，不进哈希
  if (kind !== undefined) out.kind = kind;
  if (shape !== undefined) out.shape = shape;
  if (textRotate !== undefined) out.textRotate = textRotate;
  if (tone !== undefined) out.tone = tone;
  if (align !== undefined) out.align = align;
  if (silent !== undefined) out.silent = silent;
  // icon 是技术栈图标的逻辑名数组（查 assets/icons/catalog.json）：
  // 非几何语义字段，不进哈希；图标盒本身由 iconSlots() 算成子节点。
  if (icon !== undefined) out.icon = Array.isArray(icon) ? [...icon] : [String(icon)];
  // accent：分层色相（非几何，不进哈希）："compute" → 渲染器读 DRAWIO_ACCENT_COMPUTE
  if (accent !== undefined) out.accent = accent;
  return out;
}

/**
 * 技术栈图标槽位 —— 把卡片左侧的图标盒算成 kind:"icon" 子节点（带两段式 expr）。
 *
 * 为什么由布局函数算而不是渲染器算：图标盒有 x/y/w/h，属于几何；
 * 一旦放进序列化器，「图上的图标位置」就无法被 assert-layout / verify-positioning 复核。
 * 这里只做「卡片框 + 版面度量」的确定函数，与 drawio 规范中「禁止渲染器自动布局」一致。
 *
 * 图标在卡片内从左到右排列：第 i 个 x = card.x + pad + i*(size+gap)，纵向居中。
 * 渲染器据此把同一张卡片的文字左移 `pad + n*size + (n-1)*gap + textGap`，
 * 这就是「左图标 + 右文字」。
 *
 * @param {object} card 卡片节点（含 x/y/w/h 与 expr）
 * @param {string[]} keys 图标逻辑名（catalog.json 的键，由 check-drawio 校验存在性）
 * @param {object} m 版面度量 + 快照符号名
 *   size/pad/gap：像素值；sizeName/padName/gapName：它们在 variableSnapshot 里的键名。
 *   pad / gap 的取值必须落在 SPACE 刻度内（assert-layout 会检查 ICON_PAD / ICON_GAP）。
 * @returns {object[]} 可直接作为 card.children 的节点规格数组
 */
export function iconSlots(card, keys, m) {
  if (!card || !card.id) throw new Error("iconSlots 需要卡片节点");
  if (!Array.isArray(keys) || keys.length === 0) return [];
  const { size, pad, gap, sizeName = "ICON_SIZE", padName = "ICON_PAD", gapName = "ICON_GAP" } = m ?? {};
  for (const [k, v] of Object.entries({ size, pad, gap })) {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`iconSlots 的度量 ${k} 不是有限数值: ${v}`);
  }
  const sx = symbolic(card.expr?.x);
  const sy = symbolic(card.expr?.y);
  const sh = symbolic(card.expr?.h);
  const ex = (sym, numv) => `${sym} = ${numv}`;
  return keys.map((key, i) => {
    const x = round(card.x + pad + i * (size + gap));
    const y = round(card.y + (card.h - size) / 2);
    return {
      id: `${card.id}-icon-${key}`,
      label: key,
      kind: "icon",
      icon: [key],
      x,
      y,
      w: size,
      h: size,
      refs: [sizeName, padName, gapName],
      expr: {
        x: ex(
          `(${sx}) + ${padName} + ${i} * (${sizeName} + ${gapName})`,
          `${num(card.x)} + ${num(pad)} + ${i} * (${num(size)} + ${num(gap)})`,
        ),
        y: ex(
          `(${sy}) + ((${sh}) - ${sizeName}) / 2`,
          `${num(card.y)} + (${num(card.h)} - ${num(size)}) / 2`,
        ),
        w: ex(sizeName, num(size)),
        h: ex(sizeName, num(size)),
      },
      children: [],
    };
  });
}

/**
 * 取两段式 expr 的符号段（最后一个 "=" 之前）。
 * 锚点/途经点的 expr 就是由上游数值的符号段拼出来的，因此
 * 「树里那个 88 从哪来」能一路回溯到 variables/。
 */
export function symbolic(expr) {
  const s = String(expr ?? "");
  const i = s.lastIndexOf("=");
  return (i >= 0 ? s.slice(0, i) : s).trim() || "0";
}

const SIDES = ["N", "E", "S", "W"];
const ROLES = ["data", "control", "power"];
const ARROWS = ["forward", "both", "none"];

const rectOf = (n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, expr: n.expr ?? {} });

/**
 * 计算节点某条边上的锚点（绝对像素 + 两段式出处）。
 *
 * 锚点=「节点框 + 边」的确定函数，所以它属于布局计算，不属于渲染。
 * 渲染器只读 fromPt / toPt，不自己拿 x+w/2。
 *
 * @param {object} n 节点矩形（含 x/y/w/h/expr）
 * @param {"N"|"E"|"S"|"W"} side
 */
export function anchor(n, side) {
  const r = rectOf(n);
  if (!SIDES.includes(side)) throw new Error(`anchor 的 side 非法: ${side}`);
  const sx = symbolic(r.expr.x);
  const sy = symbolic(r.expr.y);
  const sw = symbolic(r.expr.w);
  const sh = symbolic(r.expr.h);
  const nx = num(r.x);
  const ny = num(r.y);
  const nw = num(r.w);
  const nh = num(r.h);
  const two = (sym, val) => `${sym} = ${val}`;
  switch (side) {
    case "N":
      return { x: round(r.x + r.w / 2), y: r.y,
               expr: { x: two(`(${sx}) + (${sw}) / 2`, `${nx} + ${nw} / 2`), y: two(`(${sy})`, ny) } };
    case "S":
      return { x: round(r.x + r.w / 2), y: round(r.y + r.h),
               expr: { x: two(`(${sx}) + (${sw}) / 2`, `${nx} + ${nw} / 2`), y: two(`(${sy}) + (${sh})`, `${ny} + ${nh}`) } };
    case "W":
      return { x: r.x, y: round(r.y + r.h / 2),
               expr: { x: two(`(${sx})`, nx), y: two(`(${sy}) + (${sh}) / 2`, `${ny} + ${nh} / 2`) } };
    default: // E
      return { x: round(r.x + r.w), y: round(r.y + r.h / 2),
               expr: { x: two(`(${sx}) + (${sw})`, `${nx} + ${nw}`), y: two(`(${sy}) + (${sh}) / 2`, `${ny} + ${nh} / 2`) } };
  }
}

/** 两点中点（含出处），用于正交路由的拐点。 */
export function midPoint(p, q) {
  return {
    x: round((p.x + q.x) / 2),
    y: round((p.y + q.y) / 2),
    expr: {
      x: `((${symbolic(p.expr?.x)}) + (${symbolic(q.expr?.x)})) / 2 = (${num(p.x)} + ${num(q.x)}) / 2`,
      y: `((${symbolic(p.expr?.y)}) + (${symbolic(q.expr?.y)})) / 2 = (${num(p.y)} + ${num(q.y)}) / 2`,
    },
  };
}

/** 把点 p 的某个轴坐标搬到值 v（出处同样替换为该轴的出处）。 */
function withAxis(p, axis, value, expr) {
  const out = { x: p.x, y: p.y, expr: { x: p.expr?.x, y: p.expr?.y } };
  out[axis] = value;
  out.expr[axis] = expr;
  return out;
}

/**
 * 正交路由：给两个节点和它们各自的出/入边，产出途经点数组（含出处）。
 *
 * 只处理「同轴」与「异轴」两种拓扑，产出 0~2 个拐点：
 *   - 同轴（S→N、E→W…）：走中位数线，共 2 个拐点
 *   - 异轴（S→E…）      ：1 个拐点
 * 拐点都在节间空隙里；若该空隙仍被占用，调用方应改用 viaPanel() 指定走廊。
 *
 * @returns {{x:number,y:number,expr:{x:string,y:string}}[]}
 */
export function route(from, fromSide, to, toSide) {
  const a = anchor(from, fromSide);
  const b = anchor(to, toSide);
  const vertA = fromSide === "N" || fromSide === "S";
  const vertB = toSide === "N" || toSide === "S";
  if (vertA && vertB) {
    if (Math.abs(a.x - b.x) < 0.01) return [];
    const m = midPoint(a, b);
    const p1 = withAxis(m, "x", a.x, a.expr.x);
    const p2 = withAxis(m, "x", b.x, b.expr.x);
    return [p1, p2];
  }
  if (!vertA && !vertB) {
    if (Math.abs(a.y - b.y) < 0.01) return [];
    const m = midPoint(a, b);
    const p1 = withAxis(m, "y", a.y, a.expr.y);
    const p2 = withAxis(m, "y", b.y, b.expr.y);
    return [p1, p2];
  }
  if (vertA) return [withAxis(a, "x", b.x, b.expr.x)];
  return [withAxis(a, "y", b.y, b.expr.y)];
}

/** 在指定的走廊坐标上布置拐点（用于长距离绕行，宁绕不穿）。 */
export function viaPanel(axis, value, from, fromSide, to, toSide, expr) {
  const a = anchor(from, fromSide);
  const b = anchor(to, toSide);
  return [withAxis(a, axis, value, expr), withAxis(b, axis, value, expr)];
}

/** 构造一个带两段式出处的点（供手工绕行走廊使用）。 */
export function waypoint(x, y, exprX, exprY) {
  if (typeof x !== "number" || typeof y !== "number") throw new Error(`waypoint 坐标必须是数值: ${x},${y}`);
  if (!exprX || !exprY) throw new Error(`waypoint(${x},${y}) 缺少两段式出处`);
  return { x, y, expr: { x: exprX, y: exprY } };
}

/**
 * 空隙轨道分配器 —— 让同一空隙里的多条连线不共线重合，且标签不互相压。
 *
 * 为什么要它：层间空隙（水平段）与右侧走廊（垂直段）是架构图里最容易「挤成一团」的地方。
 * 若每条连线都把拐点放在空隙中线上，多条线会**重合为一条超长直线**，
 * 读者无法知道那里其实有几条边（`assert-layout` 的「共线重合」检查会报错）。
 * 这里把「选轨道」与「选标签槽位」两件事收进引擎：
 *   - 轨道：对区间做贪心装箱，x（或 y）区间不相交的连线可以共用一条轨道；
 *   - 标签：轨距只有 20px，而标签高 24px，所以标签槽位必须**全局不重叠**，
 *     不是各轨道各管各的。槽位不够时**报错**，而不是默默重叠。
 *
 * @param {object} spec
 * @param {string} spec.name        快照键名前缀（如 "BAND1"）
 * @param {"y"|"x"} spec.axis       "y" = 水平段（层间空隙）；"x" = 垂直段（走廊）
 * @param {number} spec.center      空隙中线坐标
 * @param {number} [spec.tracks=3]  轨道数（必须 ≤ 空隙尺寸 / pitch）
 * @param {number} [spec.pitch=20]  轨距；要放标签时不得小于标签沿轨方向的尺寸
 * @param {number} [spec.labelSize] 标签沿轨方向的尺寸（不传则不分配标签槽位）
 * @param {number} [spec.labelGap=8] 标签槽位之间的最小间隙
 */
export function makeTrackRouter(spec) {
  const { name, axis, center, tracks = 3, pitch = 20, labelSize = null, labelGap = 8 } = spec;
  if (axis !== "x" && axis !== "y") throw new Error(`makeTrackRouter: axis 只能是 x 或 y，实际 ${axis}`);
  if (labelSize !== null && labelSize > pitch * tracks) {
    throw new Error(`${name}: 标签尺寸 ${labelSize} 放不进 ${tracks} 条轨道的空隙（可用 ${pitch * tracks}）`);
  }
  const onTrack = Array.from({ length: tracks }, () => []);
  const labelSlots = [];
  const snapshot = {};
  let labelCount = 0;
  const nudge = Math.max(1, Math.round(labelGap / 2));

  return {
    /**
     * 为一条连线（其在空隙里的投影区间为 [a,b]）分配轨道与标签槽位。
     * @returns {{pos:number, expr:string, labelPos?:number, labelPosExpr?:string}}
     */
    route(key, a, b) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      let idx = -1;
      for (let i = 0; i < tracks; i += 1) {
        if (onTrack[i].every(([p, q]) => hi <= p || lo >= q)) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        throw new Error(
          `${name}: 轨道已占满（${tracks} 条），连线 ${key} 的区间 [${num(lo)}, ${num(hi)}] 无处可放；` +
            `请减少穿过该空隙的连线，或提高 SEC_GAP / CHANNEL_W 并相应增加 tracks`,
        );
      }
      onTrack[idx].push([lo, hi]);
      const pos = round(center + (idx - (tracks - 1) / 2) * pitch);
      const posKey = `${name}_T${idx}`;
      snapshot[posKey] = pos;
      const out = { pos, expr: `${posKey} = ${num(pos)}` };

      if (labelSize !== null) {
        const halfLab = labelSize / 2;
        const from = lo + halfLab;
        const to = hi - halfLab;
        let chosen = null;
        if (to - from >= labelGap) {
          for (let c = from; c <= to + 0.001; c += nudge) {
            const c0 = round(c);
            if (labelSlots.every(([p, q]) => c0 - halfLab >= q || c0 + halfLab <= p)) {
              chosen = c0;
              break;
            }
          }
        } else {
          // 区间比标签还短：居中即可（仍然压在自己的线上）
          const c0 = round((lo + hi) / 2);
          if (labelSlots.every(([p, q]) => c0 - halfLab >= q || c0 + halfLab <= p)) chosen = c0;
        }
        if (chosen === null) {
          throw new Error(
            `${name}: 标签槽位不足，连线 ${key} 找不到不与已分配标签重叠的位置；` +
              `请调小 LABEL_W、减少该空隙内的连线，或把标签改到竖向线段上`,
          );
        }
        labelSlots.push([chosen - halfLab, chosen + halfLab]);
        const labKey = `${name}_L${labelCount}`;
        snapshot[labKey] = chosen;
        labelCount += 1;
        out.labelPos = chosen;
        out.labelPosExpr = `${labKey} = ${num(chosen)}`;
      }
      return out;
    },
    /** 该空隙用到的快照键（并入 variableSnapshot）。 */
    snapshot() {
      return { ...snapshot };
    },
  };
}

/** 层间空隙的水平轨道（axis="y"）。 */
export function bandRouter(spec) {
  return makeTrackRouter({ ...spec, axis: "y" });
}

/** 竖向走廊的垂直轨道（axis="x"）。 */
export function channelRouter(spec) {
  return makeTrackRouter({ ...spec, axis: "x" });
}

/**
 * 创建一条连线。from/to 传节点对象，锚点在这里算；via 传 route()/viaPanel()/waypoint() 的结果。
 *
 * @param {import("./layout-tree.d.ts").EdgeSpec} spec
 */
export function edge(spec) {
  const { id, from, to, fromSide, toSide, via = [], role = "data", arrow = "forward", labelNode } = spec;
  if (!id) throw new Error("edge 缺少 id");
  for (const [label, s] of [["fromSide", fromSide], ["toSide", toSide]]) {
    if (!SIDES.includes(s)) throw new Error(`edge ${id} 的 ${label} 非法: ${s}`);
  }
  if (!ROLES.includes(role)) throw new Error(`edge ${id} 的 role 非法: ${role}`);
  if (!ARROWS.includes(arrow)) throw new Error(`edge ${id} 的 arrow 非法: ${arrow}`);
  if (!from?.id || !to?.id) throw new Error(`edge ${id} 的 from/to 必须是节点对象（需带 id）`);
  const a = anchor(from, fromSide);
  const b = anchor(to, toSide);
  for (const p of via) {
    if (typeof p.x !== "number" || typeof p.y !== "number") throw new Error(`edge ${id} 的 via 点缺少坐标`);
    if (!p.expr?.x || !p.expr?.y) throw new Error(`edge ${id} 的 via 点缺少两段式出处（expr.x / expr.y）`);
  }
  const out = {
    id,
    from: { node: from.id, side: fromSide },
    to: { node: to.id, side: toSide },
    fromPt: { x: a.x, y: a.y },
    toPt: { x: b.x, y: b.y },
    fromPtExpr: { ...a.expr },
    toPtExpr: { ...b.expr },
    via: via.map((p) => ({ x: p.x, y: p.y })),
    role,
    arrow,
  };
  if (via.length) out.viaExpr = via.map((p) => ({ x: p.expr.x, y: p.expr.y }));
  if (labelNode !== undefined) out.labelNode = labelNode;
  return out;
}

function assignDepth(nodes, parentDepth) {
  for (const n of nodes) {
    n.depth = parentDepth;
    if (n.children.length) assignDepth(n.children, parentDepth + 1);
  }
}

/**
 * 组装一棵 Layout Tree。
 * @param {{canvas: ReturnType<typeof canvas>, variableSnapshot: Record<string, number|string>, elements: NodeSpec[]}} spec
 * @returns {LayoutTree}
 */
export function tree(spec) {
  const { canvas: c, variableSnapshot = {}, elements, edges = [] } = spec;
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error("tree 至少需要一个顶层元素");
  }
  const built = elements.map((e) => node(e));
  assignDepth(built, 0);
  const out = { canvas: c, variableSnapshot, elements: built };
  // edges 既接受 raw spec（由 tree 调用 edge() 归一化），也接受 edge() 的返回值
  // （布局函数里通常已经算好了锚点与途经点）。
  if (edges.length) out.edges = edges.map((e) => (e && e.fromPt && e.fromPtExpr ? e : edge(e)));
  return out;
}

/** 先序遍历展平。 */
export function flatten(nodes) {
  const out = [];
  const walk = (list) => {
    for (const n of list) {
      out.push(n);
      if (n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** 按 id 查找节点，找不到返回 undefined。 */
export function byId(root, id) {
  for (const n of flatten(Array.isArray(root) ? root : root.elements)) {
    if (n.id === id) return n;
  }
  return undefined;
}

/** 把树序列化为稳定 JSON（2 空格缩进，结尾换行）。 */
export function serializeTree(t) {
  return JSON.stringify(t, null, 2) + "\n";
}
