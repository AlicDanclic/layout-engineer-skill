#!/usr/bin/env node
/**
 * 端到端测试：单元（含负例）+ 集成。
 * 运行：node tests/run.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { lintSource, lintProject } from "../layout/scripts/validate/lint-geometry.mjs";
import { assertTree, readSpacingScale } from "../layout/scripts/validate/assert-layout.mjs";
import { validateLayoutTree } from "../layout/scripts/layout-engine/schema.mjs";
import { bandRouter, channelRouter, makeTrackRouter } from "../layout/scripts/layout-engine/builder.mjs";
import { assertEdgeOverlap } from "../layout/scripts/validate/assert-layout.mjs";
import { verifyTree, evaluate, splitExpr } from "../layout/scripts/validate/verify-positioning.mjs";
import { validateDeclarations } from "../layout/scripts/docgen.mjs";
import { checkEnv } from "../layout/scripts/validate/check-env.mjs";
import { newProject } from "../scripts/new-project.mjs";
import { buildTrees } from "../layout/scripts/build-tree.mjs";
import { impactPreview } from "../layout/scripts/indexer.mjs";
import { serveViewer, listUrls } from "../layout/scripts/positioning-viewer/serve.mjs";
import { hashLayoutTree, HASH_VERSION } from "../layout/scripts/layout-engine/hash.mjs";
import { parseArgs, splitList } from "../layout/scripts/layout-engine/cli.mjs";
import { readConfirmations } from "../layout/scripts/layout-engine/confirm-store.mjs";
import { checkConfirmation, writeFixtureConfirmation } from "../layout/scripts/validate/check-confirmation.mjs";
import { loadTypeScript, analyzeSourceAst } from "../layout/scripts/layout-engine/ast.mjs";
import { renderReact } from "../drawio/scripts/serializers/react.mjs";
import { renderDrawio, nodeStyle, edgeStyle, isDrawioProject, iconTextInset } from "../drawio/scripts/serializers/drawio.mjs";
import { checkDrawioTree, checkDrawioProject, measureLine } from "../drawio/scripts/validate/check-drawio.mjs";
import { parseXml, findAll, parseStyle, escapeAttr } from "../drawio/scripts/xml.mjs";
import { anchor, edge, route, waypoint, half, inset, midX, gapMid, iconSlots, tree } from "../layout/scripts/layout-engine/builder.mjs";
import { buildCatalog, loadCatalog, resolveIcon } from "../drawio/scripts/icons/build-catalog.mjs";
import { checkDocs } from "./check-docs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = path.join(ROOT, "examples", "landing");
const ARCH = path.join(ROOT, "examples", "architecture");
const run = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", ...opts });
const must = (args, opts) => {
  const r = run(args, opts);
  assert.equal(r.status, 0, `${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r;
};

let pass = 0;
let fail = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (e) {
    console.error(`  ✗ ${name}\n      ${e.message.split("\n").join("\n      ")}`);
    fail += 1;
    failures.push(name);
  }
}

const node = (id, x, y, w, h, extra = {}) => ({
  id,
  label: id,
  x,
  y,
  w,
  h,
  expr: { x: "0 = 0", y: "0 = 0", w: `${w} = ${w}`, h: `${h} = ${h}` },
  depth: 0,
  children: [],
  ...extra,
});
const treeOf = (elements, canvas = { w: 100, h: 100, breakpoint: "desktop" }, snapshot = {}) => ({
  canvas,
  variableSnapshot: snapshot,
  elements,
});
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/**
 * 把示例项目复制到临时目录再操作。
 * 测试绝不允许改写 examples/ 本体——那里的 positioning/confirmed.json 是
 * 真实的人工确认记录，被测试覆盖掉就等于伪造确认。
 */
