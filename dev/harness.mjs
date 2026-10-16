/**
 * harness.mjs —— 在 Node 里跑起这个网页应用（给自动化测试用）
 *
 * 做法：造一个最小 window/document（mini-dom.mjs）+ 需要的浏览器 API 桩，
 * 然后把 js/*.js 按 index.html 的顺序真实执行一遍。app.js 是纯字符串模板 +
 * 事件委托，所以点击、输入、路由跳转全都能在这里复现。
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument, parseHTML } from './mini-dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => map.clear(),
    get length() { return map.size; },
  };
}

/** 只支持本项目用到的那一个请求：GET data/words.json */
function makeFetch(sandbox, { allowNetwork }) {
  return (url, opts) => {
    const path = String(url);
    if (path.indexOf('data/words.json') >= 0) {
      if (!allowNetwork) return Promise.reject(new TypeError('Failed to fetch (模拟 file:// 协议)'));
      const file = join(ROOT, 'data', 'words.json');
      if (!existsSync(file)) return Promise.reject(new Error('HTTP 404'));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(readFileSync(file, 'utf8'))),
        text: () => Promise.resolve(readFileSync(file, 'utf8')),
      });
    }
    return Promise.reject(new Error('mini-fetch 不支持该地址：' + path));
  };
}

/**
 * @param {object} opts
 *   opts.allowNetwork  默认 true：模拟 http 环境（走 fetch words.json）；false 模拟 file:// 双击打开
 *   opts.injectInline  默认与 allowNetwork 相反：是否注入 data/words.js 的内联词库
 */
