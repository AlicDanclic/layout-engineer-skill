# layout-engineer 自身架构图

由 **layout-engineer** 生成。布局是算出来的，不是画出来的。

## 目录

```
variables/          设计变量（tokens.ts + layout.ts，四行注释约束）
src/layout/         布局计算纯函数（buildLayout(breakpoint) -> LayoutTree）
vendor/layout-engine 布局构建工具（由 Skill 复制，勿改）
layout-tree/        双端 Layout Tree JSON（含 variableSnapshot）
positioning/        定位图：查看器快照 / confirmed-*.svg / storyboard/
preview/            双端预览图（SVG + PNG）
docs/               docgen 生成的文档站
manifest.json       变量反向索引
```

## 流程

```bash
# ③ 计算并归档双端 Layout Tree
npm run build

# ④ 交互式定位确认（浏览器打开提示的地址，双端各确认一次）
npm run view

# ⑤ 验证层（不通过则禁止渲染）
npm run validate

# ⑥ 最终渲染
npm run render

# 视频产物：关键帧 storyboard（先编辑 storyboard.json）
npm run storyboard && npm run render

# ⑦ 文档站
npm run docs
```

## 修改布局的正确姿势

1. 改 `variables/` 里的变量（不要直接改坐标）；
2. `node ../../layout/scripts/indexer.mjs --project . --impact <变量名>` 看结构化 diff 预览；
3. `npm run build && npm run validate && npm run view` 重新确认。
