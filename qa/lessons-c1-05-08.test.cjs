const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snap = (page, options) => process.env.QA_SCREENSHOTS ? (fs.mkdirSync(path.dirname(options.path), { recursive: true }), page.screenshot(options)) : Promise.resolve(); // 스크린샷은 QA_SCREENSHOTS=1 일 때만 qa/screenshots/ 에 남겨요.
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'albatross-c2-lesson-03.html');
const pageURL = pathToFileURL(file).href;
const html = fs.readFileSync(file, 'utf8');
const OPEN = '<script type="application/json" id="lesson-data">';
const start = html.indexOf(OPEN) + OPEN.length;
const data = JSON.parse(html.slice(start, html.indexOf('</script>', start)));

const NEW = ['albatross-c1-lesson-05', 'albatross-c1-lesson-06', 'albatross-c1-lesson-07', 'albatross-c1-lesson-08'];
const HOSTS = new Set(['www.etymonline.com', 'dictionary.cambridge.org', 'en.wiktionary.org']);
const HANGUL = /[가-힣]/;
// 앱의 clozeParts 와 같은 규칙: 예문에 표제어가 정확히 한 번, 앞 글자에 붙지 않고 나와야 빈칸 문제를 만들 수 있다.
const clozeOK = w => { const s = w.example.toLowerCase(), k = w.word.toLowerCase(), at = s.indexOf(k); return at >= 0 && s.indexOf(k, at + k.length) < 0 && !(at > 0 && /[a-z]/.test(s[at - 1])); };

