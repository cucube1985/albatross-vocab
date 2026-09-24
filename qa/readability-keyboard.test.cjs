const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snap = (page, options) => process.env.QA_SCREENSHOTS ? (fs.mkdirSync(path.dirname(options.path), { recursive: true }), page.screenshot(options)) : Promise.resolve(); // 스크린샷은 QA_SCREENSHOTS=1 일 때만 qa/screenshots/ 에 남겨요.
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'albatross-c2-lesson-03.html'), 'utf8');

// 단어 데이터는 <script type="application/json" id="lesson-data"> 블록 하나에 모여 있다.
const LESSON_DATA_OPEN = '<script type="application/json" id="lesson-data">';
const dataStart = html.indexOf(LESSON_DATA_OPEN);
assert(dataStart >= 0, 'lesson-data block is missing');
const lessonData = JSON.parse(html.slice(dataStart + LESSON_DATA_OPEN.length, html.indexOf('</script>', dataStart)));

// 해시는 키를 재귀적으로 정렬한 정규형으로 낸다. 포맷이나 키 순서만 바뀌면 통과하고,
// 단어 내용이 실제로 바뀌면 실패한다.
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : (value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value);
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'readability-baseline.json'), 'utf8'));
assert.equal(lessonData.lessons.length, baseline.length, 'lesson count changed');
for (const [id, hash] of baseline) {
  const lesson = lessonData.lessons.find(entry => entry.id === id);
  assert(lesson, `lesson ${id} disappeared`);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(canonical(lesson))).digest('hex'), hash, `lesson ${id} content changed`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'albatross-c2-lesson-03.html')).href);
    assert.equal(await page.locator('[data-lesson]').count(), 0, 'no lesson cards before a level is chosen');
    assert.equal(await page.locator('[data-level]').count(), 2);
    await page.evaluate(() => chooseLevel('C1')); assert.equal(await page.locator('[data-lesson]').count(), 11);
    await page.evaluate(() => chooseLevel('C2')); assert.equal(await page.locator('[data-lesson]').count(), 10);
    await snap(page, { path: path.join(__dirname, 'screenshots', 'readability-library.png'), fullPage: true });
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), "albatross-c2-lesson-05").then(() => page.locator('[data-lesson="albatross-c2-lesson-05"]').click());
    const entry = page.locator('#selection-number');
    const selected = () => page.evaluate(() => [...state.draftIds].sort((a,b) => a-b));
    const enterNumber = async value => { await entry.fill(value); await entry.press('Enter'); };
    assert(await page.locator('[data-selection-action="start"]').isDisabled());
    await page.keyboard.press('1');
    assert.equal(await entry.inputValue(), '1');
    await page.keyboard.press('Enter');
    assert.deepEqual(await selected(), [0]);
    await page.keyboard.type('12', { delay: 100 });
    assert.deepEqual(await selected(), [0]);
    await page.keyboard.press('Enter');
    assert.deepEqual(await selected(), [0,11]);
    await enterNumber('12');
    assert.deepEqual(await selected(), [0]);
    await enterNumber('40');
    assert.deepEqual(await selected(), [0,39]);
    for (const invalid of ['0', '41', '999', '', 'abc']) {
      await enterNumber(invalid);
      assert.equal(await entry.getAttribute('aria-invalid'), 'true');
      assert.deepEqual(await selected(), [0,39]);
    }
    await entry.fill('12'); await entry.press('Escape');
    assert.equal(await entry.inputValue(), '');
    await page.keyboard.type('12'); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter');
    assert.deepEqual(await selected(), [39]);
    // Number shortcuts still work after a mouse-selected checkbox has focus.
    await page.locator('input[type="checkbox"][value="4"]').check();
    await page.keyboard.press('2'); await page.keyboard.press('Enter');
    assert.deepEqual(await selected(), [1,4,39]);
    const before = await selected();
    await page.locator('#selection-title').focus();
    await page.locator('#selection-title').dispatchEvent('keydown', { key:'3', ctrlKey:true });
    await page.locator('#selection-title').dispatchEvent('keydown', { key:'3', isComposing:true });
    assert.deepEqual(await selected(), before);
    assert.equal(await entry.inputValue(), '');
    await page.locator('[data-selection-action="range"][data-start="10"]').click();
    assert.equal((await selected()).length, 10);
    await page.locator('[data-selection-action="random"]').click();
    assert.equal((await selected()).length, 10);
    await page.locator('[data-selection-action="none"]').click();
    await enterNumber('1'); await enterNumber('12'); await enterNumber('40');
    await page.evaluate(() => window.scrollTo(0,0));
    await snap(page, { path: path.join(__dirname, 'screenshots', 'readability-selection.png') });
    await page.locator('[data-selection-action="start"]').click();
    assert.equal(await page.evaluate(() => new Set(state.queue).size), 3);
    assert.deepEqual(await page.locator('.choice-letter').allTextContents(), ['1','2','3','4']);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'screen-title');
    await snap(page, { path: path.join(__dirname, 'screenshots', 'readability-question.png') });
    const correct = await page.evaluate(() => state.options.findIndex(o=>o.correct)+1);
    await page.locator('#screen-title').dispatchEvent('keydown', { key:String(correct), repeat:true });
    assert.equal(await page.evaluate(() => state.phase), 'question');
    await page.keyboard.press(String(correct));
    assert.equal(await page.evaluate(() => state.answers[0].correct), true);
    await page.locator('[data-action="uncertain"]').click();
    await page.locator('[data-action="next"]').click();
    const wrong = await page.evaluate(() => state.options.findIndex(o=>!o.correct)+1);
    await page.keyboard.press(String(wrong));
    assert.equal(await page.locator('.your-answer').count(), 1);
    await page.locator('[data-action="next"]').click();
    await page.keyboard.press(String(await page.evaluate(() => state.options.findIndex(o=>o.correct)+1)));
    await page.locator('[data-action="next"]').click();
    const downloaded = page.waitForEvent('download');
    await page.locator('[data-action="export-wrong"]').click();
    const chunks=[]; for await(const chunk of await (await downloaded).createReadStream()) chunks.push(chunk);
    assert(Buffer.concat(chunks).toString('utf8').includes('틀린 단어 1개'));
    await page.locator('[data-action="review"]').click();
    assert.equal(await page.evaluate(() => state.queue.length), 2);
    await page.locator('#back-to-lessons').click();
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), "albatross-c1-lesson-04").then(() => page.locator('[data-lesson="albatross-c1-lesson-04"]').click());
    assert.deepEqual(await selected(), []);
    await enterNumber('50');
    assert.deepEqual(await selected(), [49]);
    // Mobile, narrow viewport and longer words/feedback.
    for (const width of [390,320]) {
      await page.setViewportSize({width, height:844});
      await page.evaluate(() => window.scrollTo(0,0));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'selection overflow');
      await snap(page, { path: path.join(__dirname, 'screenshots', `readability-selection-${width}.png`)});
    }
    await enterNumber('13');
    await page.locator('[data-selection-action="start"]').click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'question overflow');
    await page.keyboard.press(String(await page.evaluate(() => state.options.findIndex(o=>o.correct)+1)));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'feedback overflow');
    await page.setViewportSize({width:390,height:844});
    await snap(page, { path: path.join(__dirname, 'screenshots', 'readability-feedback-mobile.png'),fullPage:true});
    assert.deepEqual(errors, []);
    console.log('PASS: all vocabulary unchanged; number selection, invalid input, editing, keyboard quiz, review, export, isolation, mobile layout.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