const SANDBOX = new Map();
function sandbox(name) {
  if (SANDBOX.has(name)) return SANDBOX.get(name);
  const src = path.join(ROOT, "examples", name);
  const dst = path.join(tmp(`le-${name}-`), name);
  fs.mkdirSync(dst, { recursive: true });
  for (const dir of ["variables", "src"]) {
    fs.cpSync(path.join(src, dir), path.join(dst, dir), {
      recursive: true,
      // src/serializers 是生成物，不属于源
      filter: (s) => !/src[\\/]serializers/.test(s),
    });
  }
  for (const f of [".nvmrc", "package.json", "package-lock.json", "storyboard.json", "layout.config.json", "README.md"]) {
    if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
  // vendor 实体化（示例里是软链，拷到临时目录会失效）
  fs.mkdirSync(path.join(dst, "vendor"), { recursive: true });
  fs.cpSync(path.join(ROOT, "layout", "scripts", "layout-engine"), path.join(dst, "vendor", "layout-engine"), { recursive: true });
  fs.mkdirSync(path.join(dst, "layout-tree"), { recursive: true });
  must([path.join(ROOT, "layout", "scripts", "build-tree.mjs"), "--project", dst]);
  SANDBOX.set(name, dst);
  return dst;
}

const ARCH2 = path.join(ROOT, "examples", "drawio-hwsync");

/** drawio 测试用的最小设计 token 快照（值与 templates/drawio 一致）。 */
const DRAWIO_SNAP = {
  DRAWIO_HUAQING: "#003472", DRAWIO_DIANLAN: "#065279", DRAWIO_BAOLAN: "#4B5CC4",
  DRAWIO_DIANQING: "#177CB0", DRAWIO_ZANGQING: "#2E4E7E", DRAWIO_SHIQING: "#1685A9",
  DRAWIO_LANHUI: "#A1AFC9", DRAWIO_YUEBAI: "#D6ECF0", DRAWIO_XUEBAI: "#F0FCFF",
  DRAWIO_MO: "#1F2A3D", DRAWIO_BASE: "#FFFFFF", DRAWIO_FILL_MIX: 0.16, DRAWIO_FONT_FAMILY: "Noto Sans CJK SC",
  DRAWIO_STROKE_W: 1, DRAWIO_ARC_SIZE_ITEM: 30, DRAWIO_ARC_SIZE_SECTION: 12,
  DRAWIO_LAYER_HEAD_H: 32, DRAWIO_LABEL_PAD: 8, DRAWIO_LINE_HEIGHT: 1.35,
  DRAWIO_MIN_MARGIN: 64,
  TYPE_DISPLAY: 28, TYPE_SECTION: 15, TYPE_ITEM: 13.5, TYPE_NOTE: 11.5, RADIUS_SECTION: 14, RADIUS_ITEM: 10,
};

/** 构造一棵含 edges 的最小架构图树（坐标入参即真相，方便写负例）。 */
function drawioTree({ a = { x: 64, y: 64, w: 200, h: 72 }, b = { x: 64, y: 224, w: 200, h: 72 }, label, labelBox, via } = {}) {
  const snap = { ...DRAWIO_SNAP, MARGIN: 64, NODE_W: 200, NODE_H: 72, GAP: 64, LBL_W: 96, LBL_H: 24 };
  const mk = (id, r, kind) => ({ id, label: id, kind, x: r.x, y: r.y, w: r.w, h: r.h,
    expr: { x: `MARGIN = ${r.x}`, y: `MARGIN = ${r.y}`, w: `NODE_W = ${r.w}`, h: `NODE_H = ${r.h}` }, depth: 0, children: [] });
  const na = mk("a", a, "app");
  const nb = mk("b", b, "hardware");
  const elements = [na, nb];
  if (label !== undefined) {
    const r = labelBox ?? { x: 130, y: 160, w: 96, h: 24 };
    elements.push({ id: "lbl", label, kind: "edgeLabel", x: r.x, y: r.y, w: r.w, h: r.h,
      expr: { x: `LBL_X = ${r.x}`, y: `LBL_Y = ${r.y}`, w: `LBL_W = ${r.w}`, h: `LBL_H = ${r.h}` }, depth: 0, children: [] });
    snap.LBL_X = r.x; snap.LBL_Y = r.y;
  }
  const e = via
    ? { id: "e1", from: { node: "a", side: "S" }, to: { node: "b", side: "N" },
        fromPt: { x: a.x + a.w / 2, y: a.y + a.h }, toPt: { x: b.x + b.w / 2, y: b.y },
        fromPtExpr: { x: "MARGIN = 64", y: "MARGIN = 64" }, toPtExpr: { x: "MARGIN = 64", y: "MARGIN = 64" },
        via, viaExpr: via.map((p) => ({ x: `VX = ${p.x}`, y: `VY = ${p.y}` })), role: "data", arrow: "forward",
        ...(label !== undefined ? { labelNode: "lbl" } : {}) }
    : edge({ id: "e1", from: na, fromSide: "S", to: nb, toSide: "N", via: route(na, "S", nb, "N"), role: "data",
             ...(label !== undefined ? { labelNode: "lbl" } : {}) });
  return { tree: { canvas: { w: 480, h: 400, breakpoint: "hwsync" }, variableSnapshot: snap, elements, edges: [e] }, e };
}

console.log("layout-engineer · 测试\n\n单元：");

// ── lint-geometry ──────────────────────────────────────────────────────

await test("lint-geometry 命中几何裸字面量并给改法", () => {
  const hits = lintSource("const y = HEADER_H + 10;\nconst n = { x: 0, y: 88 };", "src/layout/t.ts");
  assert.ok(hits.length >= 2, `期望 ≥2 处，实际 ${hits.length}`);
  assert.ok(hits.every((h) => h.advice && h.advice.length > 6), "每处都要带可行动改法");
  assert.ok(hits.every((h) => h.value !== 0 && h.value !== 1), "0/1 应豁免");
});

await test("lint-geometry 对 variables/ 整目录白名单", () => {
  const src = "export const HEADER_H = 64; export const GAP = 24;";
  assert.equal(lintSource(src, "variables/layout.ts").length, 0);
  assert.equal(lintSource(src, "src/variables/layout.ts").length, 0);
});

await test("lint-geometry 不误报合法表达", () => {
  const src = [
    "const y = ctx.headerH + ctx.gapLg;",
    "const w = areaW - (ctx.cols - 1) * SPACE.md;",
    "const arr = [0, 1];",
    "for (let i = 0; i < n; i += 1) {}",
  ].join("\n");
  assert.equal(lintSource(src, "src/layout/t.ts").length, 0);
});

await test("lint-geometry 对两个示例项目通过", () => {
  assert.equal(lintProject(EXAMPLE).length, 0);
  assert.equal(lintProject(ARCH).length, 0);
});

// ── assert-layout ──────────────────────────────────────────────────────

await test("assert-layout 检出兄弟重叠与越界（父子包含不算重叠）", () => {
  const allowed = new Set([0, 8, 16, 24]);
  const errs = [];
  assertTree(treeOf([node("a", 0, 0, 60, 20), node("b", 10, 0, 60, 20)]), allowed, errs);
  assert.ok(errs.some((e) => e.includes("兄弟元素重叠")), errs.join("; "));

  const errs2 = [];
  assertTree(treeOf([node("o", 0, 0, 200, 20)]), allowed, errs2);
  assert.ok(errs2.some((e) => e.includes("越界")), errs2.join("; "));

  // 父包住子是正常的，不应报重叠
  const parent = node("p", 0, 0, 60, 60, { children: [node("c", 10, 10, 20, 20)] });
  parent.children[0].depth = 1;
  const errs3 = [];
  assertTree(treeOf([parent]), allowed, errs3);
  assert.ok(!errs3.some((e) => e.includes("重叠")), errs3.join("; "));
});

await test("assert-layout 检出非刻度间距与快照间距越界", () => {
  const errs = [];
  assertTree(treeOf([node("a", 0, 0, 40, 20), node("b", 53, 0, 40, 20)]), new Set([0, 8, 16, 24]), errs);
  assert.ok(errs.some((e) => e.includes("不在 SPACE 刻度内")), errs.join("; "));

  const errs2 = [];
  assertTree(treeOf([node("a", 0, 0, 40, 20)], undefined, { GAP_X: 13 }), new Set([0, 8, 16, 24]), errs2);
  assert.ok(errs2.some((e) => e.includes("属于间距类")), errs2.join("; "));
});

await test("assert-layout 检出 expr 缺失", () => {
  const bad = node("a", 0, 0, 10, 10);
  delete bad.expr.w;
  const errs = [];
  assertTree(treeOf([bad]), new Set([0]), errs);
  assert.ok(errs.some((e) => e.includes("缺少 expr")), errs.join("; "));
});

await test("assert-layout 读取 tokens 间距刻度", () => {
  const scale = readSpacingScale(EXAMPLE);
  assert.ok(scale && scale.has(8) && scale.has(24));
});

// ── verify-positioning（两段式）─────────────────────────────────────────

await test("verify-positioning 两段复算：符号段、数值段、树值三者一致", () => {
  const ok = treeOf([
    node("a", 88, 0, 10, 10, { expr: { x: "HEADER_H + GAP_LG = 64 + 24", y: "0 = 0", w: "10 = 10", h: "10 = 10" } }),
  ], { w: 100, h: 100, breakpoint: "desktop" }, { HEADER_H: 64, GAP_LG: 24 });
  assert.equal(verifyTree(ok, "t").length, 0);

  // 符号段对、数值段错 → 必须报出来
  const bad = treeOf([
    node("a", 88, 0, 10, 10, { expr: { x: "HEADER_H + GAP_LG = 64 + 25", y: "0 = 0", w: "10 = 10", h: "10 = 10" } }),
  ], { w: 100, h: 100, breakpoint: "desktop" }, { HEADER_H: 64, GAP_LG: 24 });
  const errs = verifyTree(bad, "t");
  assert.ok(errs.some((e) => e.includes("数值段复算")), errs.join("; "));
  assert.ok(errs.some((e) => e.includes("不等")), errs.join("; "));
});

await test("verify-positioning 拒绝非两段式与未代入的序号", () => {
  const one = treeOf([node("a", 5, 0, 10, 10, { expr: { x: "5", y: "0", w: "10", h: "10" } })]);
  assert.ok(verifyTree(one, "t").some((e) => e.includes("两段式")));

  const idx = treeOf(
    [node("a", 5, 0, 10, 10, { expr: { x: "GAP + i*GAP = 5", y: "0 = 0", w: "10 = 10", h: "10 = 10" } })],
    { w: 100, h: 100, breakpoint: "desktop" },
    { GAP: 5 },
  );
  assert.ok(verifyTree(idx, "t").some((e) => e.includes("变量 i 不在")), "序号未代入必须报错");
});

await test("verify-positioning 算术求值器与 splitExpr", () => {
  assert.ok(Math.abs(evaluate("CARD_AREA_X + 1 * (CARD_W + SPACE.md)", { CARD_AREA_X: 288, CARD_W: 357.33, "SPACE.md": 16 }) - 661.33) < 0.01);
  assert.throws(() => evaluate("UNKNOWN + 1", {}), /不在 variableSnapshot/);
  assert.deepEqual(splitExpr("A + B = 1 + 2"), ["A + B ", " 1 + 2"]);
  assert.deepEqual(splitExpr("42"), [null, "42"]);
});

// ── docgen / check-env ─────────────────────────────────────────────────

await test("docgen 检出注释缺要素", () => {
  const warnings = [];
  const errors = validateDeclarations(
    [{
      kind: "function", name: "f", line: 3,
      params: [{ name: "a", desc: "" }], returns: null, returnType: "number",
      doc: { fields: { 功能: "x" }, params: [], returns: null },
    }],
    "t.ts",
    warnings,
  );
  assert.ok(errors.some((e) => e.includes("实现原理")));
  assert.ok(errors.some((e) => e.includes("@param a")));
  assert.ok(errors.some((e) => e.includes("@returns")));
});

await test("check-env 检出缺 .nvmrc 与 globalInstall 自报", () => {
  const dir = tmp("le-env-");
  try {
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"x","version":"1.0.0"}');
    assert.ok(checkEnv(dir).errors.some((e) => e.includes(".nvmrc")));

    fs.writeFileSync(path.join(dir, ".nvmrc"), "22");
    fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ globalInstall: true }));
    assert.ok(checkEnv(dir).errors.some((e) => e.includes("globalInstall")), "自报 true 必须报错");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── indexer / AST ──────────────────────────────────────────────────────

