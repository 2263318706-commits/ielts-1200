/* ===========================================================
 * app.js —— 界面与交互（视图渲染 / 路由 / 事件）
 * 依赖：Storage、Data、Quiz
 * =========================================================== */
(function (global) {
  'use strict';

  var doc = document;
  var appEl = doc.getElementById('app');
  var toastEl = doc.getElementById('toast');
  var brandSub = doc.getElementById('brand-sub');
  var themeBtn = doc.getElementById('btn-theme');

  var S = global.Storage, D = global.Data, Q = global.Quiz;

  var view = 'home';        // home | practice | summary | mistakes | settings
  var session = null;       // 当前一组题的状态
  var lastSummary = null;

  /* ---------------- 通用工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel) { return appEl.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(appEl.querySelectorAll(sel)); }

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
  }

  function fmtPct(n) { return Math.round(n * 100) + '%'; }
  function fmtTime(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + ' 秒';
    return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒';
  }
  function modeLabel(mode) { return (Q.MODES[mode] && Q.MODES[mode].label) || mode; }

  /* ---------------- 主题 ---------------- */
  var mql = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
  function effectiveTheme() {
    var t = S.settings.theme || 'auto';
    if (t === 'auto') return mql && mql.matches ? 'dark' : 'light';
    return t;
  }
  function applyTheme() {
    var t = effectiveTheme();
    doc.documentElement.setAttribute('data-theme', t);
    if (themeBtn) themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0f1115' : '#f4f5f7');
  }
  if (mql && mql.addEventListener) mql.addEventListener('change', function () { if ((S.settings.theme || 'auto') === 'auto') applyTheme(); });

  /* ---------------- 组卷 ---------------- */
  function roundSize(total) {
    var g = Number(S.settings.groupSize) || 0;
    if (g <= 0) return total;
    return Math.min(g, total);
  }

  function startSession(mode, pool, note) {
    var words = pool && pool.length ? pool : D.words;
    var count = roundSize(words.length);
    var roundWords = Q.sample(words, count <= 0 ? words.length : count);
    var questions = Q.build(roundWords, {
      mode: mode,
      count: roundWords.length,
      optionCount: Number(S.settings.optionCount) || 4,
      // 干扰项从整个词库里挑：本轮题量可能小于选项个数，
      // 若只用本轮这几个词，四选一/六选一就凑不够选项了。
      distractorPool: words,
    });

    if (!questions.length) { toast('没有可用于练习的词条'); return; }

    session = {
      mode: mode,
      note: note || '',
      questions: questions,
      index: 0,
      answers: new Array(questions.length).fill(null),
      answeredCount: 0,
      right: 0,
      revealed: false,
      hintLevel: 0,
      spellValue: '',
      startedAt: Date.now(),
      finishedAt: 0,
    };
    S.addSession();
    view = 'practice';
    render();
  }

  function currentQ() { return session ? session.questions[session.index] : null; }
  function currentWord() { var q = currentQ(); return q ? D.byId(q.id) : null; }

  function submitAnswer(isRight, userText) {
    var q = currentQ();
    if (!q || session.answers[session.index] !== null) return;
    session.answers[session.index] = { right: !!isRight, user: userText == null ? '' : String(userText) };
    session.answeredCount += 1;
    if (isRight) session.right += 1;
    S.record(q.id, isRight, q.mode);
  }

  function goNext() {
    if (!session) return;
    session.index += 1;
    session.revealed = false;
    session.hintLevel = 0;
    session.spellValue = '';
    if (session.index >= session.questions.length) {
      session.finishedAt = Date.now();
      lastSummary = summarize();
      view = 'summary';
    }
    render();
  }

  function goPrev() {
    if (!session || session.index === 0) return;
    session.index -= 1;
    session.revealed = false;
    session.hintLevel = 0;
    session.spellValue = '';
    render();
  }

  function summarize() {
    if (!session) return null;
    var wrong = [];
    session.questions.forEach(function (q, i) {
      var a = session.answers[i];
      if (!a || !a.right) {
        var w = D.byId(q.id);
        wrong.push({ word: w, question: q, user: a ? a.user : '' });
      }
    });
    return {
      mode: session.mode,
      note: session.note,
      total: session.questions.length,
      right: session.right,
      wrong: wrong,
      elapsed: (session.finishedAt || Date.now()) - session.startedAt,
    };
  }

  /* ---------------- 视图：首页 ---------------- */
  function viewHome() {
    var words = D.words;
    var totals = S.totals;
    var acc = totals.answered ? totals.right / totals.answered : 0;
    var ids = words.map(function (w) { return w.id; });
    var mastered = S.masteredCount(ids);
    var mistakes = S.mistakeIds().filter(function (id) { return !!D.byId(id); });
    var isPlaceholder = (D.set.meta && D.set.meta.source === 'placeholder') || /占位/.test((D.set.meta && D.set.meta.title) || '');
    var sampleW = words[0] || { word: 'abandon', cn: '放弃' };
    var sample2 = words[1] || sampleW;

    var modes = [
      { mode: 'w2c', title: '见词选义', desc: '看英文单词，四选一挑中文释义', sample: sampleW.word + ' → ' + sampleW.cn },
      { mode: 'c2w', title: '见义选词', desc: '看中文释义，四选一挑英文单词', sample: sampleW.cn + ' → ' + sampleW.word },
      { mode: 'spell', title: '拼写单词', desc: '看中文释义，把英文单词打出来', sample: sampleW.cn + ' → ?' },
      { mode: 'mix', title: '混合练习', desc: '以上题型随机穿插，最接近真实考场', sample: sampleW.word + ' / ' + sample2.cn },
    ];

    return '' +
      '<section class="hero">' +
        '<h1>' + esc((D.set.meta && D.set.meta.title) || '雅思核心词汇背诵') + '</h1>' +
        '<p>三种模式随时切换，进度和错题都存在你自己的浏览器里。</p>' +
      '</section>' +

      (isPlaceholder
        ? '<div class="banner">🧪 <div><b>当前是占位词库</b>（' + words.length + ' 个词），用于先验收界面与交互。' +
          '真实词表整理好后，按 README 执行一条命令即可替换，界面代码无需改动。</div></div>'
        : (D.problems.length ? '<div class="banner">⚠️ <div>词库自检发现 ' + D.problems.length + ' 个问题，详情见「设置 → 数据体检」。</div></div>' : '')) +

      '<div class="mode-grid">' +
        modes.map(function (m) {
          return '<button class="mode-card" type="button" data-act="start" data-mode="' + m.mode + '">' +
            '<span class="mc-top"><span class="mc-title">' + esc(m.title) + '</span><span class="pill">' + esc(Q.MODES[m.mode].short) + '</span></span>' +
            '<span class="mc-desc">' + esc(m.desc) + '</span>' +
            '<span class="mc-sample">' + esc(m.sample) + '</span>' +
          '</button>';
        }).join('') +
      '</div>' +

      '<div class="spacer"></div>' +

      '<div class="stats-row">' +
        '<div class="stat"><div class="num">' + totals.answered + '</div><div class="lbl">累计答题</div></div>' +
        '<div class="stat"><div class="num">' + (totals.answered ? fmtPct(acc) : '—') + '</div><div class="lbl">总正确率</div></div>' +
        '<div class="stat"><div class="num">' + mastered + '<span class="faint">/' + words.length + '</span></div><div class="lbl">已掌握</div></div>' +
      '</div>' +

      '<div class="home-actions">' +
        (mistakes.length
          ? '<button class="btn" type="button" data-act="review-mistakes">🔁 复习错题（' + mistakes.length + '）</button>'
          : '') +
        '<button class="btn ghost" type="button" data-act="view-mistakes">📕 错题本</button>' +
        '<button class="btn ghost" type="button" data-act="view-settings">⚙️ 设置</button>' +
      '</div>' +

      '<p class="faint" style="margin-top:18px">' +
        '词库来源：' + (D.source === 'json' ? 'data/words.json' : 'data/words.js（内联回退，说明你是直接双击打开的）') +
        ' · 共 ' + words.length + ' 词' +
      '</p>';
  }

  /* ---------------- 视图：练习 ---------------- */
  function viewPractice() {
    if (!session) { view = 'home'; return viewHome(); }
    var q = currentQ();
    if (!q) { view = 'summary'; return viewSummary(); }
    var w = currentWord() || { word: q.answer, cn: '', phonetic: '', example: '', exampleCn: '' };
    var a = session.answers[session.index];
    var locked = a !== null;
    var n = session.questions.length;
    var pct = Math.round(((session.index + (locked ? 1 : 0)) / n) * 100);

    var dots = session.questions.map(function (qq, i) {
      var cls = [];
      var ans = session.answers[i];
      if (ans) cls.push(ans.right ? 'done' : 'wrong');
      if (i === session.index) cls.push('now');
      return '<i class="' + cls.join(' ') + '"></i>';
    }).join('');

    var body = '';
    if (q.mode === 'spell') {
      body =
        '<div class="spell-row">' +
          '<input class="spell-input" id="spell-input" type="text" autocomplete="off" autocorrect="off" ' +
            'autocapitalize="off" spellcheck="false" placeholder="在此输入英文单词" ' +
            'value="' + esc(session.spellValue) + '" ' + (locked ? 'disabled' : '') + '>' +
          '<button class="btn primary" id="btn-submit-spell" type="button" data-act="submit-spell"' + (locked ? ' disabled' : '') + '>确认</button>' +
        '</div>' +
        (S.settings.hintMode !== 'none' && !locked
          ? '<div class="hints" id="hints">' + renderHints(w.word) + '</div>'
          : '') +
        (!locked ? '<div class="practice-foot"><button class="btn ghost" type="button" data-act="hint">💡 提示</button>' +
          '<span class="kbd-hint">回车提交</span></div>' : '');
    } else {
      body = '<div class="options" id="options">' + q.choices.map(function (c, i) {
        var cls = ['option'];
        if (locked) {
          if (Q.plainText(c.text) === Q.plainText(q.answer)) cls.push('correct');
          else if (c.text === a.user) cls.push('wrong');
        }
        var isEn = q.mode === 'c2w';
        return '<button class="' + cls.join(' ') + '" type="button" data-choice="' + esc(c.text) + '"' + (locked ? ' disabled' : '') + '>' +
          '<span class="key">' + (i + 1) + '</span>' +
          '<span class="val' + (isEn ? ' en' : '') + '">' + esc(c.text) + '</span>' +
          '<span class="mark">' + (Q.plainText(c.text) === Q.plainText(q.answer) ? '✓' : '✕') + '</span>' +
        '</button>';
      }).join('') + '</div>';
    }

    return '' +
      '<div class="practice-head">' +
        '<button class="btn ghost" type="button" data-act="quit" title="返回首页">←</button>' +
        '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
        '<span class="qmeta">' + (session.index + 1) + ' / ' + n + '</span>' +
      '</div>' +
      '<div class="dots">' + dots + '</div>' +

      '<div class="qcard card">' +
        '<div class="qtype">' + esc(modeLabel(q.mode)) + '</div>' +
        '<div class="qprompt-label">' + esc(q.promptLabel) + '</div>' +
        '<div class="qprompt ' + (q.promptLang === 'en' ? 'en' : 'zh') + '">' + esc(q.prompt) + '</div>' +
        (q.mode === 'spell' && q.hint && S.settings.showPhonetic
          ? '<div class="phon"><span>' + esc(q.hint) + '</span>' +
            '<button class="speak" type="button" data-act="speak" title="朗读">🔊</button></div>'
          : (q.mode === 'w2c' && q.hint && S.settings.showPhonetic
            ? '<div class="phon"><span>' + esc(q.hint) + '</span>' +
              '<button class="speak" type="button" data-act="speak" title="朗读">🔊</button></div>'
            : '')) +
        body +
        (locked ? feedbackHTML(w, q, a) : '') +
      '</div>' +

      '<div class="practice-foot">' +
        '<button class="btn ghost" type="button" data-act="prev"' + (session.index === 0 ? ' disabled' : '') + '>上一题</button>' +
        (!locked
          ? '<button class="btn ghost" type="button" data-act="skip">跳过</button>'
          : '<button class="btn primary" type="button" data-act="next">' + (session.index + 1 >= n ? '完成本轮' : '下一题 →') + '</button>') +
      '</div>' +
      '<p class="kbd-hint center" style="margin-top:10px">数字键 1–' + (q.choices ? q.choices.length : 4) + ' 选择 · 回车确认 / 下一题</p>';
  }

  function renderHints(word) {
    var mode = S.settings.hintMode || 'letter';
    if (mode === 'none') return '';
    return '<span>' + esc(Q.hintFor(word, session.hintLevel)) + '</span>' +
      '<span class="faint" style="letter-spacing:0;margin-left:8px">共 ' + String(word).replace(/[^A-Za-z]/g, '').length + ' 个字母</span>';
  }

  function feedbackHTML(w, q, a) {
    var ok = a.right;
    var rows = '';
    rows += '<div class="fb-row"><span class="fb-word">' + esc(w.word) + '</span>' +
      (w.phonetic && S.settings.showPhonetic ? ' <span class="muted">' + esc(w.phonetic) + '</span>' : '') +
      (w.pos ? ' <span class="pill">' + esc(w.pos) + '</span>' : '') + '</div>';
    rows += '<div class="fb-row">' + esc(w.cn) + '</div>';
    if (S.settings.showExample && w.example) {
      rows += '<div class="fb-row fb-ex">' + w.example + '</div>';
      if (w.exampleCn) rows += '<div class="fb-row fb-cn">' + esc(w.exampleCn) + '</div>';
    }
    var extra = '';
    if (!ok) {
      if (a.user && q.mode === 'spell') {
        extra = Q.isNearMiss(a.user, w.word) ? '<span class="pill bad">差一点，拼写接近</span>' : '<span class="pill bad">你的答案：' + esc(a.user) + '</span>';
      } else if (a.user) {
        extra = '<span class="pill bad">你选了：' + esc(a.user) + '</span>';
      }
    }
    return '<div class="feedback ' + (ok ? 'good' : 'bad') + '">' +
      '<div class="fb-title">' + (ok ? '✅ 答对了' : '❌ 答错了') + ' ' + extra +
        '<button class="speak" type="button" data-act="speak" title="朗读">🔊</button></div>' +
      rows + '</div>';
  }

  /* ---------------- 视图：结算 ---------------- */
  function viewSummary() {
    var s = lastSummary;
    if (!s) { view = 'home'; return viewHome(); }
    var acc = s.total ? s.right / s.total : 0;
    var praise = acc === 1 ? '全对，可以加难度了 🎉' : acc >= 0.8 ? '很稳，保持这个节奏。' : acc >= 0.6 ? '及格线附近，错题再过一遍更划算。' : '这组偏难，建议先看错题再重做。';

    return '' +
      '<section class="card">' +
        '<div class="score-hero">' +
          '<div class="big">' + s.right + ' <span class="faint" style="font-size:22px">/ ' + s.total + '</span></div>' +
          '<div class="sub">正确率 ' + fmtPct(acc) + ' · 用时 ' + fmtTime(s.elapsed) + ' · ' + esc(modeLabel(s.mode)) + '</div>' +
          '<p class="muted" style="margin-top:10px">' + esc(praise) + '</p>' +
        '</div>' +
        '<div class="home-actions" style="justify-content:center">' +
          '<button class="btn primary" type="button" data-act="again">再来一组</button>' +
          (s.wrong.length ? '<button class="btn" type="button" data-act="review-this">看错题（' + s.wrong.length + '）</button>' : '') +
          '<button class="btn ghost" type="button" data-act="home">回首页</button>' +
        '</div>' +
      '</section>' +

      (s.wrong.length
        ? '<h2 style="margin:20px 0 0">这组答错的词</h2><div class="review-list">' +
          s.wrong.map(function (item) {
            var w = item.word || { word: item.question.answer, cn: '' };
            return '<div class="review-item"><div class="ri-main">' +
              '<div class="ri-word">' + esc(w.word) + (w.phonetic ? ' <span class="faint">' + esc(w.phonetic) + '</span>' : '') + '</div>' +
              '<div class="ri-cn">' + esc(w.cn) + '</div>' +
            '</div><div class="ri-x">' + esc(item.user || '未作答') + '</div></div>';
          }).join('') +
        '</div>'
        : '');
  }

  /* ---------------- 视图：错题本 ---------------- */
  function viewMistakes() {
    var ids = S.mistakeIds().filter(function (id) { return !!D.byId(id); });
    var counts = S.mistakes;

    if (!ids.length) {
      return '<section class="card center"><h2>错题本是空的 🎉</h2>' +
        '<p class="muted">答错的词会自动进来，答对一次就自动移出。</p>' +
        '<button class="btn primary" type="button" data-act="home">回首页</button></section>';
    }

    return '' +
      '<h1>错题本</h1>' +
      '<p class="muted">共 ' + ids.length + ' 个词。答对一次自动移出，点词可以听发音。</p>' +
      '<div class="home-actions">' +
        '<button class="btn primary" type="button" data-act="review-mistakes">开始复习错题</button>' +
        '<button class="btn ghost" type="button" data-act="clear-mistakes">清空错题本</button>' +
      '</div>' +
      '<div class="review-list">' +
        ids.map(function (id) {
          var w = D.byId(id);
          return '<div class="review-item"><div class="ri-main">' +
            '<div class="ri-word">' + esc(w.word) + (w.phonetic ? ' <span class="faint">' + esc(w.phonetic) + '</span>' : '') + '</div>' +
            '<div class="ri-cn">' + esc(w.cn || '（缺中文释义）') + '</div>' +
          '</div>' +
          '<div class="ri-x">错 ' + counts[id] + ' 次 <button class="speak" type="button" data-act="speak-word" data-word="' + esc(w.word) + '">🔊</button></div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="spacer"></div>' +
      '<button class="btn ghost wide" type="button" data-act="home">← 回首页</button>';
  }

  /* ---------------- 视图：设置 ---------------- */
  function viewSettings() {
    var st = S.settings;
    var totals = S.totals;
    var byMode = totals.byMode || {};
    var modeRows = ['w2c', 'c2w', 'spell'].map(function (m) {
      var rec = byMode[m];
      var acc = rec && rec.answered ? fmtPct(rec.right / rec.answered) : '—';
      return '<div class="setting-row"><div><div class="sr-label">' + esc(modeLabel(m)) + '</div>' +
        '<div class="sr-note">答过 ' + (rec ? rec.answered : 0) + ' 题</div></div>' +
        '<span class="pill">' + acc + '</span></div>';
    }).join('');

    return '' +
      '<h1>设置</h1>' +

      '<section class="card">' +
        '<h2>本轮题量</h2>' +
        '<div class="setting-row">' +
          '<div><div class="sr-label">每轮题数</div><div class="sr-note">0 = 一次把全部词过完</div></div>' +
          '<input type="number" id="set-groupSize" min="0" max="200" step="5" value="' + Number(st.groupSize) + '">' +
        '</div>' +
        '<div class="setting-row">' +
          '<div><div class="sr-label">选项个数</div><div class="sr-note">四选一 / 六选一</div></div>' +
          '<select id="set-optionCount">' +
            [4, 6].map(function (n) { return '<option value="' + n + '"' + (Number(st.optionCount) === n ? ' selected' : '') + '>' + n + ' 个</option>'; }).join('') +
          '</select>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div><div class="sr-label">答对后自动下一题</div><div class="sr-note">关闭后可停下来看例句</div></div>' +
          '<label class="switch"><input type="checkbox" id="set-autoNext"' + (st.autoNext ? ' checked' : '') + '>开启</label>' +
        '</div>' +
      '</section>' +

      '<div class="spacer"></div>' +

      '<section class="card">' +
        '<h2>显示与提示</h2>' +
        '<div class="setting-row">' +
          '<div><div class="sr-label">显示音标与发音按钮</div><div class="sr-note">使用浏览器自带的语音合成</div></div>' +
          '<label class="switch"><input type="checkbox" id="set-showPhonetic"' + (st.showPhonetic ? ' checked' : '') + '>开启</label>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div><div class="sr-label">显示例句</div><div class="sr-note">答题反馈里带例句和翻译</div></div>' +
          '<label class="switch"><input type="checkbox" id="set-showExample"' + (st.showExample ? ' checked' : '') + '>开启</label>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div><div class="sr-label">拼写提示强度</div><div class="sr-note">点「💡 提示」时逐级揭示字母</div></div>' +
          '<select id="set-hintMode">' +
            [['none', '不提示'], ['length', '只给长度'], ['letter', '按字母揭示']].map(function (p) {
              return '<option value="' + p[0] + '"' + (st.hintMode === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div><div class="sr-label">主题</div><div class="sr-note">跟随系统 / 强制浅色 / 强制深色</div></div>' +
          '<select id="set-theme">' +
            [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(function (p) {
              return '<option value="' + p[0] + '"' + (st.theme === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
      '</section>' +

      '<div class="spacer"></div>' +

      '<section class="card">' +
        '<h2>数据</h2>' +
        '<p class="faint">所有进度只存在这台设备的浏览器里（localStorage），不上传任何服务器。更换设备或浏览器用导出/导入迁移。</p>' +
        '<div class="home-actions">' +
          '<button class="btn" type="button" data-act="export">⬇️ 导出进度</button>' +
          '<button class="btn" type="button" data-act="import">⬆️ 导入进度</button>' +
          '<button class="btn ghost" type="button" data-act="reset">🗑️ 清空所有进度</button>' +
        '</div>' +
        '<input type="file" id="import-file" accept=".json,application/json" style="display:none">' +
      '</section>' +

      '<div class="spacer"></div>' +

      '<section class="card">' +
        '<h2>练习统计</h2>' +
        '<div class="stats-row">' +
          '<div class="stat"><div class="num">' + totals.answered + '</div><div class="lbl">累计答题</div></div>' +
          '<div class="stat"><div class="num">' + totals.sessions + '</div><div class="lbl">练习轮数</div></div>' +
          '<div class="stat"><div class="num">' + (totals.answered ? fmtPct(totals.right / totals.answered) : '—') + '</div><div class="lbl">总正确率</div></div>' +
        '</div>' +
        modeRows +
      '</section>' +

      '<div class="spacer"></div>' +

      '<section class="card">' +
        '<h2>数据体检</h2>' +
        '<pre class="faint" style="white-space:pre-wrap;margin:0 0 10px">' + esc(D.report()) + '</pre>' +
        (D.problems.length
          ? '<pre class="faint" style="white-space:pre-wrap;max-height:180px;overflow:auto;margin:0 0 10px">' + esc(D.problems.slice(0, 30).join('\n')) + '</pre>'
          : '<p class="faint">结构自检通过 ✅</p>') +
        '<div class="home-actions">' +
          '<button class="btn ghost" type="button" data-act="copy-report">复制体检报告</button>' +
          '<a class="btn ghost" href="data/words.json" target="_blank" rel="noopener">查看 words.json</a>' +
        '</div>' +
      '</section>' +

      '<div class="spacer"></div>' +
      '<button class="btn ghost wide" type="button" data-act="home">← 回首页</button>';
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var html;
    if (view === 'practice') html = viewPractice();
    else if (view === 'summary') html = viewSummary();
    else if (view === 'mistakes') html = viewMistakes();
    else if (view === 'settings') html = viewSettings();
    else { view = 'home'; html = viewHome(); }

    appEl.innerHTML = html;
    if (brandSub) {
      brandSub.textContent = view === 'practice' && session
        ? modeLabel(session.mode) + ' · ' + (session.index + 1) + '/' + session.questions.length
        : (D.words.length + ' 词');
    }
    if (view === 'practice') {
      var input = $('#spell-input');
      if (input && !input.disabled) input.focus();
    }
    syncHash();
  }

  /* ---------------- hash 路由 ---------------- */
  // 当前 view 对应的 hash（练习视图带题号）
  function desiredHash() {
    if (view === 'practice' && session) return '#practice/' + (session.index + 1);
    return '#' + (view === 'home' ? '' : view);
  }

  // 用 replaceState 只更新地址栏，不用 location.hash：真实浏览器里 hashchange 是
  // 异步派发的，写完 hash 再同步 render，等 hashchange 回来时 view 已经变过一次，
  // 会把刚启动的练习又打回首页。这里让 view 成为唯一事实来源，路由不反过来改 view。
  function syncHash() {
    var want = desiredHash();
    if (location.hash === want) return;
    try { history.replaceState(null, '', want || location.pathname + location.search); }
    catch (e) { location.hash = want; }
  }

  function applyRoute() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var parts = h.split('/');
    var name = parts[0] || 'home';
    if (name === 'practice' && !session) name = 'home';
    if (name === 'summary' && !lastSummary) name = 'home';
    var next = (name === 'settings' || name === 'mistakes' || name === 'practice' || name === 'summary') ? name : 'home';
    // 已经在练习视图里就不再重置（题号跳转由 goNext/goPrev 负责）
    if (next === 'practice' && view === 'practice') return;
    view = next;
    render();
  }

  /* ---------------- 事件 ---------------- */
  function handleSpellSubmit() {
    if (!session) return;
    var q = currentQ();
    var input = $('#spell-input');
    if (!q || !input || session.answers[session.index] !== null) return;
    var val = input.value.trim();
    if (!val) { toast('先输入答案'); return; }
    session.spellValue = val;
    var ok = Q.isCorrectSpelling(val, q.answer);
    submitAnswer(ok, val);
    render();
    if (ok && S.settings.autoNext) {
      setTimeout(function () {
        if (view === 'practice' && session && session.answers[session.index] && session.answers[session.index].right) goNext();
      }, Number(S.settings.autoNextDelay) || 650);
    }
  }

  function selectChoice(text) {
    if (!session) return;
    var q = currentQ();
    if (!q || session.answers[session.index] !== null) return;
    var ok = Q.plainText(text) === Q.plainText(q.answer);
    submitAnswer(ok, text);
    render();
    if (ok && S.settings.autoNext) {
      setTimeout(function () {
        if (view === 'practice' && session && session.answers[session.index] && session.answers[session.index].right) goNext();
      }, Number(S.settings.autoNextDelay) || 650);
    }
  }

  function speak(text) {
    if (!text || !global.speechSynthesis) { toast('这个浏览器不支持朗读'); return; }
    try {
      global.speechSynthesis.cancel();
      var u = new global.SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.95;
      global.speechSynthesis.speak(u);
    } catch (e) { toast('朗读失败'); }
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url; a.download = filename;
    doc.body.appendChild(a); a.click();
    doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  appEl.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act], [data-choice]');
    if (!t) return;

    if (t.hasAttribute('data-choice')) { selectChoice(t.getAttribute('data-choice')); return; }

    var act = t.getAttribute('data-act');
    switch (act) {
      case 'start': {
        var mode = t.getAttribute('data-mode');
        S.setSetting('mode', mode);
        startSession(mode, D.words, '全部词库');
        break;
      }
      case 'home': session = null; view = 'home'; render(); break;
      case 'submit-spell': handleSpellSubmit(); break;
      case 'quit': if (confirm('退出本轮练习？已答的题目已经计入统计。')) { session = null; view = 'home'; render(); } break;
      case 'again': {
        var m = session ? session.mode : (S.settings.mode || 'mix');
        var pool = session && session.note === '错题复习' ? mistakePool() : D.words;
        startSession(m, pool, session ? session.note : '全部词库');
        break;
      }
      case 'next': goNext(); break;
      case 'prev': goPrev(); break;
      case 'skip': submitAnswer(false, '（跳过）'); render(); break;
      case 'hint': {
        var w = currentWord();
        if (!w) break;
        if ((S.settings.hintMode || 'letter') === 'length') { toast('这个词有 ' + String(w.word).replace(/[^A-Za-z]/g, '').length + ' 个字母'); break; }
        session.hintLevel = Math.min(session.hintLevel + 1, w.word.length);
        var box = $('#hints');
        if (box) box.innerHTML = renderHints(w.word);
        break;
      }
      case 'speak': {
        var w2 = currentWord();
        speak(w2 ? w2.word : '');
        break;
      }
      case 'speak-word': speak(t.getAttribute('data-word')); break;
      case 'review-this': {
        if (!lastSummary || !lastSummary.wrong.length) break;
        var poolThis = lastSummary.wrong.map(function (x) { return x.word; }).filter(Boolean);
        startSession(lastSummary.mode === 'spell' ? 'spell' : lastSummary.mode, poolThis, '错题复习');
        break;
      }
      case 'review-mistakes': startSession(S.settings.mode === 'spell' ? 'spell' : (S.settings.mode || 'mix'), mistakePool(), '错题复习'); break;
      case 'view-mistakes': view = 'mistakes'; render(); break;
      case 'view-settings': view = 'settings'; render(); break;
      case 'clear-mistakes':
        if (confirm('清空错题本？（不影响累计统计）')) { S.clearMistakes(); toast('错题本已清空'); render(); }
        break;
      case 'export': download('ielts1200-progress.json', S.exportJSON()); toast('已导出'); break;
      case 'import': { var f = $('#import-file'); if (f) f.click(); break; }
      case 'reset':
        if (confirm('清空全部进度、错题与设置？此操作不可恢复。')) { S.resetAll(); applyTheme(); toast('已清空'); render(); }
        break;
      case 'copy-report': {
        var text = D.report() + '\n\n' + (D.problems.length ? D.problems.join('\n') : '结构自检通过');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { toast('复制失败，请手动选择'); });
        } else { toast('这个浏览器不支持一键复制'); }
        break;
      }
    }
  });

  // 拼写输入框：回车提交
  appEl.addEventListener('keydown', function (ev) {
    if (ev.target && ev.target.id === 'spell-input') {
      if (ev.key === 'Enter') { ev.preventDefault(); handleSpellSubmit(); }
      return;
    }
    if (view !== 'practice' || !session) return;
    var q = currentQ();
    if (!q) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (session.answers[session.index] !== null) goNext();
      else if (q.mode === 'spell') handleSpellSubmit();
      return;
    }
    if (q.mode !== 'spell' && /^[1-9]$/.test(ev.key) && q.choices) {
      var i = Number(ev.key) - 1;
      if (i < q.choices.length && session.answers[session.index] === null) selectChoice(q.choices[i].text);
    }
  });

  function mistakePool() {
    var ids = S.mistakeIds().filter(function (id) { return !!D.byId(id); });
    return ids.map(function (id) { return D.byId(id); });
  }

  // 设置项：直接读 DOM 元素的当前值
  appEl.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || !el.id) return;
    var map = {
      'set-groupSize': function (v) { S.setSetting('groupSize', Math.max(0, Number(v) || 0)); },
      'set-optionCount': function (v) { S.setSetting('optionCount', Number(v)); },
      'set-hintMode': function (v) { S.setSetting('hintMode', v); },
      'set-theme': function (v) { S.setSetting('theme', v); applyTheme(); },
      'set-autoNext': function (v) { S.setSetting('autoNext', el.checked); },
      'set-showPhonetic': function (v) { S.setSetting('showPhonetic', el.checked); },
      'set-showExample': function (v) { S.setSetting('showExample', el.checked); },
      'import-file': function () {
        var file = el.files && el.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try { S.importJSON(String(reader.result)); applyTheme(); toast('导入成功'); render(); }
          catch (e) { toast('导入失败：' + e.message); }
        };
        reader.readAsText(file, 'utf-8');
      },
    };
    if (map[el.id]) map[el.id](el.value);
  });

  themeBtn && themeBtn.addEventListener('click', function () {
    var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    S.setSetting('theme', next);
    applyTheme();
    if (view === 'settings') render();
  });

  doc.getElementById('btn-settings').addEventListener('click', function () {
    view = view === 'settings' ? 'home' : 'settings';
    render();
  });

  global.addEventListener('hashchange', applyRoute);

  /* ---------------- 启动 ---------------- */
  function fail(msg, detail) {
    appEl.innerHTML = '<section class="card"><h1>启动失败</h1><p class="muted">' + esc(msg) + '</p>' +
      (detail ? '<pre class="faint" style="white-space:pre-wrap">' + esc(detail) + '</pre>' : '') +
      '<p class="faint">如果你是用 file:// 直接双击打开的，请确认 data/words.js 存在；' +
      '或者在本目录执行 <code>python -m http.server 8000</code> 后访问 http://localhost:8000/</p></section>';
  }

  function boot() {
    applyTheme();
    D.load().then(function () {
      if (!D.words.length) { fail('词库是空的。'); return; }
      applyRoute();
      if (D.problems.length) {
        console.warn('[词库自检] 发现 ' + D.problems.length + ' 个问题：\n' + D.problems.join('\n'));
      }
      console.log('[词库] 来源=' + D.source + ' 词条=' + D.words.length +
        (D.problems.length ? ' 问题=' + D.problems.length : ' 自检通过 ✅'));
    }).catch(function (e) { fail(e.message || String(e), e && e.stack); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
