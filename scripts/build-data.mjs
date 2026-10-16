#!/usr/bin/env node
/**
 * build-data.mjs —— 把 CSV / TSV / JSON 词表清洗成 data/words.json 与 data/words.js
 *
 * 用法（在项目根目录 ielts-1200 下执行）：
 *   node scripts/build-data.mjs --in words.csv
 *   node scripts/build-data.mjs --in words.csv --out data/words.json --title "1200 雅思核心词汇"
 *   node scripts/build-data.mjs --in words.csv --strict     # 缺中文释义直接报错退出
 *
 * CSV 表头（大小写不敏感，可缺列，顺序随意）：
 *   word | phonetic | pos | cn | en | example | examplecn | tags
 *   - word      必填
 *   - cn        强烈建议填写（缺了无法出四选一的中文选项）
 *   - cn 里的多个义项用 ; 、 | ，或 / 分隔，脚本会统一成 「；」
 *   - example 里把目标词写成 *word* 或 __word__，脚本会转成 <b>word</b> 高亮
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';

/* ---------------- CLI ---------------- */
const argv = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const IN = arg('in');
const OUT = resolve(arg('out', 'data/words.json'));
const TITLE = arg('title', '1200 雅思核心词汇');
if (!IN) {
  console.error('缺少 --in 参数。示例：node scripts/build-data.mjs --in words.csv');
  process.exit(2);
}

/* ---------------- 工具 ---------------- */
const HEADER_ALIAS = {
  word: 'word', '单词': 'word', '词': 'word', term: 'word',
  phonetic: 'phonetic', ipa: 'phonetic', '音标': 'phonetic', pronunciation: 'phonetic',
  pos: 'pos', '词性': 'pos', type: 'pos',
  cn: 'cn', '中文': 'cn', '释义': 'cn', '中文释义': 'cn', meaning: 'cn', translation: 'cn',
  en: 'en', '英文释义': 'en', definition: 'en', definitionen: 'en',
  example: 'example', '例句': 'example', sentence: 'example',
  examplecn: 'exampleCn', '例句翻译': 'exampleCn', '例句中文': 'exampleCn', sentencecn: 'exampleCn',
  tags: 'tags', '标签': 'tags', unit: 'tags', '单元': 'tags',
};

const normHeader = (h) => {
  const k = String(h || '').trim().toLowerCase().replace(/[\s_\-.]/g, '');
  return HEADER_ALIAS[k] || HEADER_ALIAS[String(h || '').trim()] || null;
};

/** 极简但够用的 CSV 解析：支持双引号包裹、"" 转义、字段内换行 */
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (c === '\r') {
      /* 忽略 */
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

const stripBom = (s) => s.replace(/^\uFEFF/, '');

const tidyCn = (s) =>
  String(s || '')
    .replace(/[;；|、/]+/g, '；')
    .replace(/；{2,}/g, '；')
    .replace(/^；|；$/g, '')
    .replace(/\s*；\s*/g, '；')
    .trim();

const tidyExample = (word, s) => {
  let out = String(s || '').trim();
  if (!out) return '';
  const re = new RegExp(`(\\*\\*?|__)(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)(\\*\\*?|__)`, 'gi');
  out = out.replace(re, '<b>$2</b>');
  return out;
};

const slug = (w) => String(w).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---------------- 读取输入 ---------------- */
const raw = stripBom(readFileSync(IN, 'utf8'));
let records = [];

if (/\.json$/i.test(IN)) {
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed.words;
  if (!Array.isArray(list)) throw new Error('JSON 里没有找到 words 数组');
  records = list;
} else {
  const delimiter = /\.tsv$/i.test(IN) ? '\t' : ',';
  const rows = parseDelimited(raw, delimiter);
  if (!rows.length) throw new Error('输入文件是空的');
  const header = rows[0].map(normHeader);
  const unknown = rows[0].filter((h, i) => !header[i] && String(h).trim() !== '');
  if (unknown.length) console.warn(`⚠️  未识别的列（将忽略）：${unknown.join(', ')}`);
  if (!header.includes('word')) {
    throw new Error(`第一行必须是表头且包含 word 列。当前表头：${rows[0].join(' | ')}`);
  }
  for (const r of rows.slice(1)) {
    const rec = {};
    header.forEach((key, i) => { if (key) rec[key] = r[i]; });
    records.push(rec);
  }
}

/* ---------------- 清洗 ---------------- */
const seen = new Map();
const words = [];
const dropped = [];

for (const rec of records) {
  const word = String(rec.word || '').trim();
  if (!word) { dropped.push('（空单词行）'); continue; }
  if (!/^[A-Za-z][A-Za-z'’\- ]*$/.test(word)) { dropped.push(`${word}（含非法字符）`); continue; }
  const key = word.toLowerCase();
  if (seen.has(key)) { dropped.push(`${word}（重复）`); continue; }

  const item = {
    id: slug(word),
    word,
    phonetic: String(rec.phonetic || '').trim(),
    pos: String(rec.pos || '').trim(),
    cn: tidyCn(rec.cn),
    en: String(rec.en || '').trim(),
    example: tidyExample(word, rec.example),
    exampleCn: String(rec.exampleCn || '').trim(),
  };
  const tags = String(rec.tags || '').split(/[|,;；、]+/).map((t) => t.trim()).filter(Boolean);
  if (tags.length) item.tags = tags;

  if (!item.cn) { dropped.push(`${word}（缺中文释义）`); if (flag('strict')) continue; }
  if (!item.cn && flag('strict')) continue;

  seen.set(key, true);
  words.push(item);
}

words.sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase(), 'en'));

const payload = {
  schema: 1,
  meta: {
    title: TITLE,
    count: words.length,
    note: '由 scripts/build-data.mjs 生成，请勿手工编辑；改词表请改源 CSV 后重新生成。',
    generatedAt: new Date().toISOString(),
  },
  words,
};

/* ---------------- 写出 ---------------- */
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

const JS_OUT = OUT.replace(/\.json$/i, '.js');
const jsBody =
  '/* 由 scripts/build-data.mjs 自动生成，请勿手工编辑。 */\n' +
  '/* 这个文件的作用：让你双击 index.html（file:// 协议，fetch 被浏览器禁用）时也能正常加载词库。 */\n' +
  'window.DSH_WORDS = ' + JSON.stringify(payload) + ';\n';
writeFileSync(JS_OUT, jsBody, 'utf8');

const noCn = words.filter((w) => !w.cn).length;
console.log(`✅ 写出 ${words.length} 条 → ${OUT}`);
console.log(`✅ 写出 ${words.length} 条 → ${JS_OUT}`);
console.log(`   缺中文释义：${noCn} 条   被跳过：${dropped.length} 条`);
if (dropped.length) {
  console.log('   跳过的内容（最多显示 20 条）：');
  dropped.slice(0, 20).forEach((d) => console.log(`     - ${d}`));
  if (dropped.length > 20) console.log(`     ... 其余 ${dropped.length - 20} 条`);
}
if (noCn && !flag('strict')) {
  console.log('ℹ️  有词条缺中文释义时，「见词选义」和「见义选词」不会把它们当干扰项，但仍可用于拼写练习。');
}