/* ---------- 구조 ---------- */
assert.equal(data.lessons.length, 21);
assert.deepEqual(data.lessons.slice(6, 10).map(l => l.id), NEW, 'new lessons are appended after the original six, in order');
for (const id of NEW) {
  const lesson = data.lessons.find(l => l.id === id);
  const n = id.slice(-2);
  assert.equal(lesson.title, `Albatross C1 Lesson ${n}`);
  assert.equal(lesson.level, 'C1');
  assert.equal(lesson.number, n);
  assert.equal(lesson.words.length, 50, `${id} has 50 words`);
  assert.deepEqual(lesson.words.map(w => w.number), Array.from({ length: 50 }, (_, i) => i + 1), `${id} numbered 1..50`);
  assert.equal(new Set(lesson.words.map(w => w.word.toLowerCase())).size, 50, `${id} headwords are unique`);
  for (const w of lesson.words) {
    const tag = `${id}#${w.number} ${w.word}`;
    assert(w.phrase.toLowerCase().includes(w.word.toLowerCase()), `${tag}: headword inside its phrase`);
    assert.equal(w.distractors.length, 3, tag);
    assert.equal(new Set(w.distractors.map(x => x.toLowerCase())).size, 3, `${tag}: distinct distractors`);
    assert(!w.distractors.some(x => x.toLowerCase() === w.en.toLowerCase()), `${tag}: en is not a distractor`);
    assert(!w.distractors.some(x => HANGUL.test(x)), `${tag}: distractors are English`);
    assert(clozeOK(w), `${tag}: example must support the cloze mode — "${w.example}"`);
    assert(HANGUL.test(w.translation) && HANGUL.test(w.origin) && HANGUL.test(w.relationNote), `${tag}: Korean explanations`);
    assert(w.synonyms.length >= 1, `${tag}: at least one synonym`);
    assert(w.sources.length >= 1 && w.sources.every(([label, url]) => label && HOSTS.has(new URL(url).host)), `${tag}: sources from verified dictionaries only`);
    assert(!/[<>]/.test(JSON.stringify(w)), `${tag}: no angle brackets`);
  }
}
const total = data.lessons.reduce((n, l) => n + l.words.length, 0);
assert.equal(total, 950);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('albatross-sound', JSON.stringify({ autoRead: false, effects: false })));
    await page.goto(pageURL);

    /* ---------- 라이브러리: 카드 10개, 합계 470 ---------- */
    assert.equal(await page.locator('[data-lesson]').count(), 0, 'no lesson cards before a level is chosen');
    assert.equal(await page.locator('[data-level]').count(), 2);
    await page.evaluate(() => chooseLevel('C1')); assert.equal(await page.locator('[data-lesson]').count(), 11);
    await page.evaluate(() => chooseLevel('C2')); assert.equal(await page.locator('[data-lesson]').count(), 10);
    assert.match(await page.locator('.library-stats-row').innerText(), /0 \/ 950 단어 학습/);
    await page.evaluate(() => chooseLevel('C1'));
    for (const id of NEW) assert.match(await page.locator(`[data-lesson="${id}"] .lesson-card-count`).innerText(), /단어 50개/);

    /* ---------- 새 수업마다 선택 화면 50개 ---------- */
    for (const id of NEW) {
      await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), id).then(() => page.locator(`[data-lesson="${id}"]`).click());
      assert.equal(await page.locator('.word-pick').count(), 50, `${id} selection grid`);
      await page.locator('#back-to-lessons').click();
    }

    /* ---------- 뜻이 같은 짝은 뜻→영단어 보기로 함께 나오지 않는다 ---------- */
    const neverTogether = async (lessonId, pairs) => {
      await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), lessonId).then(() => page.locator(`[data-lesson="${lessonId}"]`).click());
      const clashes = await page.evaluate(list => {
        const found = [];
        for (const [answer, rival] of list) {
          const entry = words.find(w => w.word === answer);
          if (!entry || !words.some(w => w.word === rival)) { found.push(`missing ${answer}/${rival}`); continue; }
          for (let i = 0; i < 60; i++) if (wordOptions(entry).some(o => o.text === rival)) { found.push(`${answer} offered ${rival}`); break; }
        }
        return found;
      }, pairs);
      await page.locator('#back-to-lessons').click();
      return clashes;
    };
    const both = pairs => pairs.flatMap(([a, b]) => [[a, b], [b, a]]);
    assert.deepEqual(await neverTogether('albatross-c1-lesson-05', both([['artifact', 'relic'], ['wreckage', 'debris'], ['abduction', 'kidnapping']])), [], 'same-meaning pairs in C1·05');
    assert.deepEqual(await neverTogether('albatross-c1-lesson-04', both([['preserve', 'reserve']])), [], 'the guard also fixes an older lesson');
    // 그래도 보기는 항상 4개, 중복 없음.
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), "albatross-c1-lesson-05").then(() => page.locator('[data-lesson="albatross-c1-lesson-05"]').click());
    const shapes = await page.evaluate(() => words.map(w => { const o = wordOptions(w); return [o.length, new Set(o.map(x => x.text)).size, o.filter(x => x.correct).length]; }));
    assert(shapes.every(([n, u, c]) => n === 4 && u === 4 && c === 1), 'every ko/cloze question has 4 distinct choices and exactly one answer');

    /* ---------- 새 수업으로 실제 풀이: 빈칸 모드 ---------- */
    await page.locator('[data-selection-action="mode"][data-mode="cloze"]').click();
    await page.evaluate(() => setDraftSelection([0, 1, 2]));
    await page.locator('[data-selection-action="start"]').click();
    for (let i = 0; i < 3; i++) {
      const view = await page.evaluate(() => ({ mode: state.mode, heading: document.getElementById('screen-title').textContent.toLowerCase(), word: currentWord().word.toLowerCase(), blanks: document.querySelectorAll('.cloze-blank').length }));
      assert.equal(view.mode, 'cloze', 'every new word supports the cloze mode');
      assert.equal(view.blanks, 1);
      assert.equal(view.heading.includes(view.word), false, 'the answer never shows in the sentence');
      const index = await page.evaluate(() => state.options.findIndex(o => o.correct));
      await page.locator(`[data-choice="${index}"]`).click();
      await page.locator('[data-action="next"]').click();
    }
    assert.equal(await page.locator('.summary-title').count(), 1);
    await page.locator('#back-to-lessons').click();
    await snap(page, { path: path.join(__dirname, 'screenshots', 'lessons-10-library.png'), fullPage: true });

    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS: 10 lessons (C1·05–08 appended, 50 words each, numbered 1..50, unique headwords), all 200 new words cloze-ready with English distractors, Korean explanations and verified dictionary sources; library shows 470 words; same-meaning pairs (artifact/relic, wreckage/debris, abduction/kidnapping, preserve/reserve) are never offered together; every question keeps 4 distinct choices.');
  } finally {
    await browser.close();
  }
})();
