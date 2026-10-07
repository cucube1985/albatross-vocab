const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snap = (page, options) => process.env.QA_SCREENSHOTS ? (fs.mkdirSync(path.dirname(options.path), { recursive: true }), page.screenshot(options)) : Promise.resolve(); // 스크린샷은 QA_SCREENSHOTS=1 일 때만 qa/screenshots/ 에 남겨요.
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const pageURL = pathToFileURL(path.join(root, 'albatross-c2-lesson-03.html')).href;
const LESSON = 'albatross-c2-lesson-03';
const SUMMARY_TEXT = '어원 · 동의어 · 반대어 보기';

// 모바일 피드백 화면: 760px 이하에서 '다음 단어' 줄이 화면 아래에 붙고(요약 카드는 제외), 어원·관계어는 <details class="deep-dive"> 로 접혀요.
// 기본 'en' 방식 그대로, 자동 읽기·효과음은 꺼 두어 음성 스텁 없이도 조용히 돌아요(lessons-c2-06-08 과 같은 방식).
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    // 각 구간은 새 페이지(=새 컨텍스트)에서 시작하므로 deepDiveOpen 과 localStorage 가 서로 섞이지 않아요.
    const open = async options => {
      const page = await browser.newPage(options);
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => localStorage.setItem('albatross-sound', JSON.stringify({ autoRead: false, effects: false })));
      const answer = async correct => {
        const i = await page.evaluate(want => state.options.findIndex(o => o.correct === want), correct);
        await page.locator(`[data-choice="${i}"]`).click();
      };
      const study = async ids => {
        await page.goto(pageURL);
        await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON);
        await page.locator(`[data-lesson="${LESSON}"]`).click();
        await page.evaluate(list => setDraftSelection(list), ids);
        await page.locator('[data-selection-action="start"]').click();
      };
      const next = () => page.locator('[data-action="next"]').click();
      const bar = () => page.evaluate(() => { const s = getComputedStyle(document.querySelector('.feedback-card > .actions')); return { position: s.position, bottom: s.bottom, borderTopWidth: s.borderTopWidth, backgroundColor: s.backgroundColor }; });
      const cardBackground = () => page.evaluate(() => getComputedStyle(document.querySelector('.feedback-card')).backgroundColor);
      const bodyBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const isOpen = () => page.evaluate(() => document.querySelector('.deep-dive').open);
      const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      // 브라우저는 <details open> 을 넣은 직후 toggle 을 따로 큐에 넣으므로, 그 이벤트가 처리된 뒤에 deepDiveOpen 을 읽어요.
      const settled = () => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
      return { page, errors, answer, study, next, bar, cardBackground, bodyBackground, isOpen, noOverflow, settled };
    };

    // --- 데스크톱(1440): 접기 항목은 펼쳐진 채로, 버튼 줄은 카드 흐름 안에 그대로.
    {
      const t = await open({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      const { page } = t;
      await t.study([0, 1, 2, 3]);
      assert.equal(await page.locator('.question-card .shortcut').isVisible(), true, 'a fine pointer keeps the 1–4 / S hint');
      await t.answer(true);
      await t.settled();
      assert.equal(await page.locator('details.deep-dive').count(), 1);
      assert.equal(await t.isOpen(), true, 'open on desktop');
      assert.equal(await page.evaluate(() => deepDiveOpen), null, 'the toggle Chromium fires for an initially-open details must not be remembered');
      assert.equal(await page.evaluate(() => ['.origin', '.relations', '.relation-note'].every(s => document.querySelector('.deep-dive ' + s))), true, 'origin / relations / relation-note live inside the details');
      assert.equal(await page.evaluate(() => ['.next-review', '.confidence-box', '.example', '.source', '.actions', '.keyboard-hint'].some(s => document.querySelector('.deep-dive ' + s))), false, 'everything else stays outside the details');
      assert.equal(await page.locator('.origin p').isVisible(), true);
      assert.equal(await page.evaluate(() => document.querySelector('.origin p').textContent), await page.evaluate(() => currentWord().origin));
      assert.equal(await page.locator('.deep-dive > summary').innerText(), SUMMARY_TEXT);
      assert.equal(await page.locator('.keyboard-hint').isVisible(), true);
      assert.equal((await t.bar()).position, 'static', 'the desktop bar stays in flow');
      assert.equal(await page.locator('[data-action="next"]').count(), 1);
      await snap(page, { path: path.join(__dirname, 'screenshots', 'feedback-mobile-desktop.png'), fullPage: true });
      // 한 번 닫으면 다음 카드부터 닫힌 채로, 다시 열면 열린 채로 그려져요.
      await page.locator('.deep-dive > summary').click();
      assert.equal(await t.isOpen(), false);
      await page.waitForFunction(() => deepDiveOpen === false);
      await t.next();
      await t.answer(true);
      await t.settled();
      assert.equal(await t.isOpen(), false, 'remembered closed');
      await page.locator('.deep-dive > summary').click();
      assert.equal(await t.isOpen(), true);
      await page.waitForFunction(() => deepDiveOpen === true);
      await t.next();
      await t.answer(true);
      await t.settled();
      assert.equal(await t.isOpen(), true, 'remembered open');
      // 틀린 카드에는 어원·관계어 자체가 없으니 접기 항목도 없어요.
      await t.next();
      await t.answer(false);
      assert.equal(await page.locator('details.deep-dive').count(), 0);
      assert.equal(await page.locator('.your-answer').count(), 1);
      assert.equal(await page.locator('.feedback-card.is-wrong').count(), 1);
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // --- 폰 너비(390, 마우스 포인터): 버튼 줄이 화면 아래에 붙고, 접기 항목은 닫힌 채로 시작해요.
    {
      const t = await open({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const { page } = t;
      await t.study([0, 1, 2, 3]);
      assert.equal(await page.locator('.question-card .shortcut').isVisible(), true, 'a narrow window with a fine pointer still shows the hint');
      await page.keyboard.press(String(await page.evaluate(() => state.options.findIndex(o => o.correct) + 1)));
      await page.waitForFunction(() => state.phase === 'feedback');
      const scrollAfterRender = await page.evaluate(() => window.scrollY);
      const pinned = await t.bar();
      assert.equal(pinned.position, 'sticky');
      assert.equal(pinned.bottom, '0px');
      assert.equal(pinned.borderTopWidth, '1px');
      assert.equal(pinned.backgroundColor, await t.cardBackground(), 'the bar uses the card surface token');
      assert.notEqual(pinned.backgroundColor, 'rgba(0, 0, 0, 0)', 'the bar is opaque');
      assert.equal(await page.locator('[data-action="next"]').count(), 1);
      assert.equal(await page.locator('[data-action="next"]').isVisible(), true);
      const box = await page.locator('[data-action="next"]').boundingBox();
      assert(box && box.y >= 0 && box.y + box.height <= 844, `next button pinned inside the viewport without scrolling (y=${box && box.y}, h=${box && box.height})`);
      assert.equal(await page.evaluate(() => window.scrollY), scrollAfterRender, 'the test performed no programmatic scroll');
      assert.equal(await t.noOverflow(), true, 'no horizontal overflow at 390');
      assert.equal(await page.locator('.deep-dive').count(), 1);
      await t.settled();
      assert.equal(await t.isOpen(), false, 'collapsed by default on phones');
      assert.equal(await page.locator('.origin').isVisible(), false);
      assert.equal(await page.evaluate(() => document.querySelector('.origin p').textContent), await page.evaluate(() => currentWord().origin), 'the content is in the DOM, just collapsed');
      await snap(page, { path: path.join(__dirname, 'screenshots', 'feedback-mobile-390.png') });
      // Tab 으로 초점을 옮겨도 카드 안의 버튼·접기 제목이 붙어 있는 버튼 줄 아래에 숨지 않아요(scroll-margin-bottom). 마지막 Tab 은 붙어 있는 '다음 단어' 버튼에 닿아요.
      const focusedStop = () => page.evaluate(() => { const el = document.activeElement, r = el.getBoundingClientRect(), bar = document.querySelector('.feedback-card > .actions').getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { desc: el.dataset.speak || el.dataset.action || el.tagName, inBar: !!el.closest('.feedback-card > .actions'), clear: r.top >= 0 && r.bottom <= bar.top, hitSelf: el === hit || el.contains(hit) }; });
      const stops = [];
      for (let k = 0; k < 8; k++) {
        await page.keyboard.press('Tab');
        const f = await focusedStop();
        if (f.inBar) break;
        stops.push(f.desc);
        assert.equal(f.clear && f.hitSelf, true, `Tab stop ${f.desc} is fully above the pinned bar and receives the pointer`);
      }
      assert.deepEqual(stops, ['uncertain', 'SUMMARY', 'word', 'example', 'SUMMARY'], 'the Tab order inside the card is unchanged');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'next', 'Tab reaches the pinned next button');
      // 접기 제목을 화면 가운데로 옮긴 뒤 눌러요(붙어 있는 버튼 줄 아래로 들어가지 않게).
      await page.evaluate(() => document.querySelector('.deep-dive > summary').scrollIntoView({ block: 'center' }));
      await page.locator('.deep-dive > summary').click();
      assert.equal(await t.isOpen(), true);
      assert.equal(await page.locator('.origin').isVisible(), true);
      await page.waitForFunction(() => deepDiveOpen === true);
      assert.equal(await t.noOverflow(), true, 'an open details does not overflow');
      await snap(page, { path: path.join(__dirname, 'screenshots', 'feedback-mobile-390-open.png'), fullPage: true });
      // 붙어 있는 버튼 줄이어도 → 키는 그대로 동작해요.
      const cursorBefore = await page.evaluate(() => state.cursor);
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => state.phase), 'question');
      assert.equal(await page.evaluate(() => state.cursor), cursorBefore + 1);
      await t.answer(true);
      await t.settled();
      assert.equal(await t.isOpen(), true, 'remembered open on the next card');
      assert.equal((await t.bar()).position, 'sticky');
      await t.next();
      await t.answer(false);
      assert.equal(await page.locator('.deep-dive').count(), 0);
      assert.equal(await page.locator('.your-answer').count(), 1);
      assert.equal((await t.bar()).position, 'sticky', 'the bar applies to wrong cards too');
      // 요약 카드의 버튼 줄은 붙지 않아요.
      await t.next();
      await t.answer(true);
      await t.next();
      assert.equal(await page.locator('.summary-title').count(), 1);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.study-card:not(.feedback-card) .actions')).position), 'static', 'summary card actions are not sticky');
      assert((await page.locator('[data-action="review"], [data-action="restart"]').count()) >= 1);
      // 320px 에서도 기억한 선택(열림)대로 그려지고 가로 넘침이 없어요.
      await page.setViewportSize({ width: 320, height: 844 });
      await page.locator('[data-action="restart"]').click();
      await t.answer(true);
      await t.settled();
      assert.equal(await t.isOpen(), true, 'remembered open at 320');
      assert.equal((await t.bar()).position, 'sticky');
      assert.equal(await t.noOverflow(), true, 'no horizontal overflow at 320');
      await snap(page, { path: path.join(__dirname, 'screenshots', 'feedback-mobile-320.png'), fullPage: true });
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // --- 터치 기기(pointer:coarse): 키보드 전용 안내는 숨고, 단축키는 그대로 동작해요.
    {
      const t = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
      const { page } = t;
      await t.study([0, 1]);
      const coarse = await page.evaluate(() => matchMedia('(pointer:coarse)').matches);
      if (coarse) {
        assert.equal(await page.locator('.question-card .shortcut').isVisible(), false, 'touch devices hide the 1–4 / S hint');
        await t.answer(true);
        assert.equal(await page.locator('.keyboard-hint').isVisible(), false, 'touch devices hide the → hint');
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('.relation-note')].some(el => el.textContent.includes('오른쪽 방향키'))), true, 'the hint is only hidden, still in the DOM');
      } else {
        console.log('note: mobile emulation did not report pointer:coarse — checking the fine-pointer fallback instead');
        await t.answer(true);
        assert.equal(await page.locator('.keyboard-hint').isVisible(), true);
      }
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => state.phase), 'question', '→ still advances whether or not the hint is shown');
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // --- 어두운 테마(자동 + 수동): 붙어 있는 버튼 줄은 카드와 같은 불투명한 바탕색이에요.
    {
      const check = async (t, label) => {
        await t.answer(true);
        const pinned = await t.bar();
        assert.equal(pinned.position, 'sticky', `${label}: sticky at 390`);
        assert.equal(pinned.backgroundColor, await t.cardBackground(), `${label}: the bar uses the card surface`);
        assert.notEqual(pinned.backgroundColor, await t.bodyBackground(), `${label}: the bar is distinct from the page background`);
        assert.equal(pinned.backgroundColor, 'rgb(17, 16, 14)', `${label}: --neutral-020 dark value`);
        assert.deepEqual(t.errors, []);
        await t.page.close();
      };
      const auto = await open({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' });
      await auto.study([0]);
      await snap(auto.page, { path: path.join(__dirname, 'screenshots', 'feedback-mobile-390-dark-question.png') });
      await check(auto, 'prefers-color-scheme dark');
      const manual = await open({ viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' });
      await manual.study([0]);
      await manual.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await check(manual, 'data-theme dark');
    }

    console.log('PASS: sticky next-bar on phones (opaque, top border, pinned without scrolling, static on desktop and on the summary card, no overflow at 390/320), 어원·관계어 details collapsed on phones / open on desktop with session memory via toggle delegation, wrong cards unchanged, keyboard → still advances, keyboard hints hidden on coarse pointers, bar opaque in both dark palettes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
