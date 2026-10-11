#!/usr/bin/env node
/**
 * 文档一致性校验：把 SKILL.md / README.md 里的「事实声明」变成机器可复核的断言。
 *
 * 功能：防止文档与代码漂移——验证步数、硬规则编号、checklist 计数、
 *       脚本路径、导航链接、脚本索引与 references/04-scripts.md 的对应关系。
 * 实现原理：以 layout/scripts/validate/run-all.mjs 的 STEPS 数组为步数唯一事实来源，
 *       其余声明全部从文档文本中用正则抽取后与磁盘/代码比对；任何不符即报错。
 *
 * 运行：node tests/check-docs.mjs（也可被 tests/run.mjs 作为库调用）
 * 导出：checkDocs(root) -> string[]（错误列表，空数组 = 通过）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 取 marker 起到下一个二级标题（或文末）的切片。 */
function sliceSection(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const rest = text.slice(start + marker.length);
  const next = rest.indexOf("\n## ");
  return next < 0 ? rest : rest.slice(0, next);
}

/** 文档中出现的脚本路径是否适合就地校验（排除占位符与相对他处的路径）。 */
function checkablePath(p) {
  return !p.startsWith(".") && !/[<>{}\s]/.test(p);
}

export function checkDocs(root) {
  const errors = [];
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const skill = read("SKILL.md");
  const readme = read("README.md");
  const scripts04 = read(path.join("references", "04-scripts.md"));
  const docs = [
    ["SKILL.md", skill],
    ["README.md", readme],
    ["references/04-scripts.md", scripts04],
  ];

  // ── 1. 验证步数：run-all.mjs 的 STEPS 是唯一事实来源 ─────────────────
  const runAll = read(path.join("layout", "scripts", "validate", "run-all.mjs"));
  const stepsBlock = /const STEPS = \[([\s\S]*?)\];/.exec(runAll)?.[1] ?? "";
  const steps = [...stepsBlock.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (steps.length === 0) errors.push("无法从 run-all.mjs 解析 STEPS 数组");
  const cn = Object.entries(CN_NUM).find(([, v]) => v === steps.length)?.[0];
  for (const [label, doc] of docs) {
    for (const m of doc.matchAll(/([一二两三四五六七八九十])步/g)) {
      // 「一步」几乎总是「第一步 / 进一步」等常用语，不是步数声明，豁免
      if (m[1] !== "一" && CN_NUM[m[1]] !== steps.length) {
        errors.push(`${label}: 「${m[1]}步」与 run-all.mjs 实际 ${steps.length} 步（${steps.join(" / ")}）不符`);
      }
    }
    if (cn && !doc.includes(`${cn}步`)) {
      errors.push(`${label}: 未提及「${cn}步」验证流程，与 run-all.mjs 脱节`);
    }
  }
  // 「四层」只许以阶段概念出现在 01-standards.md（已加注区分），主文档不得使用
  for (const [label, doc] of [["SKILL.md", skill], ["README.md", readme]]) {
    if (doc.includes("四层")) errors.push(`${label}: 出现「四层」表述，验证层口径应为「八步」`);
  }

  // ── 2. 硬规则速查表编号必须连续（1..n，不许 6b / 跳号 / 乱序）─────────
  const rulesSection = sliceSection(skill, "## 硬规则速查");
  if (!rulesSection) {
    errors.push("SKILL.md: 缺少「## 硬规则速查」章节");
  } else {
    const nums = [...rulesSection.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
    if (nums.length < 10) {
      errors.push(`SKILL.md 硬规则表只解析到 ${nums.length} 行，疑似表格结构被破坏`);
    }
    nums.forEach((v, i) => {
      if (v !== i + 1) errors.push(`SKILL.md 硬规则表编号乱序：第 ${i + 1} 行编号为 ${v}`);
    });
  }

  // ── 3. checklist 计数声明必须与实际条目数一致 ────────────────────────
  const human = sliceSection(skill, "**人工判定**");
  if (!human) {
    errors.push("SKILL.md: 缺少「人工判定」章节");
  } else {
    const claim = /只剩([一二两三四五六七八九十]|\d+)项/.exec(human);
    if (claim) {
      const claimed = CN_NUM[claim[1]] ?? Number(claim[1]);
      const actual = (human.match(/^- \[ \]/gm) ?? []).length;
      if (claimed !== actual) {
        errors.push(`SKILL.md 人工判定声称「只剩${claim[1]}项」，实际列了 ${actual} 项`);
      }
    }
  }

  // ── 4. 机器判定 checklist 必须覆盖 run-all 的每一步 ──────────────────
  const machine = sliceSection(skill, "**机器判定**");
  for (const name of steps) {
    if (!machine.includes(name)) {
      errors.push(`SKILL.md 机器判定 checklist 缺少 run-all 步骤「${name}」`);
    }
  }

  // ── 5. 文档命令里的脚本路径必须真实存在 ──────────────────────────────
  for (const [label, doc] of [["SKILL.md", skill], ["README.md", readme]]) {
    for (const m of doc.matchAll(/(?:node|python3?)\s+([A-Za-z0-9_@./-]+\.(?:mjs|py))\b/g)) {
      if (checkablePath(m[1]) && !fs.existsSync(path.join(root, m[1]))) {
        errors.push(`${label}: 命令中的脚本不存在：${m[1]}`);
      }
    }
  }

  // ── 6. SKILL.md 脚本索引表：路径存在，且与 04-scripts.md 互为印证 ─────
  const tableSection = sliceSection(skill, "## 脚本索引");
  const tableScripts = [...tableSection.matchAll(/`([A-Za-z0-9_@./-]+\.(?:mjs|py))`/g)].map((m) => m[1]);
  if (tableScripts.length < 10) errors.push(`SKILL.md 脚本索引表只解析到 ${tableScripts.length} 个脚本，疑似表格结构被破坏`);
  for (const p of tableScripts) {
    if (!fs.existsSync(path.join(root, p))) errors.push(`SKILL.md 脚本索引的路径不存在：${p}`);
    if (!scripts04.includes(path.basename(p))) {
      errors.push(`SKILL.md 脚本索引的 ${p} 未在 references/04-scripts.md 中登记（两处需同步）`);
    }
  }

  // ── 7. Markdown 链接（含图片）必须指向真实文件/目录 ───────────────────
  for (const [label, doc] of [["SKILL.md", skill], ["README.md", readme]]) {
    for (const m of doc.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      const dir = label === "README.md" || label === "SKILL.md" ? root : path.join(root, path.dirname(label));
      if (!fs.existsSync(path.resolve(dir, target))) errors.push(`${label}: 链接失效：${m[1]}`);
    }
  }

  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = checkDocs(root);
  if (errors.length) {
    console.error(`✗ 文档一致性校验失败（${errors.length} 项）：\n  - ${errors.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("✓ 文档一致性校验通过：步数 / 规则编号 / checklist / 脚本路径 / 链接均与代码和磁盘一致");
}
