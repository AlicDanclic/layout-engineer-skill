#!/usr/bin/env bash
# 一键跑通示例：build → 确认闸门 → validate → storyboard → render → 自举架构图
#
# 注意：
#   1. 示例用「夹具确认」代替人工确认，只为让仓库可复现；
#      真实交付必须由用户在定位查看器里点击「确认布局」。
#   2. 本脚本**不会覆盖已存在的人工确认**（曾因此把真实记录冲成 fixture）。
#
# 用法：bash examples/run-example.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="examples/landing"

echo "▶ 0/6  自检 Skill"
node tests/run.mjs >/dev/null
echo "  ✓ tests/run.mjs 通过（26 项）"

echo "▶ 1/6  计算并归档双端 Layout Tree"
node layout/scripts/build-tree.mjs --project "$PROJECT"
node layout/scripts/print-tree.mjs --project "$PROJECT" --breakpoint desktop | head -4

echo "▶ 2/6  确认闸门（演示：未确认时渲染被阻断）"
if node layout/scripts/validate/check-confirmation.mjs --project "$PROJECT" --quiet 2>/dev/null; then
  echo "  · 已有有效确认记录"
else
  echo "  · 尚无有效确认 → 渲染会抛错退出（符合预期）"
  node drawio/scripts/serializers/preview.mjs --project "$PROJECT" >/dev/null 2>&1 \
    && echo "  ✗ 居然渲染成功了，闸门有问题" \
    || echo "  ✓ 已被闸门拦下"
  echo "  · 示例写入夹具确认（fixture，非人工）"
  node drawio/scripts/storyboard/index.mjs --project "$PROJECT" >/dev/null
  node layout/scripts/validate/check-confirmation.mjs --project "$PROJECT" --write-fixture
fi
echo "  真实确认请在浏览器里点「确认布局」："
echo "    node layout/scripts/positioning-viewer/serve.mjs --project $PROJECT"

echo "▶ 3/6  强制验证层（七步）"
node layout/scripts/validate/run-all.mjs --project "$PROJECT"

echo "▶ 4/6  关键帧 Storyboard + 最终渲染"
node drawio/scripts/storyboard/index.mjs --project "$PROJECT" >/dev/null
if node layout/scripts/validate/check-confirmation.mjs --project "$PROJECT" --quiet 2>/dev/null; then
  echo "  · 已有有效确认，保留不动"
else
  node layout/scripts/validate/check-confirmation.mjs --project "$PROJECT" --write-fixture
fi
node drawio/scripts/serializers/index.mjs --project "$PROJECT" --target all

echo "▶ 5/6  修改回路演示：HEADER_H 64 → 56"
node layout/scripts/indexer.mjs --project "$PROJECT" --impact HEADER_H 56 | head -4

echo "▶ 6/6  自举：用 Skill 自身生成架构图"
node layout/scripts/build-tree.mjs --project examples/architecture >/dev/null
node drawio/scripts/storyboard/index.mjs --project examples/architecture >/dev/null
if node layout/scripts/validate/check-confirmation.mjs --project examples/architecture --quiet 2>/dev/null; then
  echo "  · 已有有效确认，保留不动"
else
  node layout/scripts/validate/check-confirmation.mjs --project examples/architecture --write-fixture
fi
node layout/scripts/validate/run-all.mjs --project examples/architecture | tail -2
node drawio/scripts/serializers/preview.mjs --project examples/architecture --style diagram

echo
echo "✓ 完成。"
echo "  定位图确认入口：node layout/scripts/positioning-viewer/serve.mjs --project $PROJECT"
echo "  确认记录：      $PROJECT/positioning/confirmed.json"
echo "  查看器快照：    $PROJECT/positioning/viewer.html"
echo "  双端预览图：    $PROJECT/preview/"
echo "  文档站：        $PROJECT/docs/index.html"
echo "  清单+确认状态： $PROJECT/manifest.json"
echo "  架构图（自举）：examples/architecture/preview/desktop.png"
