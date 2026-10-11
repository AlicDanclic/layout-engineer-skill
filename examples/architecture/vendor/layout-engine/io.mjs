/**
 * 文件 IO 工具（仅 Node 使用）。
 */
import fs from "node:fs";
import path from "node:path";
import { assertLayoutTree } from "./schema.mjs";
import { serializeTree } from "./builder.mjs";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/** 读取并校验一棵 Layout Tree。 */
export function readTree(file) {
  return assertLayoutTree(readJson(file), file);
}

/** 写出 Layout Tree（稳定格式）。 */
export function writeTree(file, tree) {
  assertLayoutTree(tree, file);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, serializeTree(tree));
  return file;
}

/** 列出某目录下所有 .json Layout Tree，返回 [文件名, 树] 列表。 */
export function listTrees(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => [f, readTree(path.join(dir, f))]);
}

export function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(p);
      } else if (!ext || e.name.endsWith(ext)) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out.sort();
}
