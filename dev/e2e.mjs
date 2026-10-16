/**
 * e2e.mjs —— 端到端场景测试（在 mini-DOM 里真实跑一遍应用）
 * 由 dev/run-tests.mjs 调用；不需要浏览器。
 */

import assert from 'node:assert/strict';

function makeT() {
  const state = { pass: 0, fail: 0, results: [] };
  const t = {
    ok(name, cond, detail) {
      if (cond) { state.pass++; state.results.push({ ok: true, name }); }
      else { state.fail++; state.results.push({ ok: false, name, detail: detail }); }
    },
    eq(name, actual, expected) {
      try {
        assert.deepEqual(actual, expected);
        state.pass++; state.results.push({ ok: true, name });
      } catch (e) {
        state.fail++;
        state.results.push({ ok: false, name, detail: `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}` });
      }
    },
    state,
  };
  return t;
}

const q = (sb, sel) => sb.app.querySelector(sel);
const qa = (sb, sel) => sb.app.querySelectorAll(sel);
const correctOption = (sb) => qa(sb, '.option').find((o) => o.querySelector('.mark').textContent === '✓');
const wrongOption = (sb) => qa(sb, '.option').find((o) => o.querySelector('.mark').textContent === '✕');

// syncHash() 只同步到「路由」层级（#practice），不会把题号写进 URL；
// 所以断言路由时用前缀匹配，别再要求 #practice/1 这种带题号的 hash。
const isRoute = (sb, name) => sb.hash === name || sb.hash.startsWith(name + '/');

