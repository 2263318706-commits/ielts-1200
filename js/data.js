/* ===========================================================
 * data.js —— 词库加载与自检
 *
 * 加载策略（双保险，保证 file:// 双击打开也能用）：
 *   1) 优先 fetch('data/words.json')  ← 用本地服务器或 GitHub Pages 时走这条路
 *   2) 失败则回退到 data/words.js 注入的 window.DSH_WORDS
 * 两个文件都由 scripts/build-data.mjs 生成，内容一致。
 * =========================================================== */
(function (global) {
  'use strict';

  var JSON_URL = 'data/words.json';
  var deep = typeof structuredClone === 'function' ? structuredClone : function (o) { return JSON.parse(JSON.stringify(o)); };

  /** 结构自检：返回问题列表（空数组 = 通过） */
  function validateSet(set) {
    var problems = [];
    if (!set || typeof set !== 'object') return ['词库不是对象'];
    if (!Array.isArray(set.words)) return ['缺少 words 数组'];
    if (!set.words.length) problems.push('words 是空数组');
    if (set.words.length < 4) problems.push('词条少于 4 条，四选一无法生成足够干扰项（当前 ' + set.words.length + ' 条）');

    var seenId = Object.create(null), seenWord = Object.create(null);
    set.words.forEach(function (w, i) {
      var at = '#' + i + (w && w.word ? ' (' + w.word + ')' : '');
      if (!w || typeof w !== 'object') { problems.push(at + ' 不是对象'); return; }
      if (!w.word) problems.push(at + ' 缺少 word');
      if (!w.id) problems.push(at + ' 缺少 id');
      if (w.id && seenId[w.id]) problems.push(at + ' id 重复：' + w.id);
      if (w.id) seenId[w.id] = true;
      if (w.word && seenWord[String(w.word).toLowerCase()]) problems.push(at + ' 单词重复');
      if (w.word) seenWord[String(w.word).toLowerCase()] = true;
      ['phonetic', 'cn', 'example'].forEach(function (f) {
        if (typeof w[f] !== 'string') problems.push(at + ' 字段 ' + f + ' 应为字符串');
      });
      if (w.example && w.word) {
        var plain = String(w.example).replace(/<[^>]+>/g, '');
        if (!new RegExp('\\b' + String(w.word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*', 'i').test(plain)) {
          problems.push(at + ' 例句里没有出现该单词');
        }
      }
    });
    return problems;
  }

  function normalize(set) {
    var words = set.words.map(function (w, i) {
      var item = deep(w);
      item.id = item.id || ('w' + i);
      item.word = String(item.word).trim();
      item.cn = (item.cn || '').trim();
      item.phonetic = item.phonetic || '';
      item.pos = item.pos || '';
      item.example = item.example || '';
      item.exampleCn = item.exampleCn || '';
      return item;
    });
    return {
      schema: set.schema || 1,
      meta: set.meta || {},
      words: words,
    };
  }

  var Data = {
    set: null,
    words: [],
    problems: [],
    source: '',       // 'json' | 'inline'

    /** @returns {Promise<{set:object, source:string, problems:string[]}>} */
    load: function () {
      var self = this;
      var inline = global.DSH_WORDS || null;

      function fallback(reason) {
        if (!inline) {
          throw new Error('词库加载失败：' + reason + '，且没有内联词库（data/words.js）。');
        }
        return { set: inline, source: 'inline', reason: reason };
      }

      var p;
      try {
        p = fetch(JSON_URL, { cache: 'no-cache' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
      } catch (e) {
        p = Promise.reject(e);
      }

      return p
        .then(function (json) { return { set: json, source: 'json', reason: '' }; })
        .catch(function (err) { return fallback(err && err.message ? err.message : String(err)); })
        .then(function (res) {
          self.set = normalize(res.set);
          self.words = self.set.words;
          self.source = res.source;
          self.problems = validateSet(self.set);
          return { set: self.set, source: res.source, problems: self.problems, fallbackReason: res.reason };
        });
    },

    /** 有中文释义的词（可用于「见词选义」和「见义选词」的选项池） */
    withCn: function () { return this.words.filter(function (w) { return !!w.cn; }); },

    byId: function (id) { return this.words.filter(function (w) { return w.id === id; })[0] || null; },

    validate: validateSet,

    /** 数据体检报告，settings 里可一键复制 */
    report: function () {
      var w = this.words;
      var noCn = w.filter(function (x) { return !x.cn; }).length;
      var noPhon = w.filter(function (x) { return !x.phonetic; }).length;
      var noEx = w.filter(function (x) { return !x.example; }).length;
      return [
        '来源：' + (this.source === 'json' ? 'data/words.json' : 'data/words.js（内联回退）'),
        '词条总数：' + w.length,
        '缺中文释义：' + noCn,
        '缺音标：' + noPhon,
        '缺例句：' + noEx,
        '结构问题：' + (this.problems.length ? this.problems.length + ' 处' : '无'),
      ].join('\n');
    },
  };

  global.Data = Data;
})(window);
