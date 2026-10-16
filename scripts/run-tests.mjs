#!/usr/bin/env node
/**
 * run-tests.mjs —— 一条命令跑完所有自动化检查
 *
 *   node scripts/run-tests.mjs
 *
 * 依次执行：
 *   1) 词库体检 + 出题引擎自测      （scripts/validate.mjs 的核心逻辑）
 *   2) 浏览器环境端到端场景测试     （dev/harness.mjs + dev/e2e.mjs）
 *      · http 环境：走 fetch('data/words.json') 这条路（GitHub Pages / 本地服务器）
 *      · file 环境：走 data/words.js 内联回退这条路（双击 index.html）
 *
 * 任意一项失败即以退出码 1 结束，可以直接挂到 CI / pre-commit。
 */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox } from '../dev/harness.mjs';
import { runE2E } from '../dev/e2e.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

let failed = 0;

function section(title) {
  console.log('\n' + '─'.repeat(64));
  console.log(title);
  console.log('─'.repeat(64));
}

/* ---------- 1. 词库与题库自测 ---------- */
section('① 词库体检 + 出题引擎自测');
const v = spawnSync(process.execPath, [resolve(HERE, 'validate.mjs'), '--selftest'], { cwd: ROOT, encoding: 'utf8' });
process.stdout.write(v.stdout || '');
if (v.stderr) process.stderr.write(v.stderr);
if (v.status !== 0) { failed++; console.log('❌ 词库/引擎自测未通过'); }
else console.log('✅ 词库/引擎自测通过');

/* ---------- 2. 端到端场景测试 ---------- */
const scenarios = [
  { label: 'http', opts: { allowNetwork: true } },
  { label: 'file', opts: { allowNetwork: false } },
];

for (const sc of scenarios) {
  section(`② 端到端场景测试（${sc.label === 'http' ? 'http:// 服务器 / GitHub Pages' : 'file:// 双击打开'}）`);
  let result;
  let sb = null;
  try {
    sb = await createSandbox(sc.opts);
    result = await runE2E(sb, { label: sc.label });
  } catch (e) {
    failed++;
    console.log(`❌ ${sc.label} 场景启动失败：${e.message}`);
    console.log(e.stack);
    if (sb) {
      console.log('\n--- 失败时页面 HTML（截断 1200 字）---');
      console.log(String(sb.app.innerHTML).slice(0, 1200));
      console.log('--- hash = ' + sb.hash + ' ---');
    }
    continue;
  }
  for (const r of result.results) {
    if (r.ok) console.log('  ✓ ' + r.name);
    else console.log('  ✗ ' + r.name + (r.detail ? '\n      → ' + r.detail : ''));
  }
  console.log(`\n  ${sc.label} 场景：${result.pass} 通过 / ${result.fail} 失败`);
  if (result.fail) failed++;
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(64));
if (failed) {
  console.log(`❌ 有 ${failed} 项检查未通过`);
  process.exit(1);
}
console.log('✅ 全部检查通过');
