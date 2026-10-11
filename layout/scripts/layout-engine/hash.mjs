/**
 * Layout Tree 指纹 —— 用于把「确认」绑定到一次具体的布局结果。
 *
 * **只对几何载荷取哈希**：canvas + 每个节点的 {id, depth, x, y, w, h, expr, children}。
 *
 * 刻意排除的三类内容：
 *   - variableSnapshot：改它不影响几何；
 *   - note（说明文字）、refs（变量引用声明）：展示与元数据，不动任何坐标；
 *   - 节点顺序以外的任何表现层字段。
 *
 * v1.2 新增 `edges`（可选）：无连线的树载荷字节不变，所以旧确认记录继续有效，
 * 无需升版本号；一旦有连线，端点/途经点/标签归属就全部入哈希。
 *
 * 这样「确认」表达的是「我认可这套几何」，而不是「我认可这版文案」——
 * 补一句说明不该逼用户重新确认布局，而移动 1px 必须重新确认。
 */
import crypto from "node:crypto";

/**
 * 哈希定义版本。
 * 修改 geometryPayload 的形状必须同时 +1 —— 否则旧记录的指纹会被误判成
 * 「布局变了」，而真正的原因是算法变了。check-confirmation 会读这个字段给出准确提示。
 */
export const HASH_VERSION = 2;

function geometryPayload(nodes) {
  return nodes.map((n) => ({
    id: n.id,
    depth: n.depth,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    expr: n.expr ?? {},
    children: geometryPayload(n.children ?? []),
  }));
}

/**
 * 连线的几何载荷：只要动到端点、途经点或标签归属，确认就必须失效。
 * 刻意排除 role / arrow（线型与箭头）——它们是「连线长什么样」，不是「连线在哪」。
 */
function edgePayload(edges) {
  return (edges ?? []).map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    fromPt: e.fromPt,
    toPt: e.toPt,
    via: e.via ?? [],
    labelNode: e.labelNode ?? null,
  }));
}

export function hashLayoutTree(tree) {
  const payload = JSON.stringify({
    canvas: tree.canvas,
    elements: geometryPayload(tree.elements ?? []),
    // 无连线的树（普通页面）哈希与 v2 一致；有连线时多一段载荷
    ...(tree.edges?.length ? { edges: edgePayload(tree.edges) } : {}),
  });
  return "sha256:" + crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}
