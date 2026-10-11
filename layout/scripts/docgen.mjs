/**
 * docgen — 从源码注释自动提取文档，生成文档站，并强制校验注释完整性（规范三）。
 *
 * 校验：
 *   - 函数注释四要素：函数名与参数 / 返回参数 / 功能 / 实现原理
 *   - 变量注释四行：作用 / 影响范围 / 可调范围
 *   - tokens 变量额外需要：可选值 或 临界参数
 *
 * 用法：
 *   node scripts/docgen.mjs --project <dir> [--check-only]
 * 产物：<project>/docs/index.html + <project>/docs/data.json
 */
import fs from "node:fs";
import path from "node:path";
import { listFiles, ensureDir } from "./layout-engine/io.mjs";
import { buildIndex } from "./indexer.mjs";

const FIELD_RE = /^(作用|可选值|临界参数|影响范围|可调范围|功能|实现原理)\s*[:：]\s*(.+)$/;

/** 解析一个 doc 注释块为字段对象。 */
export function parseDocComment(raw) {
  const fields = {};
  const params = [];
  let returns = null;
  for (const line of raw.split("\n")) {
    const clean = line.replace(/^\s*\*?\s?/, "").trim();
    const m = clean.match(FIELD_RE);
    if (m) {
      fields[m[1]] = m[2].trim();
      continue;
    }
    const p = clean.match(/^@param\s+([A-Za-z_$][\w$]*)\s*(.*)$/);
    if (p) {
      params.push({ name: p[1], desc: p[2].trim() });
      continue;
    }
    const r = clean.match(/^@returns?\s*(.*)$/);
    if (r) returns = r[1].trim();
  }
  if (Object.keys(fields).length === 0 && params.length === 0 && returns === null) return null;
  return { fields, params, returns };
}

/** 找出源码中所有 doc 注释及其后的声明。 */
export function extractDeclarations(src, file) {
  const out = [];
  const re = /\/\*\*([\s\S]*?)\*\//g;
  let m;
  while ((m = re.exec(src))) {
    const doc = parseDocComment(m[1]) ?? { fields: {}, params: [], returns: null };
    const rest = src.slice(m.index + m[0].length);
    const line = src.slice(0, m.index).split("\n").length;

    const fn = rest.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*([^{]+?))?\s*\{/);
    if (fn) {
      const params = fn[2]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const ci = s.indexOf(":");
          const nameRaw = (ci >= 0 ? s.slice(0, ci) : s).trim();
          const typeRaw = ci >= 0 ? s.slice(ci + 1).trim() : "";
          // 支持解构参数 `{ breakpoint }: Type` / `[a, b]: Type`
          const name = nameRaw
            .replace(/^\s*(?:\.\.\.)?/, "")
            .replace(/[{}[\]]/g, " ")
            .trim()
            .split(/\s+/)[0]
            .replace(/\?$/, "");
          return { name, type: typeRaw, desc: doc.params.find((p) => p.name === name)?.desc ?? "" };
        });
      out.push({
        kind: "function",
        name: fn[1],
        file,
        line,
        signature: `function ${fn[1]}(${fn[2].trim()})${fn[3] ? `: ${fn[3].trim()}` : ""}`,
        params,
        returns: doc.returns,
        returnType: fn[3]?.trim() ?? null,
        doc,
      });
      continue;
    }

    // 箭头函数常量：`const f = (a, b) => ...` 应按函数文档校验（四要素），
    // 否则「函数名与参数 / 返回参数」两项会被漏掉——这是实际踩过的坑。
    const arrow = rest.match(
      /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*([^=]+?))?\s*=>/,
    );
    if (arrow) {
      const params = arrow[2]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const ci = x.indexOf(":");
          const nameRaw = (ci >= 0 ? x.slice(0, ci) : x).trim();
          const typeRaw = ci >= 0 ? x.slice(ci + 1).trim() : "";
          const name = nameRaw.replace(/[{}[\]]/g, " ").trim().split(/\s+/)[0].replace(/\?$/, "");
          return { name, type: typeRaw, desc: doc.params.find((p) => p.name === name)?.desc ?? "" };
        });
      out.push({
        kind: "function",
        name: arrow[1],
        file,
        line,
        signature: `const ${arrow[1]}(${arrow[2].trim()})${arrow[3] ? `: ${arrow[3].trim()}` : ""} => …`,
        params,
        returns: doc.returns,
        returnType: arrow[3]?.trim() ?? null,
        doc,
      });
      continue;
    }

    const v = rest.match(/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/);
    if (v) {
      out.push({ kind: "const", name: v[1], file, line, doc });
      continue;
    }

    const c = rest.match(/^\s*@?(\w+)/);
    void c;
  }
  return out;
}

