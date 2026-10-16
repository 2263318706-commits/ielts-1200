/**
 * mini-dom.mjs —— 极简 DOM 实现（只服务本项目的自动化测试）
 *
 * 为什么需要它：本机沙箱里拉不起无头浏览器，而 app.js 是纯字符串模板 + 事件委托，
 * 只用到很小一部分 DOM API。这里用 200 行实现这些 API，就能在 Node 里
 * 真正跑一遍「点击 → 重渲染 → 断言」的完整流程，并且以后可以放进 CI 回归。
 *
 * 支持：解析 innerHTML（标签/属性/实体/自闭合）、textContent、classList、
 *      querySelector(All)（标签 / #id / .class / [attr=v] / :not(简单选择器) / 后代组合）、
 *      addEventListener + 冒泡、dispatchEvent、closest、dataset、value、disabled。
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

const ENTITIES = {
  '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': '\u00a0',
};

export function decodeEntities(s) {
  return String(s).replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, (m) => ENTITIES[m] || m);
}

/* ============================ Node ============================ */
class BaseNode {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
  }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) { this.childNodes.splice(i, 1); node.parentNode = null; }
    return node;
  }
  get textContent() {
    return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join('');
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  contains(node) {
    let p = node;
    while (p) { if (p === this) return true; p = p.parentNode; }
    return false;
  }
}

class TextNode extends BaseNode {
  constructor(ownerDocument, data) {
    super(ownerDocument);
    this.nodeType = 3;
    this.data = String(data);
  }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class ClassList {
  constructor(el) { this.el = el; }
  _list() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  _set(list) { this.el.setAttribute('class', list.join(' ')); }
  contains(c) { return this._list().indexOf(c) >= 0; }
  add(...cs) { const l = this._list(); cs.forEach((c) => { if (l.indexOf(c) < 0) l.push(c); }); this._set(l); }
  remove(...cs) { this._set(this._list().filter((c) => cs.indexOf(c) < 0)); }
  toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); }
}

class Element extends BaseNode {
  constructor(ownerDocument, tagName) {
    super(ownerDocument);
    this.nodeType = 1;
    this.tagName = String(tagName).toLowerCase();
    this.attributes = Object.create(null);
    this.classList = new ClassList(this);
    this.style = {};
    this.dataset = {};
    this.listeners = Object.create(null);
    this._innerHTML = null;
  }

  /* --- 属性 --- */
  setAttribute(name, value) {
    this.attributes[String(name)] = String(value);
    if (name === 'data-' || String(name).indexOf('data-') === 0) {
      const key = String(name).slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
      this.dataset[key] = String(value);
    }
    if (name === 'id') this.ownerDocument._registerId(this);
  }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  hasAttribute(name) { return name in this.attributes; }
  removeAttribute(name) { delete this.attributes[name]; }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get value() { return 'value' in this.attributes ? this.attributes.value : ''; }
  set value(v) { this.attributes.value = String(v); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get checked() { return this.hasAttribute('checked'); }
  set checked(v) { if (v) this.setAttribute('checked', ''); else this.removeAttribute('checked'); }
  get href() { return this.getAttribute('href') || ''; }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  click() { this.dispatchEvent({ type: 'click', target: this }); }

  /* --- innerHTML --- */
  get innerHTML() { return this._innerHTML != null ? this._innerHTML : serializeChildren(this); }
  set innerHTML(html) {
    this._innerHTML = String(html);
    this.childNodes = [];
    const frag = parseHTML(this.ownerDocument, String(html));
    frag.childNodes.slice().forEach((c) => this.appendChild(c));
  }

  /* --- 查询 --- */
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    let n = this;
    while (n && n.nodeType === 1) {
      if (matchesSelector(n, selector)) return n;
      n = n.parentNode;
    }
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const groups = selector.split(',').map((s) => s.trim()).filter(Boolean);
    const found = [];
    walk(this, (el) => {
      if (el === this) return;
      for (const g of groups) {
        if (matchesComplex(el, g)) { found.push(el); break; }
      }
    });
    return found;
  }

  /* --- 事件 --- */
  addEventListener(type, fn) {
    (this.listeners[type] || (this.listeners[type] = [])).push(fn);
  }
  removeEventListener(type, fn) {
    const l = this.listeners[type];
    if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    const path = [];
    let n = this;
    while (n) { path.push(n); n = n.parentNode; }
    // 捕获阶段的 useCapture 本实现用不到，只做冒泡
    for (const node of path) {
      const list = node.listeners && node.listeners[event.type];
      if (!list) continue;
      for (const fn of list.slice()) {
        fn.call(node, event);
        if (event._stopped) break;
      }
      if (event._stopped) break;
    }
    return !event.defaultPrevented;
  }
}

