/**
 * positioning-viewer 交互逻辑。
 * 坐标全部来自 Layout Tree JSON，渲染复用 render-core.mjs（与静态导出同一套代码）。
 */
import { flattenTree, numberMark, renderSvg, depthColor } from "./render-core.mjs";

const state = {
  trees: {},
  projectName: "",
  breakpoint: "desktop",
  toggles: {
    showAreas: true,
    showCenters: false,
    showDistances: true,
    showExpr: true,
    showCanvasInfo: true,
  },
  hidden: { desktop: new Set(), mobile: new Set() },
  hovered: null,
};

const $ = (sel) => document.querySelector(sel);

// 服务端若用 --token 启动，地址会带 ?token=...，这里透传给所有 API
const TOKEN = new URLSearchParams(location.search).get("token") ?? "";
const api = (p) => (TOKEN ? `${p}${p.includes("?") ? "&" : "?"}token=${encodeURIComponent(TOKEN)}` : p);

function toast(msg, ok = false) {
  const el = $("#status");
  el.textContent = msg;
  el.className = `status on${ok ? " ok" : ""}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.className = "status"), 4000);
}

function optionsFor(bp) {
  return {
    ...state.toggles,
    hiddenIds: [...state.hidden[bp]],
    hoveredId: state.hovered,
  };
}

function currentTree() {
  return state.trees[state.breakpoint];
}

function draw() {
  const tree = currentTree();
  if (!tree) {
    $("#stage").innerHTML = '<p style="padding:24px;color:#64748b">没有可用的 Layout Tree。</p>';
    return;
  }
  $("#stage").innerHTML = renderSvg(tree, optionsFor(state.breakpoint));
  const c = tree.canvas;
  $("#canvasHint").textContent = `当前画布 ${c.w} × ${c.h} · ${c.breakpoint}`;
}

function buildElementList() {
  const tree = currentTree();
  const ul = $("#elementList");
  ul.innerHTML = "";
  if (!tree) return;
  const entries = flattenTree(tree.elements);
  for (const e of entries) {
    const n = e.node;
    const li = document.createElement("li");
    li.className = e.node.depth > 0 ? "child" : "";
    li.dataset.id = n.id;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !state.hidden[state.breakpoint].has(n.id);
    cb.addEventListener("change", () => {
      if (cb.checked) state.hidden[state.breakpoint].delete(n.id);
      else state.hidden[state.breakpoint].add(n.id);
      draw();
    });

    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = numberMark(e.index);
    mark.style.color = depthColor(n.depth);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = n.label;

    const id = document.createElement("span");
    id.className = "id";
    id.textContent = n.id;

    li.append(cb, mark, name, id);
    li.addEventListener("mouseenter", () => {
      state.hovered = n.id;
      li.classList.add("hot");
      draw();
    });
    li.addEventListener("mouseleave", () => {
      if (state.hovered === n.id) state.hovered = null;
      li.classList.remove("hot");
      draw();
    });
    ul.append(li);
  }
}

async function load() {
  const res = await fetch(api("/api/trees"));
  const data = await res.json();
  state.trees = data.trees ?? {};
  state.projectName = data.projectName ?? "";
  $("#projectName").textContent = state.projectName;
  if (!state.trees[state.breakpoint]) {
    state.breakpoint = Object.keys(state.trees)[0] ?? "desktop";
    const radio = document.querySelector(`input[name=bp][value=${state.breakpoint}]`);
    if (radio) radio.checked = true;
  }
  buildElementList();
  draw();
}

function serializeSvg() {
  const tree = currentTree();
  return renderSvg(tree, {
    ...optionsFor(state.breakpoint),
    title: `${state.projectName} · ${state.breakpoint} · confirmed`,
  });
}

function download(name, text) {
  const blob = new Blob([text], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.querySelectorAll("[data-opt]").forEach((cb) => {
  cb.addEventListener("change", () => {
    state.toggles[cb.dataset.opt] = cb.checked;
    draw();
  });
});

document.querySelectorAll('input[name="bp"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    state.breakpoint = r.value;
    state.hovered = null;
    buildElementList();
    draw();
  });
});

document.querySelectorAll("[data-all]").forEach((b) => {
  b.addEventListener("click", () => {
    const all = b.dataset.all === "hide";
    const tree = currentTree();
    if (!tree) return;
    state.hidden[state.breakpoint] = all
      ? new Set(flattenTree(tree.elements).map((e) => e.node.id))
      : new Set();
    buildElementList();
    draw();
  });
});

$("#refresh").addEventListener("click", async () => {
  const res = await fetch(api("/api/refresh"));
  const data = await res.json();
  state.trees = data.trees ?? {};
  buildElementList();
  draw();
  toast("已重新读取 layout-tree/*.json");
});

$("#export").addEventListener("click", () => {
  download(`positioning-${state.breakpoint}.svg`, serializeSvg());
  toast(`已导出当前 ${state.breakpoint} 定位图（浏览器下载）`, true);
});

$("#confirm").addEventListener("click", async () => {
  const options = {};
  for (const bp of Object.keys(state.trees)) {
    options[bp] = {
      ...state.toggles,
      hiddenIds: [...state.hidden[bp]],
      hoveredId: null,
    };
  }
  const res = await fetch(api("/api/confirm"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ options, source: "viewer-ui" }),
  });
  const data = await res.json();
  if (data.error) return toast(`确认失败: ${data.error}`);
  toast(`已确认并归档: ${data.written.join(", ")}`, true);
});

load().catch((e) => toast(`加载失败: ${e.message}`));
