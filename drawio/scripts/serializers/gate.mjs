/**
 * serializers/gate — 渲染前置闸门（供每个序列化器单独调用）。
 *
 * 为什么每个序列化器都要调：`serializers/index.mjs` 的预检只是「更好看的报错」，
 * 真正兜底的是这里。任何人直接 `node scripts/serializers/react.mjs` 也绕不过去。
 *
 * 闸门读的是**文件**（confirmed.json / manifest.confirmations），不读对话。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkConfirmation } from "../../../layout/scripts/validate/check-confirmation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 未确认即抛错。
 * @param {string} projectDir
 * @param {"static"|"storyboard"} mode
 * @param {{allow?: boolean}} [opts]
 */
export function requireConfirmation(projectDir, mode = "static", opts = {}) {
  if (opts.allow) {
    console.warn(
      [
        "",
        "╔══════════════════════════════════════════════════════════════╗",
        "║  ⚠  未确认预览（UNCONFIRMED PREVIEW）                              ║",
        "║  确认闸门被 --allow-unconfirmed 跳过：本次产物一律带            ║",
        "║  `PREVIEW-` 文件名前缀 + 位图水印，不得作为交付物。            ║",
        "║  交付前请在定位查看器里由用户点「确认布局」，再重新渲染。      ║",
        "╚══════════════════════════════════════════════════════════════╝",
        "",
      ].join("\n"),
    );
    return;
  }
  const { ok, errors, warnings } = checkConfirmation(projectDir, { mode, scope: opts.scope ?? null });
  for (const w of warnings) console.warn(`确认闸门警告：${w}`);
  if (!ok) {
    const hint =
      mode === "storyboard"
        ? `请让用户确认关键帧后执行：\n    node ${path.relative(process.cwd(), path.join(HERE, "..", "confirm.mjs"))} --project ${path.relative(process.cwd(), projectDir)} --node storyboard --source user-chat`
        : `请在定位查看器中由用户点击「确认布局」：\n    node ${path.relative(process.cwd(), path.join(HERE, "..", "positioning-viewer", "serve.mjs"))} --project ${path.relative(process.cwd(), projectDir)}`;
    const err = new Error(
      `确认闸门未通过（mode=${mode}），渲染被阻断：\n  - ${errors.join("\n  - ")}\n  ${hint}\n  CI / 示例归档可加 --allow-unconfirmed 跳过（会打印警告）`,
    );
    err.isGateError = true;
    throw err;
  }
}

/** 从 argv 里读 --allow-unconfirmed。 */
export function allowUnconfirmed(argv = process.argv.slice(2)) {
  return argv.includes("--allow-unconfirmed");
}

/** 从 argv 里读 --scope desktop,mobile（缺省表示全部断点）。 */
export function scopeFrom(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--scope");
  return i >= 0 ? argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : null;
}

/** 未确认预览产物的文件名前缀。交付只认**没有**这个前缀的文件。 */
export const PREVIEW_MARK = "PREVIEW-";

/**
 * 未确认时给产物路径加 `PREVIEW-` 前缀（幂等）。
 *
 * 这是「先确认、后生成」的**结构性保证**：闸门被跳过后，正常文件名的交付物
 * 在物理上不可能产生——AI 就算调 `--allow-unconfirmed`，也只能得到一份
 * 带前缀的预览，无法冒充交付稿。
 *
 * @param {string} file
 * @param {boolean} allow 是否走了 --allow-unconfirmed
 * @returns {string}
 */
export function previewPath(file, allow) {
  if (!allow) return file;
  const dir = path.dirname(file);
  const base = path.basename(file);
  if (base.startsWith(PREVIEW_MARK)) return file;
  return path.join(dir, `${PREVIEW_MARK}${base}`);
}
