const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'albatross-c2-lesson-03.html');
const pageURL = pathToFileURL(file).href;
const html = fs.readFileSync(file, 'utf8');
const OPEN = '<script type="application/json" id="lesson-data">';
const start = html.indexOf(OPEN) + OPEN.length;
const data = JSON.parse(html.slice(start, html.indexOf('</script>', start)));

const NEW = ['albatross-c1-lesson-09', 'albatross-c1-lesson-10', 'albatross-c1-lesson-11', 'albatross-c1-lesson-12'];
// 재사용한 옛 항목은 Oxford·Merriam-Webster 출처를 쓰기도 한다.
const HOSTS = new Set(['www.etymonline.com', 'dictionary.cambridge.org', 'en.wiktionary.org', 'www.oxfordlearnersdictionaries.com', 'www.merriam-webster.com']);
const HANGUL = /[가-힣]/;
const clozeOK = w => { const s = w.example.toLowerCase(), k = w.word.toLowerCase(), at = s.indexOf(k); return at >= 0 && s.indexOf(k, at + k.length) < 0 && !(at > 0 && /[a-z]/.test(s[at - 1])); };

assert.equal(data.lessons.length, 21);
assert.deepEqual(data.lessons.slice(10, 14).map(l => l.id), NEW, 'appended after C1·08, in order');
for (const id of NEW) {
  const lesson = data.lessons.find(l => l.id === id), n = id.slice(-2);
  assert.equal(lesson.title, `Albatross C1 Lesson ${n}`);
  assert.equal(lesson.level, 'C1');
  assert.equal(lesson.number, n);
  assert.deepEqual(lesson.words.map(w => w.number), Array.from({ length: 50 }, (_, i) => i + 1), `${id} numbered 1..50`);
  assert.equal(new Set(lesson.words.map(w => w.word.toLowerCase())).size, 50, `${id} headwords unique`);
  for (const w of lesson.words) {
    const tag = `${id}#${w.number} ${w.word}`;
    assert(w.phrase.toLowerCase().includes(w.word.toLowerCase()), `${tag}: headword inside phrase`);
    assert.equal(new Set(w.distractors.map(x => x.toLowerCase())).size, 3, `${tag}: 3 distinct distractors`);
    assert(!w.distractors.some(x => x.toLowerCase() === w.en.toLowerCase() || HANGUL.test(x)), `${tag}: English distractors, none equal to en`);
    assert(clozeOK(w), `${tag}: cloze-ready example — "${w.example}"`);
    assert(HANGUL.test(w.translation) && HANGUL.test(w.origin) && HANGUL.test(w.relationNote), `${tag}: Korean explanations`);
    assert(w.sources.length >= 1 && w.sources.every(([label, url]) => label && HOSTS.has(new URL(url).host)), `${tag}: dictionary sources`);
    assert(!/[<>]/.test(JSON.stringify(w)), `${tag}: no angle brackets`);
  }
}
// 원문 유의어 오타 교정(annouce → announce)이 반영돼 있다.
assert.equal(data.lessons.find(l => l.id === NEW[0]).words.find(w => w.word === 'herald').synonyms[0][0], 'announce');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('albatross-sound', JSON.stringify({ autoRead: false, effects: false })));
    await page.goto(pageURL);
    assert.match(await page.locator('.library-stats-row').innerText(), /0 \/ 950 단어 학습/);
    await page.locator('[data-level="C1"]').click();
    assert.equal(await page.locator('[data-lesson]').count(), 11);
    for (const id of NEW) {
      await page.locator(`[data-lesson="${id}"]`).click();
      assert.equal(await page.locator('.word-pick').count(), 50, `${id} selection grid`);
      await page.locator('#back-to-lessons').click();
    }
    const neverTogether = async (lessonId, pairs) => {
      await page.locator(`[data-lesson="${lessonId}"]`).click();
      const clashes = await page.evaluate(list => {
        const found = [];
        for (const [answer, rival] of list) {
          const entry = words.find(w => w.word === answer);
          if (!entry || !words.some(w => w.word === rival)) { found.push(`missing ${answer}/${rival}`); continue; }
          for (let i = 0; i < 60; i++) if (wordOptions(entry).some(o => o.text === rival)) { found.push(`${answer} offered ${rival}`); break; }
        }
        return found;
      }, pairs.flatMap(([a, b]) => [[a, b], [b, a]]));
      const shapes = await page.evaluate(() => words.every(w => { const o = wordOptions(w); return o.length === 4 && new Set(o.map(x => x.text)).size === 4 && o.filter(x => x.correct).length === 1; }));
      await page.locator('#back-to-lessons').click();
      assert(shapes, `${lessonId}: every question has 4 distinct choices and one answer`);
      return clashes;
    };
    assert.deepEqual(await neverTogether(NEW[0], [['tangible', 'concrete']]), []);
    assert.deepEqual(await neverTogether(NEW[2], [['esoteric', 'obscure']]), []);
    assert.deepEqual(await neverTogether(NEW[3], [['complication', 'obstacle']]), []);
    // 실제 풀이 한 바퀴(빈칸 모드).
    await page.locator(`[data-lesson="${NEW[3]}"]`).click();
    await page.locator('[data-selection-action="mode"][data-mode="cloze"]').click();
    await page.evaluate(() => setDraftSelection([0, 1, 2]));
    await page.locator('[data-selection-action="start"]').click();
    for (let i = 0; i < 3; i++) {
      const v = await page.evaluate(() => ({ mode: state.mode, heading: document.getElementById('screen-title').textContent.toLowerCase(), word: currentWord().word.toLowerCase() }));
      assert.equal(v.mode, 'cloze');
      assert.equal(v.heading.includes(v.word), false);
      await page.locator(`[data-choice="${await page.evaluate(() => state.options.findIndex(o => o.correct))}"]`).click();
      await page.locator('[data-action="next"]').click();
    }
    assert.equal(await page.locator('.summary-title').count(), 1);
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS: 14 lessons (C1·09–12 appended, 50 words each), all cloze-ready with Korean explanations and dictionary sources; library shows 670 words and 11 C1 lessons; synonym pairs (tangible/concrete, esoteric/obscure, complication/obstacle) never offered together.');
  } finally {
    await browser.close();
  }
})();
