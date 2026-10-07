const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snap = (page, options) => process.env.QA_SCREENSHOTS ? (fs.mkdirSync(path.dirname(options.path), { recursive: true }), page.screenshot(options)) : Promise.resolve(); // 스크린샷은 QA_SCREENSHOTS=1 일 때만 qa/screenshots/ 에 남겨요.
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const pageURL = pathToFileURL(path.join(root, 'albatross-c2-lesson-03.html')).href;
const LESSON = 'albatross-c2-lesson-03';

const channel = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const rgb = s => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
const contrast = (a, b) => { const [hi, lo] = [channel(rgb(a)), channel(rgb(b))].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const PROBE = sel => {
  const el = document.querySelector(sel);
  if (!el) return null;
  let node = el, bg = getComputedStyle(el).backgroundColor;
  while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) { node = node.parentElement; if (node) bg = getComputedStyle(node).backgroundColor; }
  return { fg: getComputedStyle(el).color, bg };
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: scheme, reducedMotion: 'reduce' });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', d => d.accept());
      const answer = async correct => {
        const i = await page.evaluate(want => state.options.findIndex(o => o.correct === want), correct);
        await page.locator(`[data-choice="${i}"]`).click();
      };
      const tag = scheme === 'dark' ? '-dark' : '';

      await page.goto(pageURL);

      // 페이지 바탕이 실제로 그 테마의 밝기를 따라야 한다.
      const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const bodyFg = await page.evaluate(() => getComputedStyle(document.body).color);
      const bright = channel(rgb(bodyBg));
      if (scheme === 'dark') assert(bright < 0.05, `dark bg too bright: ${bodyBg}`);
      else assert(bright > 0.8, `light bg too dark: ${bodyBg}`);
      assert(contrast(bodyFg, bodyBg) > 7, `body contrast ${contrast(bodyFg, bodyBg).toFixed(2)}`);

      await page.evaluate(() => chooseLevel('C2')); // 카드는 레벨을 고른 뒤에 나온다
      // 주요 표면·글자 조합이 모두 본문 기준(4.5:1) 위에 있어야 한다.
      for (const sel of ['.level-button', '.level-hint']) { const probe = await page.evaluate(PROBE, sel); assert(probe && contrast(probe.fg, probe.bg) >= 4.5, `${scheme} ${sel} contrast`); }
      for (const sel of ['.lesson-card-title', '.lesson-card-count', '.lesson-words span', '.library-stats-row', '.library-stats-note', '.theme-toggle', '.library-intro', '.stage-headline', '.stage-legend']) {
        const probe = await page.evaluate(PROBE, sel);
        assert(probe, `missing ${sel}`);
        const value = contrast(probe.fg, probe.bg);
        assert(value >= 4.5, `${scheme} ${sel}: ${value.toFixed(2)}:1`);
      }
      // 기억 단계 램프(1~5단계)는 카드 바탕과 1.4:1 이상 떨어지고 이웃 칸과 색이 달라야 해요. 미학습 견본은 테두리로 보여요.
      const chartBg = await page.evaluate(() => getComputedStyle(document.querySelector('.stage-chart')).backgroundColor);
      const swatches = await page.evaluate(() => [1, 2, 3, 4, 5].map(n => getComputedStyle(document.querySelector(`.stage-legend .stage-dot.stage-${n}`)).backgroundColor));
      swatches.forEach((color, i) => { assert(contrast(color, chartBg) > 1.4, `${scheme} stage-${i + 1} swatch vs card`); if (i) assert.notEqual(color, swatches[i - 1], `${scheme} stage-${i}/stage-${i + 1} must differ`); });
      assert.equal(await page.locator('.stage-bar i').count(), 1, 'fresh page shows only the unseen track'); assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.stage-legend .stage-dot.stage-0')).borderTopColor), chartBg, 'unseen swatch keeps a visible border');
      // 브라우저 상단 바 색(theme-color)이 실제 페이지 배경과 같아야 한다.
      assert.equal(await page.evaluate(() => document.getElementById('theme-color').content), bodyBg, `theme-color must match the ${scheme} background`);

      // 카드는 페이지 바탕과 구분돼야 한다(다크에서 카드가 배경에 묻히면 안 됨).
      const cardBg = await page.evaluate(() => getComputedStyle(document.querySelector('.lesson-card')).backgroundColor);
      assert.notEqual(cardBg, bodyBg, 'card surface must differ from the page');
      if (scheme === 'dark') assert(channel(rgb(cardBg)) > channel(rgb(bodyBg)), 'dark cards must sit above the page');
      // 눌린 레벨 버튼(초록 바탕)에서는 굳음 칸이 글자색으로, 트랙은 테두리만 남아야 해요(light/dark 모두).
      await page.evaluate(id => { const lesson = lessons.find(l => l.id === id); progress.stats[id] = { [lesson.words[0].word]: { seen: 5, correct: 5, wrong: 0, unsure: false, lastResult: true, last: '2026-01-01', box: 5, due: '2099-01-01' } }; chooseLevel('C2'); }, LESSON);
      const pressed = await page.evaluate(() => { const button = document.querySelector('.level-button[aria-pressed="true"]'); return { fill: getComputedStyle(button.querySelector('.level-bar .is-mastered')).backgroundColor, text: getComputedStyle(button).color, bg: getComputedStyle(button).backgroundColor, track: getComputedStyle(button.querySelector('.level-bar')).backgroundColor }; });
      assert.equal(pressed.fill, pressed.text, `${scheme} pressed level: solid segment uses the button text colour`); assert.notEqual(pressed.fill, pressed.bg); assert.equal(pressed.track, 'rgba(0, 0, 0, 0)', 'pressed track is outlined, not filled');
      await page.evaluate(() => { progress.stats = {}; chooseLevel('C2'); }); assert.equal(await page.locator('.mastery.is-empty').count(), 10); // 이후 40단어 학습 흐름은 기록 없는 상태에서 시작해요.
      await snap(page, { path: path.join(__dirname, 'screenshots', `visuals-library${tag}.png`), fullPage: true });

      // --- 단어 스트립: 숨어 있던 사이드바 목록이 학습 화면에 가로로 살아 있어야 한다.
      await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => page.locator(`[data-lesson="${LESSON}"]`).click());
      await page.evaluate(() => setDraftSelection(words.map((_, i) => i)));
      await page.locator('[data-selection-action="start"]').click();
      const strip = page.locator('#word-list');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.word-index')).display), 'block', 'word index must be visible during study');
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('word-list')).display), 'flex');
      assert.equal(await strip.locator('li').count(), 40);
      // 가로 한 줄이어야 한다: 첫 칩과 마지막 칩의 세로 위치가 같다.
      const rows = await page.evaluate(() => { const li = [...document.querySelectorAll('#word-list li')]; return [li[0].offsetTop, li[li.length - 1].offsetTop]; });
      assert.equal(rows[0], rows[1], 'strip must be a single row');
      assert.equal(await page.evaluate(() => document.getElementById('word-list').getAttribute('tabindex')), '0', 'an overflowing strip must be reachable by keyboard');

      for (let i = 0; i < 12; i++) { await answer(i % 3 !== 0); await page.locator('[data-action="next"]').click(); }

      // 큐는 무작위라, 목록 맨 끝 단어를 현재 문제로 만들어 스크롤이 따라오는지 확정적으로 본다.
      const scrolled = await page.evaluate(() => {
        state.cursor = state.queue.indexOf(state.studyIds[state.studyIds.length - 1]);
        renderQuestion(false);
        const list = document.getElementById('word-list'), active = list.querySelector('.active');
        const offset = active.getBoundingClientRect().left - list.getBoundingClientRect().left;
        return { scrollLeft: list.scrollLeft, overflow: list.scrollWidth - list.clientWidth, visible: offset >= -1 && offset + active.offsetWidth <= list.clientWidth + 1 };
      });
      assert(scrolled.overflow > 0, 'the 40-word strip must overflow');
      assert(scrolled.scrollLeft > 0, 'strip should have scrolled to follow the last word');
      assert(scrolled.visible, 'current word chip must be inside the visible strip');
      await snap(page, { path: path.join(__dirname, 'screenshots', `visuals-question${tag}.png`), fullPage: true });

      // --- 결과 화면 시각화
      await page.evaluate(() => { state.cursor = state.queue.length - 1; renderQuestion(); });
      await answer(true);
      await page.locator('[data-action="next"]').click();
      const expectedPercent = await page.evaluate(() => Math.round(state.answers.filter(a => a.correct).length / state.queue.length * 100));
      assert.equal(await page.evaluate(() => document.querySelector('.donut-label').textContent), `${expectedPercent}%`);
      assert.equal(await page.locator('.donut').count(), 1);
      const donutStroke = await page.evaluate(() => getComputedStyle(document.querySelector('.donut-value')).stroke);
      const donutTrack = await page.evaluate(() => getComputedStyle(document.querySelector('.donut-track')).stroke);
      assert.notEqual(donutStroke, donutTrack, 'donut value and track must be distinguishable');
      assert(contrast(donutStroke, donutTrack) > 1.4, 'donut value/track contrast too low');

      const weak = page.locator('.weak-list li');
      assert(await weak.count() > 0 && await weak.count() <= 5, 'weak word list holds 1-5 entries');
      const rates = await page.locator('.weak-rate b').allInnerTexts();
      const numbers = rates.map(r => Number(r.replace('%', '')));
      assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), 'weak words must be sorted by accuracy ascending');
      await snap(page, { path: path.join(__dirname, 'screenshots', `visuals-summary${tag}.png`), fullPage: true });

      assert.deepEqual(errors, []);
      await page.close();
    }

    // --- 테마 토글: 자동 -> 밝게 -> 어둡게 -> 자동, 새로고침 후에도 유지.
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
    page.setDefaultTimeout(5000);
    const toggle = page.locator('#theme-toggle');
    const themeAttr = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const bodyBright = async () => channel(rgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)));

    await page.goto(pageURL);
    assert.equal((await toggle.innerText()).replace(/\s+/g, ' '), '◐ 자동');
    assert.equal(await themeAttr(), null, 'auto must not pin data-theme');
    assert(await bodyBright() < 0.05, 'auto follows the OS dark preference');

    const themeColor = () => page.evaluate(() => document.getElementById('theme-color').content);
    const pageBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(await themeColor(), await pageBg(), 'auto: theme-color follows the OS');

    await toggle.click();
    assert.equal(await themeAttr(), 'light');
    assert(await bodyBright() > 0.8, 'manual light overrides the OS dark preference');
    assert.match(await toggle.getAttribute('aria-label'), /화면 테마 밝게\. 누르면 어둡게로 바뀌어요\./);
    // 수동 전환은 OS 설정과 어긋나므로, media 쿼리만으로는 못 맞추는 경우다.
    assert.equal(await themeColor(), await pageBg(), 'manual light: theme-color follows the override, not the OS');
    assert(channel(rgb(await themeColor())) > 0.8);

    await page.reload();
    assert.equal(await themeAttr(), 'light', 'theme choice survives a reload');
    assert(await bodyBright() > 0.8);

    await toggle.click();
    assert.equal(await themeAttr(), 'dark');
    assert(await bodyBright() < 0.05);
    assert.equal(await themeColor(), await pageBg(), 'manual dark: theme-color follows too');
    await toggle.click();
    assert.equal(await themeAttr(), null, 'the cycle returns to 자동');

    // <meta> 의 pre-paint 임시값이 실제 팔레트와 어긋나지 않아야 한다(둘 다 한 곳에서 검증).
    const fallbacks = await page.evaluate(() => {
      const meta = document.getElementById('theme-color');
      const read = theme => {
        const previous = document.documentElement.getAttribute('data-theme');
        document.documentElement.setAttribute('data-theme', theme);
        const value = getComputedStyle(document.body).backgroundColor;
        if (previous === null) document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', previous);
        return value;
      };
      const toHex = value => '#' + value.match(/\d+/g).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');
      return { light: meta.dataset.light, dark: meta.dataset.dark, realLight: toHex(read('light')), realDark: toHex(read('dark')) };
    });
    assert.equal(fallbacks.light, fallbacks.realLight, 'data-light drifted from the real light background');
    assert.equal(fallbacks.dark, fallbacks.realDark, 'data-dark drifted from the real dark background');

    // 학습 기록을 초기화해도 테마는 남는다.
    await toggle.click();
    await page.locator('#reset-progress').click().catch(() => {});
    assert.equal(await themeAttr(), 'light', 'resetting progress must not reset the theme');

    // 모바일에서는 라벨을 숨기고 아이콘만 남긴다.
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.theme-label').isVisible(), false);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await snap(page, { path: path.join(__dirname, 'screenshots', 'visuals-library-390-dark.png'), fullPage: true });
    await page.close();

    // --- 수동 테마는 첫 그리기 전에 적용돼야 한다(깜빡임 없음).
    const boot = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
    await boot.goto(pageURL);
    await boot.evaluate(() => window.localStorage.setItem('albatross-theme', 'dark'));
    // addInitScript 는 페이지의 어떤 스크립트보다 먼저 돈다. data-theme 이 바뀐 시점에 body 가
    // 아직 없었다면, head 에서 적용됐다는 뜻이고 곧 밝은 화면이 한 프레임도 안 보였다는 뜻이다.
    await boot.addInitScript(() => {
      // 이 시점엔 documentElement 가 아직 없을 수 있어서 document 에 subtree 로 건다.
      window.__themeTimeline = [];
      new MutationObserver(records => {
        for (const record of records) {
          const isMeta = record.target.id === 'theme-color';
          if (record.attributeName !== (isMeta ? 'content' : 'data-theme')) continue;
          window.__themeTimeline.push({
            what: isMeta ? 'theme-color' : 'data-theme',
            value: record.target.getAttribute(record.attributeName),
            bodyExists: Boolean(document.body),
          });
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme', 'content'] });
    });
    await boot.reload();
    const timeline = await boot.evaluate(() => window.__themeTimeline);
    const themed = timeline.filter(entry => entry.what === 'data-theme');
    const coloured = timeline.filter(entry => entry.what === 'theme-color');
    assert(themed.length >= 1, 'data-theme was never applied');
    assert.equal(themed[0].value, 'dark');
    assert.equal(themed[0].bodyExists, false, 'theme must be applied while the head is parsing, before the body exists');
    assert(coloured.length >= 1, 'theme-color was never set');
    assert.equal(coloured[0].bodyExists, false, 'the browser bar colour is set in the head too, before any paint');
    assert.equal(coloured[0].value, '#0b0a07', 'the pre-paint fallback is the dark background');
    const darkBackground = await boot.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(channel(rgb(darkBackground)) < 0.05);
    // 로드가 끝나면 임시 hex 대신 실제로 칠해진 색으로 교정된다.
    assert.equal(await boot.evaluate(() => document.getElementById('theme-color').content), darkBackground);

    // --- 정리된 죽은 요소는 DOM에 남아 있으면 안 된다.
    for (const gone of ['.sidebar', '#micro-note', '#lesson-badge', '#lesson-intro', '.study-note', '.layout']) {
      assert.equal(await boot.locator(gone).count(), 0, `${gone} should be gone`);
    }
    // 그래도 학습 화면은 정상 동작해야 한다.
    await boot.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => boot.locator(`[data-lesson="${LESSON}"]`).click());
    await boot.evaluate(() => setDraftSelection([0, 1, 2]));
    await boot.locator('[data-selection-action="start"]').click();
    assert.equal(await boot.locator('#word-list li').count(), 3);
    assert.equal(await boot.locator('.question-card').count(), 1);
    assert.equal(await boot.evaluate(() => getComputedStyle(document.querySelector('#word-list li')).display), 'flex');
    assert.equal(await boot.evaluate(() => getComputedStyle(document.getElementById('word-list')).listStyleType), 'none');
    assert.equal(await boot.evaluate(() => document.getElementById('word-list').getAttribute('tabindex')), null, 'a strip that fits needs no tab stop');
    await boot.close();

    console.log('PASS: dark palette contrast (light+dark), card elevation, horizontal word strip with follow-scroll, donut, weak-word ranking, theme cycle + persistence + mobile label, pre-paint theme boot and browser-bar colour, dead markup removed.');
  } finally {
    await browser.close();
  }
})();
