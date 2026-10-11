# 05 · Storyboard 与 Remotion

视频布局是四维的（含时间），不做逐帧定位图，只出**关键帧**。

## 输入：`storyboard.json`

```json
{
  "fps": 30,
  "duration": 3.0,
  "breakpoint": "desktop",
  "tracks": [
    { "id": "header",    "enter": 0.0, "expanded": 0.4, "exit": 3.0, "animation": "fade", "offset": 16 },
    { "id": "card-list", "enter": 0.4, "expanded": 0.9, "exit": 3.0, "animation": "fade" },
    { "id": "footer",    "enter": 1.6, "expanded": 2.0, "exit": 3.0, "animation": "slide-up" }
  ]
}
```

- `id` 必须存在于对应断点的 Layout Tree。
- `enter / expanded / exit` 单位为**秒**；`expanded` 是「完全展开」时刻。
- `animation`：`none` | `fade` | `slide-up` | `slide-left` | `scale`（remotion 序列化器支持）。
- `offset`：入场位移量（px）。**作为数据写进 `timeline.json`**，因此序列化器里不带几何字面量。
- 未出现在 `tracks` 里的元素视为常驻、无入场动画。

## 关键帧选取规则

- 每个有动画的元素取 3 个关键状态：**入场帧 / 完全展开帧 / 离场帧**；无动画元素不单独出帧。
- 关键帧时间点 = 所有轨道三个端点的**合并去重后排序**。
- 想让帧数落在 3~6 张（推荐范围），让多个轨道的端点对齐。
- `renderKeyframes` 会把不在 `[enter, exit]` 区间内的元素标为隐藏后再渲染。

## 产出物

```
positioning/storyboard/
├── timeline.svg          # 时间轴轨道图
├── timeline.json         # 供 remotion 序列化器消费
├── kf-01-t0.0s.svg       # 关键帧 1：t = 0.0s
├── kf-02-t0.4s.svg       # 关键帧 2：t = 0.4s
└── ...
```

- **关键帧定位图**：复用查看器的静态导出（区域圈选 + 编号 + 四向距离 + expr），右上角标注时间区间，如 `t = 0.0s ~ 0.4s`。
- **时间轴轨道图**：横轴为时间刻度，每行一个元素（左侧 ①②③ 编号），色块表示存在区间，红色竖虚线标记关键帧时刻，色块上的三个圆点即 入场 / 完全展开 / 离场。

关键帧定位图同样需经用户确认后才渲染视频，而且走**独立闸门**（与静态产物分开）：

```bash
node layout/scripts/confirm.mjs --project <dir> --node storyboard --source user-chat
node layout/scripts/validate/check-confirmation.mjs --project <dir> --mode storyboard
```

闸门比对的是 `timeline.json` 的指纹：确认后只要改了时间轴，确认即失效。

## timeline.json（自动生成）

```json
{
  "fps": 30,
  "durationInFrames": 90,
  "breakpoint": "desktop",
  "tracks": [
    { "id": "header", "from": 0, "durationInFrames": 90, "animation": "fade" }
  ]
}
```

`from = round(enter × fps)`；`durationInFrames = round(exit × fps) - from`（至少 1）。

## Remotion 序列化

```bash
node drawio/scripts/storyboard/index.mjs --project <dir>
node drawio/scripts/serializers/remotion.mjs --project <dir> [--breakpoint desktop]
```

产物 `src/serializers/Composition.tsx`：

- `TREE` 内嵌 Layout Tree，坐标换算为百分比 `s(v, total)`；
- `TRACKS` 来自 `timeline.json`（含 `from / durationInFrames / animation / offset`）；
- 每个顶层元素按 `from / durationInFrames` 包在 `<Sequence>` 里；
- `animStyle(anim, progress)` 用 `useCurrentFrame()` + `interpolate` 做入场；
- 导出 `<Name>Composition` 与 `<Name>Meta`（`id / component / durationInFrames / fps / width / height`），可直接喂给 `<Composition>`。

**先跑 storyboard 再跑 remotion**；否则会退化为「全部元素常驻、无动画」。

## 建议

- 时长 < 5s 时 fps 取 30，> 5s 可 30/60。
- 关键帧确认时重点看：入场顺序是否符合预期、离场时机是否留白、元素区间是否有重叠冲突。
- 若需要真正的运动模糊/缓动曲线，属于视觉层，不在本 Skill 几何范畴内。
