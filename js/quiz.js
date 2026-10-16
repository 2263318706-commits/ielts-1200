/* ===========================================================
 * quiz.js —— 出题引擎（纯函数，不碰 DOM，方便将来替换成微信小程序或做单元测试）
 *
 * 四种模式：
 *   w2c   见词选义：题面 = 英文单词，选项 = 4 个中文释义
 *   c2w   见义选词：题面 = 中文释义，选项 = 4 个英文单词
 *   spell 拼写：题面 = 中文释义（可选音标/首字母提示），输入英文单词
 *   mix   混合：逐题随机在 w2c / c2w 之间切换
 * =========================================================== */
(function (global) {
  'use strict';

  var MODES = {
    w2c: { label: '见词选义', short: '词 → 义' },
    c2w: { label: '见义选词', short: '义 → 词' },
    spell: { label: '拼写', short: '义 → 拼' },
    mix: { label: '混合练习', short: '随机' },
  };

  /* ---------------- 小工具 ---------------- */
  function randInt(n) { return Math.floor(Math.random() * n); }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function sample(arr, n) { return shuffle(arr).slice(0, n); }

  function normEn(s) {
    return String(s == null ? '' : s)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function plainText(html) { return String(html || '').replace(/<[^>]+>/g, ''); }

  /** 编辑距离（用于拼写「只差一点」的提示） */
  function levenshtein(a, b) {
    a = normEn(a); b = normEn(b);
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur.slice();
    }
    return prev[n];
  }

  function isCorrectSpelling(input, word) {
    return normEn(input) === normEn(word);
  }

  function isNearMiss(input, word) {
    var d = levenshtein(input, word);
    return d > 0 && d <= Math.max(1, Math.floor(normEn(word).length / 4));
  }

  /* ---------------- 选项池 ---------------- */
  /**
   * 为一个单词挑干扰项。
   * 关键点：英文选项的池子里剔除「英文释义与正确答案中文相同」的词，
   * 否则 c2w 模式可能出现两个看起来都对的情况。
   */
  function buildChoices(target, mode, pool, optionCount) {
    var need = Math.max(2, Math.min(optionCount || 4, pool.length)) - 1;
    var isEn = mode === 'c2w';
    var poolKey = isEn ? 'en' : 'cn';
    var targetKey = isEn ? target.word : target.cn;

    var sameMeaning = Object.create(null);
    if (!isEn) {
      sameMeaning[normEn(target.en)] = true;
    }

    var candidates = pool.filter(function (w) {
      if (w.id === target.id) return false;
      var v = isEn ? w.word : w.cn;
      if (!v) return false;
      if (normEn(v) === normEn(targetKey)) return false;
      if (!isEn && w.en && sameMeaning[normEn(w.en)]) return false;   // 同义英文释义，避免歧义
      return true;
    });

    // 优先选「不像」的干扰项；池子太小就退化为全池
    var picked = sample(candidates, need);
    if (picked.length < need) {
      var extra = sample(pool.filter(function (w) {
        return w.id !== target.id && !picked.some(function (p) { return p.id === w.id; }) && (isEn ? w.word : w.cn);
      }), need - picked.length);
      picked = picked.concat(extra);
    }

    return shuffle(picked.map(function (w) {
      return { id: w.id, text: isEn ? w.word : w.cn };
    }).concat([{ id: target.id, text: targetKey }]));
  }

  /* ---------------- 出题 ---------------- */
  function makeQuestion(target, mode, pool, optionCount) {
    if (mode === 'mix') mode = Math.random() < 0.5 ? 'w2c' : 'c2w';
    if (mode === 'spell') {
      return {
        id: target.id, mode: 'spell',
        prompt: target.cn, promptLang: 'zh', promptLabel: '写出对应的英文单词',
        answer: target.word, hint: target.phonetic || '',
      };
    }
    if (mode === 'c2w') {
      return {
        id: target.id, mode: 'c2w',
        prompt: target.cn, promptLang: 'zh', promptLabel: '选出对应的英文单词',
        answer: target.word, hint: '',
        choices: buildChoices(target, 'c2w', pool, optionCount),
      };
    }
    return {
      id: target.id, mode: 'w2c',
      prompt: target.word, promptLang: 'en', promptLabel: '选出正确的中文释义',
      answer: target.cn, hint: target.phonetic || '',
      choices: buildChoices(target, 'w2c', pool, optionCount),
    };
  }

  var Quiz = {
    MODES: MODES,
    shuffle: shuffle,
    sample: sample,
    levenshtein: levenshtein,
    isCorrectSpelling: isCorrectSpelling,
    isNearMiss: isNearMiss,
    plainText: plainText,
    buildChoices: buildChoices,

    /** mode 为 'mix' 时交替使用 w2c 与 c2w，避免连出同一种题型 */
    makeQuestion: makeQuestion,

    /**
     * 生成一组题
     * @param {Array} pool   本轮要考的候选词
     * @param {object} opts  {mode, count, optionCount, distractorPool}
     *                       distractorPool 是「挑干扰项」用的词池，默认与 pool 相同；
     *                       本轮题量小于选项个数时，必须传全量词库才凑得够选项。
     */
    build: function (pool, opts) {
      opts = opts || {};
      var mode = opts.mode || 'w2c';
      var distractorPool = (opts.distractorPool && opts.distractorPool.length) ? opts.distractorPool : pool;
      var usable = (mode === 'spell')
        ? pool.filter(function (w) { return w.cn || w.word; })
        : pool.filter(function (w) { return w.cn; });
      var count = opts.count > 0 ? Math.min(opts.count, usable.length) : usable.length;
      var picked = sample(usable, count);

      var seq = picked.map(function (w) {
        var m = mode;
        if (mode === 'mix') m = Math.random() < 0.5 ? 'w2c' : 'c2w';
        return { word: w, mode: m };
      });
      return seq.map(function (s) { return makeQuestion(s.word, s.mode, distractorPool, opts.optionCount); });
    },

    /** 生成拼写提示：按难度递进返回遮罩字符串 */
    hintFor: function (word, level) {
      var letters = String(word).split('');
      var reveal = Math.max(0, Math.min(level, letters.length));
      return letters.map(function (ch, i) {
        if (ch === ' ' || ch === '-') return ch;
        return i < reveal ? ch : '_';
      }).join(' ');
    },
  };

  global.Quiz = Quiz;
})(window);
