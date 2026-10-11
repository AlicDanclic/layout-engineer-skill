/**
 * Layout Tree 规范校验（零依赖）。
 *
 * 用于 assert-layout / indexer / verify-positioning 的公共入口。
 * 返回错误字符串数组；空数组表示合规。
 */

const NUMERIC = ["x", "y", "w", "h"];

/** 节点语义角色（非几何，但枚举必须收敛，否则渲染器无法穷举映射）。 */
export const NODE_KINDS = [
  "title", "layer", "app", "framework", "hardware", "storage",
  "bus", "control", "legend", "legendItem", "edgeLabel", "plain",
  // 图例专用的「连线色样」：分别对应 data / control / power 三种连线语义
  "edgeData", "edgeControl", "edgePower",
  // 技术栈图标（框架 / 编程语言 / 平台）：由 builder.iconSlots() 算出的卡片子节点
  "icon",
];
export const SHAPES = [
  "rounded", "rect", "cylinder", "process", "hexagon", "parallelogram",
  "ellipse", "bar", "solid", "dashed",
];
export const SIDES = ["N", "E", "S", "W"];
const EDGE_ROLES = ["data", "control", "power"];
const EDGE_ARROWS = ["forward", "both", "none"];
const BREAKPOINT_RE = /^[a-z][a-z0-9-]*$/;

/** 校验一条两段式 expr。 */
function checkExpr(v, who, field, errors) {
  if (typeof v !== "string" || v.trim() === "") {
    errors.push(`${who}.${field} 必须是非空表达式字符串`);
    return;
  }
  if (!v.includes("=")) {
    errors.push(
      `${who}.${field} 必须是「符号算式 = 数值算式」两段式（如 "HEADER_H + SPACE.lg = 64 + 24"），实际: ${v}`,
    );
  }
}

/**
 * @param {unknown} t
 * @returns {string[]} 错误列表
 */
