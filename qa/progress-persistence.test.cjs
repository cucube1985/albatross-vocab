const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snap = (page, options) => process.env.QA_SCREENSHOTS ? (fs.mkdirSync(path.dirname(options.path), { recursive: true }), page.screenshot(options)) : Promise.resolve(); // 스크린샷은 QA_SCREENSHOTS=1 일 때만 qa/screenshots/ 에 남겨요.
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const pageURL = pathToFileURL(path.join(root, 'albatross-c2-lesson-03.html')).href;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.accept());

    const answer = async correct => {
      const index = await page.evaluate(want => state.options.findIndex(o => o.correct === want), correct);
      await page.locator(`[data-choice="${index}"]`).click();
    };
    const filter = kind => page.locator(`[data-selection-action="filter"][data-filter="${kind}"]`);

    await page.goto(pageURL);

    // localStorage must be usable from file:// — otherwise the whole feature silently degrades.
    assert.equal(await page.locator('.storage-warning').count(), 0, 'localStorage unavailable on file://');
    assert.match(await page.locator('.library-stats-row').innerText(), /0 \/ 950 단어 학습/);
    assert(await page.locator('#reset-progress').isDisabled());
    await page.evaluate(() => chooseLevel('C2')); assert.equal(await page.locator('.mastery.is-empty').count(), 10);
    // 기록이 없을 때: 홈 분포 막대는 미학습 칸 하나, 레벨 막대는 빈 트랙, sr-only 숫자 없음.
    assert.match(await page.locator('.stage-headline').innerText(), /장기 기억\(4~5단계\) 0 \/ 950/);
    assert.equal(await page.locator('.stage-bar').getAttribute('aria-label'), '950개 단어의 기억 단계: 미학습 950개, 1단계 0개, 2단계 0개, 3단계 0개, 4단계 0개, 5단계 0개');
    assert.equal(await page.locator('.stage-bar i').count(), 1); assert.equal(await page.locator('.stage-bar i.stage-0').count(), 1);
    assert.equal(await page.locator('.level-bar').count(), 2); assert.equal(await page.locator('.level-bar i:not(.is-unseen)').count(), 0); assert.equal(await page.locator('.level-button .sr-only').count(), 0);

    // Filters start out empty except "안 푼 단어".
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), "albatross-c2-lesson-03").then(() => page.locator('[data-lesson="albatross-c2-lesson-03"]').click());
    assert.equal(await filter('new').innerText(), '안 푼 단어 40개');
    assert(await filter('wrong').isDisabled());
    assert(await filter('unsure').isDisabled());
    assert.equal(await page.locator('.pick-state.is-new').count(), 40);

    // Search filters the grid and retargets 전체 선택 at what is visible.
    await page.locator('#selection-search-input').fill('pess');
    assert.equal(await page.locator('.word-pick:not([hidden])').count(), 1);
    assert.equal(await page.locator('#selection-search-count').innerText(), '1 / 40개 표시');
    assert.equal(await page.locator('[data-selection-action="all"]').innerText(), '표시된 1개 선택');
    await page.locator('#selection-search-input').fill('비관');
    assert.equal(await page.locator('.word-pick:not([hidden])').count(), 1, 'korean meaning is searchable');
    await page.locator('#selection-search-input').fill('zzz');
    assert.equal(await page.locator('#selection-search-empty').isHidden(), false);
    await page.locator('#selection-search-input').press('Escape');
    assert.equal(await page.locator('.word-pick:not([hidden])').count(), 40);
    assert.equal(await page.locator('[data-selection-action="all"]').innerText(), '전체 선택');

    // Study two words: first wrong, second correct.
    await page.evaluate(() => setDraftSelection([0, 1]));
    await page.locator('[data-selection-action="start"]').click();
    await answer(false);
    await page.locator('[data-action="next"]').click();
    await answer(true);
    const firstWord = await page.evaluate(() => words[state.answers[0].id].word);
    await page.locator('[data-action="next"]').click();
    assert.equal(await page.locator('.summary-title').count(), 1);

    // Reload: long-term stats and the in-progress session both survive.
    await page.reload();
    await page.evaluate(() => chooseLevel('C2'));
    const libraryText = await page.locator('.library-stats-row').innerText();
    assert.match(libraryText, /2 \/ 950 단어 학습/);
    assert.match(libraryText, /굳음 0개 · 다지는 중 1개 · 복습 필요 1개 · 정답률 50%/);
    assert.match(await page.locator('[data-lesson="albatross-c2-lesson-03"] .mastery-text').innerText(), /굳음 0 · 다지는 중 1 · 복습 필요 1 · 정답률 50%/);
    // 오답 1개(1단계)·정답 1개(2단계): 홈 분포·수업 카드·레벨 버튼 세 곳이 같은 숫자를 보여요.
    assert.match(await page.locator('.stage-headline').innerText(), /0 \/ 950/); assert.match(await page.locator('.stage-bar').getAttribute('aria-label'), /미학습 948개, 1단계 1개, 2단계 1개, 3단계 0개, 4단계 0개, 5단계 0개/);
    assert.deepEqual(await page.locator('.stage-bar i').evaluateAll(els => els.map(e => e.className)), ['stage-0', 'stage-1', 'stage-2']); const legend = await page.locator('.stage-legend').innerText(); assert.match(legend, /1단계 1/); assert.match(legend, /2단계 1/);
    assert.deepEqual(await page.locator('[data-lesson="albatross-c2-lesson-03"] .mastery-bar i').evaluateAll(els => els.map(e => e.className)), ['is-building', 'is-review', 'is-unseen']); assert.equal(await page.locator('[data-lesson="albatross-c2-lesson-03"] .mastery-bar').getAttribute('aria-label'), '40개 중 굳음 0개, 다지는 중 1개, 복습 필요 1개, 미학습 38개');
    assert.equal(await page.locator('[data-lesson="albatross-c2-lesson-03"]').getAttribute('aria-describedby'), 'action-albatross-c2-lesson-03 mastery-albatross-c2-lesson-03'); assert.equal(await page.locator('#mastery-albatross-c2-lesson-03').count(), 1); assert.equal(await page.locator('[data-lesson="albatross-c2-lesson-04"]').getAttribute('aria-describedby'), 'action-albatross-c2-lesson-04');
    assert.equal(await page.locator('.level-button[data-level="C2"] .level-bar i:not(.is-unseen)').count(), 2); assert.match(await page.locator('.level-button[data-level="C2"]').textContent(), /굳음 0개, 다지는 중 1개, 복습 필요 1개/); assert.equal(await page.locator('.level-button[data-level="C1"] .sr-only').count(), 0);
    assert.equal(await page.locator('[data-lesson="albatross-c2-lesson-03"] .lesson-card-action').innerText(), '이어서 학습할 단어 선택');

    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), "albatross-c2-lesson-03").then(() => page.locator('[data-lesson="albatross-c2-lesson-03"]').click());
    assert.equal(await page.locator('.selection-resume').count(), 1, 'session survived reload');
    assert.match(await page.locator('.selection-resume strong').innerText(), /이전 학습 결과가 있어요/);
    assert.equal(await filter('new').innerText(), '안 푼 단어 38개');
    assert.equal(await filter('wrong').innerText(), '틀렸던 단어 1개');
    assert(await filter('wrong').isEnabled());
    assert.equal(await page.locator('.pick-state.is-wrong').count(), 1);
    assert.equal(await page.locator('.pick-state.is-ok').count(), 1);

    // The 틀렸던 단어 filter selects exactly the word that was missed.
    await filter('wrong').click();
    assert.deepEqual(await page.evaluate(() => [...state.draftIds].map(i => words[i].word)), [firstWord]);
    assert.equal(await filter('wrong').getAttribute('aria-pressed'), 'true');

    // Resuming the saved summary still works after a reload.
    await page.locator('[data-selection-action="resume"]').click();
    assert.equal(await page.locator('.summary-title').count(), 1);
    await snap(page, { path: path.join(__dirname, 'screenshots', 'persistence-summary.png'), fullPage: true });

    await page.locator('#back-to-lessons').click();
    await snap(page, { path: path.join(__dirname, 'screenshots', 'persistence-library.png'), fullPage: true });
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), "albatross-c2-lesson-03").then(() => page.locator('[data-lesson="albatross-c2-lesson-03"]').click());
    await snap(page, { path: path.join(__dirname, 'screenshots', 'persistence-selection.png'), fullPage: true });

    // Reset wipes both stats and sessions, and survives a reload.
    await page.locator('#back-to-lessons').click();
    await page.locator('#reset-progress').click();
    assert.match(await page.locator('.library-stats-row').innerText(), /0 \/ 950 단어 학습/);
    assert.match(await page.locator('.stage-headline').innerText(), /0 \/ 950/); assert.equal(await page.locator('.stage-bar i').count(), 1); // 초기화 뒤 분포 막대도 트랙만 남아요.
    await page.reload();
    assert.match(await page.locator('.library-stats-row').innerText(), /0 \/ 950 단어 학습/);
    await page.evaluate(() => chooseLevel('C2')); assert.equal(await page.locator('.mastery.is-empty').count(), 10);
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), "albatross-c2-lesson-03").then(() => page.locator('[data-lesson="albatross-c2-lesson-03"]').click());
    assert.equal(await page.locator('.selection-resume').count(), 0, 'reset cleared the saved session');

    // Corrupt storage must not break the page.
    await page.evaluate(() => window.localStorage.setItem('albatross-progress-v1', '{ not json'));
    await page.reload();
    assert.match(await page.locator('.library-stats-row').innerText(), /0 \/ 950 단어 학습/);

    // A saved session pointing past the end of a lesson is discarded, not crashed on.
    await page.evaluate(() => window.localStorage.setItem('albatross-progress-v1', JSON.stringify({
      v: 1, stats: {}, sessions: { 'albatross-c2-lesson-03': { studyIds: [999], queue: [999], phase: 'question', cursor: 0, answers: [], history: [], unsure: [], draftIds: [999], options: [], review: false, selected: null } }
    })));
    await page.reload();
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), "albatross-c2-lesson-03").then(() => page.locator('[data-lesson="albatross-c2-lesson-03"]').click());
    assert.equal(await page.locator('.selection-resume').count(), 0, 'out-of-range session discarded');
    assert.deepEqual(await page.evaluate(() => [...state.draftIds]), []);

    // Mobile layout still renders the new blocks.
    await page.setViewportSize({ width: 390, height: 844 });
    await snap(page, { path: path.join(__dirname, 'screenshots', 'persistence-selection-390.png'), fullPage: true });
    await page.locator('#back-to-lessons').click();
    await snap(page, { path: path.join(__dirname, 'screenshots', 'persistence-library-390.png'), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'library overflow at 390');

    assert.deepEqual(errors, []);
    console.log('PASS: file:// storage, mastery bars, filters, search, session resume across reload, reset, corrupt/stale data recovery.');
  } finally {
    await browser.close();
  }
})();
