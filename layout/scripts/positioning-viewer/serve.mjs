#!/usr/bin/env node
/**
 * positioning-viewer server — 交互式定位确认查看器。
 *
 * 用法：
 *   node scripts/positioning-viewer/serve.mjs --project <projectDir> [--port 5173] [--host 0.0.0.0] [--token <secret>]
 *
 * 网络：
 *   --host 默认 0.0.0.0，即对外暴露端口，服务器上跑的 skill 也能用本地浏览器打开。
 *   启动时会打印所有可达地址（localhost + 各网卡 IPv4）。
 *   只想本机访问：--host 127.0.0.1
 *   暴露到公网时建议加 --token，API 需带 ?token=... 才能读写（页面里会自动带上）。
 *
 * 页面读取 <projectDir>/layout-tree/*.json；"确认"时把当前开关状态导出为
 * <projectDir>/positioning/confirmed-<breakpoint>.svg 并写入确认记录与查看器快照。
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderSvg } from "./render-core.mjs";
import { ensureDir, listTrees } from "../layout-engine/io.mjs";
import { hashLayoutTree, HASH_VERSION } from "../layout-engine/hash.mjs";
import { parseArgs } from "../layout-engine/cli.mjs";
import { upsertRecord, listRecords } from "../layout-engine/confirm-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/** 列出该 host/port 下所有可达地址（含各网卡 IPv4）。 */
export function listUrls(host, port, token = null) {
  const suffix = token ? `/?token=${encodeURIComponent(token)}` : "/";
  const urls = [];
  if (LOOPBACK.has(host)) {
    urls.push(`http://localhost:${port}${suffix}`);
    return urls;
  }
  urls.push(`http://localhost:${port}${suffix}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${port}${suffix}`);
    }
  }
  return [...new Set(urls)];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

/**
 * 启动查看器服务。
 * @returns {{server: import("node:http").Server, urls: string[], project: string, loadTrees: Function}}
 */
