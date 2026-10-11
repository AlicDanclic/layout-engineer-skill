# {{PROJECT_TITLE}}

由 **layout-engineer** 生成。布局是算出来的，不是画出来的。

## 目录

```
variables/           tokens.ts（间隔刻度/断点/原点）+ layout.ts（元素特定尺寸）
src/layout/          布局计算纯函数：context(breakpoint) + 唯一的 layout(ctx)
vendor/layout-engine 布局构建工具（由 Skill 复制或软链，勿改）
layout-tree/         双端 Layout Tree JSON（含 variableSnapshot 与 expr 出处）
positioning/         confirmed.json（确认记录）+ confirmed-*.svg + storyboard/
preview/             双端预览图（SVG + PNG）
docs/                docgen 生成的文档站
manifest.json        variableSnapshot + variableUsage + confirmations
eslint.config.mjs    几何裸字面量规则（引用 Skill 里的插件）
```

## 流程（两个确认节点不可跳过）

```bash
# 复核结构（确认节点 A 的机器版）
npm run print-tree

# ③ 计算并归档双端 Layout Tree
npm run build

# ④ 交互式定位确认：默认绑 0.0.0.0 并打印所有可达地址，双端各确认一次
#    服务器上跑：直接用 http://<服务器IP>:5173/；公网加锁：npm run view -- --token <secret>
npm run view

# 结构确认落盘（用户认可文本 box tree 后执行；AI 不得自行伪造）
npm run confirm -- --node structure --source user-chat --note "用户回复：结构 OK"

# ⑤ 验证层（含确认闸门；不通过则禁止渲染）
npm run validate

# ⑥ 最终渲染（渲染前会再检查一次确认记录，未经确认直接抛错退出）
npm run render

# 视频产物：先编辑 storyboard.json，出关键帧并让用户确认，再渲染
npm run storyboard
npm run confirm -- --node storyboard --source user-chat
npm run render

# ⑦ 文档站
npm run docs
```

## 确认与闸门

- 确认状态落盘在 `positioning/confirmed.json`，**渲染闸门读文件，不读对话**；
- 每条定位确认都记录当次布局的 `treeHash`：确认后再改布局，确认自动失效；
- `manifest.json` 的 `confirmations` 是聚合视图（结构 / 桌面 / 移动 / 分镜）；
- CI 或示例归档可加 `--allow-unconfirmed` 跳过，但会打印警告。

## 修改布局的正确姿势

1. 改 `variables/` 里的变量（不要直接改坐标）；
2. `node {{SKILL_REL}}/layout/scripts/indexer.mjs --project . --impact <变量名>` 看结构化 diff 预览；
3. `npm run build && npm run validate && npm run view` 重新确认。
