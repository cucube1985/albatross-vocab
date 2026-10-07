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
const LESSON = 'albatross-c2-lesson-09';

// 데이터: 모든 단어에 학습 카드용 '유래'(story)가 있고, 해요체 두 문장(각각 '요.'로 끝남)이에요.
const HANGUL = /[가-힣]/;
for (const lesson of data.lessons) for (const w of lesson.words) {
  const tag = `${lesson.id}#${w.number} ${w.word}`;
  assert.equal(typeof w.story, 'string', `${tag}: story`);
  const sentences = w.story.trim().split(/(?<=요\.)\s+/);
  assert.equal(sentences.length, 2, `${tag}: two sentences — "${w.story}"`);
  assert(sentences.every(s => /요\.$/.test(s)), `${tag}: each sentence ends with 요. — "${w.story}"`);
  assert(HANGUL.test(w.story) && w.story.length >= 40 && w.story.length <= 170, `${tag}: Korean, 40–170 chars (${w.story.length})`);
  assert(!/[<>"]/.test(w.story), `${tag}: no angle brackets or double quotes`);
}
const keys = data.lessons[0].words[0] && Object.keys(data.lessons[0].words[0]);
assert.equal(keys[keys.indexOf('origin') + 1], 'story', 'story sits right after origin in the field order');

// 헤드리스 브라우저에는 음성이 없을 수 있어 speechSynthesis 를 스텁해요(listen-mode 와 같은 방식).
const SPY = () => {
  window.__spoken = [];
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; } } });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ lang: 'ko-KR', name: 'Test Korean' }, { lang: 'en-US', name: 'Test US' }], addEventListener: () => {}, cancel: () => {}, speak: u => window.__spoken.push({ text: u.text, lang: u.lang }) } });
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(SPY);
    const spoken = () => page.evaluate(() => window.__spoken.map(s => s.text));
    const clear = () => page.evaluate(() => { window.__spoken.length = 0; });
    const openLesson = async () => { await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON); await page.locator(`[data-lesson="${LESSON}"]`).click(); };
    const view = mode => page.locator(`[data-view-mode="${mode}"]`);
    await page.goto(pageURL);

    // 1) 처음에는 지금까지처럼 풀이 모드예요(체크박스 선택 화면). 두 모드 전환 버튼이 위에 있어요.
    await openLesson();
    assert.equal(await view('quiz').getAttribute('aria-pressed'), 'true');
    assert.equal(await view('learn').getAttribute('aria-pressed'), 'false');
    assert(await page.locator('.word-pick input[type="checkbox"]').count() > 0, 'quiz mode keeps the checkbox grid');
    assert.equal(await page.locator('.learn-pick').count(), 0);

    // 2) 학습 모드: 체크박스 대신 단어 버튼 목록(한글 뜻 포함), 선택은 이 브라우저에 기억돼요.
    await view('learn').click();
    const lessonWords = await page.evaluate(() => words.map(w => ({ word: w.word, ko: w.ko, en: w.en, story: w.story, root: w.root, example: w.example, translation: w.translation })));
    assert.equal(await page.locator('.learn-pick').count(), lessonWords.length);
    assert.equal(await page.locator('.word-pick').count(), 0, 'no checkbox rows in learn mode');
    assert.equal(await view('learn').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.viewMode), 'learn', 'focus stays on the switch after re-render');
    assert.equal(await page.evaluate(() => localStorage.getItem('albatross-view')), 'learn');
    assert.match(await page.locator('.learn-pick').nth(3).innerText(), new RegExp(lessonWords[3].ko.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await page.reload();
    await openLesson();
    assert.equal(await page.locator('.learn-pick').count(), lessonWords.length, 'learn mode is remembered after reload');

    // 3) 단어를 누르면 카드: 단어 → 예문 순서로 읽어 주고, 영어 뜻·한글 뜻·유래(두 문장)·예문을 보여 줘요.
    await clear();
    await page.locator('[data-learn="3"]').click();
    const w = lessonWords[3];
    const card = await page.evaluate(() => ({
      visible: !document.getElementById('learn-view').hidden, selection: !document.getElementById('word-selection').hidden,
      heading: document.getElementById('learn-title').textContent, focus: document.activeElement.id,
      ko: document.querySelector('.learn-card .meaning-ko').textContent, en: document.querySelector('.learn-card .meaning-en').textContent,
      story: document.querySelector('.learn-story p').textContent, root: document.querySelector('.learn-root').textContent,
      example: document.querySelector('.learn-card .example p[lang="en"]').textContent, translation: document.querySelector('.learn-card .example .translation').textContent,
      position: document.querySelector('.learn-position [aria-hidden="true"]').textContent, positionSr: document.querySelector('.learn-position .sr-only').textContent,
    }));
    assert.equal(card.visible, true); assert.equal(card.selection, false);
    assert.equal(card.heading, w.word); assert.equal(card.focus, 'learn-title', 'focus moves to the word');
    assert.equal(card.ko, w.ko); assert.equal(card.en, w.en); assert.equal(card.story, w.story); assert.equal(card.root, w.root);
    assert.equal(card.example, w.example); assert.equal(card.translation, w.translation);
    assert.equal(card.position.replace(/\s+/g, ''), `4/${lessonWords.length}`); assert.equal(card.positionSr, `${lessonWords.length}개 중 4번째 단어`);
    assert.deepEqual(await spoken(), [w.word, w.en, w.example], 'opening a card reads the word, then the english definition, then the example');
    assert.equal(await page.locator('#learn-view [data-sound="autoRead"]').getAttribute('title'), '단어를 열면 단어 → 영어 설명 → 예문 순서로 읽어 줘요.');
    assert(await page.evaluate(() => window.__spoken.every(s => s.lang === 'en-US')), 'read with the english voice');

    // 4) 다시 듣기: S = 단어, E = 예문, '영어 뜻 듣기' 버튼 = 영어 설명.
    await clear(); await page.keyboard.press('s'); assert.deepEqual(await spoken(), [w.word]);
    await clear(); await page.keyboard.press('e'); assert.deepEqual(await spoken(), [w.example]);
    await clear(); await page.locator('[data-learn-action="speak"][data-speak-kind="en"]').click(); assert.deepEqual(await spoken(), [w.en]);

    // 5) ←/→ 와 버튼으로 이전·다음 단어, 끝에서는 버튼이 꺼져요.
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#learn-title').textContent(), lessonWords[4].word);
    await page.locator('[data-learn-action="prev"]').click();
    assert.equal(await page.locator('#learn-title').textContent(), w.word);
    await page.evaluate(() => openLearn(0));
    assert(await page.locator('[data-learn-action="prev"]').isDisabled(), 'no previous word on the first card');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#learn-title').textContent(), lessonWords[0].word, 'ArrowLeft does nothing on the first card');
    await page.evaluate(n => openLearn(n - 1), lessonWords.length);
    assert(await page.locator('[data-learn-action="next"]').isDisabled());
    assert.match(await page.locator('[data-learn-action="next"]').innerText(), /마지막 단어/);

    // 6) 자동 읽기 끄기: 카드 위 토글로 끄면 다음 카드부터 읽지 않고, 버튼으로는 여전히 들을 수 있어요.
    await page.evaluate(() => openLearn(2));
    await page.locator('#learn-view [data-sound="autoRead"]').click();
    assert.equal(await page.locator('#learn-view [data-sound="autoRead"]').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('albatross-sound')).autoRead), false);
    await clear(); await page.keyboard.press('ArrowRight');
    assert.deepEqual(await spoken(), [], 'no auto reading when 자동 읽기 is off');
    await page.keyboard.press('s'); assert.deepEqual(await spoken(), [lessonWords[3].word]);
    await page.locator('#learn-view [data-sound="autoRead"]').click();

    // 7) Esc 로 단어 목록에 돌아오면 방금 본 단어 버튼에 초점이 가요. 학습 모드는 기억 단계 기록을 남기지 않아요.
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => !document.getElementById('word-selection').hidden && document.getElementById('learn-view').hidden), true);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.learn), '3');
    assert.deepEqual(await page.evaluate(() => progress.stats), {}, 'learning does not touch the review records');

    // 8) 검색은 학습 목록도 걸러요. 숫자키는 학습 목록에서 아무 일도 안 해요(오류 없음).
    await page.locator('#selection-search-input').fill(lessonWords[5].word);
    assert.equal(await page.locator('.learn-item:not([hidden])').count(), 1);
    await page.locator('[data-learn="5"]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#selection-search-input').inputValue(), lessonWords[5].word, 'the search survives a visit to the card');
    assert.equal(await page.locator('.learn-item:not([hidden])').count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.learn), '5');
    await page.locator('#selection-search-input').press('Escape');
    assert.equal(await page.locator('.learn-item:not([hidden])').count(), lessonWords.length);
    await page.locator('[data-learn="0"]').focus(); await page.keyboard.press('7');
    assert.equal(await page.evaluate(() => !document.getElementById('word-selection').hidden), true);

    // 9) 풀이 모드로 돌아가면 원래 선택 화면과 문제 풀이가 그대로 돼요.
    await view('quiz').click();
    assert(await page.locator('.word-pick input[type="checkbox"]').count() > 0);
    await page.evaluate(() => setDraftSelection([0, 1]));
    await page.locator('[data-selection-action="start"]').click();
    assert.equal(await page.locator('.question-card').count(), 1, 'the quiz still starts from quiz mode');
    assert.equal(await page.evaluate(() => localStorage.getItem('albatross-view')), 'quiz');

    // 10) 데이터에 든 마크업은 카드에서도 글자로만 보여요.
    await page.locator('#back-to-lessons').click();
    await page.evaluate(() => { localStorage.setItem('albatross-view', 'learn'); });
    await page.reload();
    await openLesson();
    await page.evaluate(() => { const e = words[0]; e.story = '<img src=x onerror="window.__pwned=1">유래예요.'; e.ko = '<b>굵게</b>'; e.root = '<u>root</u>'; e.example = '<i>example</i>'; e.translation = '<mark>번역</mark>'; e.note = '<big>note</big>'; });
    await page.locator('[data-learn="0"]').click();
    const injected = await page.evaluate(() => ({ nodes: document.querySelectorAll('#learn-view img, #learn-view b:not(.learn-position b), #learn-view u, #learn-view mark, #learn-view big').length, pwned: window.__pwned, story: document.querySelector('.learn-story p').textContent }));
    assert.equal(injected.nodes, 0, 'no element is created from the data');
    assert.equal(injected.pwned, undefined);
    assert.equal(injected.story, '<img src=x onerror="window.__pwned=1">유래예요.');

    // 11) 오답 노트도 학습 모드로 볼 수 있어요(여러 수업 단어, 원래 수업 표시).
    await page.reload();
    await page.evaluate(() => { const l = lessons.find(x => x.id === 'albatross-c1-lesson-02'); recordAnswer(l.id, l.words[0].word, false); recordAnswer('albatross-c2-lesson-10', lessons.find(x => x.id === 'albatross-c2-lesson-10').words[1].word, false); showLessons(); });
    await page.locator('[data-open-notebook]').click();
    assert.equal(await page.locator('.learn-pick').count(), 2);
    assert.equal(await page.locator('.learn-pick .pick-origin').count(), 2);
    await page.locator('[data-learn="1"]').click();
    assert.equal(await page.locator('#learn-title').textContent(), await page.evaluate(() => words[1].word));
    assert.equal(await page.locator('.learn-card .eyebrow').getAttribute('lang'), null, 'the Korean notebook title is not marked english');
    assert.match(await page.locator('.learn-card .eyebrow').innerText(), /오답 노트 · C2·10/);

    // 12) 폰 폭: 가로 넘침이 없고, '이전·다음' 줄이 화면 아래에 붙어 스크롤 없이 보여요.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => openLearn(0));
    const phone = await page.evaluate(() => { const nav = document.querySelector('.learn-nav'), r = document.querySelector('[data-learn-action="next"]').getBoundingClientRect(); return { overflow: document.documentElement.scrollWidth > innerWidth, position: getComputedStyle(nav).position, direction: getComputedStyle(nav).flexDirection, nextVisible: r.top >= 0 && r.bottom <= innerHeight }; });
    assert.equal(phone.overflow, false); assert.equal(phone.position, 'sticky'); assert.equal(phone.direction, 'row'); assert.equal(phone.nextVisible, true);
    await snap(page, { path: path.join(__dirname, 'screenshots', 'learn-card-390.png') });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => openLearn(words.length - 1));
    const narrow = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, nav: document.querySelector('.learn-nav').getBoundingClientRect().height, heights: [...document.querySelectorAll('.learn-nav button')].map(b => Math.round(b.getBoundingClientRect().height)) }));
    assert.equal(narrow.overflow, false, 'no overflow on the card at 320px');
    assert(narrow.nav < 90 && narrow.heights.every(h => h < 60), `the pinned bar stays one line at 320px (${JSON.stringify(narrow)})`);
    await page.evaluate(() => closeLearn());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'learn list fits 320px');

    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS: learn mode — 950 two-sentence 유래 stories in the data; quiz/learn switch (default quiz, remembered); word list with meanings; card reads word → english definition → example, shows en/ko/유래/root/example; S/E/영어 뜻 replay; ←/→/Esc navigation with disabled ends; 자동 읽기 toggle; no review records; search; quiz mode intact; escaping; wrong notebook; phone layout with pinned prev/next.`);
  } finally {
    await browser.close();
  }
})();