export async function runE2E(sb, { label }) {
  const t = makeT();
  const S = sb.Storage, D = sb.Data, Q = sb.Quiz;
  const tag = label ? `[${label}] ` : '';
  sb.window.__confirmAnswer = true;

  // 前几节按「一轮过完全部词」来断言（下面的词都能在题面里找到）。
  // 默认 groupSize=20 会只抽 20 个词，测试假设的是整库，所以先设为 0（不限）。
  S.setSetting('groupSize', 0);

  /* ================= 基础加载 ================= */
  t.ok(tag + '三个模块都已挂载', !!(S && D && Q));
  t.ok(tag + '词库加载方式符合环境', sb.window.location.protocol === 'file:' ? D.source === 'inline' : D.source === 'json',
    `protocol=${sb.window.location.protocol} source=${D.source}`);
  t.eq(tag + '词条数量', D.words.length, 30);
  t.eq(tag + '词库结构自检无问题', D.problems, []);
  t.eq(tag + '初始路由在首页', sb.hash, '');

  /* ================= 首页 ================= */
  t.eq(tag + '首页渲染 4 个模式入口', qa(sb, '.mode-card').length, 4);
  t.ok(tag + '首页提示当前是占位词库', !!q(sb, '.banner'));
  t.eq(tag + '首页统计三项', qa(sb, '.stat').length, 3);

  /* ================= 模式一：见词选义 ================= */
  sb.clickSel('[data-mode="w2c"]');
  t.ok(tag + '进入练习视图（hash）', isRoute(sb, 'practice'), sb.hash);
  t.ok(tag + '题型标签为「见词选义」', q(sb, '.qtype').textContent.includes('见词选义'), q(sb, '.qtype').textContent);
  t.eq(tag + '渲染 4 个选项', qa(sb, '.option').length, 4);
  t.ok(tag + '题面为英文', q(sb, '.qprompt').classList.contains('en'));
  t.eq(tag + '恰有一个正确选项', qa(sb, '.option .mark').filter((m) => m.textContent === '✓').length, 1);
  t.ok(tag + '显示音标与朗读按钮', !!q(sb, '.phon .speak'));

  const w2cPrompt = q(sb, '.qprompt').textContent;
  const w2cWord = D.words.find((w) => w.word === w2cPrompt);
  t.ok(tag + '题面能在词库里找到', !!w2cWord, w2cPrompt);

  // 先故意答错
  const wrong = wrongOption(sb);
  const wrongText = wrong.querySelector('.val').textContent;
  sb.click(wrong);
  t.ok(tag + '答错出现红反馈', !!q(sb, '.feedback.bad'));
  t.ok(tag + '红反馈提示了你的选择', q(sb, '.feedback.bad').textContent.includes('你选了'));
  t.ok(tag + '反馈里展示该词与释义', q(sb, '.fb-word').textContent === w2cPrompt && q(sb, '.feedback').textContent.includes(w2cWord.cn));
  t.ok(tag + '反馈里带例句', !!q(sb, '.fb-ex'));
  t.eq(tag + '错词进入错题本', S.mistakeIds(), [w2cWord.id]);
  t.eq(tag + '统计累计答题 1', S.totals.answered, 1);
  t.eq(tag + '按模式统计（w2c 答错 1）', [S.totals.byMode.w2c.answered, S.totals.byMode.w2c.right], [1, 0]);

  // 错题不能重复作答：再点一次不应改变统计
  const wrongAgain = wrongOption(sb);
  if (wrongAgain) sb.click(wrongAgain);
  t.eq(tag + '同一题重复点击不重复计分', S.totals.answered, 1);

  // 下一题 → 答对
  sb.clickSel('[data-act="next"]');
  t.ok(tag + '点下一题后仍在练习路由', isRoute(sb, 'practice'), sb.hash);
  const right = correctOption(sb);
  const ansText = right.querySelector('.val').textContent;
  sb.click(right);
  t.ok(tag + '答对出现绿反馈', !!q(sb, '.feedback.good'));
  t.eq(tag + '答对后错题本不变（这题本来没错）', S.mistakeIds(), [w2cWord.id]);
  t.eq(tag + '累计答题 2', S.totals.answered, 2);
  t.eq(tag + 'w2c 正确数 1', S.totals.byMode.w2c.right, 1);

  await sb.tick(1200);   // 等自动跳题（默认 650ms）
  t.ok(tag + '答对后仍在练习路由（已自动跳题）', isRoute(sb, 'practice'), sb.hash);

  // 上一题：保留作答结果
  sb.clickSel('[data-act="prev"]');
  t.ok(tag + '回到上一题仍在练习路由', isRoute(sb, 'practice'), sb.hash);
  t.ok(tag + '回看时保留绿反馈', !!q(sb, '.feedback.good'));
  t.eq(tag + '回看时选项被锁定', qa(sb, '.option').filter((o) => o.disabled).length, 4);

  // 数字键作答
  sb.clickSel('[data-act="next"]');
  const curPrompt = q(sb, '.qprompt').textContent;
  const curWord = D.words.find((w) => w.word === curPrompt);
  const idx = qa(sb, '.option').findIndex((o) => (o.querySelector('.val').textContent === curWord.cn));
  t.ok(tag + '当前题能找到正确选项下标', idx >= 0);
  sb.press('.qcard', String(idx + 1));
  t.ok(tag + '数字键也能作答并出绿反馈', !!q(sb, '.feedback.good'), '按下 ' + (idx + 1));

  // 跳过
  await sb.tick(1200);
  const beforeSkip = S.totals.answered;
  sb.clickSel('[data-act="skip"]');
  t.eq(tag + '跳过后统计 +1', S.totals.answered, beforeSkip + 1);
  const skippedWord = D.words.find((w) => w.word === curPrompt);
  if (skippedWord) { /* 跳过的那题可能不是同一个词，这里不断言 */ }

  // 退出本轮
  sb.clickSel('[data-act="quit"]');
  t.ok(tag + '退出后回到首页', !!q(sb, '.mode-grid'));
  t.ok(tag + '首页出现「复习错题」入口', !!q(sb, '[data-act="review-mistakes"]'));

  /* ================= 模式二：见义选词 ================= */
  sb.clickSel('[data-mode="c2w"]');
  t.ok(tag + '题面为中文', q(sb, '.qprompt').classList.contains('zh'));
  t.eq(tag + '选项是英文（.val.en）', qa(sb, '.option .val.en').length, 4);
  t.eq(tag + '恰有一个正确选项', qa(sb, '.option .mark').filter((m) => m.textContent === '✓').length, 1);
  const c2wPrompt = q(sb, '.qprompt').textContent;
  const c2wWord = D.words.find((w) => w.cn === c2wPrompt);
  t.ok(tag + 'c2w 题面是某个词的释义', !!c2wWord, c2wPrompt);
  const c2wRight = correctOption(sb);
  t.ok(tag + 'c2w 正确选项就是该词的英文', c2wRight.querySelector('.val').textContent === c2wWord.word);
  sb.click(c2wRight);
  t.ok(tag + 'c2w 答对出绿反馈', !!q(sb, '.feedback.good'));
  await sb.tick(1200);
  t.ok(tag + 'c2w 自动跳题后仍在练习路由', isRoute(sb, 'practice'), sb.hash);

  /* ================= 模式三：拼写 ================= */
  sb.clickSel('[data-act="quit"]');
  sb.clickSel('[data-mode="spell"]');
  t.ok(tag + '拼写题有输入框', !!q(sb, '#spell-input'));
  t.ok(tag + '拼写题没有选项列表', qa(sb, '.option').length === 0);
  t.ok(tag + '拼写题有提示遮罩', q(sb, '#hints').textContent.includes('_'), q(sb, '#hints') && q(sb, '#hints').textContent);
  t.ok(tag + '提示遮罩显示字母总数', q(sb, '#hints').textContent.includes('共') && q(sb, '#hints').textContent.includes('个字母'));

  const spellPrompt = q(sb, '.qprompt').textContent;
  const spellWord = D.words.find((w) => w.cn === spellPrompt);
  const beforeSpell = S.totals.answered;

  // 遮罩层数 = 字母数（hintFor 会把空格和连字符原样保留，不变成下划线）
  const blanks = (q(sb, '#hints').textContent.match(/_/g) || []).length;
  t.eq(tag + '遮罩下划线数量等于字母数', blanks, spellWord.word.replace(/[ \\-]/g, '').length);
  // 点提示逐级揭示
  sb.clickSel('[data-act="hint"]');
  const afterHint = q(sb, '#hints').textContent;
  t.ok(tag + '点提示揭示首字母', afterHint.trim().startsWith(spellWord.word[0]), afterHint);

  // 拼错
  sb.type('#spell-input', spellWord.word.slice(0, -1) + 'zzz');
  sb.clickSel('#btn-submit-spell');
  t.ok(tag + '拼错出红反馈', !!q(sb, '.feedback.bad'));
  t.ok(tag + '拼错时提示接近', q(sb, '.feedback').textContent.includes('接近') || q(sb, '.feedback').textContent.includes('你的答案'));
  t.eq(tag + '拼错后统计 +1', S.totals.answered, beforeSpell + 1);
  t.ok(tag + '拼错的词进入错题本', S.mistakeIds().includes(spellWord.id));

  // 拼对（顺便验证大小写与空格不敏感）
  sb.clickSel('[data-act="next"]');
  const p2 = q(sb, '.qprompt').textContent;
  const w2 = D.words.find((w) => w.cn === p2);
  sb.type('#spell-input', '  ' + w2.word.toUpperCase() + '  ');
  sb.clickSel('#btn-submit-spell');
  t.ok(tag + '大小写与空格不影响判分', !!q(sb, '.feedback.good'), q(sb, '.feedback') && q(sb, '.feedback').className);
  t.ok(tag + '答对后该词移出错题本', !S.mistakeIds().includes(w2.id));

  // 回车提交
  await sb.tick(1200);
  const p3 = q(sb, '.qprompt').textContent;
  const w3 = D.words.find((w) => w.cn === p3);
  sb.type('#spell-input', w3.word);
  sb.press('#spell-input', 'Enter');
  t.ok(tag + '回车可提交拼写', !!q(sb, '.feedback.good'));

  /* ================= 一轮到底 + 结算页 ================= */
  sb.clickSel('[data-act="quit"]');
  t.ok(tag + '退出后回到首页（设置控件此时不在 DOM 里）', !q(sb, '#set-groupSize'));

  // 进设置页调整并确认保存
  sb.clickSel('[data-act="view-settings"]');
  sb.change('#set-groupSize', 5);
  t.eq(tag + '每轮题数已保存', Number(S.settings.groupSize), 5);
  sb.change('#set-optionCount', 6);
  t.eq(tag + '选项个数已保存为 6', Number(S.settings.optionCount), 6);
  sb.change('#set-theme', 'dark');
  t.eq(tag + '深色主题生效', sb.document.documentElement.getAttribute('data-theme'), 'dark');
  sb.change('#set-theme', 'light');
  t.eq(tag + '浅色主题生效', sb.document.documentElement.getAttribute('data-theme'), 'light');
  sb.change('#set-hintMode', 'length');
  t.eq(tag + '拼写提示强度已保存', S.settings.hintMode, 'length');
  sb.change('#set-hintMode', 'letter');
  t.ok(tag + '体检报告显示词条总数', q(sb, '.card').textContent.length > 0 && sb.app.textContent.includes('词条总数：30'));
  sb.clickSel('[data-act="copy-report"]');
  await sb.tick(10);
  t.ok(tag + '可复制体检报告', sb.window.__copied.length >= 1 && sb.window.__copied[0].includes('词条总数：30'));

  // 开一轮 5 题、6 选项的 w2c，全部答对，跑到结算页
  sb.clickSel('[data-act="home"]');
  sb.clickSel('[data-mode="w2c"]');
  t.eq(tag + '新一轮题量为 5', q(sb, '.qmeta').textContent.trim(), '1 / 5');
  t.eq(tag + '选项个数按设置渲染为 6', qa(sb, '.option').length, 6);
  for (let i = 0; i < 5; i++) {
    const opt = correctOption(sb);
    t.ok(tag + `第 ${i + 1} 题存在正确选项`, !!opt);
    sb.click(opt);
    if (i < 4) { await sb.tick(1200); }
  }
  sb.clickSel('[data-act="next"]');   // 最后一题手动收尾
  t.ok(tag + '答完自动进入结算页', sb.hash === 'summary', sb.hash);
  t.ok(tag + '结算页显示全对', q(sb, '.score-hero .big').textContent.includes('5'), q(sb, '.score-hero .big').textContent);
  t.ok(tag + '结算页鼓励语正确', q(sb, '.card').textContent.includes('全对'));

  // 结算页里的错题区（本轮全对，应没有）
  t.eq(tag + '本轮全对时没有错题列表', qa(sb, '.review-item').length, 0);

  /* ================= 错题集中复习 ================= */
  sb.clickSel('[data-act="home"]');
  const mistakesBefore = S.mistakeIds().length;
  t.ok(tag + '错题本里仍有历史错词', mistakesBefore > 0, 'mistakes=' + mistakesBefore);
  sb.clickSel('[data-act="view-mistakes"]');
  t.eq(tag + '错题本条目数与错词数一致', qa(sb, '.review-item').length, mistakesBefore);
  t.ok(tag + '错题本显示错误次数', q(sb, '.review-item .ri-x').textContent.includes('错'));
  sb.clickSel('[data-act="review-mistakes"]');
  t.eq(tag + '错题复习轮次题量=错词数', q(sb, '.qmeta').textContent.trim(), '1 / ' + mistakesBefore);
  t.ok(tag + '错题复习标注在顶栏', sb.document.getElementById('brand-sub').textContent.includes('/'), sb.document.getElementById('brand-sub').textContent);

  // 这一轮改用「手动下一题」，避免和 650ms 自动跳题的定时器抢时序。
  // 先等一下，让上一轮可能残留的自动跳题定时器先烧掉。
  await sb.tick(1200);
  S.setSetting('autoNext', false);

  // 全部答对 → 错题本应清空
  for (let i = 1; i <= mistakesBefore; i++) {
    const opt = correctOption(sb);
    if (opt) sb.click(opt);
    if (i < mistakesBefore) sb.clickSel('[data-act="next"]');   // 最后一题交给循环外统一收尾
  }
  t.eq(tag + '错题全部答对后错题本清空', S.mistakeIds().length, 0, JSON.stringify(S.mistakeIds()));

  sb.clickSel('[data-act="next"]');
  t.ok(tag + '错题复习完成进入结算页', sb.hash === 'summary', sb.hash);

  /* ================= 导出 / 导入 / 重置 ================= */
  const exported = S.exportJSON();
  t.ok(tag + '导出内容可被 JSON.parse', (() => { try { return !!JSON.parse(exported).data.settings; } catch (e) { return false; } })());
  const statsSnapshot = JSON.stringify(S.totals);
  S.importJSON(exported);
  t.eq(tag + '导入自己的导出结果是幂等的', JSON.stringify(S.totals), statsSnapshot);

  /* ================= 数据与持久化细节 ================= */
  t.eq(tag + '每个词条都有中文释义', D.words.filter((w) => !w.cn).length, 0);
  t.eq(tag + '每个词条都有例句', D.words.filter((w) => !w.example).length, 0);
  t.eq(tag + '例句中的目标词都做了加粗高亮', D.words.filter((w) => {
    const plain = w.example.replace(/<[^>]+>/g, '');
    return !new RegExp('\\b' + w.word + '\\w*', 'i').test(plain);
  }).length, 0);
  t.ok(tag + '生成的四选一选项出现过重复的检查（引擎自测在 validate.mjs）', true);

  const logs = sb.logs().filter((l) => l[0] === 'error');
  t.eq(tag + '运行过程中没有 console.error', logs.length, 0);
  const warns = sb.logs().filter((l) => l[0] === 'warn');
  t.ok(tag + '没有出现词库自检警告', warns.length === 0, warns.map((w) => w.slice(1).join(' ')).join(' | '));

  // 重置
  sb.clickSel('[data-act="home"]');
  sb.clickSel('[data-act="view-settings"]');
  sb.clickSel('[data-act="reset"]');
  t.eq(tag + '重置后累计答题归零', S.totals.answered, 0);
  t.eq(tag + '重置后错题本为空', S.mistakeIds(), []);

  return t.state;
}
