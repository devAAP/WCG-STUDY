const { chromium } = require('playwright');
// End-to-end walkthrough of Testament Quest in Chromium (Playwright).
// Run: node tests/e2e.quest.cjs [screenshotDir]
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
(async () => {
  const SP = process.argv[2] || null;
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const quiz = (await import(path.join(ROOT, 'quest/js/data/quiz-john.js'))).JOHN_QUIZ;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/.netlify/functions/**', r => r.fulfill({ status: 404, body: '{}' }));
  await page.goto(`${base}/quest/index.html`);
  await page.fill('input[name=name]', 'Ama');
  await page.click('form[data-action=onboard] button');
  if (SP) await page.screenshot({ path: path.join(SP, '/01-today.png') });

  async function answerJohn(ch, correct = true) {
    await page.click('[data-action=quiz]');
    await page.waitForSelector('form[data-action=submit-quiz]');
    const qs = quiz[ch];
    for (let i = 0; i < qs.length; i++) {
      const want = correct ? qs[i].options[qs[i].a] : qs[i].options[(qs[i].a + 1) % 4];
      const labels = page.locator(`fieldset:nth-of-type(${i + 1}) label.opt`);
      const n = await labels.count();
      for (let j = 0; j < n; j++) if ((await labels.nth(j).innerText()).trim() === want) await labels.nth(j).click();
    }
    await page.click('form[data-action=submit-quiz] button');
  }
  // wrong answers first → retry screen
  await answerJohn(1, false);
  const retry = await page.locator('.modal h2').innerText();
  if (SP) await page.screenshot({ path: path.join(SP, '/02-retry.png') });
  await page.click('[data-action=close-modal]', { force: true }).catch(() => {});
  await page.keyboard.press('Escape');
  await answerJohn(1, true);
  const celebrate1 = await page.locator('.celebrate').innerText();
  await page.click('.celebrate [data-action=close-modal]');

  // Simulate the next 6 days: rewind lastDay before each reading
  for (let ch = 2; ch <= 7; ch++) {
    await page.evaluate(() => { const k = 'testament-quest:v1'; const s = JSON.parse(localStorage[k]);
      const d = new Date(s.streak.lastDay + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
      s.streak.lastDay = d.toISOString().slice(0, 10); localStorage[k] = JSON.stringify(s); });
    await page.reload();
    await answerJohn(ch, true);
    await page.click('.celebrate [data-action=close-modal]');
  }
  const celebrate7 = await page.evaluate(() => JSON.parse(localStorage['testament-quest:v1']).streak);
  if (SP) await page.screenshot({ path: path.join(SP, '/03-foundation.png'), fullPage: false });

  for (let ch = 8; ch <= 21; ch++) { await answerJohn(ch, true); if (ch < 21) await page.click('.celebrate [data-action=close-modal]'); }
  const finale = await page.locator('.celebrate').innerText();
  if (SP) await page.screenshot({ path: path.join(SP, '/04-john-done.png') });
  await page.click('.celebrate [data-action=close-modal]');
  const todayCard = await page.locator('.book-name').innerText();

  // Matthew quiz: AI endpoint mocked 404 → reflection fallback
  await page.click('[data-action=quiz]');
  await page.fill('textarea[name=note]', 'Matthew opens with the genealogy of Jesus through David and Abraham.');
  await page.click('form[data-action=submit-reflection] button');
  const matt = await page.locator('.celebrate').innerText();
  await page.click('.celebrate [data-action=close-modal]');

  await page.click('[data-tab=quest]');
  if (SP) await page.screenshot({ path: path.join(SP, '/05-quest.png') });
  await page.click('[data-tab=fellowship]');
  await page.fill('input[name=name]', 'Kofi'); await page.click('form[data-action=add-friend] button');
  const wa = await page.getAttribute('.share.wa', 'href');
  if (SP) await page.screenshot({ path: path.join(SP, '/06-fellowship.png') });
  await page.click('[data-tab=settings]');
  if (SP) await page.screenshot({ path: path.join(SP, '/07-settings.png') });

  assert.match(retry, /Almost: 0\/3/);
  assert.match(celebrate1, /streak has begun/);
  assert.deepEqual([celebrate7.current, celebrate7.longest, celebrate7.shields], [7, 7, 1]);
  assert.match(finale, /Cana Wine Jar/); assert.match(finale, /Matthew is unlocked/);
  assert.equal(todayCard, 'Matthew');
  assert.match(matt, /Well done/);
  assert.ok(wa.startsWith('https://wa.me/?text=Hi%20Kofi'));
  const real = errors.filter(e => !/status of 404/.test(e)); // 404 = mocked quiz endpoint
  assert.deepEqual(real, []);
  console.log('E2E PASSED');
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
