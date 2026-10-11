/**
 * xml — 极简 XML 序列化 / 解析（零依赖）。
 *
 * 为什么自己写而不是引第三方：
 *   1. 产物（drawio / SVG）由我们生成，只需要支持自己用到的子集；
 *   2. 「XML 必须能被解析」这条自检项若用生成器自证就是循环论证，
 *      所以这里提供一个**独立的**严格解析器：drawio.mjs 生成，check-drawio.mjs 用它反解，
 *      两边不共享代码路径，才真的能拦住「标签没闭合 / 属性里的 & 没转义」。
 *
 * 不支持（也用不到）：CDATA、DOCTYPE、命名空间前缀、混合内容中的多段文本。
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * 属性值转义。
 *
 * 换行/制表符必须写成字符引用（&#10; / &#9;）：按 XML 规范，属性值里的
 * 字面换行会被解析器归一化成空格——不写引用的话，节点里精心排的「标题 + 说明行」
 * 到了 Python 那边就变成一行。这个坑就是在这里堵的。
 */
export function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    .replace(/\t/g, "&#9;");
}

/** 文本节点转义。 */
export function escapeText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `<tag k="v">children</tag>` 或自闭合。attrs 里 undefined/null 会被跳过。 */
export function element(tag, attrs, children = null, { selfClose = children === null } = {}) {
  const a = Object.entries(attrs ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");
  if (selfClose) return `<${tag}${a}/>`;
  const body = Array.isArray(children) ? children.join("") : String(children ?? "");
  return `<${tag}${a}>${body}</${tag}>`;
}

class Parser {
  constructor(src) {
    this.src = src;
    this.i = 0;
  }

  error(msg) {
    const upto = this.src.slice(0, this.i);
    const line = upto.split("\n").length;
    const col = this.i - upto.lastIndexOf("\n");
    throw new Error(`XML 解析失败（第 ${line} 行第 ${col} 列）：${msg}`);
  }

  skipSpace() {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i += 1;
  }

  /** 跳过 <?xml ...?> 与 <!-- ... --> 与 <!...>。 */
  skipProlog() {
    for (;;) {
      this.skipSpace();
      if (this.src.startsWith("<?", this.i)) {
        const end = this.src.indexOf("?>", this.i + 2);
        if (end < 0) this.error("处理指令未闭合");
        this.i = end + 2;
      } else if (this.src.startsWith("<!--", this.i)) {
        const end = this.src.indexOf("-->", this.i + 4);
        if (end < 0) this.error("注释未闭合");
        this.i = end + 3;
      } else if (this.src.startsWith("<!", this.i)) {
        const end = this.src.indexOf(">", this.i + 2);
        if (end < 0) this.error("声明未闭合");
        this.i = end + 1;
      } else {
        return;
      }
    }
  }

  readName() {
    const start = this.i;
    while (this.i < this.src.length && /[A-Za-z0-9_:.\-]/.test(this.src[this.i])) this.i += 1;
    if (this.i === start) this.error("期望标签名");
    return this.src.slice(start, this.i);
  }

  readAttrValue() {
    const quote = this.src[this.i];
    if (quote !== '"' && quote !== "'") this.error("属性值必须用引号包围");
    this.i += 1;
    const start = this.i;
    while (this.i < this.src.length && this.src[this.i] !== quote) {
      if (this.src[this.i] === "<") this.error("属性值里出现了未转义的 <");
      this.i += 1;
    }
    if (this.i >= this.src.length) this.error("属性值未闭合");
    const raw = this.src.slice(start, this.i);
    this.i += 1;
    return decodeEntities(raw, (m) => this.error(`未知实体 ${m}`));
  }

  parseElement() {
    if (this.src[this.i] !== "<") this.error("期望 '<'");
    this.i += 1;
    const name = this.readName();
    const attrs = {};
    for (;;) {
      this.skipSpace();
      if (this.src.startsWith("/>", this.i)) {
        this.i += 2;
        return { name, attrs, children: [], text: "" };
      }
      if (this.src[this.i] === ">") {
        this.i += 1;
        break;
      }
      const key = this.readName();
      this.skipSpace();
      if (this.src[this.i] !== "=") this.error(`属性 ${key} 后缺少 '='`);
      this.i += 1;
      this.skipSpace();
      attrs[key] = this.readAttrValue();
    }
    // 内容
    const children = [];
    const textParts = [];
    for (;;) {
      if (this.i >= this.src.length) this.error(`<${name}> 未闭合`);
      if (this.src.startsWith("</", this.i)) {
        this.i += 2;
        const close = this.readName();
        if (close !== name) this.error(`闭合标签不匹配：<${name}> 对 </${close}>`);
        this.skipSpace();
        if (this.src[this.i] !== ">") this.error(`</${close} 后缺少 '>'`);
        this.i += 1;
        break;
      }
      if (this.src.startsWith("<!--", this.i)) {
        const end = this.src.indexOf("-->", this.i + 4);
        if (end < 0) this.error("注释未闭合");
        this.i = end + 3;
        continue;
      }
      if (this.src[this.i] === "<") {
        children.push(this.parseElement());
        continue;
      }
      const start = this.i;
      while (this.i < this.src.length && this.src[this.i] !== "<") this.i += 1;
      textParts.push(decodeEntities(this.src.slice(start, this.i), (m) => this.error(`未知实体 ${m}`)));
    }
    const text = textParts.join("");
    if (text.trim() !== "" && children.length) this.error(`<${name}> 同时含文本与子元素（不支持混合内容）`);
    return { name, attrs, children, text };
  }

  parseDocument() {
    this.skipProlog();
    const root = this.parseElement();
    this.skipProlog();
    if (this.i < this.src.length) this.error("根元素之后还有内容");
    return root;
  }
}

function decodeEntities(raw, onError) {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch !== "&") {
      out += ch;
      i += 1;
      continue;
    }
    const semi = raw.indexOf(";", i);
    const body = semi < 0 ? "" : raw.slice(i + 1, semi);
    // 裸 & 或未知实体：严格报错（XML 规定属性值里的 & 必须写成实体）
    if (semi < 0 || !/^(#[0-9]+|#x[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*)$/.test(body)) {
      if (onError) onError(raw.slice(i, Math.min(i + 8, raw.length)));
      out += ch;
      i += 1;
      continue;
    }
    const hexForm = /^#x/i.test(body);
    if (body in ENTITIES) {
      out += ENTITIES[body];
    } else if (hexForm || body.startsWith("#")) {
      const code = parseInt(hexForm ? body.slice(2) : body.slice(1), hexForm ? 16 : 10);
      try {
        out += String.fromCodePoint(code);
      } catch {
        if (onError) onError("&" + body + ";");
      }
    } else {
      if (onError) onError("&" + body + ";");
      out += "&" + body + ";";
    }
    i = semi + 1;
  }
  return out;
}

/**
 * 严格解析一段 XML，返回根节点 { name, attrs, children, text }。
 * 任何畸形（未闭合、标签不匹配、属性未转义、根后有多余内容）都抛错。
 */
export function parseXml(src) {
  return new Parser(String(src)).parseDocument();
}

/** 深度优先遍历，返回所有匹配标签名的节点。 */
export function findAll(root, tag) {
  const out = [];
  const walk = (n) => {
    if (n.name === tag) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** 取直接子元素。 */
export function childrenNamed(node, tag) {
  return node.children.filter((c) => c.name === tag);
}

/** 把 mxGraph 的 style 字符串解成对象（`fillColor=#fff;rounded=1`）。 */
export function parseStyle(style) {
  const out = {};
  for (const part of String(style ?? "").split(";")) {
    if (!part) continue;
    const i = part.indexOf("=");
    if (i < 0) out[part] = "1";
    else out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
