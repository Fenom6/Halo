// Playwright（ブラウザを自動で動かす道具）を読み込む。
// このリポジトリには依存パッケージを入れていないので、
// 端末に入っているもの（または npm i --no-save playwright で入れたもの）を探して使う。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  console.error('Playwright が見つかりません。次を実行してください：\n  npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
}
export const { chromium } = pw;