export function serveViewer({ projectDir, port = 5173, host = "0.0.0.0", token = null }) {
  const project = path.resolve(projectDir);
  const treesDir = path.join(project, "layout-tree");
  const positioningDir = path.join(project, "positioning");

  const loadTrees = () => {
    const out = {};
    for (const [, tree] of listTrees(treesDir)) out[tree.canvas.breakpoint] = tree;
    return out;
  };

  const authed = (req, url) => {
    if (!token) return true;
    const given = url.searchParams.get("token") ?? req.headers["x-viewer-token"] ?? "";
    return given === token;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const p = url.pathname;

    try {
      // ---------- API（受 token 保护）----------
      if (p.startsWith("/api/")) {
        if (!authed(req, url)) {
          return send(res, 401, JSON.stringify({ error: "缺少或错误的 token（启动时用 --token 指定，请求带 ?token=）" }));
        }

        if (p === "/api/trees") {
          return send(
            res,
            200,
            JSON.stringify({ project, projectName: path.basename(project), trees: loadTrees() }),
          );
        }
        if (p === "/api/refresh") {
          return send(res, 200, JSON.stringify({ project, trees: loadTrees() }));
        }
        if (p === "/api/export" && req.method === "POST") {
          const body = await readBody(req);
          const trees = loadTrees();
          const tree = trees[body.breakpoint];
          if (!tree) return send(res, 400, JSON.stringify({ error: `无 ${body.breakpoint} 布局树` }));
          return send(res, 200, JSON.stringify({ svg: renderSvg(tree, body.options ?? {}) }));
        }
        if (p === "/api/confirm" && req.method === "POST") {
          const body = await readBody(req);
          const trees = loadTrees();
          ensureDir(positioningDir);
          const written = [];
          for (const [bp, tree] of Object.entries(trees)) {
            const opts = body.options?.[bp] ?? body.options?.default ?? {};
            const svg = renderSvg(tree, { ...opts, title: `${path.basename(project)} · ${bp} · confirmed` });
            const file = path.join(positioningDir, `confirmed-${bp}.svg`);
            fs.writeFileSync(file, svg);
            written.push(path.relative(project, file));
            // 落盘确认记录：{node, bp, hidden, 时间戳} + 当次布局指纹
            // 指纹把「确认」绑定到这一次具体的布局结果：之后改布局，确认自动失效
            upsertRecord(project, {
              node: "positioning",
              bp,
              hidden: opts.hiddenIds ?? [],
              source: body.source ?? "viewer-ui",
              treeHash: hashLayoutTree(tree),
              hashVersion: HASH_VERSION,
              svg: path.relative(project, file),
              options: opts,
            });
          }
          const records = listRecords(project);

          // 查看器快照：把确认时刻的双端定位图固化为可离线打开的页面
          const gallery = [
            "<!doctype html>",
            '<html lang="zh-CN"><head><meta charset="utf-8"/>',
            `<title>${path.basename(project)} · positioning confirmed</title>`,
            "<style>body{margin:0;font-family:ui-sans-serif,system-ui,'PingFang SC',sans-serif;background:#0b1120;color:#e2e8f0}",
            "header{padding:14px 20px;background:#111827;border-bottom:1px solid #263244}",
            "h1{font-size:15px;margin:0}",
            ".meta{color:#94a3b8;font-size:12px;margin-top:4px}",
            "figure{margin:22px auto;max-width:1100px;background:#fff;border-radius:8px;overflow:hidden}",
            "figcaption{background:#111827;color:#94a3b8;font-size:12px;padding:8px 12px}",
            "svg{display:block;width:100%;height:auto}</style></head><body>",
            `<header><h1>定位确认快照 · ${path.basename(project)}</h1>`,
            `<div class="meta">断点 ${Object.keys(trees).join(" / ")} · 记录数 ${records.length}</div></header>`,
          ];
          for (const bp of Object.keys(trees)) {
            const svg = fs.readFileSync(path.join(positioningDir, `confirmed-${bp}.svg`), "utf8");
            gallery.push(`<figure><figcaption>${bp} · confirmed-${bp}.svg</figcaption>${svg}</figure>`);
          }
          gallery.push("</body></html>");
          fs.writeFileSync(path.join(positioningDir, "viewer.html"), gallery.join("\n"));
          written.push("positioning/viewer.html");

          return send(res, 200, JSON.stringify({ ok: true, written, records }));
        }
        return send(res, 404, JSON.stringify({ error: `未知接口 ${p}` }));
      }

      // ---------- 静态资源 ----------
      const rel = p === "/" ? "/viewer.html" : p;
      const target = path.join(HERE, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      if (!target.startsWith(HERE) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        return send(res, 404, "not found", "text/plain; charset=utf-8");
      }
      return send(res, 200, fs.readFileSync(target), MIME[path.extname(target)] ?? "application/octet-stream");
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  });

  return { server, urls: listUrls(host, port, token), project, loadTrees };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { project: ".", port: 5173, host: "0.0.0.0", token: null });
  if (args.help) {
    console.log(
      "用法: node scripts/positioning-viewer/serve.mjs --project <projectDir> [--port 5173] [--host 0.0.0.0] [--token <secret>]",
    );
    return;
  }
  const { server, urls, project } = serveViewer({ ...args, projectDir: args.project });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error(`端口 ${args.port} 已被占用。换个端口：--port ${args.port + 1}`);
    } else {
      console.error(`查看器启动失败: ${e.message}`);
    }
    process.exit(1);
  });

  server.listen(args.port, args.host, () => {
    console.log(`定位查看器已启动（项目：${project}）`);
    for (const u of urls) console.log(`  ${u}`);
    console.log("  打开后左侧面板确认布局；点「确认」会写入 positioning/confirmed-*.svg");
    if (!LOOPBACK.has(args.host)) {
      console.log(
        args.token
          ? "  已启用 token 校验；请用上面带 ?token= 的地址打开。"
          : "  注意：已对外暴露端口且未设 token，同网络内任何人都可读写该项目（服务端可加 --token 限制）。",
      );
      console.log("  只允许本机访问：--host 127.0.0.1");
    }
    console.log("按 Ctrl+C 结束。");
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`查看器启动失败: ${e.message}`);
    process.exit(1);
  });
}