await test("AST 分析：全大写标识符归属到最近的 id", async () => {
  const ts = await loadTypeScript();
  assert.ok(ts, "typescript 应可用（npm install 已在 Skill 内完成）");
  const src = `
    const header = node({ id: "header", h: HEADER_H });
    const list = node({ id: "card-list", y: HEADER_H + GAP_LG });
    function helper() { return GAP_LG; }
    const explicit = node({ id: "footer", refs: ["FOOTER_H"], h: FOOTER_H });
  `;
  const { usage } = analyzeSourceAst(src, "t.ts", ts);
  assert.ok(usage.get("HEADER_H").has("header"), "HEADER_H 应归属 header");
  assert.ok(usage.get("HEADER_H").has("card-list"));
  assert.ok(usage.get("GAP_LG").has("card-list"));
  assert.ok(usage.get("GAP_LG").has("(unknown)"), "辅助函数内借用应落 unknown 桶");
  assert.ok(usage.get("FOOTER_H").has("footer"), "refs 命中时按 id 归属");
});

await test("indexer 反向索引与 manifest 三重结构", async () => {
  const L = sandbox("landing");
  const r = impactPreview(L, "HEADER_H", 56);
  assert.ok(r.ok, r.message);
  assert.ok(r.data.affected.length > 0, "应给受影响元素");
  assert.ok(r.data.affected.every((h) => h.parts.length > 0));
  assert.ok(r.text.includes("确认执行？[y/n]"), r.text);
  assert.ok(/影响元素：.*①/.test(r.text), "影响元素要带 ①②③ 编号：" + r.text);

  must([path.join(ROOT, "layout", "scripts", "indexer.mjs"), "--project", L]);
  const m = JSON.parse(fs.readFileSync(path.join(L, "manifest.json"), "utf8"));
  assert.ok(m.variableSnapshot && Object.keys(m.variableSnapshot).length > 0, "variableSnapshot 必需");
  assert.ok(Array.isArray(m.variableUsage.HEADER_H) && m.variableUsage.HEADER_H.includes("header"), "variableUsage 必需");
  assert.ok(m.confirmations && typeof m.confirmations.structure === "boolean", "confirmations 必需");
  assert.equal(m.globalInstall, false, "globalInstall 自报字段必需");
  assert.ok(m.refs && m.refs.reserved === true, "refs 预留标记必需");
});

// ── 确认闭环 ───────────────────────────────────────────────────────────

