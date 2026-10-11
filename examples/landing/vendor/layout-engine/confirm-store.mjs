/**
 * confirm-store — 确认记录的读写（`positioning/confirmed.json`）。
 *
 * 这个文件存在的意义不是「记录」，而是**渲染阶段的前置闸门**：
 * 序列化器运行前第一步就检查它，不存在就直接抛错退出。这样 SKILL.md 里
 * 「未经确认禁止渲染」的软约束就变成了一道硬闸门。
 *
 * 记录形态：
 *   { "project": "...", "updatedAt": "...", "records": [
 *       { "node": "structure",  "confirmedAt": "...", "source": "user-chat", "note": "..." },
 *       { "node": "positioning","bp": "desktop", "hidden": [], "countdown": ..., },
 *       { "node": "storyboard", "timelineHash": "sha256:..." }
 *   ]}
 *
 * 两层记录：本文件是原始记录（可能来自不同断点、不同时间点），
 * manifest.confirmations 是聚合视图，渲染闸门读的是聚合视图。
 */
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "./io.mjs";

export const CONFIRM_FILE = "positioning/confirmed.json";

export function confirmFilePath(projectDir) {
  return path.join(path.resolve(projectDir), CONFIRM_FILE);
}

export function readConfirmations(projectDir) {
  const file = confirmFilePath(projectDir);
  if (!fs.existsSync(file)) return { project: path.basename(path.resolve(projectDir)), records: [] };
  try {
    const data = readJson(file);
    return { project: data.project ?? path.basename(path.resolve(projectDir)), records: data.records ?? [] };
  } catch {
    return { project: path.basename(path.resolve(projectDir)), records: [] };
  }
}

export function writeConfirmations(projectDir, data) {
  const file = confirmFilePath(projectDir);
  writeJson(file, { ...data, updatedAt: new Date().toISOString() });
  return file;
}

/**
 * 追加/替换一条记录（按 node + bp 去重，保留最新）。
 */
export function upsertRecord(projectDir, record) {
  const data = readConfirmations(projectDir);
  const key = (r) => `${r.node}:${r.bp ?? "-"}`;
  const next = data.records.filter((r) => key(r) !== key(record));
  next.push({ ...record, confirmedAt: record.confirmedAt ?? new Date().toISOString() });
  return writeConfirmations(projectDir, { ...data, records: next });
}

/** 取某类记录。 */
export function getRecord(projectDir, node, bp = null) {
  const { records } = readConfirmations(projectDir);
  return records.find((r) => r.node === node && (bp === null || r.bp === bp)) ?? null;
}

export function listRecords(projectDir) {
  return readConfirmations(projectDir).records;
}
