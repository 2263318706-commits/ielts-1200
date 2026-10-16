/* ===========================================================
 * storage.js —— 本地存储：设置、总进度、错题本
 * 纯 localStorage，不上传任何数据。隐私模式/禁用存储时自动降级为内存存储。
 * =========================================================== */
(function (global) {
  'use strict';

  var KEY = 'ielts1200:v1';

  var DEFAULT_SETTINGS = {
    groupSize: 20,      // 每组题数，0 表示不限（一次把全部词过完）
    optionCount: 4,     // 四选一的选项个数
    autoNext: true,     // 答对后自动进入下一题
    autoNextDelay: 650, // 自动跳转延迟（毫秒）
    showPhonetic: true, // 显示音标
    showExample: true,  // 显示例句
    hintMode: 'letter', // 拼写提示：none | length | letter
    theme: 'auto',      // auto | light | dark
    mode: 'mix',        // 上次使用的模式
  };

  var memory = null;

  function canUseLS() {
    try {
      var k = '__t__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }
  var HAS_LS = canUseLS();

  function defaultState() {
    return {
      settings: Object.assign({}, DEFAULT_SETTINGS),
      progress: {},                       // id -> { right, wrong, seen, last }
      mistakes: {},                       // id -> 错误次数
      totals: { answered: 0, right: 0, sessions: 0, byMode: {} },
    };
  }

  var state = null;

  function load() {
    if (state) return state;
    var raw = null;
    try { raw = HAS_LS ? global.localStorage.getItem(KEY) : memory; } catch (e) { raw = null; }
    var parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
    var s = defaultState();
    if (parsed && typeof parsed === 'object') {
      s.settings = Object.assign(s.settings, parsed.settings || {});
      s.progress = parsed.progress || {};
      s.mistakes = parsed.mistakes || {};
      s.totals = Object.assign(s.totals, parsed.totals || {});
      s.totals.byMode = (parsed.totals && parsed.totals.byMode) || {};
    }
    state = s;
    return state;
  }

  function persist() {
    var payload = JSON.stringify(load());
    if (HAS_LS) { try { global.localStorage.setItem(KEY, payload); } catch (e) { memory = payload; } }
    else memory = payload;
  }

  function bump(obj, key, field, delta) {
    var rec = obj[key] || (obj[key] = { right: 0, wrong: 0, seen: 0, last: 0 });
    if (field) rec[field] = (rec[field] || 0) + (delta || 1);
    rec.last = Date.now();
    return rec;
  }

  var Storage = {
    defaults: DEFAULT_SETTINGS,
    available: HAS_LS,

    get settings() { return load().settings; },
    get progress() { return load().progress; },
    get mistakes() { return load().mistakes; },
    get totals() { return load().totals; },

    setSetting: function (key, value) {
      load().settings[key] = value;
      persist();
    },

    /** 记录一次作答 */
    record: function (wordId, isRight, mode) {
      var s = load();
      var rec = bump(s.progress, wordId, isRight ? 'right' : 'wrong', 1);
      rec.seen = (rec.seen || 0) + 1;
      if (isRight) {
        if (s.mistakes[wordId]) {
          s.mistakes[wordId] -= 1;            // 答对一次就消一次错题记录
          if (s.mistakes[wordId] <= 0) delete s.mistakes[wordId];
        }
      } else {
        s.mistakes[wordId] = (s.mistakes[wordId] || 0) + 1;
      }
      s.totals.answered += 1;
      if (isRight) s.totals.right += 1;
      var m = s.totals.byMode[mode] || (s.totals.byMode[mode] = { answered: 0, right: 0 });
      m.answered += 1; if (isRight) m.right += 1;
      persist();
    },

    addSession: function () { var s = load(); s.totals.sessions += 1; persist(); },

    mistakeIds: function () {
      var m = load().mistakes;
      return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
    },

    clearMistakes: function () { load().mistakes = {}; persist(); },

    /** 每个词掌握度：0~1，用于首页统计 */
    masteryOf: function (id) {
      var rec = load().progress[id];
      if (!rec || !rec.seen) return null;
      return (rec.right || 0) / rec.seen;
    },

    masteredCount: function (ids) {
      var n = 0, self = this;
      (ids || Object.keys(load().progress)).forEach(function (id) {
        var m = self.masteryOf(id);
        if (m !== null && m >= 0.8) n++;
      });
      return n;
    },

    exportJSON: function () { return JSON.stringify({ app: 'ielts-1200', exportedAt: new Date().toISOString(), data: load() }, null, 2); },

    importJSON: function (text) {
      var parsed = JSON.parse(text);
      var incoming = parsed && parsed.data ? parsed.data : parsed;
      if (!incoming || typeof incoming !== 'object' || !incoming.settings) throw new Error('文件格式不对');
      var base = defaultState();
      base.settings = Object.assign(base.settings, incoming.settings || {});
      base.progress = incoming.progress || {};
      base.mistakes = incoming.mistakes || {};
      base.totals = Object.assign(base.totals, incoming.totals || {});
      base.totals.byMode = (incoming.totals && incoming.totals.byMode) || {};
      state = base;
      persist();
    },

    resetAll: function () { state = defaultState(); persist(); },
  };

  global.Storage = Storage;
})(window);
