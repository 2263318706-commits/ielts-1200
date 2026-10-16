#!/usr/bin/env node
/**
 * validate.mjs —— 词库与题库体检
 *
 *   node scripts/validate.mjs                    # 检查 data/words.json
 *   node scripts/validate.mjs --in data/words.json
 *   node scripts/validate.mjs --selftest         # 顺带跑一遍出题引擎的逻辑自测
 *
 * 有错误时以退出码 1 结束，可直接用在 CI 或 git pre-commit 里。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);

const FILE = resolve(arg('in', 'data/words.json'));
const raw = JSON.parse(readFileSync(FILE, 'utf8'));
const words = Array.isArray(raw) ? raw : raw.words;

const errors = [];
const warns = [];

if (!Array.isArray(words) || !words.length) {
  console.error('❌ 没有找到 words 数组');
  process.exit(1);
}

const seenId = new Map(), seenWord = new Map();
words.forEach((w, i) => {
  const at = `#${i} ${w && w.word ? w.word : '(无 word)'}`;
  if (!w || typeof w !== 'object') { errors.push(`${at}: 不是对象`); return; }
  if (!w.id) errors.push(`${at}: 缺 id（build-data.mjs 会自动生成）`);
  if (!w.word) errors.push(`${at}: 缺 word`);
  if (w.id) { if (seenId.has(w.id)) errors.push(`${at}: id 与 #${seenId.get(w.id)} 重复`); else seenId.set(w.id, i); }
  const key = String(w.word || '').toLowerCase();
  if (key) { if (seenWord.has(key)) errors.push(`${at}: 单词与 #${seenWord.get(key)} 重复`); else seenWord.set(key, i); }
  if (!w.cn) warns.push(`${at}: 缺中文释义 → 不能参与「见词选义/见义选词」`);
  if (!w.phonetic) warns.push(`${at}: 缺音标`);
  if (!w.example) warns.push(`${at}: 缺例句`);
  if (w.example) {
    const plain = String(w.example).replace(/<[^>]+>/g, '');
    if (w.word && !new RegExp(`\\b${String(w.word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'i').test(plain)) {
      warns.push(`${at}: 例句中找不到该单词`);
    }
  }
});

const withCn = words.filter((w) => w.cn).length;
console.log(`📄 ${FILE}`);
console.log(`   词条总数：${words.length}    有中文释义：${withCn}    无中文释义：${words.length - withCn}`);
console.log(`   例：${words.slice(0, 3).map((w) => `${w.word} ${w.cn || ''}`).join(' | ')}`);
console.log(`   错误 ${errors.length} 处，警告 ${warns.length} 处`);

if (warns.length) {
  console.log('\n⚠️  警告（不影响运行）：');
  warns.slice(0, 15).forEach((w) => console.log('   - ' + w));
  if (warns.length > 15) console.log(`   ... 其余 ${warns.length - 15} 条`);
}
if (errors.length) {
  console.log('\n❌ 错误：');
  errors.slice(0, 30).forEach((e) => console.log('   - ' + e));
}

/* ---------------- 出题引擎自测 ---------------- */
if (flag('selftest')) {
  console.log('\n🧪 出题引擎自测（直接加载 js/quiz.js 里真正的引擎代码）');
  const enginePath = resolve('js/quiz.js');
  let engineSrc;
  try {
    engineSrc = readFileSync(enginePath, 'utf8');
  } catch (e) {
    errors.push('自测失败：读不到 js/quiz.js（请在项目根目录执行）');
    engineSrc = '';
  }
  if (engineSrc) {
    const fakeWin = {};
    new Function('window', engineSrc)(fakeWin);
    const Quiz = fakeWin.Quiz;
    if (!Quiz) {
      errors.push('自测失败：quiz.js 没有挂载 window.Quiz');
    } else {
      const normalize = (w, i) => Object.assign({ id: w.id || 'w' + i }, w, { cn: (w.cn || '').trim() });
      const pool = words.filter((w) => w.cn).map(normalize);
      if (pool.length < 4) {
        errors.push('自测失败：有中文释义的词少于 4 个，无法生成四选一');
      } else {
        const optionCount = 4;
        for (const mode of ['w2c', 'c2w']) {
          const qs = Quiz.build(pool, { mode, count: Math.min(120, pool.length), optionCount });
          let badCount = 0, dup = 0, noAnswer = 0, sameEn = 0;
          for (const q of qs) {
            if (!q.choices || q.choices.length !== optionCount) badCount++;
            else {
              const texts = q.choices.map((c) => Quiz.plainText(c.text).toLowerCase());
              if (new Set(texts).size !== texts.length) dup++;
              const hits = texts.filter((t) => t === Quiz.plainText(q.answer).toLowerCase());
              if (hits.length !== 1) noAnswer++;
            }
            if (mode === 'w2c') {
              // 检查干扰项里有没有「英文释义与正确答案相同」的，那会造成一题两个答案
              const target = pool.find((w) => w.id === q.id);
              const texts = q.choices.map((c) => Quiz.plainText(c.text).toLowerCase());
              const wrongTexts = texts.filter((t) => t !== Quiz.plainText(q.answer).toLowerCase());
              const confused = pool.filter((w) => wrongTexts.includes(String(w.cn).toLowerCase()));
              if (target && target.en && confused.some((w) => String(w.en).toLowerCase() === String(target.en).toLowerCase())) sameEn++;
            }
          }
          console.log(`   ${mode === 'w2c' ? '见词选义' : '见义选词'}：出题 ${qs.length} 道 · 选项数异常 ${badCount} · 选项重复 ${dup} · 正确答案不唯一 ${noAnswer}${mode === 'w2c' ? ' · 同义释义干扰 ' + sameEn : ''}`);
          if (badCount || dup || noAnswer || sameEn) errors.push(`自测失败：${mode} 存在选项异常（异常 ${badCount} / 重复 ${dup} / 答案不唯一 ${noAnswer} / 同义干扰 ${sameEn}）`);
        }
        const spellQs = Quiz.build(pool, { mode: 'spell', count: Math.min(50, pool.length) });
        const spellBad = spellQs.filter((q) => !q.answer || !q.prompt).length;
        console.log(`   拼写：出题 ${spellQs.length} 道 · 缺题面或答案 ${spellBad} 道`);
        if (spellBad) errors.push('自测失败：拼写题存在缺题面或答案');

        const hintOk = Quiz.hintFor('abandon', 0) === '_ _ _ _ _ _ _';
        console.log(`   提示遮罩：${hintOk ? '正常' : '异常'}（hintFor('abandon', 0) = "${Quiz.hintFor('abandon', 0)}"）`);
        if (!hintOk) errors.push('自测失败：hintFor 遮罩结果不符合预期');

        const caseOk = Quiz.isCorrectSpelling('  Abandon ', 'abandon') && !Quiz.isCorrectSpelling('abandom', 'abandon');
        console.log(`   拼写判分（忽略大小写与首尾空格）：${caseOk ? '正常' : '异常'}`);
        if (!caseOk) errors.push('自测失败：拼写判分逻辑异常');
      }
    }
  }
}

if (errors.length) {
  console.log('\n❌ 体检未通过');
  process.exit(1);
}
console.log('\n✅ 体检通过');
