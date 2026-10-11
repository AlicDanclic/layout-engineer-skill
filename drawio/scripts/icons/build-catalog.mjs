#!/usr/bin/env node
/**
 * build-catalog — 扫描 assets/icons/ 生成图标目录 assets/icons/catalog.json。
 *
 * 为什么要有目录（而不是让渲染器现场扫目录）：
 *   1. `icon` 字段是**逻辑名**（如 "python"），必须有一个稳定的「逻辑名 → 文件」映射，
 *      否则改了文件名就会静默丢图标；
 *   2. 目录还是**校验依据**：check-drawio / schema 找不到逻辑名就报错，而不是渲染出空白；
 *   3. SVG（内嵌进 .drawio）与配套 PNG（供 Pillow 渲染 PNG）分别记录，缺哪一个一目了然。
 *
 * 命名约定：`<Base>_<Variant>.<ext>`，Variant ∈ Color / Monochrome / Color_Labeled / Labeled。
 * 同一个 Base 的不同 Variant 归并为同一个逻辑名（小写 Base）。
 * 默认取色优先级：Color > Monochrome > Color_Labeled > Default。
 *
 * 用法：
 *   node scripts/icons/build-catalog.mjs            # 生成 catalog.json
 *   node scripts/icons/build-catalog.mjs --list     # 按类别打印可用逻辑名
 *   node scripts/icons/build-catalog.mjs --check    # 只校验 catalog.json 是否与目录一致
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = path.resolve(HERE, "..", "..");
export const ICON_DIR = path.join(SKILL_ROOT, "assets", "icons");
export const CATALOG_FILE = path.join(ICON_DIR, "catalog.json");

/**
 * 逻辑名 → [显示名, 类别]。
 * 类别用于 `--list` 分组与文档，不参与校验；未登记的文件会落到 "misc" 并在生成时告警。
 */
const META = {
  adi: ["Analog Devices (ADI)", "vendor"],
  android: ["Android", "platform"],
  cloudflare: ["Cloudflare", "platform"],
  docker: ["Docker", "platform"],
  document: ["Document", "generic"],
  drawio: ["draw.io", "tool"],
  electron: ["Electron", "framework"],
  espressif: ["Espressif (ESP32)", "platform"],
  git: ["Git", "tool"],
  gitee: ["Gitee", "platform"],
  github: ["GitHub", "platform"],
  go: ["Go", "language"],
  google: ["Google", "platform"],
  gradle: ["Gradle", "tool"],
  html5: ["HTML5", "language"],
  image: ["Image", "generic"],
  jsonfile: ["JSON", "generic"],
  kicad: ["KiCad", "tool"],
  lvgl: ["LVGL", "framework"],
  markdown: ["Markdown", "generic"],
  opencv: ["OpenCV", "framework"],
  platformio: ["PlatformIO", "tool"],
  python: ["Python", "language"],
  qt: ["Qt", "framework"],
  react: ["React", "framework"],
  rust: ["Rust", "language"],
  stmicroelectronics: ["STMicroelectronics (STM32)", "platform"],
  tauri: ["Tauri", "framework"],
  texas: ["Texas Instruments", "vendor"],
  智乃智乃: ["智乃智乃", "misc"],
};

/** 变体识别顺序：先长后短，避免 `_Color_Labeled` 被误判成 `_Color`。 */
const VARIANTS = ["Color_Labeled", "Monochrome_Labeled", "Color", "Monochrome", "Labeled"];
const PICK_ORDER = ["Color", "Monochrome", "Color_Labeled", "Labeled", "Default"];
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

function splitVariant(stem) {
  for (const v of VARIANTS) {
    if (stem.endsWith(`_${v}`)) return { base: stem.slice(0, -(v.length + 1)), variant: v };
  }
  return { base: stem, variant: "Default" };
}

/** 扫描目录，产出 { key: { variants: { variant: { svg?, raster?, rasterMime? } } } }。 */
export function scanIcons(dir = ICON_DIR) {
  if (!fs.existsSync(dir)) throw new Error(`图标目录不存在: ${dir}`);
  const groups = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const ext = path.extname(name).toLowerCase();
    if (!MIME[ext]) continue; // catalog.json 等非图片文件跳过
    const stem = name.slice(0, -ext.length);
    const { base, variant } = splitVariant(stem);
    const key = base.toLowerCase();
    const g = (groups[key] ??= { base, variants: {} });
    const slot = (g.variants[variant] ??= {});
    if (ext === ".svg") slot.svg = name;
    else {
      slot.raster = name;
      slot.rasterMime = MIME[ext];
    }
  }
  return groups;
}