function serializeChildren(el) {
  return el.childNodes.map((c) => (c.nodeType === 3 ? c.data : serializeNode(c))).join('');
}
function serializeNode(el) {
  const attrs = Object.keys(el.attributes).map((k) => ` ${k}="${el.attributes[k]}"`).join('');
  if (VOID_TAGS.has(el.tagName)) return `<${el.tagName}${attrs}>`;
  return `<${el.tagName}${attrs}>${serializeChildren(el)}</${el.tagName}>`;
}
function walk(node, fn) {
  for (const c of node.childNodes) {
    if (c.nodeType === 1) { fn(c); walk(c, fn); }
  }
}

/* ========================= 选择器引擎 ========================= */
function parseCompound(part) {
  const out = { tag: null, classes: [], attrs: [], not: null };
  const m = String(part).trim().match(/^([a-zA-Z][\w-]*)?((?:[#.\[][^\s\]]*\]?)*)$/);
  if (!m) return out;
  out.tag = m[1] ? m[1].toLowerCase() : null;
  const rest = m[2] || '';
  const notM = rest.match(/:not\(([^)]*)\)/);
  if (notM) out.not = notM[1].trim();
  const cleaned = rest.replace(/:not\([^)]*\)/g, '');
  const tokenRe = /([#.])([A-Za-z0-9_\-]+)|\[([^\]=]+)(?:=([^\]]*))?\]/g;
  let t;
  while ((t = tokenRe.exec(cleaned))) {
    if (t[1] === '#') out.attrs.push({ name: 'id', value: t[2] });
    else if (t[1] === '.') out.classes.push(t[2]);
    else out.attrs.push({ name: t[3], value: t[4] != null ? t[4].replace(/^["']|["']$/g, '') : null });
  }
  return out;
}

function matchCompound(el, compound) {
  const c = typeof compound === 'string' ? parseCompound(compound) : compound;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.classes.some((cl) => !el.classList.contains(cl))) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.value != null && el.getAttribute(a.name) !== a.value) return false;
  }
  if (c.not && matchesComplex(el, c.not)) return false;
  return true;
}

function matchesComplex(el, selector) {
  const parts = String(selector).trim().split(/\s+/).map(parseCompound);
  if (!parts.length) return false;
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  let n = el.parentElement;
  while (i >= 0) {
    let found = false;
    while (n) {
      if (matchCompound(n, parts[i])) { found = true; n = n.parentElement; break; }
      n = n.parentElement;
    }
    if (!found) return false;
    i--;
  }
  return true;
}

function matchesSelector(el, selector) {
  return String(selector).split(',').map((s) => s.trim()).filter(Boolean)
    .some((s) => matchesComplex(el, s));
}

/* ========================= HTML 解析 ========================= */
function parseAttrs(str) {
  const attrs = [];
  const re = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(str))) {
    attrs.push([m[1], decodeEntities(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '')]);
  }
  return attrs;
}

export function parseHTML(document, html) {
  const root = document.createElement('#fragment');
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    const top = stack[stack.length - 1];
    if (m[1]) {                                   // 结束标签
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === m[1].toLowerCase()) { stack.length = i; break; }
      }
    } else if (m[2]) {                            // 开始标签
      const el = document.createElement(m[2]);
      for (const [k, v] of parseAttrs(m[3] || '')) el.setAttribute(k, v);
      top.appendChild(el);
      if (!m[4] && !VOID_TAGS.has(el.tagName)) stack.push(el);
    } else if (m[5] != null) {                    // 文本
      const text = decodeEntities(m[5]);
      if (text.trim() !== '' || text === ' ') top.appendChild(document.createTextNode(text));
    }
  }
  return root;
}

/* ========================= Document ========================= */
export class Document extends BaseNode {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.tagName = '#document';
    this._ids = new Map();
    this.readyState = 'loading';
    this.listeners = Object.create(null);
    this.documentElement = this.createElement('html');
    this.documentElement.setAttribute('data-theme', 'light');
    this.appendChild(this.documentElement);
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  _registerId(el) { if (el.id) this._ids.set(el.id, el); }
  createElement(tag) { return new Element(this, tag); }
  createTextNode(text) { return new TextNode(this, text); }
  getElementById(id) {
    const hit = this._ids.get(id);
    if (hit && this.contains(hit)) return hit;
    let found = null;
    walk(this.documentElement, (el) => { if (!found && el.id === id) found = el; });
    if (found) this._ids.set(id, found);
    return found;
  }
  querySelector(sel) { return this.documentElement.querySelector(sel) || this.head.querySelector(sel); }
  querySelectorAll(sel) {
    return this.documentElement.querySelectorAll(sel).concat(this.head.querySelectorAll(sel));
  }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  removeEventListener(type, fn) {
    const l = this.listeners[type]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    const list = this.listeners[event.type];
    if (list) for (const fn of list.slice()) fn.call(this, event);
    return !event.defaultPrevented;
  }
  get activeElement() { return this._active || this.body; }
  set activeElement(el) { this._active = el; }
}

/** 为测试环境造一个 document + 常用全局桩 */
export function createDocument() {
  return new Document();
}

export { Element, TextNode };