export async function createSandbox(opts = {}) {
  const allowNetwork = opts.allowNetwork !== false;
  const injectInline = opts.injectInline != null ? opts.injectInline : !allowNetwork;

  const document = createDocument();
  const sandbox = {};

  /* ---- 全局桩 ---- */
  Object.assign(sandbox, {
    document,
    console: {
      log: (...a) => sandbox.__logs.push(['log'].concat(a)),
      warn: (...a) => sandbox.__logs.push(['warn'].concat(a)),
      error: (...a) => sandbox.__logs.push(['error'].concat(a)),
      info: () => {},
      debug: () => {},
    },
    __logs: [],
    __copied: [],
    localStorage: makeLocalStorage(),
    navigator: {
      clipboard: { writeText: (t) => { sandbox.__copied.push(t); return Promise.resolve(); } },
      userAgent: 'mini-dom-test',
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, isNaN, parseInt, parseFloat,
    speechSynthesis: null,
    Blob: function Blob(parts) { this.parts = parts; },
    URL: { createObjectURL: () => 'blob:mini', revokeObjectURL: () => {} },
    FileReader: function FileReader() {
      this.readAsText = () => { this.result = ''; if (this.onload) this.onload(); };
    },
    confirm: () => (sandbox.__confirmAnswer != null ? sandbox.__confirmAnswer : true),
    alert: () => {},
    structuredClone: (o) => JSON.parse(JSON.stringify(o)),
  });
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  // window.addEventListener / removeEventListener（浏览器里 window 也是事件目标）
  sandbox.__winListeners = Object.create(null);
  sandbox.addEventListener = (type, fn) => {
    (sandbox.__winListeners[type] || (sandbox.__winListeners[type] = [])).push(fn);
  };
  sandbox.removeEventListener = (type, fn) => {
    const l = sandbox.__winListeners[type];
    if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  };
  sandbox.dispatchWindowEvent = (event) => {
    const l = sandbox.__winListeners[event.type];
    if (l) for (const fn of l.slice()) fn.call(sandbox, event);
  };

  sandbox.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  sandbox.fetch = makeFetch(sandbox, { allowNetwork });

  // opts.onSandbox：脚本执行前拿到 sandbox，用来安装调试探针（如 window.__probe）
  if (typeof opts.onSandbox === 'function') opts.onSandbox(sandbox);

  /* ---- location / history 桩：hash 变化触发 hashchange ---- */
  let hash = '';
  sandbox.location = {
    protocol: allowNetwork ? 'http:' : 'file:',
    pathname: '/index.html',
    search: '',
    get hash() { return hash; },
    set hash(v) {
      const next = String(v).replace(/^#/, '');
      if (next === hash) return;
      hash = next;
      // 浏览器里 hashchange 的目标是 window（不是 document），app.js 也注册在 window 上
      sandbox.dispatchWindowEvent({ type: 'hashchange' });
    },
  };

  // history 桩：浏览器里存在 history，app.js 会走 history.replaceState 分支
  sandbox.history = {
    replaceState(_state, _title, url) {
      const s = String(url == null ? '' : url);
      const i = s.indexOf('#');
      hash = i >= 0 ? s.slice(i + 1) : '';
    },
    pushState(_state, _title, url) { this.replaceState(_state, _title, url); },
  };

  /* ---- index.html 里 app.js 依赖的固定节点 ---- */
  const head = document.head;
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  head.appendChild(meta);

  function add(id, tag, attrs) {
    const el = document.createElement(tag);
    el.setAttribute('id', id);
    Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
    document.body.appendChild(el);
    return el;
  }
  const topbar = add('topbar', 'div');
  const brand = document.createElement('div');
  brand.setAttribute('class', 'brand');
  const brandSpan = document.createElement('span');
  brandSpan.textContent = 'IELTS 1200';
  const brandSub = document.createElement('small');
  brandSub.setAttribute('id', 'brand-sub');
  brand.appendChild(brandSpan); brand.appendChild(brandSub);
  topbar.appendChild(brand);
  add('btn-theme', 'button', { type: 'button' });
  add('btn-settings', 'button', { type: 'button' });
  const appEl = add('app', 'main', { class: 'wrap' });
  add('toast', 'div');

  /* ---- 按 index.html 的顺序加载脚本 ---- */
  const sources = [];
  if (injectInline) sources.push(join(ROOT, 'data', 'words.js'));
  sources.push(join(ROOT, 'js', 'storage.js'), join(ROOT, 'js', 'data.js'), join(ROOT, 'js', 'quiz.js'), join(ROOT, 'js', 'app.js'));

  // opts.overrideSource：{'js/app.js': '已改写过的源码'}，仅调试用，可不碰磁盘替换某个文件
  const override = opts.overrideSource || {};

  for (const file of sources) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const code = override[rel] != null ? override[rel] : readFileSync(file, 'utf8');
    try {
      // eslint-disable-next-line no-new-func
      new Function('window', 'document', 'location', 'console', 'localStorage', 'navigator', 'fetch', 'Blob', 'URL', 'FileReader', 'confirm', 'alert', 'matchMedia', 'setTimeout', 'clearTimeout', 'structuredClone', code)(
        sandbox, document, sandbox.location, sandbox.console, sandbox.localStorage, sandbox.navigator,
        sandbox.fetch, sandbox.Blob, sandbox.URL, sandbox.FileReader, sandbox.confirm, sandbox.alert,
        sandbox.matchMedia, setTimeout, clearTimeout, sandbox.structuredClone,
      );
    } catch (e) {
      throw new Error(`加载 ${file} 失败：${e.message}`);
    }
  }

  /* ---- 启动应用（等价于浏览器触发 DOMContentLoaded） ---- */
  await new Promise((r) => setTimeout(r, 0));   // 让 app.js 注册好 DOMContentLoaded
  document.readyState = 'complete';
  document.dispatchEvent({ type: 'DOMContentLoaded' });
  await new Promise((r) => setTimeout(r, 30));  // 等 D.load() 的 promise 链跑完

  return {
    window: sandbox,
    document,
    get app() { return document.getElementById('app'); },
    get Storage() { return sandbox.Storage; },
    get Data() { return sandbox.Data; },
    get Quiz() { return sandbox.Quiz; },
    get hash() { return hash; },
    setHash(v) { sandbox.location.hash = v; },
    click(el) {
      if (!el) throw new Error('click: 元素不存在');
      const ev = { type: 'click', target: el, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stopped = true; } };
      el.dispatchEvent(ev);
    },
    clickSel(sel) {
      const el = appEl.querySelector(sel);
      if (!el) throw new Error('clickSel: 找不到 ' + sel);
      this.click(el);
      return el;
    },
    type(sel, text) {
      const el = appEl.querySelector(sel);
      if (!el) throw new Error('type: 找不到 ' + sel);
      el.value = text;
      return el;
    },
    press(sel, key) {
      const el = appEl.querySelector(sel) || appEl;
      const ev = { type: 'keydown', key, target: el, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stopped = true; } };
      el.dispatchEvent(ev);
      return el;
    },
    change(sel, value) {
      const el = appEl.querySelector(sel);
      if (!el) throw new Error('change: 找不到 ' + sel);
      if (value != null) el.value = String(value);
      el.dispatchEvent({ type: 'change', target: el });
      return el;
    },
    tick(ms) { return new Promise((r) => setTimeout(r, ms)); },
    logs() { return sandbox.__logs; },
  };
}