/** 校验一个文件里的所有声明。 */
export function validateDeclarations(decls, file, warnings) {
  const errors = [];
  for (const d of decls) {
    const { fields } = d.doc;
    if (d.kind === "function") {
      if (!fields.功能) errors.push(`${file}:${d.line} 函数 ${d.name} 缺少「功能：」`);
      if (!fields.实现原理) errors.push(`${file}:${d.line} 函数 ${d.name} 缺少「实现原理：」`);
      for (const p of d.params) {
        if (!p.desc) errors.push(`${file}:${d.line} 函数 ${d.name} 缺少 @param ${p.name}`);
      }
      const nonVoid = d.returnType && !/^void$/i.test(d.returnType);
      if (d.returns === null || d.returns === undefined) {
        if (nonVoid) errors.push(`${file}:${d.line} 函数 ${d.name} 缺少 @returns（返回类型 ${d.returnType}）`);
        else warnings.push(`${file}:${d.line} 函数 ${d.name} 建议补 @returns（无返回值可写「无」）`);
      }
    } else {
      for (const k of ["作用", "影响范围", "可调范围"]) {
        if (!fields[k]) errors.push(`${file}:${d.line} 变量 ${d.name} 缺少「${k}：」`);
      }
      if (/(?:^|[\\/])tokens\.ts$/.test(file) && !fields.可选值 && !fields.临界参数) {
        errors.push(`${file}:${d.line} 变量 ${d.name} 属于 tokens，缺少「可选值：」或「临界参数：」`);
      }
    }
  }
  return errors;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 生成文档站 HTML。 */
export function renderDocsHtml(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(data.project)} · 布局文档</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:ui-sans-serif,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a;background:#f8fafc}
header{padding:14px 20px;background:#0f172a;color:#f8fafc;display:flex;gap:16px;align-items:baseline}
header h1{font-size:16px;margin:0}
header .meta{color:#94a3b8;font-size:12px}
.tabs{margin-left:auto;display:flex;gap:8px}
.tabs button{background:#1e293b;border:1px solid #334155;color:#cbd5e1;padding:6px 14px;border-radius:6px;cursor:pointer}
.tabs button.on{background:#3b82f6;border-color:#3b82f6;color:#fff}
.layout{display:grid;grid-template-columns:260px 1fr;min-height:calc(100vh - 52px)}
nav{border-right:1px solid #e2e8f0;background:#fff;padding:12px;overflow:auto}
nav .dir{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin:12px 4px 6px}
nav a{display:block;padding:6px 8px;border-radius:6px;color:#334155;text-decoration:none;font-size:13px;font-family:ui-monospace,Menlo,monospace}
nav a:hover{background:#f1f5f9}
nav a.on{background:#eff6ff;color:#1d4ed8;font-weight:600}
main{padding:22px 26px;overflow:auto}
.card{border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:16px 18px;margin-bottom:16px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.card h3{margin:0 0 4px;font-size:15px}
.sig{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;background:#f1f5f9;border-radius:6px;padding:8px 10px;color:#0f172a;overflow-x:auto;white-space:pre-wrap}
.block{margin-top:12px}
.block .k{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#64748b;margin-bottom:4px}
.block p{margin:0;line-height:1.7;font-size:13.5px;color:#1e293b;white-space:pre-wrap}
table{border-collapse:collapse;width:100%;margin-top:6px;font-size:13px}
th,td{border:1px solid #e2e8f0;padding:6px 9px;text-align:left}
th{background:#f8fafc;color:#475569;font-weight:600}
code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:12px}
.var-card .row{display:grid;grid-template-columns:120px 1fr;gap:8px;margin-top:8px;font-size:13.5px}
.var-card .row .k{color:#64748b}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.chip{background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:2px 10px;font-size:12px}
.empty{color:#94a3b8;padding:20px}
.hidden{display:none}
</style>
</head>
<body>
<header>
  <h1>布局文档站</h1>
  <span class="meta">${esc(data.project)} · 由 docgen 自动生成，请勿手改</span>
  <div class="tabs">
    <button id="tab-code" class="on">代码文件</button>
    <button id="tab-vars">变量索引</button>
  </div>
</header>
<div class="layout">
  <nav id="nav"></nav>
  <main id="main"></main>
</div>
<script type="application/json" id="doc-data">${json}</script>
<script>
const data = JSON.parse(document.getElementById('doc-data').textContent);
const nav = document.getElementById('nav'), main = document.getElementById('main');
let tab = 'code';
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function render(){
  nav.innerHTML = ''; main.innerHTML = '';
  if(tab==='code'){
    const files = data.files;
    let current = files[0]?.path;
    for(const grp of ['variables','src/layout','src/serializers','other']){
      const list = files.filter(f=>grp==='other' ? !/^(variables|src\\/layout|src\\/serializers)/.test(f.path) : f.path.startsWith(grp));
      if(!list.length) continue;
      const d=document.createElement('div'); d.className='dir'; d.textContent=grp; nav.append(d);
      for(const f of list){
        const a=document.createElement('a'); a.textContent=f.path.split('/').pop(); a.href='#';
        a.title=f.path;
        a.onclick=(e)=>{e.preventDefault(); current=f.path; renderMain(f); [...nav.querySelectorAll('a')].forEach(x=>x.classList.toggle('on', x.title===f.path));};
        a.dataset.path=f.path;
        if(f.path===current) a.classList.add('on');
        nav.append(a);
      }
    }
    renderMain(files.find(f=>f.path===current)||files[0]);
  } else {
    nav.innerHTML='<div class="dir">变量（反向索引）</div>';
    for(const v of data.variables){
      const a=document.createElement('a'); a.textContent=v.name; a.href='#';
      a.onclick=(e)=>{e.preventDefault(); renderVar(v);};
      nav.append(a);
    }
    renderVar(data.variables[0]);
  }
}
function renderMain(f){
  if(!f){main.innerHTML='<p class="empty">没有可展示的源码文件。</p>';return;}
  main.innerHTML = '<h2 style="margin-top:0;font-size:14px;color:#64748b;font-weight:600">'+esc(f.path)+'</h2>';
  if(!f.functions.length && !f.variables.length){main.innerHTML+='<p class="empty">该文件没有带四要素注释的声明。</p>';}
  for(const fn of f.functions){
    const el=document.createElement('div'); el.className='card';
    let html='<h3>'+esc(fn.name)+' <span style="color:#94a3b8;font-weight:400;font-size:12px">'+esc(fn.file)+'</span></h3>';
    html+='<div class="sig">'+esc(fn.signature)+'</div>';
    html+='<div class="block"><div class="k">函数签名与参数表</div><table><tr><th>参数</th><th>类型</th><th>说明</th></tr>';
    if(fn.params.length) html+=fn.params.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.type||'—')+'</td><td>'+esc(p.desc||'')+'</td></tr>').join('');
    else html+='<tr><td colspan="3">无参数</td></tr>';
    html+='</table></div>';
    html+='<div class="block"><div class="k">返回值</div><p>'+esc(fn.returns||'（未标注）')+'</p></div>';
    html+='<div class="block"><div class="k">功能</div><p>'+esc(fn.doc.fields['功能']||'')+'</p></div>';
    html+='<div class="block"><div class="k">实现原理</div><p>'+esc(fn.doc.fields['实现原理']||'')+'</p></div>';
    el.innerHTML=html; main.append(el);
  }
}
function renderVar(v){
  if(!v){main.innerHTML='<p class="empty">没有变量。</p>';return;}
  main.innerHTML='<div class="card var-card"><h3>'+esc(v.name)+' <span style="color:#94a3b8;font-weight:400;font-size:12px">'+esc(v.file)+'</span></h3>';
  const box=main.querySelector('.var-card');
  for(const k of ['作用','可选值','临界参数','影响范围','可调范围']){
    if(!v.doc||!v.doc[k]) continue;
    const r=document.createElement('div'); r.className='row';
    r.innerHTML='<div class="k">'+esc(k)+'</div><div>'+esc(v.doc[k])+'</div>'; box.append(r);
  }
  const r=document.createElement('div'); r.className='row';
  r.innerHTML='<div class="k">引用元素</div><div><div class="chips">'+
    (v.elements.length?v.elements.map(e=>'<span class="chip">'+esc(e)+'</span>').join(''):'<span style="color:#94a3b8">无</span>')+'</div></div>';
  box.append(r);
  const r2=document.createElement('div'); r2.className='row';
  r2.innerHTML='<div class="k">引用文件</div><div>'+(v.usedIn.map(esc).join('<br>')||'—')+'</div>';
  box.append(r2);
}
document.getElementById('tab-code').onclick=()=>{tab='code';document.getElementById('tab-code').classList.add('on');document.getElementById('tab-vars').classList.remove('on');render();};
document.getElementById('tab-vars').onclick=()=>{tab='vars';document.getElementById('tab-vars').classList.add('on');document.getElementById('tab-code').classList.remove('on');render();};
render();
</script>
</body>
</html>
`;
}

async function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--project");
  const project = path.resolve(pi >= 0 ? argv[pi + 1] : ".");
  const checkOnly = argv.includes("--check-only");

  const files = [
    ...listFiles(path.join(project, "variables")),
    ...listFiles(path.join(project, "src")),
  ].filter(
    (f) =>
      /\.(ts|tsx|js|jsx|mjs)$/.test(f) &&
      // 跳过 layout-engineer 生成的序列化器产物（其注释来自模板，非手写源码）
      !fs.readFileSync(f, "utf8").includes("AUTO-GENERATED by layout-engineer"),
  );

  const errors = [];
  const warnings = [];
  const fileModels = [];
  for (const f of files) {
    const rel = path.relative(project, f);
    const decls = extractDeclarations(fs.readFileSync(f, "utf8"), rel);
    errors.push(...validateDeclarations(decls, rel, warnings));
    fileModels.push({
      path: rel,
      functions: decls.filter((d) => d.kind === "function").map((d) => ({
        name: d.name, file: d.file, line: d.line, signature: d.signature,
        params: d.params, returns: d.returns, doc: d.doc,
      })),
      variables: decls.filter((d) => d.kind === "const").map((d) => ({
        name: d.name, file: d.file, line: d.line, doc: d.doc.fields,
      })),
    });
  }

  const index = await buildIndex(project);
  const data = {
    project: path.basename(project),
    generatedBy: "layout-engineer/docgen",
    files: fileModels.filter((f) => f.functions.length || f.variables.length),
    variables: Object.values(index.variables),
  };

  if (warnings.length) console.warn(`docgen 警告：\n  - ${warnings.join("\n  - ")}`);

  if (errors.length) {
    console.error(`docgen 失败：注释要素不完整（${errors.length} 项）\n  - ${errors.join("\n  - ")}`);
    process.exit(1);
  }

  if (!checkOnly) {
    const docsDir = path.join(project, "docs");
    ensureDir(docsDir);
    fs.writeFileSync(path.join(docsDir, "data.json"), JSON.stringify(data, null, 2) + "\n");
    fs.writeFileSync(path.join(docsDir, "index.html"), renderDocsHtml(data));
    console.log(`✓ docgen：注释四要素完整 → docs/index.html（${fileModels.length} 个文件）`);
  } else {
    console.log(`✓ docgen --check-only：注释四要素完整（${fileModels.length} 个文件）`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
