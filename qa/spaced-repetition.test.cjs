const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snap = (page, options) => process.env.QA_SCREENSHOTS ? (fs.mkdirSync(path.dirname(options.path), { recursive: true }), page.screenshot(options)) : Promise.resolve(); // 스크린샷은 QA_SCREENSHOTS=1 일 때만 qa/screenshots/ 에 남겨요.
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const pageURL = pathToFileURL(path.join(root, 'albatross-c2-lesson-03.html')).href;
const LESSON = 'albatross-c2-lesson-03';

const pad = n => String(n).padStart(2, '0');
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.accept());

    const plan = () => page.locator('[data-selection-action="plan"]');
    const filter = kind => page.locator(`[data-selection-action="filter"][data-filter="${kind}"]`);
    const statOf = word => page.evaluate(([lesson, w]) => progress.stats[lesson][w], [LESSON, word]);
    const answer = async correct => {
      const index = await page.evaluate(want => state.options.findIndex(o => o.correct === want), correct);
      await page.locator(`[data-choice="${index}"]`).click();
    };
    const openLesson = async () => { await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => page.locator(`[data-lesson="${LESSON}"]`).click()); };

    await page.goto(pageURL);

    // The page must schedule on the user's local date, not UTC (KST is +9h).
    assert.equal(await page.evaluate(() => today()), localToday(), 'today() must be the local date');

    // Nothing studied yet: the plan is all new words, nothing is due.
    await openLesson();
    assert.equal(await plan().innerText(), '오늘의 학습 10개 · 새 단어 10');
    assert.equal(await filter('due').innerText(), '복습할 때 0개');
    assert(await filter('due').isDisabled());
    await plan().click();
    assert.equal(await page.evaluate(() => state.draftIds.size), 10);
    assert.equal(await plan().getAttribute('aria-pressed'), 'true');

    // Study two words: one correct (box 2 -> +3 days), one wrong (box 1 -> +1 day).
    await page.evaluate(() => setDraftSelection([0, 1]));
    await page.locator('[data-selection-action="start"]').click();
    const firstWord = await page.evaluate(() => words[state.queue[0]].word);
    await answer(true);
    assert.match(await page.locator('.next-review').innerText(), /기억 단계 2 \/ 5 · 다음 복습 3일 뒤/);
    assert.equal(await page.locator('.review-boxes').innerText(), '●●○○○');
    let stat = await statOf(firstWord);
    assert.equal(stat.box, 2);
    assert.equal(stat.due, plusDays(3));
    assert.equal(stat.last, localToday());

    await page.locator('[data-action="next"]').click();
    const secondWord = await page.evaluate(() => words[state.queue[1]].word);
    await answer(false);
    assert.match(await page.locator('.next-review').innerText(), /기억 단계 1 \/ 5 · 다음 복습 내일/);
    stat = await statOf(secondWord);
    assert.equal(stat.box, 1);
    assert.equal(stat.due, plusDays(1));

    // The summary groups the words by when they come back.
    await page.locator('[data-action="next"]').click();
    assert.match(await page.locator('.schedule-note').innerText(), /다음 복습 예정\s*내일 1개 · 3일 뒤 1개/);

    // Marking a correct answer as "헷갈림" drops it to box 1 and makes it due today.
    await page.locator(`[data-action="uncertain"][data-word-id="${await page.evaluate(w => words.findIndex(x => x.word === w), firstWord)}"]`).click();
    stat = await statOf(firstWord);
    assert.equal(stat.box, 1);
    assert.equal(stat.due, localToday());
    assert.equal(stat.unsure, true);
    assert.match(await page.locator('.schedule-note').innerText(), /오늘 다시 1개 · 내일 1개/);

    // That word now shows up as due everywhere.
    await page.locator('#change-words').click();
    assert.equal(await filter('due').innerText(), '복습할 때 1개');
    assert(await filter('due').isEnabled());
    assert.equal(await page.locator('.pick-state.is-due').count(), 0, 'unsure badge outranks the due badge');
    await filter('due').click();
    assert.deepEqual(await page.evaluate(() => [...state.draftIds].map(i => words[i].word)), [firstWord]);
    assert.equal(await plan().innerText(), '오늘의 학습 10개 · 복습 1 · 새 단어 9');

    await page.locator('#back-to-lessons').click();
    assert.match(await page.locator('.library-stats-row').innerText(), /오늘 복습할 단어 1개/);
    assert.equal(await page.locator(`[data-lesson="${LESSON}"] .due-badge`).innerText(), '오늘 복습할 단어 1개');
    await snap(page, { path: path.join(__dirname, 'screenshots', 'leitner-library.png'), fullPage: true });

    // A due date in the past counts as due, and the badge is distinct from 헷갈림/오답.
    await page.evaluate(lesson => {
      const raw = JSON.parse(window.localStorage.getItem('albatross-progress-v1'));
      const stats = raw.stats[lesson];
      stats[Object.keys(stats)[0]].unsure = false;
      for (const key of Object.keys(stats)) { stats[key].due = '2020-01-01'; stats[key].lastResult = true; }
      window.localStorage.setItem('albatross-progress-v1', JSON.stringify(raw));
    }, LESSON);
    await page.reload();
    await openLesson();
    assert.equal(await filter('due').innerText(), '복습할 때 2개');
    assert.equal(await page.locator('.pick-state.is-due').count(), 2);
    assert.equal(await plan().innerText(), '오늘의 학습 10개 · 복습 2 · 새 단어 8');
    await snap(page, { path: path.join(__dirname, 'screenshots', 'leitner-selection.png'), fullPage: true });

    // Boxes climb 1->5 and cap there, with the 30-day interval at the top.
    await page.evaluate(() => setDraftSelection([0]));
    await page.locator('[data-selection-action="start"]').click();
    const word = await page.evaluate(() => words[state.queue[0]].word);
    const expected = [[2, 3], [3, 7], [4, 14], [5, 30], [5, 30]];
    for (const [box, interval] of expected) {
      await answer(true);
      const current = await statOf(word);
      assert.equal(current.box, box, `box after a correct answer (expected ${box})`);
      assert.equal(current.due, plusDays(interval), `due after box ${box}`);
      await page.locator('[data-action="next"]').click();
      await page.locator('[data-action="restart"]').click();
    }
    await answer(false);
    assert.equal((await statOf(word)).box, 1, 'one wrong answer drops straight back to box 1');
    await snap(page, { path: path.join(__dirname, 'screenshots', 'leitner-feedback.png'), fullPage: true });

    // Records saved by step 1 (no box/due fields) are migrated on load.
    await page.evaluate(lesson => {
      window.localStorage.setItem('albatross-progress-v1', JSON.stringify({
        v: 1, sessions: {},
        stats: { [lesson]: { pessimistic: { seen: 2, correct: 2, wrong: 0, unsure: false, lastResult: true, last: '2026-01-01' },
                             implement: { seen: 1, correct: 0, wrong: 1, unsure: false, lastResult: false, last: '2026-01-01' } } }
      }));
    }, LESSON);
    await page.reload();
    const migrated = await page.evaluate(lesson => progress.stats[lesson], LESSON);
    assert.equal(migrated.pessimistic.box, 2, 'a previously correct word starts at box 2');
    assert.equal(migrated.implement.box, 1, 'a previously wrong word starts at box 1');
    assert.equal(migrated.pessimistic.due, localToday());
    await openLesson();
    assert.equal(await filter('due').innerText(), '복습할 때 2개');

    // Mobile layout.
    await page.setViewportSize({ width: 390, height: 844 });
    await snap(page, { path: path.join(__dirname, 'screenshots', 'leitner-selection-390.png'), fullPage: true });

    assert.deepEqual(errors, []);
    console.log('PASS: local-date scheduling, 1/3/7/14/30 box intervals with cap, wrong resets to box 1, 헷갈림 demotes to due-today, due filters and badges, daily plan composition, step-1 record migration.');
  } finally {
    await browser.close();
  }
})();
