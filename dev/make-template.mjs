#!/usr/bin/env node
/**
 * make-template.mjs —— 从 data/words.json 反向导出词表模板 data/words.csv
 *
 * 用途：给你一个「照着填」的起点。把 30 个占位词换成你的 1200 词，
 * 然后执行：
 *   node scripts/build-data.mjs --in data/words.csv --out data/words.json --strict
 *
 * 注意：这是开发辅助脚本，只需要在准备词表时跑一次。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const set = JSON.parse(readFileSync(resolve(ROOT, 'data/words.json'), 'utf8'));

const COLUMNS = ['word', 'phonetic', 'pos', 'cn', 'en', 'example', 'exampleCn'];

/** CSV 转义：含逗号/引号/换行时用双引号包裹，内部引号翻倍 */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** <b>word</b> 还原成 *word*，这样 build-data.mjs 才能再高亮回去 */
function toMarkup(word, example) {
  const re = new RegExp(`<b>(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)</b>`, 'gi');
  return String(example || '').replace(re, '*$1*');
}

const lines = [COLUMNS.join(',')];
for (const w of set.words) {
  lines.push([
    csvCell(w.word),
    csvCell(w.phonetic),
    csvCell(w.pos),
    csvCell(w.cn),
    csvCell(w.en),
    csvCell(toMarkup(w.word, w.example)),
    csvCell(w.exampleCn),
  ].join(','));
}

const out = resolve(ROOT, 'data/words.csv');
writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log(`✅ 导出 ${set.words.length} 条 → ${out}`);
console.log('   把这个文件里的内容替换成你的 1200 词，然后运行：');
console.log('   node scripts/build-data.mjs --in data/words.csv --strict');