const pick = (g, field) => {
  for (const v of PICK_ORDER) {
    const slot = g.variants[v];
    if (slot?.[field]) return { variant: v, file: slot[field], mime: slot.rasterMime };
  }
  return null;
};

/** 生成 catalog 对象（确定性：键排序、无时间戳）。 */
export function buildCatalog(dir = ICON_DIR) {
  const groups = scanIcons(dir);
  const icons = {};
  const unknown = [];
  for (const key of Object.keys(groups).sort()) {
    const g = groups[key];
    const [label, category] = META[key] ?? [g.base, "misc"];
    if (!META[key]) unknown.push(key);
    // 优先选「SVG 与配套 PNG 都齐全」的同一变体：这样 .drawio（内嵌 SVG）与
    // 自研 PNG 渲染（读配套 PNG）看到的是同一套素材，不会一个彩色一个单色。
    const both = PICK_ORDER.map((v) => [v, g.variants[v]]).find(([, s]) => s?.svg && s?.raster);
    const svg = both ? { variant: both[0], file: both[1].svg } : pick(g, "svg");
    const raster = both
      ? { variant: both[0], file: both[1].raster, mime: both[1].rasterMime }
      : pick(g, "raster");
    const variants = {};
    for (const v of PICK_ORDER) {
      const slot = g.variants[v];
      if (!slot) continue;
      variants[v.toLowerCase()] = {
        ...(slot.svg ? { svg: slot.svg } : {}),
        ...(slot.raster ? { raster: slot.raster, rasterMime: slot.rasterMime } : {}),
      };
    }
    icons[key] = {
      label,
      category,
      svg: svg?.file ?? null,
      raster: raster?.file ?? null,
      rasterMime: raster?.mime ?? null,
      variants,
    };
  }
  const categories = {};
  for (const [key, v] of Object.entries(icons)) (categories[v.category] ??= []).push(key);
  for (const list of Object.values(categories)) list.sort();
  return {
    version: 1,
    source: "assets/icons",
    note: "由 drawio/scripts/icons/build-catalog.mjs 生成；逻辑名供 Layout Tree 节点的 icon 字段引用。",
    categories,
    icons,
    unknown,
  };
}

let _cache = null;
/** 读取（必要时重算）目录。渲染器与校验器共用，避免每次读盘。 */
export function loadCatalog({ refresh = false } = {}) {
  if (_cache && !refresh) return _cache;
  if (!refresh && fs.existsSync(CATALOG_FILE)) {
    try {
      _cache = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
      return _cache;
    } catch {
      /* 目录损坏则重算 */
    }
  }
  _cache = buildCatalog();
  return _cache;
}

/** 解析一个逻辑名 → { key, svg, raster, rasterMime, label, category }，找不到抛错。 */
export function resolveIcon(key, catalog = loadCatalog()) {
  const hit = catalog.icons?.[key];
  if (!hit) {
    const names = Object.keys(catalog.icons ?? {}).sort().join(" / ");
    throw new Error(`未知图标逻辑名 "${key}"（可用：${names}）`);
  }
  return { key, ...hit };
}

const serialize = (obj) => JSON.stringify(obj, null, 2) + "\n";

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("用法: node scripts/icons/build-catalog.mjs [--list|--check]");
    return;
  }
  const catalog = buildCatalog();
  if (argv.includes("--list")) {
    for (const [cat, keys] of Object.entries(catalog.categories)) {
      console.log(`\n[${cat}]`);
      for (const k of keys) {
        const i = catalog.icons[k];
        const formats = [i.svg ? "svg" : null, i.raster ? path.extname(i.raster).slice(1) : null]
          .filter(Boolean)
          .join("+");
        console.log(`  ${k.padEnd(20)} ${i.label.padEnd(28)} ${formats}`);
      }
    }
    if (catalog.unknown.length) console.log(`\n未登记类别（misc）：${catalog.unknown.join(", ")}`);
    return;
  }
  const text = serialize(catalog);
  if (argv.includes("--check")) {
    const old = fs.existsSync(CATALOG_FILE) ? fs.readFileSync(CATALOG_FILE, "utf8") : "";
    if (old !== text) {
      console.error("catalog.json 与 assets/icons/ 不一致，请运行 node scripts/icons/build-catalog.mjs");
      process.exit(1);
    }
    console.log(`✓ catalog.json 与目录一致（${Object.keys(catalog.icons).length} 个图标）`);
    return;
  }
  fs.writeFileSync(CATALOG_FILE, text);
  console.log(`✓ 已写入 ${path.relative(SKILL_ROOT, CATALOG_FILE)}（${Object.keys(catalog.icons).length} 个图标）`);
  if (catalog.unknown.length) console.warn(`· 未登记类别已归入 misc：${catalog.unknown.join(", ")}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