export function validateLayoutTree(t) {
  const errors = [];
  if (t === null || typeof t !== "object" || Array.isArray(t)) {
    return ["LayoutTree 顶层必须是对象"];
  }
  const tree = /** @type {any} */ (t);

  // ---- canvas ----
  if (tree.canvas === null || typeof tree.canvas !== "object") {
    errors.push("canvas 缺失或不是对象");
  } else {
    const { w, h, breakpoint } = tree.canvas;
    if (!(typeof w === "number" && w > 0)) errors.push(`canvas.w 非法: ${w}`);
    if (!(typeof h === "number" && h > 0)) errors.push(`canvas.h 非法: ${h}`);
    if (typeof breakpoint !== "string" || !BREAKPOINT_RE.test(breakpoint)) {
      errors.push(`canvas.breakpoint 必须是 /^[a-z][a-z0-9-]*$/（desktop / mobile / 视图名），实际: ${breakpoint}`);
    }
  }

  // ---- variableSnapshot ----
  if (
    tree.variableSnapshot === null ||
    typeof tree.variableSnapshot !== "object" ||
    Array.isArray(tree.variableSnapshot)
  ) {
    errors.push("variableSnapshot 缺失或不是对象");
  }

  // ---- elements ----
  if (!Array.isArray(tree.elements) || tree.elements.length === 0) {
    errors.push("elements 必须是非空数组");
    return errors;
  }

  const seen = new Set();
  const walk = (nodes, expectedDepth, path) => {
    nodes.forEach((n, i) => {
      const at = `${path}[${i}]`;
      if (n === null || typeof n !== "object") {
        errors.push(`${at} 不是对象`);
        return;
      }
      if (typeof n.id !== "string" || n.id.length === 0) {
        errors.push(`${at}.id 必须是非空字符串`);
      } else if (seen.has(n.id)) {
        errors.push(`节点 id 重复: ${n.id}`);
      } else {
        seen.add(n.id);
      }
      const who = n.id ?? at;
      if (typeof n.label !== "string" || n.label.length === 0) {
        errors.push(`节点 ${who} 缺少展示用 label`);
      }
      for (const k of NUMERIC) {
        if (typeof n[k] !== "number" || !Number.isFinite(n[k])) {
          errors.push(`节点 ${who}.${k} 不是有限数值: ${n[k]}`);
        }
      }
      if (typeof n.w === "number" && n.w <= 0) errors.push(`节点 ${who}.w 必须 > 0`);
      if (typeof n.h === "number" && n.h <= 0) errors.push(`节点 ${who}.h 必须 > 0`);
      if (n.depth !== expectedDepth) {
        errors.push(`节点 ${who}.depth 应为 ${expectedDepth}，实际 ${n.depth}`);
      }
      if (n.expr === null || typeof n.expr !== "object" || Array.isArray(n.expr)) {
        errors.push(`节点 ${who}.expr 缺失或不是对象`);
      } else {
        for (const [k, v] of Object.entries(n.expr)) {
          if (!NUMERIC.includes(k)) errors.push(`节点 ${who}.expr 含非法键: ${k}`);
          else checkExpr(v, `节点 ${who}`, `expr.${k}`, errors);
        }
        // 定位图要求"每个数字都有出处"：凡是数值与默认不同的字段都应有 expr（由
        // verify-positioning 强制），此处只校验结构。
      }
      if (n.refs !== undefined && (!Array.isArray(n.refs) || n.refs.some((r) => typeof r !== "string"))) {
        errors.push(`节点 ${who}.refs 必须是字符串数组（预留字段，用于声明引用到的变量）`);
      }
      // ── 语义/展示字段（非几何，不进哈希）──
      if (n.kind !== undefined && !NODE_KINDS.includes(n.kind)) {
        errors.push(`节点 ${who}.kind 非法: ${n.kind}（可选 ${NODE_KINDS.join(" / ")}）`);
      }
      if (n.shape !== undefined && !SHAPES.includes(n.shape)) {
        errors.push(`节点 ${who}.shape 非法: ${n.shape}（可选 ${SHAPES.join(" / ")}）`);
      }
      if (n.textRotate !== undefined && n.textRotate !== 0 && n.textRotate !== 90) {
        errors.push(`节点 ${who}.textRotate 只能是 0 或 90，实际: ${n.textRotate}`);
      }
      if (n.tone !== undefined && n.tone !== "normal" && n.tone !== "focus") {
        errors.push(`节点 ${who}.tone 只能是 normal 或 focus，实际: ${n.tone}`);
      }
      if (n.align !== undefined && n.align !== "center" && n.align !== "left") {
        errors.push(`节点 ${who}.align 只能是 center 或 left，实际: ${n.align}`);
      }
      if (n.silent !== undefined && typeof n.silent !== "boolean") {
        errors.push(`节点 ${who}.silent 只能是布尔值，实际: ${n.silent}`);
      }
      // accent：分层色相（非几何）。值作为 token 名后缀："compute" → DRAWIO_ACCENT_COMPUTE
      if (n.accent !== undefined && (typeof n.accent !== "string" || !/^[a-z][a-z0-9-]*$/.test(n.accent))) {
        errors.push(`节点 ${who}.accent 必须是 /^[a-z][a-z0-9-]*$/ 的语义名（如 entry / compute / contract），实际: ${n.accent}`);
      }
      // icon：逻辑名数组（查技能 assets/icons/catalog.json）。
      // 卡片节点可挂多个（如 Tauri + Rust + Android）；kind:"icon" 节点恰好一个。
      if (n.icon !== undefined) {
        if (!Array.isArray(n.icon) || n.icon.some((k) => typeof k !== "string" || k.length === 0)) {
          errors.push(`节点 ${who}.icon 必须是非空字符串数组（如 ["python","rust"]）`);
        } else if (n.kind === "icon" && n.icon.length !== 1) {
          errors.push(`节点 ${who} 的 kind=icon 时 icon 必须恰好一个逻辑名，实际 ${n.icon.length} 个`);
        } else if (new Set(n.icon).size !== n.icon.length) {
          errors.push(`节点 ${who}.icon 含重复逻辑名: ${n.icon.join(",")}`);
        }
      } else if (n.kind === "icon") {
        errors.push(`节点 ${who} 的 kind=icon 必须提供 icon: ["<逻辑名>"]`);
      }
      if (!Array.isArray(n.children)) {
        errors.push(`节点 ${who}.children 必须是数组`);
      } else {
        walk(n.children, expectedDepth + 1, `${who}/children`);
      }
    });
  };
  walk(tree.elements, 0, "elements");

  // ---- edges ----
  const edges = tree.edges;
  if (edges !== undefined) {
    if (!Array.isArray(edges)) {
      errors.push("edges 必须是数组");
    } else {
      const edgeIds = new Set();
      edges.forEach((e, i) => {
        const at = `edges[${i}]`;
        if (e === null || typeof e !== "object") {
          errors.push(`${at} 不是对象`);
          return;
        }
        if (typeof e.id !== "string" || e.id.length === 0) errors.push(`${at}.id 必须是非空字符串`);
        else if (edgeIds.has(e.id)) errors.push(`连线 id 重复: ${e.id}`);
        else edgeIds.add(e.id);
        const who = `连线 ${e.id ?? at}`;

        for (const end of ["from", "to"]) {
          const v = e[end];
          if (v === null || typeof v !== "object") {
            errors.push(`${who}.${end} 缺失或不是对象`);
            continue;
          }
          if (!seen.has(v.node)) errors.push(`${who}.${end}.node 指向不存在的节点: ${v.node}`);
          if (!SIDES.includes(v.side)) errors.push(`${who}.${end}.side 非法: ${v.side}（可选 ${SIDES.join("/")}）`);
        }
        for (const key of ["fromPt", "toPt"]) {
          const p = e[key];
          if (p === null || typeof p !== "object") {
            errors.push(`${who}.${key} 缺失或不是对象`);
          } else {
            for (const f of ["x", "y"]) {
              if (typeof p[f] !== "number" || !Number.isFinite(p[f])) errors.push(`${who}.${key}.${f} 不是有限数值`);
            }
          }
        }
        for (const key of ["fromPtExpr", "toPtExpr"]) {
          const ex = e[key];
          if (ex === null || typeof ex !== "object") {
            errors.push(`${who}.${key} 缺失或不是对象（锚点必须带出处）`);
          } else {
            checkExpr(ex.x, who, `${key}.x`, errors);
            checkExpr(ex.y, who, `${key}.y`, errors);
          }
        }
        if (!Array.isArray(e.via)) {
          errors.push(`${who}.via 必须是数组`);
        } else {
          e.via.forEach((p, j) => {
            if (p === null || typeof p !== "object" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
              errors.push(`${who}.via[${j}] 必须是 { x, y } 有限数值`);
            }
          });
          if (e.via.length > 0) {
            if (!Array.isArray(e.viaExpr) || e.viaExpr.length !== e.via.length) {
              errors.push(`${who}.viaExpr 必须与 via 等长（每个途经点都要有出处）`);
            } else {
              e.viaExpr.forEach((ex, j) => {
                if (ex === null || typeof ex !== "object") {
                  errors.push(`${who}.viaExpr[${j}] 不是对象`);
                  return;
                }
                checkExpr(ex.x, who, `viaExpr[${j}].x`, errors);
                checkExpr(ex.y, who, `viaExpr[${j}].y`, errors);
              });
            }
          } else if (e.viaExpr !== undefined && e.viaExpr.length !== 0) {
            errors.push(`${who}.viaExpr 在 via 为空时必须为空`);
          }
        }
        if (e.role !== undefined && !EDGE_ROLES.includes(e.role)) {
          errors.push(`${who}.role 非法: ${e.role}（可选 ${EDGE_ROLES.join(" / ")}）`);
        }
        if (e.arrow !== undefined && !EDGE_ARROWS.includes(e.arrow)) {
          errors.push(`${who}.arrow 非法: ${e.arrow}（可选 ${EDGE_ARROWS.join(" / ")}）`);
        }
        if (e.labelNode !== undefined && !seen.has(e.labelNode)) {
          errors.push(`${who}.labelNode 指向不存在的节点: ${e.labelNode}`);
        }
      });
    }
  }

  return errors;
}

/**
 * 校验失败即抛错。@param {unknown} t @param {string} [where]
 */
export function assertLayoutTree(t, where = "layout-tree") {
  const errors = validateLayoutTree(t);
  if (errors.length) {
    throw new Error(`${where} 不符合 Layout Tree 规范:\n  - ${errors.join("\n  - ")}`);
  }
  return /** @type {import("./layout-tree.d.ts").LayoutTree} */ (t);
}