await test("确认闸门：无记录阻断 / 夹具放行 / 改树后失效", () => {
  const dir = tmp("le-conf-");
  try {
    const tree = treeOf([node("a", 0, 0, 50, 20)]);
    const write = () => {
      fs.mkdirSync(path.join(dir, "layout-tree"), { recursive: true });
      fs.writeFileSync(path.join(dir, "layout-tree", "desktop.json"), JSON.stringify(tree));
    };
    write();

    let r = checkConfirmation(dir);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("确认节点")), r.errors.join("; "));

    writeFixtureConfirmation(dir);
    r = checkConfirmation(dir);
    assert.equal(r.ok, true, r.errors.join("; "));
    assert.ok(r.warnings.some((w) => w.includes("fixture")), "fixture 来源必须告警");
    assert.ok(fs.existsSync(path.join(dir, "positioning", "confirmed-desktop.svg")));

    // 记录形态：{node, bp, hidden, 时间戳, treeHash}
    const rec = readConfirmations(dir).records.find((x) => x.node === "positioning");
    assert.equal(rec.bp, "desktop");
    assert.ok(Array.isArray(rec.hidden));
    assert.ok(rec.confirmedAt && rec.treeHash === hashLayoutTree(tree));

    tree.elements[0].w = 80;
    write();
    r = checkConfirmation(dir);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("已失效")), r.errors.join("; "));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test("分镜闸门与静态闸门分开", () => {
  const dir = tmp("le-story-");
  try {
    fs.mkdirSync(path.join(dir, "layout-tree"), { recursive: true });
    fs.writeFileSync(path.join(dir, "layout-tree", "desktop.json"), JSON.stringify(treeOf([node("a", 0, 0, 50, 20)])));
    writeFixtureConfirmation(dir);
    // 没有 timeline.json 时，storyboard 模式必须阻断
    const r = checkConfirmation(dir, { mode: "storyboard" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("timeline.json") || e.includes("Storyboard")), r.errors.join("; "));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test("渲染入口在未确认时被阻断（非零退出）", () => {
  const dir = tmp("le-gate-");
  try {
    fs.mkdirSync(path.join(dir, "layout-tree"), { recursive: true });
    fs.writeFileSync(path.join(dir, "layout-tree", "desktop.json"), JSON.stringify(treeOf([node("a", 0, 0, 50, 20)])));
    const r = run([path.join(ROOT, "drawio", "scripts", "serializers", "preview.mjs"), "--project", dir]);
    assert.notEqual(r.status, 0);
    assert.ok((r.stderr + r.stdout).includes("确认闸门未通过"), r.stderr + r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test("confirm.mjs 落盘 structure / storyboard 记录", () => {
  const L = sandbox("landing");
  const r = run([
    path.join(ROOT, "layout", "scripts", "confirm.mjs"),
    "--project", L, "--node", "structure", "--source", "user-chat", "--note", "测试",
  ]);
  assert.equal(r.status, 0, r.stderr);
  const rec = readConfirmations(L).records.find((x) => x.node === "structure");
  assert.ok(rec && rec.source === "user-chat" && rec.note === "测试");
});

// ── 序列化器铁律 ───────────────────────────────────────────────────────

await test("react 序列化器零几何计算 + 挂 data 属性", () => {
  const L = sandbox("landing");
  const trees = Object.fromEntries(
    ["desktop", "mobile"].map((bp) => [bp, JSON.parse(fs.readFileSync(path.join(L, "layout-tree", `${bp}.json`), "utf8"))]),
  );
  const out = renderReact(trees);
  assert.ok(out.includes("left: node.x"), "坐标必须原样映射");
  assert.ok(out.includes("data-layout-id") && out.includes("data-expr"), "必须挂可追溯属性");
  assert.ok(!/\*\s*100/.test(out), "不得出现百分比换算");
  assert.ok(!/canvas\.w\s*\//.test(out), "不得对画布宽做除法");
  assert.ok(out.includes("--layout-scale"), "缩放交给 CSS 变量");
});

// ── viewer 网络 ────────────────────────────────────────────────────────

await test("viewer 默认对外暴露端口（--host 0.0.0.0）", () => {
  // serve.mjs 现在用统一解析器；这里验证它与 cli.mjs 的约定一致
  const a = parseArgs(["--host", "127.0.0.1", "--token=t0k", "--port", "8080"],
    { project: ".", port: 5173, host: "0.0.0.0", token: null, _: [] });
  assert.equal(a.host, "127.0.0.1");
  assert.equal(a.token, "t0k", "应支持 --k=v");
  assert.equal(a.port, 8080);
  assert.ok(listUrls("0.0.0.0", 5173).some((u) => u.includes("localhost")));
  assert.equal(listUrls("127.0.0.1", 5173).length, 1);
});

await test("viewer token 校验与 API 可读性", async () => {
  // 用沙箱（干净检出时 examples/ 下没有生成产物）
  const { server } = serveViewer({ projectDir: sandbox("landing"), port: 0, host: "127.0.0.1", token: "t0k" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/trees`)).status, 401);
    assert.equal((await fetch(`${base}/api/trees?token=wrong`)).status, 401);
    const ok = await fetch(`${base}/api/trees?token=t0k`);
    assert.equal(ok.status, 200);
    const data = await ok.json();
    assert.ok(data.trees.desktop && data.trees.mobile);
    assert.equal((await fetch(`${base}/`)).status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

await test("parseArgs：未知选项及其取值不得被当成位置参数", () => {
  // 真实事故：lint-geometry 把 `--scope desktop` 的 desktop 当文件路径读，裸抛 ENOENT
  const a = parseArgs(["--project", "p", "--scope", "desktop", "--allow-unconfirmed"], {
    project: ".", scope: null, "allow-unconfirmed": false, _: [],
  });
  assert.equal(a.project, "p");
  assert.equal(a.scope, "desktop");
  assert.equal(a["allow-unconfirmed"], true);
  assert.deepEqual(a._, [], "未知选项的取值不能落进位置参数");
  const b = parseArgs(["--project=p", "--port=8080"], { project: ".", port: 1, _: [] });
  assert.equal(b.project, "p");
  assert.equal(b.port, 8080);
  assert.deepEqual(splitList("desktop, mobile"), ["desktop", "mobile"]);
});

await test("哈希定义升级时给出准确提示（不是误报「布局变了」）", () => {
  const dir = tmp("le-hashver-");
  try {
    fs.mkdirSync(path.join(dir, "layout-tree"), { recursive: true });
    const tree = treeOf([node("a", 0, 0, 50, 20)]);
    fs.writeFileSync(path.join(dir, "layout-tree", "desktop.json"), JSON.stringify(tree));
    fs.mkdirSync(path.join(dir, "positioning"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "positioning", "confirmed.json"),
      JSON.stringify({
        records: [
          { node: "structure", source: "user-chat", confirmedAt: "x" },
          { node: "positioning", bp: "desktop", source: "user-chat",
            treeHash: "sha256:old", hashVersion: HASH_VERSION - 1, svg: "positioning/confirmed-desktop.svg" },
        ],
      }),
    );
    fs.writeFileSync(path.join(dir, "positioning", "confirmed-desktop.svg"), "<svg/>");
    const r = checkConfirmation(dir);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("哈希定义已升级")), r.errors.join("; "));
    assert.ok(!r.errors.some((e) => e.includes("layout-tree 发生变化")), "不应误报成布局变化");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test("交付范围可持久化到 manifest.deliveryScope 并被闸门默认采用", () => {
  const dir = tmp("le-scope-");
  try {
    const src = sandbox("architecture");
    fs.cpSync(path.join(src, "layout-tree"), path.join(dir, "layout-tree"), { recursive: true });
    fs.cpSync(path.join(src, "variables"), path.join(dir, "variables"), { recursive: true });
    fs.cpSync(path.join(src, "src"), path.join(dir, "src"), { recursive: true });
    // 只确认 desktop
    must([path.join(ROOT, "layout", "scripts", "confirm.mjs"), "--project", dir, "--node", "structure", "--source", "user-chat"]);
    must([path.join(ROOT, "layout", "scripts", "confirm.mjs"), "--project", dir, "--node", "positioning", "--bp", "desktop", "--source", "user-chat"]);
    must([path.join(ROOT, "layout", "scripts", "indexer.mjs"), "--project", dir, "--scope", "desktop"]);
    const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    assert.deepEqual(m.deliveryScope, ["desktop"], "indexer 应把交付范围写进 manifest");
    // 不带 --scope 时，闸门应读 manifest.deliveryScope
    const r = checkConfirmation(dir);
    assert.equal(r.ok, true, r.errors.join("; "));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test("docgen 按函数校验箭头函数常量（曾把 @param 漏掉）", async () => {
  const src = [
    "/**",
    " * 求和",
    " *",
    " * @param a 左值",
    " * @param b 右值",
    " * @returns 两者之和",
    " *",
    " * 功能：求和。",
    " * 实现原理：a + b。",
    " */",
    "const add = (a: number, b: number): number => a + b;",
  ].join("\n");
  const { extractDeclarations } = await import("../layout/scripts/docgen.mjs");
  const decls = extractDeclarations(src, "src/layout/t.ts");
  assert.equal(decls[0].kind, "function", "箭头函数常量应识别为函数");
  assert.deepEqual(decls[0].params.map((p) => p.name), ["a", "b"]);
  const w = [];
  assert.equal(validateDeclarations(decls, "src/layout/t.ts", w).length, 0);
});

await test("Python 序列化器同样受确认闸门管辖（不能走后门）", () => {
  const dir = tmp("le-py-");
  try {
    const src = sandbox("architecture");
    fs.cpSync(path.join(src, "layout-tree"), path.join(dir, "layout-tree"), { recursive: true });
    const out = path.join(dir, "p.png");
    const r = spawnSync(
      "python3",
      [path.join(ROOT, "drawio", "scripts", "serializers", "diagram.py"), "--tree",
       path.join(dir, "layout-tree", "desktop.json"), "--out", out],
      { encoding: "utf8" },
    );
    if (/No module named 'PIL'|ModuleNotFoundError/.test(r.stderr)) return; // 无 Pillow 跳过
    assert.notEqual(r.status, 0, "未确认时 Python 序列化器必须拒绝渲染");
    assert.ok(!fs.existsSync(out), "不应产出文件");
    assert.ok((r.stderr + r.stdout).includes("确认闸门"), r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test("xml：转义、严格解析、拒绝畸形与换行归一化", () => {
  // 属性里的换行必须写成字符引用，否则被解析器归一化成空格
  const attr = escapeAttr("第一行\n第二行");
  assert.ok(attr.includes("&#10;") && !attr.includes("\n"), attr);
  const root = parseXml(`<?xml version="1.0"?><a k="${attr}"><b/></a>`);
  assert.equal(root.attrs.k, "第一行\n第二行");
  assert.equal(findAll(root, "b").length, 1);
  // 畸形一律抛错，不是静默放过
  for (const bad of ["<a>", "<a></b>", "<a k=x/>", "<a></a><b></b>", '<a k="1 & 2"/>']) {
    assert.throws(() => parseXml(bad), /XML 解析失败/, bad);
  }
});

await test("check-drawio：文字宽度预算区分中西文", () => {
  assert.ok(measureLine("中文四字", 10) > measureLine("abcd", 10), "同字数时中文应更宽");
});

await test("drawio 序列化器零几何计算、颜色只读快照 token", () => {
  const { tree } = drawioTree();
  const xml = renderDrawio(tree, { projectName: "unit" });
  const root = parseXml(xml);
  const cells = findAll(root, "mxCell").filter((c) => c.attrs.id !== "0" && c.attrs.id !== "1");
  assert.equal(cells.length, 3, "2 节点 + 1 连线");
  const geo = findAll(root, "mxGeometry")[0].attrs;
  assert.equal(Number(geo.x), tree.elements[0].x);
  assert.equal(Number(geo.width), tree.elements[0].w);
  // 描边色必须等于快照里的语义色，而不是某个字面量
  assert.ok(parseStyle(nodeStyle(tree.elements[0], tree.variableSnapshot)).strokeColor.toLowerCase().includes("4b5cc4"));
  assert.ok(parseStyle(edgeStyle(tree.edges[0], tree.variableSnapshot)).strokeColor.toLowerCase().includes("065279"));
  // 源码里不得硬编码十六进制颜色（.get 兜底默认除外）
  const src = fs.readFileSync(path.join(ROOT, "drawio", "scripts", "serializers", "drawio.mjs"), "utf8");
  const stripped = src.replace(/\.get\([^)]*\)/g, "");
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(stripped), "drawio.mjs 不得硬编码颜色");
});

await test("check-drawio：几何逐字段比对、文字截断与图例缺失都会被抓", () => {
  const { tree } = drawioTree({ label: "调用", labelBox: { x: 130, y: 160, w: 96, h: 24 } });
  const ok = checkDrawioTree(tree, renderDrawio(tree, { projectName: "unit" }));
  // 图例缺失只是警告；文字与几何问题才是错误
  assert.equal(ok.errors.filter((e) => !e.includes("图例")).length, 0, ok.errors.join("; "));

  // 文字装不下 → 报截断风险
  const tiny = drawioTree({ a: { x: 64, y: 64, w: 40, h: 72 } });
  tiny.tree.elements[0].label = "这一行字明显放不下";
  const bad = checkDrawioTree(tiny.tree, renderDrawio(tiny.tree, { projectName: "unit" }));
  assert.ok(bad.errors.some((e) => e.includes("文字截断风险")), bad.errors.join("; "));

  // XML 与树不一致 → 报「与 XML 不一致」
  const stale = JSON.parse(JSON.stringify(tree));
  stale.elements[0].x += 10;
  const drift = checkDrawioTree(stale, renderDrawio(tree, { projectName: "unit" }));
  assert.ok(drift.errors.some((e) => e.includes("与 XML")), drift.errors.join("; "));
});

await test("assert-layout：连线横穿节点与端点偏离锚点都会被抓", () => {
  // 中间挡一个节点，直连线必然穿过它
  const { tree } = drawioTree();
  const blocker = { id: "mid", label: "mid", kind: "plain", x: 140, y: 140, w: 40, h: 40,
    expr: { x: "M = 140", y: "M = 140", w: "M = 40", h: "M = 40" }, depth: 0, children: [] };
  tree.elements.push(blocker);
  const errs = [];
  assertTree(tree, null, errs);
  assert.ok(errs.some((e) => e.includes("横穿节点 mid")), errs.join("; "));

  const { tree: t2 } = drawioTree();
  t2.edges[0].fromPt = { x: 1, y: 1 };
  const errs2 = [];
  assertTree(t2, null, errs2);
  assert.ok(errs2.some((e) => e.includes("不在") && e.includes("锚点上")), errs2.join("; "));

  // 端点越出画布
  const { tree: t3 } = drawioTree();
  t3.canvas = { w: 100, h: 100, breakpoint: "hwsync" };
  const errs3 = [];
  assertTree(t3, null, errs3);
  assert.ok(errs3.some((e) => e.includes("越出画布")), errs3.join("; "));
});

await test("schema：连线必须带锚点出处、side 合法、指向存在的节点", () => {
  const { tree } = drawioTree();
  assert.equal(validateLayoutTree(tree).length, 0, validateLayoutTree(tree).join("; "));

  const bad1 = JSON.parse(JSON.stringify(tree));
  bad1.edges[0].to.node = "不存在";
  assert.ok(validateLayoutTree(bad1).some((e) => e.includes("指向不存在的节点")), validateLayoutTree(bad1).join("; "));

  const bad2 = JSON.parse(JSON.stringify(tree));
  bad2.edges[0].from.side = "X";
  assert.ok(validateLayoutTree(bad2).some((e) => e.includes("side 非法")), validateLayoutTree(bad2).join("; "));

  const bad3 = JSON.parse(JSON.stringify(tree));
  delete bad3.edges[0].fromPtExpr;
  assert.ok(validateLayoutTree(bad3).some((e) => e.includes("锚点必须带出处")), validateLayoutTree(bad3).join("; "));

  const bad4 = JSON.parse(JSON.stringify(tree));
  bad4.elements[0].kind = "不存在的 kind";
  assert.ok(validateLayoutTree(bad4).some((e) => e.includes("kind 非法")), validateLayoutTree(bad4).join("; "));
});

await test("指纹：连线端点/途经点入哈希，线型与配色不入哈希", () => {  const { tree } = drawioTree();
  const t = JSON.parse(JSON.stringify(tree));
  const base = hashLayoutTree(t);

  const restyled = JSON.parse(JSON.stringify(t));
  restyled.edges[0].role = "power";
  restyled.edges[0].arrow = "both";
  restyled.elements[0].kind = "storage";
  restyled.elements[0].tone = "focus";
  restyled.elements[0].note = ["说明"];
  assert.equal(hashLayoutTree(restyled), base, "改线型/配色/说明不应让确认失效");

  const moved = JSON.parse(JSON.stringify(t));
  moved.edges[0].via = [{ x: 1, y: 2 }];
  moved.edges[0].viaExpr = [{ x: "a = 1", y: "b = 2" }];
  assert.notEqual(hashLayoutTree(moved), base, "挪动途经点必须让确认失效");
});

await test("builder：anchor/route/midX 的两段式出处可复算", () => {
  const snap = { MARGIN: 64, NODE_W: 200, NODE_H: 60, GAP: 64 };
  const n1 = node("n1", 64, 64, 200, 60, { expr: { x: "MARGIN = 64", y: "MARGIN = 64", w: "NODE_W = 200", h: "NODE_H = 60" } });
  const n2 = node("n2", 64, 188, 200, 60, { expr: { x: "MARGIN = 64", y: "188 = 188", w: "NODE_W = 200", h: "NODE_H = 60" } });
  const a = anchor(n1, "S");
  assert.equal(a.x, 164);
  for (const [k, v] of Object.entries(a.expr)) {
    const [lhs, rhs] = splitExpr(v);
    assert.equal(evaluate(lhs, snap), evaluate(rhs, snap), `anchor.${k}: ${v}`);
    assert.equal(evaluate(lhs, snap), a[k]);
  }
  const via = route(n1, "S", n2, "N");
  assert.equal(via.length, 0, "同一 x 的上下相邻节点应直连");
  assert.equal(half(9), 4.5);
  assert.equal(inset(32, 12), 10);
  assert.equal(midX(n1, n2), 164);
  assert.equal(gapMid(n1, n2), 156);
  const w = waypoint(10, 20, "A = 10", "B = 20");
  assert.deepEqual(w.expr, { x: "A = 10", y: "B = 20" });
});

await test("drawio 项目识别：普通页面项目不受影响", () => {
  assert.equal(isDrawioProject(EXAMPLE), false);
  assert.equal(isDrawioProject(ARCH), false);
  assert.equal(isDrawioProject(ARCH2), true, "examples/drawio-hwsync 应被识别为 drawio 项目");
  assert.equal(checkDrawioProject(EXAMPLE).skipped, true);
});

await test("bandRouter：区间不相交可共轨，相交必须分轨，用尽即报错", () => {
  // 区间不相交 → 可以共用轨道（省得把空隙抽得很高）
  const b1 = bandRouter({ name: "B", center: 100, tracks: 2, pitch: 20 });
  const a = b1.route("e1", 0, 200);
  const c = b1.route("e2", 300, 500);
  assert.equal(a.pos, c.pos, "x 区间不相交的两条线应共用一条轨道");

  // 区间相交 → 必须分到手不同的轨道上
  const d = b1.route("e3", 100, 400);
  assert.notEqual(d.pos, a.pos, "区间相交必须换轨");

  // 轨道用尽 → 报错（而不是默默重合）
  assert.throws(() => b1.route("e4", 0, 600), /轨道已占满/);

  // 出处可复算，且键并入快照
  const snap = b1.snapshot();
  for (const [k, v] of Object.entries(snap)) {
    const [lhs, rhs] = splitExpr(`${k} = ${v}`);
    void lhs;
    assert.equal(Number(rhs), v);
  }
  assert.ok(Object.keys(snap).every((k) => k.startsWith("B_T")), Object.keys(snap).join(","));
});

await test("bandRouter：标签槽位全局不重叠；槽位不足时报错", () => {
  // 轨道给足（6 条），但标签槽位只有 3 个 → 必须报「标签槽位不足」
  const b = bandRouter({ name: "B", center: 0, tracks: 6, pitch: 20, labelSize: 100, labelGap: 8 });
  const r1 = b.route("e1", 0, 300);
  const r2 = b.route("e2", 0, 300);
  const r3 = b.route("e3", 0, 300);
  const slots = [r1, r2, r3].map((r) => r.labelPos);
  assert.equal(new Set(slots).size, 3, `三条边的标签 x 应互不相同: ${slots}`);
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      assert.ok(Math.abs(slots[i] - slots[j]) >= 100, `标签槽位不得重叠: ${slots}`);
    }
  }
  assert.throws(() => b.route("e4", 0, 300), /标签槽位不足/);

  // 区间比标签短时居中，仍然压在自己的线上（空隙要够高，否则构造时就拒绝）
  const tiny = bandRouter({ name: "T", center: 0, tracks: 6, pitch: 20, labelSize: 100 });
  const r = tiny.route("e1", 50, 50);
  assert.equal(r.labelPos, 50);
  // 空隙容不下标签高度 → 构造时就 fail-closed
  assert.throws(
    () => bandRouter({ name: "T2", center: 0, tracks: 1, pitch: 20, labelSize: 100 }),
    /放不进/,
  );
});

await test("channelRouter：竖向轨道与 bandRouter 同语义但换轴", () => {
  const ch = channelRouter({ name: "CH", center: 1800, tracks: 2, pitch: 20 });
  const a = ch.route("e1", 0, 100);
  const b = ch.route("e2", 200, 300);
  assert.equal(a.pos, b.pos, "y 区间不相交可共轨");
  const c = ch.route("e3", 50, 250);
  assert.notEqual(c.pos, a.pos);
  assert.equal(a.pos, 1790, "2 条轨道时首轨为 center − pitch/2");
  assert.equal(c.pos, 1810);
  assert.throws(() => ch.route("e4", 0, 400), /轨道已占满/);
  assert.throws(() => makeTrackRouter({ name: "X", axis: "z", center: 0 }), /axis/);
});

await test("assert-layout：不同连线共线重合报错，同一锚点扇出不报", () => {
  const mk = (segs) => ({
    canvas: { w: 1000, h: 1000, breakpoint: "unit" },
    variableSnapshot: {},
    elements: [],
    edges: segs,
  });
  const edgeOf = (id, pts) => ({
    id,
    from: { node: "a", side: "S" },
    to: { node: "b", side: "N" },
    fromPt: pts[0],
    toPt: pts[pts.length - 1],
    fromPtExpr: { x: "0 = 0", y: "0 = 0" },
    toPtExpr: { x: "0 = 0", y: "0 = 0" },
    via: pts.slice(1, -1),
    role: "data",
  });
  // 两条线在同一 y 上水平跑 200px（不共享端点）→ 必须报
  const e1 = edgeOf("e1", [{ x: 0, y: 10 }, { x: 300, y: 10 }]);
  const e2 = edgeOf("e2", [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 10 }, { x: 400, y: 10 }]);
  const errs = [];
  assertEdgeOverlap(mk([e1, e2]), errs);
  assert.ok(errs.some((e) => e.includes("共线重合")), errs.join("; "));

  // 同一锚点扇出：初始段重合是标准画法，不报
  const f1 = edgeOf("f1", [{ x: 100, y: 100 }, { x: 100, y: 500 }]);
  const f2 = edgeOf("f2", [{ x: 100, y: 100 }, { x: 100, y: 300 }, { x: 400, y: 300 }]);
  const errs2 = [];
  assertEdgeOverlap(mk([f1, f2]), errs2);
  assert.equal(errs2.length, 0, errs2.join("; "));
});

await test("图标目录：catalog.json 与 assets/icons/ 一致，且逻辑名可解析", () => {
  const disk = loadCatalog({ refresh: true });
  const fresh = buildCatalog();
  assert.deepEqual(disk.icons, fresh.icons, "catalog.json 与目录不一致，请重跑 build-catalog.mjs");
  const py = resolveIcon("python");
  assert.ok(py.svg && py.raster, "python 应同时有 svg 与配套位图");
  assert.ok(fs.existsSync(path.join(ROOT, "drawio", "assets", "icons", py.svg)));
  assert.ok(fs.existsSync(path.join(ROOT, "drawio", "assets", "icons", py.raster)));
  assert.throws(() => resolveIcon("不存在的图标"), /未知图标逻辑名/);
});

await test("builder.iconSlots：图标盒在卡片内、居中、expr 两段可复算", () => {
  const snap = {
    ...DRAWIO_SNAP, MARGIN: 64, NODE_W: 200, NODE_H: 72,
    DRAWIO_ICON_SIZE: 28, DRAWIO_ICON_PAD: 16, DRAWIO_ICON_GAP: 8, DRAWIO_ICON_TEXT_GAP: 8,
  };
  const card = node("card", 64, 64, 200, 72, {
    kind: "app", icon: ["python", "rust"],
    expr: { x: "MARGIN = 64", y: "MARGIN = 64", w: "NODE_W = 200", h: "NODE_H = 72" },
  });
  const slots = iconSlots(card, ["python", "rust"], {
    size: 28, pad: 16, gap: 8,
    sizeName: "DRAWIO_ICON_SIZE", padName: "DRAWIO_ICON_PAD", gapName: "DRAWIO_ICON_GAP",
  });
  assert.equal(slots.length, 2);
  assert.equal(slots[0].x, 64 + 16, "首个图标 = 卡片 x + iconPad");
  assert.equal(slots[1].x, 64 + 16 + 28 + 8, "第二个图标按 size+gap 递增");
  assert.equal(slots[0].y, 64 + (72 - 28) / 2, "图标纵向居中");
  for (const s of slots) {
    const n = node(s.id, s.x, s.y, s.w, s.h, { kind: "icon", icon: s.icon, expr: s.expr });
    assert.ok(n.x >= card.x && n.x + n.w <= card.x + card.w, `${s.id} 应在卡片内`);
    for (const [k, e] of Object.entries(s.expr)) {
      const [lhs, rhs] = splitExpr(e);
      assert.equal(evaluate(lhs, snap), evaluate(rhs, snap), `${s.id}.${k}: ${e}`);
      assert.equal(evaluate(lhs, snap), s[k]);
    }
  }
  assert.equal(iconTextInset(card, snap), 16 + 2 * 28 + 8 + 8);
  assert.equal(iconTextInset(node("x", 0, 0, 1, 1), snap), 0, "无图标卡片不偏移文字");
});

await test("schema：icon 字段与 kind=icon 的约束", () => {
  const mk = (extra) => treeOf([
    node("c", 0, 0, 100, 40, { kind: "app", icon: ["python"], ...extra }),
  ], { w: 200, h: 200, breakpoint: "desktop" }, {});
  assert.equal(validateLayoutTree(mk({})).length, 0, "合法 icon 字段应通过");
  assert.ok(validateLayoutTree(mk({ icon: "python" })).some((e) => e.includes("icon 必须是非空字符串数组")));
  assert.ok(validateLayoutTree(mk({ icon: ["python", "python"] })).some((e) => e.includes("重复")));
  const iconNode = treeOf([
    node("i", 0, 0, 20, 20, { kind: "icon", icon: ["python", "rust"] }),
  ], { w: 200, h: 200, breakpoint: "desktop" }, {});
  assert.ok(validateLayoutTree(iconNode).some((e) => e.includes("必须恰好一个")));
  const missing = treeOf([node("i", 0, 0, 20, 20, { kind: "icon" })], { w: 200, h: 200, breakpoint: "desktop" }, {});
  assert.ok(validateLayoutTree(missing).some((e) => e.includes("必须提供 icon")));
});

await test("drawio 图标序列化：内嵌 SVG data URI、leIcon 标记、卡片文字右移", () => {
  const snap = {
    ...DRAWIO_SNAP, MARGIN: 64, NODE_W: 300, NODE_H: 72,
    DRAWIO_ICON_SIZE: 28, DRAWIO_ICON_PAD: 16, DRAWIO_ICON_GAP: 8, DRAWIO_ICON_TEXT_GAP: 8,
  };
  const cardSpec = {
    id: "card", label: "服务", kind: "app", x: 64, y: 64, w: 300, h: 72,
    icon: ["python"],
    expr: { x: "MARGIN = 64", y: "MARGIN = 64", w: "NODE_W = 300", h: "NODE_H = 72" },
    children: [],
  };
  const nodeSpec = { ...cardSpec };
  const slots = iconSlots(nodeSpec, ["python"], {
    size: 28, pad: 16, gap: 8,
    sizeName: "DRAWIO_ICON_SIZE", padName: "DRAWIO_ICON_PAD", gapName: "DRAWIO_ICON_GAP",
  });
  nodeSpec.children = slots;
  const t = tree({ canvas: { w: 500, h: 300, breakpoint: "hwsync" }, variableSnapshot: snap, elements: [nodeSpec] });
  assert.equal(validateLayoutTree(t).length, 0, validateLayoutTree(t).join("; "));
  const xml = renderDrawio(t, { projectName: "icon-unit" });
  assert.ok(xml.includes("leIcon=\"python\""), "图标 cell 应带 leIcon");
  assert.ok(xml.includes("shape=image") && xml.includes("data:image/svg+xml,"), "应内嵌 SVG data URI");
  const cardStyle = parseStyle(nodeStyle(t.elements[0], snap));
  assert.equal(cardStyle.align, "left");
  assert.equal(Number(cardStyle.spacingLeft), 16 + 28 + 8);
  assert.equal(checkDrawioTree(t, xml).errors.length, 0, checkDrawioTree(t, xml).errors.join("; "));
});

await test("check-drawio：未知图标逻辑名与漏建 icon 子节点都会被抓", () => {
  const snap = { ...DRAWIO_SNAP, MARGIN: 64, NODE_W: 200, NODE_H: 72 };
  const bad = tree({
    canvas: { w: 400, h: 300, breakpoint: "hwsync" }, variableSnapshot: snap,
    elements: [{ id: "c", label: "c", kind: "app", x: 64, y: 64, w: 200, h: 72, icon: ["没有这个"],
      expr: { x: "MARGIN = 64", y: "MARGIN = 64", w: "NODE_W = 200", h: "NODE_H = 72" }, children: [] }],
  });
  const r = checkDrawioTree(bad, renderDrawio(bad, { projectName: "bad" }));
  assert.ok(r.errors.some((e) => e.includes("未知图标逻辑名")), r.errors.join("; "));
  assert.ok(r.errors.some((e) => e.includes("iconSlots")), "漏建子节点也要报：" + r.errors.join("; "));
});

await test("drawio-hwsync 示例的树里确实含图标节点", () => {
  const D = sandbox("drawio-hwsync");
  const t = JSON.parse(fs.readFileSync(path.join(D, "layout-tree", "hwsync.json"), "utf8"));
  const cards = [];
  const walk = (ns) => ns.forEach((n) => { if (n.kind === "icon") cards.push(n); if (n.children) walk(n.children); });
  walk(t.elements);
  assert.ok(cards.length >= 5, `示例应含 ≥5 个图标节点，实际 ${cards.length}`);
  assert.ok(cards.every((c) => c.icon?.length === 1 && c.expr?.x && c.expr?.y));
});

await test("先确认后生成：未确认渲染只产出 PREVIEW- 前缀，不产生正常交付文件名", () => {
  const dir = tmp("le-preview-");
  try {
    fs.mkdirSync(path.join(dir, "layout-tree"), { recursive: true });
    fs.writeFileSync(path.join(dir, "layout.config.json"), JSON.stringify({ kind: "drawio", breakpoints: ["hwsync"] }));
    const { tree } = drawioTree();
    fs.writeFileSync(path.join(dir, "layout-tree", "hwsync.json"), JSON.stringify(tree));
    const r = run([path.join(ROOT, "drawio", "scripts", "serializers", "drawio.mjs"), "--project", dir, "--allow-unconfirmed"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(dir, "drawio", "PREVIEW-hwsync.drawio")), "未确认应产出 PREVIEW- 前缀的 .drawio");
    assert.ok(!fs.existsSync(path.join(dir, "drawio", "hwsync.drawio")), "未确认不得产出正常文件名的交付稿");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log("\n集成：");;

await test("drawio 节点样式：渐变与阴影由 token 驱动，老快照向后兼容", () => {
  const base = {
    DRAWIO_BAOLAN: "#4B5CC4", DRAWIO_MO: "#1F2A3D", DRAWIO_BASE: "#FFFFFF",
    DRAWIO_FILL_MIX: 0.16, TYPE_ITEM: 13.5, DRAWIO_ARC_SIZE_ITEM: 30,
  };
  const node = { id: "a", label: "A", kind: "app", x: 0, y: 0, w: 100, h: 40 };
  const rich = parseStyle(nodeStyle(node, {
    ...base,
    DRAWIO_GRADIENT_END_MIX: 0.3, DRAWIO_GRADIENT_ANGLE: 120,
    DRAWIO_SHADOW_DY: 2, DRAWIO_SHADOW_BLUR: 8, DRAWIO_SHADOW_ALPHA: 26,
  }));
  assert.ok(rich.gradientColor, "endMix > fillMix 时必须输出 gradientColor");
  assert.equal(rich.gradientDirection, "east", "120° 应映射到 east（90° 档）");
  assert.equal(rich.shadow, "1");
  assert.equal(rich.leShadowBlur, "8", "leShadow* 自定义参数须随 XML 走（drawio_png.py 同源渲染）");
  const legacy = parseStyle(nodeStyle(node, base));
  assert.equal(legacy.gradientColor, undefined, "无渐变 token 的老快照不出 gradientColor");
  assert.equal(legacy.shadow, undefined, "无阴影 token 的老快照不出 shadow");
});

await test("脚手架 --theme：主题预设覆盖 tokens.ts，非法主题与 drawio 项目被拒绝", () => {
  const out = tmp("le-theme-");
  const dir = newProject({ name: "themed", out, title: "主题冒烟", theme: "deepspace" });
  const text = fs.readFileSync(path.join(dir, "variables", "tokens.ts"), "utf8");
  assert.ok(text.includes("#5B8CFF"), "deepspace 主题的 accent 应写进 tokens.ts");
  assert.ok(text.includes("SHADOW") && text.includes("GRADIENT") && text.includes("FONT"),
    "主题文件必须包含完整视觉 token 组");
  assert.throws(() => newProject({ name: "bad", out, theme: "不存在" }), /未知主题/);
  assert.throws(
    () => newProject({ name: "bad2", out, kind: "drawio", view: "cli", theme: "paper" }),
    /--theme/,
    "drawio 项目用中国色板，--theme 必须被拒绝",
  );
});

await test("文档一致性：SKILL.md/README 与代码、磁盘、04 索引对齐", () => {
  const errors = checkDocs(ROOT);
  assert.equal(errors.length, 0, errors.join("\n"));
});

await test("示例项目：双端树通过断言 + 纯函数复算 + expr 两段复算", async () => {
  for (const dir of [EXAMPLE, ARCH]) {
    const trees = await buildTrees(dir);
    assert.ok(trees.desktop && trees.mobile);
    const errs = [];
    assertTree(trees.desktop, readSpacingScale(dir), errs);
    assertTree(trees.mobile, readSpacingScale(dir), errs);
    assert.equal(errs.length, 0, `${dir}: ${errs.join("; ")}`);
    assert.equal(verifyTree(trees.desktop, "desktop").length, 0);
    assert.equal(verifyTree(trees.mobile, "mobile").length, 0);
  }
});

await test("脚手架项目可 build / validate / render / storyboard", () => {
  const out = tmp("le-proj-");
  try {
    const dir = newProject({ name: "itest", out, title: "集成测试" });
    must([path.join(ROOT, "layout", "scripts", "build-tree.mjs"), "--project", dir]);
    must([path.join(ROOT, "layout", "scripts", "validate", "run-all.mjs"), "--project", dir, "--allow-unconfirmed"]);
    must([path.join(ROOT, "drawio", "scripts", "storyboard", "index.mjs"), "--project", dir]);
    must([path.join(ROOT, "drawio", "scripts", "serializers", "index.mjs"), "--project", dir, "--target", "all", "--allow-unconfirmed"]);
    for (const f of [
      "eslint.config.mjs",
      "layout-tree/desktop.json",
      "manifest.json",
      "docs/index.html",
      "positioning/storyboard/timeline.json",
      "preview/PREVIEW-desktop.svg",
      "src/serializers/PREVIEW-Layout.tsx",
      "src/serializers/PREVIEW-Composition.tsx",
    ]) {
      assert.ok(fs.existsSync(path.join(dir, f)), `缺少产物 ${f}`);
    }
    const kf = fs.readdirSync(path.join(dir, "positioning", "storyboard")).filter((f) => f.startsWith("kf-"));
    assert.ok(kf.length >= 3 && kf.length <= 6, `关键帧数量应 3~6，实际 ${kf.length}`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

await test("架构图示例：夹具确认 → 闸门放行 → diagram 渲染", () => {
  const A = sandbox("architecture");
  must([path.join(ROOT, "drawio", "scripts", "storyboard", "index.mjs"), "--project", A]);
  must([path.join(ROOT, "layout", "scripts", "validate", "check-confirmation.mjs"), "--project", A, "--write-fixture"]);
  must([path.join(ROOT, "layout", "scripts", "validate", "run-all.mjs"), "--project", A]);
  must([path.join(ROOT, "drawio", "scripts", "serializers", "index.mjs"), "--project", A, "--target", "all"]);
  for (const f of [
    "layout-tree/desktop.json",
    "layout-tree/mobile.json",
    "positioning/confirmed.json",
    "positioning/confirmed-desktop.svg",
    "positioning/storyboard/timeline.svg",
    "src/serializers/Layout.tsx",
    "src/serializers/Composition.tsx",
    "preview/desktop.svg",
    "docs/index.html",
    "manifest.json",
  ]) {
    assert.ok(fs.existsSync(path.join(A, f)), `缺少产物 ${f}`);
  }
});

await test("设计 token 必须随快照归档（渲染器不得写死颜色字号）", () => {
  const A = sandbox("architecture");
  const tree = JSON.parse(fs.readFileSync(path.join(A, "layout-tree", "desktop.json"), "utf8"));
  const keys = Object.keys(tree.variableSnapshot);
  for (const k of ["COLOR_INK", "COLOR_SURFACE", "TYPE_DISPLAY", "TYPE_ITEM", "RADIUS_ITEM"]) {
    assert.ok(keys.includes(k), `快照缺少设计 token ${k}`);
  }
  const src = fs.readFileSync(path.join(ROOT, "drawio", "scripts", "serializers", "diagram.py"), "utf8");
  // 允许「缺 token 时的兜底默认」出现在 .get(k, default) 里，其余一律不得硬编码
  const stripped = src.replace(/\.get\([^)]*\)/g, "");
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(stripped), "渲染器里不得硬编码十六进制颜色（只能作为 .get 的兜底默认）");
  assert.ok(src.includes("variableSnapshot"), "渲染器必须从快照读设计 token");
});

await test("poster 风格：diagram.py 能渲染且几何来自树", () => {
  const A = sandbox("architecture");
  const out = path.join(A, "preview", "desktop.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(
    "python3",
    [path.join(ROOT, "drawio", "scripts", "serializers", "diagram.py"), "--tree",
     path.join(A, "layout-tree", "desktop.json"), "--out", out],
    { encoding: "utf8" },
  );
  if (r.status !== 0 && /Pillow|No module/.test(r.stderr)) return; // 无 Pillow 时跳过
  assert.equal(r.status, 0, r.stderr);
  const tree = JSON.parse(fs.readFileSync(path.join(A, "layout-tree", "desktop.json"), "utf8"));
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 2000, "应产出非空 PNG");
  assert.equal(tree.canvas.w, 1680, "几何仍由树决定");
});

await test("print-tree 输出可读的文本 box tree", () => {
  const A = sandbox("architecture");
  const r = must([path.join(ROOT, "layout", "scripts", "print-tree.mjs"), "--project", A, "--breakpoint", "desktop"]);
  assert.ok(r.stdout.includes("canvas 1680×"), r.stdout.slice(0, 200));
  assert.ok(r.stdout.includes("① title"), "应带 ①②③ 编号");
  assert.ok(r.stdout.includes("② workflow"));
});

await test("测试不得改写 examples/ 本体的确认记录", () => {
  for (const name of ["landing", "architecture"]) {
    const f = path.join(ROOT, "examples", name, "positioning", "confirmed.json");
    if (!fs.existsSync(f)) continue;
    const recs = JSON.parse(fs.readFileSync(f, "utf8")).records ?? [];
    assert.ok(
      !recs.some((r) => r.source === "fixture" && /测试|夹具/.test(r.note ?? "") && r.node === "structure" && r.note === "测试"),
      `${name} 被测试写入了 fixture 记录`,
    );
  }
});

await test("drawio 脚手架：build / 八步验证 / drawio 渲染全链路", () => {
  const out = tmp("le-drawio-");
  try {
    const dir = newProject({ name: "arch-with-dash", kind: "drawio", view: "gitviz-gui", out, title: "带连字符的视图名" });
    assert.ok(fs.existsSync(path.join(dir, "layout.config.json")), "应生成 layout.config.json");
    // 视图名带连字符时，BREAKPOINTS 的键必须能作为合法 JS 标识符串（否则 build-tree 直接语法错）
    const bps = /BREAKPOINTS\s*=\s*\{([^}]*)\}/.exec(fs.readFileSync(path.join(dir, "variables", "tokens.ts"), "utf8"));
    assert.ok(bps && bps[1].includes('"gitviz-gui"'), `BREAKPOINTS 的键应带引号，实际: ${bps?.[1]}`);
    must([path.join(ROOT, "layout", "scripts", "build-tree.mjs"), "--project", dir]);
    const lt = fs.readdirSync(path.join(dir, "layout-tree"));
    assert.deepEqual(lt, ["gitviz-gui.json"], `drawio 项目应只产出一张画布，实际 ${lt}`);
    must([path.join(ROOT, "layout", "scripts", "validate", "run-all.mjs"), "--project", dir, "--allow-unconfirmed"]);
    must([path.join(ROOT, "drawio", "scripts", "serializers", "index.mjs"), "--project", dir, "--target", "drawio", "--allow-unconfirmed"]);
    for (const f of ["drawio/PREVIEW-gitviz-gui.drawio"]) {
      assert.ok(fs.existsSync(path.join(dir, f)), `缺少产物 ${f}`);
    }
    const xml = fs.readFileSync(path.join(dir, "drawio", "PREVIEW-gitviz-gui.drawio"), "utf8");
    assert.ok(parseXml(xml).name === "mxfile", "产物应是合法 mxfile");
    // PNG 需 Pillow；装了就要出图
    const hasPillow = spawnSync("python3", ["-c", "import PIL"], { encoding: "utf8" }).status === 0;
    if (hasPillow) assert.ok(fs.statSync(path.join(dir, "drawio", "PREVIEW-gitviz-gui.png")).size > 2000, "应产出非空 PNG");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

await test("架构图示例（drawio-hwsync）：八步验证与 drawio 产物", () => {
  const D = sandbox("drawio-hwsync");
  must([path.join(ROOT, "layout", "scripts", "validate", "check-confirmation.mjs"), "--project", D, "--write-fixture"]);
  must([path.join(ROOT, "layout", "scripts", "validate", "run-all.mjs"), "--project", D]);
  must([path.join(ROOT, "drawio", "scripts", "serializers", "index.mjs"), "--project", D, "--target", "drawio"]);
  for (const f of ["layout-tree/hwsync.json", "drawio/hwsync.drawio", "positioning/confirmed.json", "manifest.json", "docs/index.html"]) {
    assert.ok(fs.existsSync(path.join(D, f)), `缺少产物 ${f}`);
  }
  const tree = JSON.parse(fs.readFileSync(path.join(D, "layout-tree", "hwsync.json"), "utf8"));
  assert.ok(tree.edges.length >= 12, `示例连线数应 ≥12，实际 ${tree.edges.length}`);
  assert.ok(tree.edges.some((e) => e.role === "control") && tree.edges.some((e) => e.role === "power"), "应包含控制线与供电线");
  // 设计 token 必须随快照归档（渲染器不得写死中国色）
  for (const k of ["DRAWIO_HUAQING", "DRAWIO_DIANLAN", "DRAWIO_BAOLAN", "DRAWIO_FILL_MIX", "DRAWIO_FONT_FAMILY"]) {
    assert.ok(k in tree.variableSnapshot, `快照缺少 ${k}`);
  }
  // 渲染器不得硬编码十六进制颜色
  for (const f of ["drawio_png.py"]) {
    const src = fs.readFileSync(path.join(ROOT, "drawio", "scripts", "serializers", f), "utf8");
    assert.ok(!/#[0-9A-Fa-f]{6}/.test(src), `${f} 不得硬编码颜色`);
  }
  assert.ok(checkDrawioProject(D).ok, checkDrawioProject(D).errors.join("; "));
  // 聚合视图必须按断点名给出单画布项目的确认状态（曾经只认 desktop/mobile）
  const mf = JSON.parse(fs.readFileSync(path.join(D, "manifest.json"), "utf8"));
  assert.equal(mf.confirmations.structure, true);
  assert.equal(mf.confirmations.positioning.hwsync, true, JSON.stringify(mf.confirmations));
});

await test("print-tree 会列出连线清单（架构图的确认节点 A 靠它）", () => {
  const D = sandbox("drawio-hwsync");
  const r = must([path.join(ROOT, "layout", "scripts", "print-tree.mjs"), "--project", D, "--breakpoint", "hwsync"]);
  assert.ok(r.stdout.includes("连线"), r.stdout.slice(0, 300));
  assert.ok(r.stdout.includes("(S)") && r.stdout.includes("via"), "应打印端点边与途经点数量");
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.error(`失败用例：\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
