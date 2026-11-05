// i18n.js（ことばの切り替え）のテスト。Node.js には document がないので日本語になる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANG, L, noteName, clockText } from '../js/i18n.js';

test('document がない所（テスト）では日本語', () => {
  assert.equal(LANG, 'ja');
  assert.equal(L('ド', 'C'), 'ド');
  assert.equal(noteName(9), 'ラ');
  assert.equal(noteName(-3), 'ラ', 'マイナスでも正しく');
  assert.equal(clockText(9), '9時');
});
