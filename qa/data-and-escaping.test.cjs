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

/* ---------- 1. 데이터가 JSON 블록 하나로 모였는가 ---------- */
assert.equal(html.split(OPEN).length - 1, 1, 'exactly one lesson-data block');
const dataStart = html.indexOf(OPEN) + OPEN.length;
const data = JSON.parse(html.slice(dataStart, html.indexOf('</script>', dataStart)));
assert.equal(data.lessons.length, 21);
assert.equal(data.lessons.reduce((n, lesson) => n + lesson.words.length, 0), 950);
assert(data.synonymHints && Object.keys(data.synonymHints).length > 0, 'synonym hints moved into the data block too');

// JSON 블록은 스크립트 태그 안의 원문이라, 아래 문자열이 섞이면 파싱이 깨진다.
const raw = html.slice(dataStart, html.indexOf('</script>', dataStart));
for (const bad of ['</script', '<!--', '-->', '\u2028', '\u2029']) {
  assert.equal(raw.includes(bad), false, `data must not contain ${JSON.stringify(bad)}`);
}

/* ---------- 2. 흩어져 있던 옛 구조가 남아 있지 않은가 ---------- */
const script = html.slice(html.lastIndexOf('<script>'), html.lastIndexOf('</script>'));
for (const gone of ['const lessons = [{', 'lessons.push(', 'c2Lesson', 'c1Lesson', 'movedToC1', 'preferredSynonyms', 'const synonymHints = {']) {
  assert.equal(script.includes(gone), false, `"${gone}" should be gone from the script`);
}
assert(script.includes("JSON.parse(document.getElementById('lesson-data').textContent)"), 'the script reads the JSON block');

/* ---------- 3. 앱이 읽지 않는 필드가 지워졌는가 ---------- */
for (const dead of ['sourcePart', 'sourceSynonym', 'etymWord']) {
  assert.equal(raw.includes(`"${dead}"`), false, `${dead} should be gone from the data`);
  assert.equal(script.includes('.' + dead), false, `${dead} should not be referenced by code`);
}
// 살아 있는 필드는 그대로여야 한다.
for (const lesson of data.lessons) for (const word of lesson.words) {
  for (const field of ['word', 'phrase', 'number', 'part', 'ko', 'en', 'distractors', 'root', 'origin', 'synonyms', 'antonyms', 'relationNote', 'example', 'translation', 'sources']) {
    assert(word[field] !== undefined, `${lesson.id}#${word.number} is missing ${field}`);
  }
  assert.equal(word.distractors.length, 3, `${word.word} must keep exactly 3 distractors`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    /* ---------- 4. JSON 블록에서 읽어도 앱이 그대로 동작하는가 ---------- */
    await page.goto(pageURL);
    assert.equal(await page.evaluate(() => lessons.length), 21);
    assert.equal(await page.evaluate(() => lessons.reduce((n, l) => n + l.words.length, 0)), 950);
    assert.equal(await page.locator('[data-lesson]').count(), 0, 'no lesson cards before a level is chosen');
    assert.equal(await page.locator('[data-level]').count(), 2);
    await page.evaluate(() => chooseLevel('C1')); assert.equal(await page.locator('[data-lesson]').count(), 11);
    await page.evaluate(() => chooseLevel('C2')); assert.equal(await page.locator('[data-lesson]').count(), 10);
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), "albatross-c2-lesson-03").then(() => page.locator('[data-lesson="albatross-c2-lesson-03"]').click());
    assert.equal(await page.locator('.word-pick').count(), 40);
    // 유의어 힌트도 JSON 에서 읽어온다.
    assert.equal(await page.evaluate(() => Boolean(synonymHints.quadruple && synonymHints.aristocrat)), true);

    /* ---------- 5. HTML 특수문자가 든 데이터가 마크업으로 새지 않는가 ---------- */
    const INJECTED = '<img src=x onerror="window.__pwned=1">';
    await page.evaluate(payload => {
      const entry = words[0];
      entry.word = payload;
      entry.ko = 'A & B "따옴표" <b>굵게</b>';
      entry.part = '<i>noun</i>';
      entry.root = '<u>root</u>';
      entry.origin = '<s>origin</s>';
      entry.relationNote = '<em>relation</em>';
      entry.translation = '<mark>번역</mark>';
      entry.note = '<big>note</big>';
      entry.sources = [['<b>label</b>', 'https://example.com/?a=1&b=2"']];
      setDraftSelection([0]);
    }, INJECTED);
    await page.locator('[data-selection-action="start"]').click();

    const questionView = await page.evaluate(() => ({
      heading: document.getElementById('screen-title').textContent,
      part: document.querySelector('.question-card .part').textContent,
      injectedNodes: document.querySelectorAll('#screen img, #screen i, #screen u, #screen s, #screen em, #screen mark, #screen big').length,
      pwned: window.__pwned,
      stripText: document.getElementById('word-list').textContent,
    }));
    assert.equal(questionView.heading, INJECTED, 'the raw markup shows as text');
    assert.equal(questionView.part, '<i>noun</i>');
    assert.equal(questionView.injectedNodes, 0, 'no element was created from the data');
    assert.equal(questionView.pwned, undefined, 'the onerror handler never ran');
    assert(questionView.stripText.includes(INJECTED), 'the word strip escapes too');

    const index = await page.evaluate(() => state.options.findIndex(o => o.correct));
    await page.locator(`[data-choice="${index}"]`).click();
    const feedbackView = await page.evaluate(() => ({
      ko: document.querySelector('.meaning-ko').textContent,
      note: document.querySelector('.meaning-note').textContent,
      root: document.querySelector('.origin-root').textContent,
      origin: document.querySelector('.origin p').textContent,
      relation: [...document.querySelectorAll('.relation-note')].map(el => el.textContent),
      translation: document.querySelector('.translation').textContent,
      sourceLabel: document.querySelector('.source-links a').textContent,
      sourceHref: document.querySelector('.source-links a').getAttribute('href'),
      injectedNodes: document.querySelectorAll('#screen img, #screen i, #screen u, #screen s, #screen em, #screen mark, #screen big').length,
      // <b> 는 동의어 목록에서 앱이 정식으로 쓰므로, 주입된 <b> 만 좁혀서 센다.
      injectedBold: document.querySelectorAll('.meaning-ko b').length,
      pwned: window.__pwned,
    }));
    assert.equal(feedbackView.injectedBold, 0, 'the <b> inside the korean meaning must not become an element');
    assert.equal(feedbackView.ko, 'A & B "따옴표" <b>굵게</b>');
    assert.equal(feedbackView.note, '<big>note</big>');
    assert.equal(feedbackView.root, '<u>root</u>');
    assert.equal(feedbackView.origin, '<s>origin</s>');
    assert(feedbackView.relation.includes('<em>relation</em>'));
    assert.equal(feedbackView.translation, '<mark>번역</mark>');
    assert.equal(feedbackView.sourceLabel.trim(), '<b>label</b> ↗');
    assert.equal(feedbackView.sourceHref, 'https://example.com/?a=1&b=2"', 'the quote in the url must not break out of the attribute');
    assert.equal(feedbackView.injectedNodes, 0, 'feedback card creates no elements from data');
    assert.equal(feedbackView.pwned, undefined);

    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS: single JSON data block (21 lessons / 950 words), old scattered literals and migration code gone, dead fields removed with required fields intact, app runs from JSON, and HTML-significant data renders as text in every question and feedback slot.');
  } finally {
    await browser.close();
  }
})();
