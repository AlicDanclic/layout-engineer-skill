/**
 * cli — 统一的命令行参数解析。
 *
 * 为什么需要它：各脚本各写一套 `for` 循环，导致了真实事故——
 * lint-geometry 把 `--scope desktop` 的取值 `desktop` 当成文件路径去读，裸抛 ENOENT。
 *
 * 规则：
 *   - 只认 defaults 里声明过的键，未知选项一律忽略（含 --k=v 形式）；
 *   - 支持 `--key value` 与 `--key=value`；
 *   - boolean 默认值的键按开关处理，不吃后面的取值；
 *   - 位置参数（不以 - 开头、也不是已知选项的取值）收进 `_`。
 */

/**
 * @param {string[]} argv
 * @param {Record<string, string|number|boolean|null>} defaults
 * @param {{aliases?: Record<string,string>, positionalsAs?: string}} [opts]
 */
export function parseArgs(argv, defaults, opts = {}) {
  const aliases = opts.aliases ?? { h: "help", help: "help" };
  const out = { ...defaults, _: [] };
  const known = new Set(Object.keys(defaults));
  const takesValue = (k) => typeof defaults[k] !== "boolean";

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "--") {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (!raw.startsWith("-")) {
      out._.push(raw);
      continue;
    }
    const eq = raw.indexOf("=");
    const bare = eq >= 0 ? raw.slice(0, eq) : raw;
    const key = aliases[bare.replace(/^-+/, "")] ?? bare.replace(/^-+/, "");
    if (!known.has(key)) continue; // 未知选项忽略
    if (!takesValue(key)) {
      out[key] = true;
      continue;
    }
    const value = eq >= 0 ? raw.slice(eq + 1) : argv[++i];
    out[key] = typeof defaults[key] === "number" ? Number(value) : value;
  }
  return out;
}

/** 把逗号分隔的字符串拆成数组（用于 --scope desktop,mobile）。 */
export function splitList(value) {
  if (!value) return null;
  const arr = String(value).split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : null;
}
