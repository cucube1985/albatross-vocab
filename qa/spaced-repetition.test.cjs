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
    // 복습 배지도 카드 설명으로 읽혀요(버튼 자식은 스크린리더에서 평탄화되니까).
    assert.equal(await page.locator(`[data-lesson="${LESSON}"]`).getAttribute('aria-describedby'), `action-${LESSON} mastery-${LESSON} due-${LESSON}`); assert.equal(await page.locator(`#due-${LESSON}`).count(), 1);
    // 헷갈림 표시 1개(1단계)·오답 1개(1단계): 둘 다 '복습 필요'로 세고, 홈 분포는 1단계 2개예요.
    assert.match(await page.locator(`[data-lesson="${LESSON}"] .mastery-text`).innerText(), /굳음 0 · 다지는 중 0 · 복습 필요 2 · 정답률 50%/); assert.match(await page.locator('.library-stats-row').innerText(), /2 \/ 950 단어 학습 · 굳음 0개 · 다지는 중 0개 · 복습 필요 2개/); assert.match(await page.locator('.stage-bar').getAttribute('aria-label'), /미학습 948개, 1단계 2개, 2단계 0개/);
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

    // wordStatus 는 기억 단계만으로 상태를 정해요: 미학습 / 복습 필요(1단계·마지막 오답·헷갈림) / 다지는 중(2~3) / 굳음(4~5).
    assert.deepEqual(await page.evaluate(() => [null, { seen: 0 }, { seen: 1, box: 1, lastResult: true, unsure: false }, { seen: 1, box: 2, lastResult: true, unsure: false }, { seen: 2, box: 3, lastResult: false, unsure: false }, { seen: 2, box: 3, lastResult: true, unsure: true }, { seen: 3, box: 4, lastResult: true, unsure: false }, { seen: 5, box: 5, lastResult: true, unsure: false }].map(wordStatus)), ['unseen', 'unseen', 'review', 'building', 'review', 'review', 'solid', 'solid']);

    // 단계 1..5 를 하나씩 심으면 수업 카드·홈 분포·레벨 버튼이 모두 같은 분포를 보여요.
    const five = await page.evaluate(id => lessons.find(l => l.id === id).words.slice(0, 5).map(w => w.word), LESSON);
    await page.evaluate(([lesson, names]) => { const stats = {}; names.forEach((word, i) => { const box = i + 1; stats[word] = { seen: box, correct: box, wrong: 0, unsure: false, lastResult: true, last: '2026-01-01', box, due: '2099-01-01' }; }); window.localStorage.setItem('albatross-progress-v1', JSON.stringify({ v: 1, sessions: {}, stats: { [lesson]: stats } })); }, [LESSON, five]);
    await page.reload();
    const st = await page.evaluate(id => lessonStats(lessons.find(l => l.id === id)), LESSON);
    assert.deepEqual(st.boxes, [35, 1, 1, 1, 1, 1]); assert.equal(st.solid, 2); assert.equal(st.building, 2); assert.equal(st.review, 1); assert.equal(st.studied, 5); assert.equal(st.due, 0); assert.equal(st.accuracy, 100); assert.equal(st.mastered, undefined);
    assert.match(await page.locator('.library-stats-row').innerText(), /5 \/ 950 단어 학습 · 굳음 2개 · 다지는 중 2개 · 복습 필요 1개 · 정답률 100%/); assert.equal(await page.locator('.stage-headline').innerText(), '장기 기억(4~5단계) 2 / 950');
    assert.deepEqual(await page.locator('.stage-legend li').allInnerTexts(), ['미학습 945', '1단계 1', '2단계 1', '3단계 1', '4단계 1', '5단계 1']); assert.deepEqual(await page.locator('.stage-bar i').evaluateAll(els => els.map(e => e.className)), ['stage-0', 'stage-1', 'stage-2', 'stage-3', 'stage-4', 'stage-5']); assert.equal(await page.locator('.stage-bar').getAttribute('aria-label'), '950개 단어의 기억 단계: 미학습 945개, 1단계 1개, 2단계 1개, 3단계 1개, 4단계 1개, 5단계 1개');
    await page.evaluate(() => chooseLevel('C2'));
    assert.deepEqual(await page.locator(`[data-lesson="${LESSON}"] .mastery-bar i`).evaluateAll(els => els.map(e => e.className)), ['is-mastered', 'is-building', 'is-review', 'is-unseen']); assert.match(await page.locator(`[data-lesson="${LESSON}"] .mastery-text`).innerText(), /굳음 2 · 다지는 중 2 · 복습 필요 1 · 정답률 100%/); assert.equal(await page.locator(`[data-lesson="${LESSON}"] .due-badge`).count(), 0); assert.equal(await page.locator('.mastery.is-empty').count(), 9);
    assert.equal(await page.locator('.level-button[data-level="C2"] .level-bar i:not(.is-unseen)').count(), 3); assert.equal(await page.locator('.level-button[data-level="C1"] .level-bar i:not(.is-unseen)').count(), 0); assert.match(await page.locator('.level-button[data-level="C2"]').textContent(), /수업 10개 · 단어 400개.*굳음 2개, 다지는 중 2개, 복습 필요 1개/s); assert.match(await page.locator('.level-button[data-level="C1"]').textContent(), /수업 11개 · 단어 550개/); assert.doesNotMatch(await page.locator('.level-button[data-level="C1"]').textContent(), /굳음/);
    // 눌린(초록 바탕) 레벨 버튼에서는 굳음 칸이 글자색으로 뒤집혀 배경에 묻히지 않아요.
    const pressed = await page.evaluate(() => { const button = document.querySelector('.level-button[aria-pressed="true"]'); const solid = button.querySelector('.level-bar .is-mastered'); return { fill: getComputedStyle(solid).backgroundColor, text: getComputedStyle(button).color, bg: getComputedStyle(button).backgroundColor }; }); assert.equal(pressed.fill, pressed.text); assert.notEqual(pressed.fill, pressed.bg);
    await openLesson(); // 이어지는 390px 스크린샷이 선택 화면 기준이라 돌아가요.

    // Mobile layout.
    await page.setViewportSize({ width: 390, height: 844 });
    await snap(page, { path: path.join(__dirname, 'screenshots', 'leitner-selection-390.png'), fullPage: true });

    assert.deepEqual(errors, []);
    console.log('PASS: local-date scheduling, 1/3/7/14/30 box intervals with cap, wrong resets to box 1, 헷갈림 demotes to due-today, due filters and badges, daily plan composition, step-1 record migration.');
  } finally {
    await browser.close();
  }
})();
