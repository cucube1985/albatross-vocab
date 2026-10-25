const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snap = (page, options) => process.env.QA_SCREENSHOTS ? (fs.mkdirSync(path.dirname(options.path), { recursive: true }), page.screenshot(options)) : Promise.resolve(); // 스크린샷은 QA_SCREENSHOTS=1 일 때만 qa/screenshots/ 에 남겨요.
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const pageURL = pathToFileURL(path.join(root, 'albatross-c2-lesson-03.html')).href;
const LESSON = 'albatross-c2-lesson-03';

// 헤드리스 브라우저에는 설치된 음성이 없을 수 있으므로 speechSynthesis 를 통째로 스텁한다.
// 음성 목록은 window.__voices 로 바꿀 수 있고, voiceschanged 핸들러는 window.__onVoices 에 잡아 두어
// "음성이 늦게 도착하는" 브라우저를 한 스텁으로 흉내 낸다.
const SPY = () => {
  window.__spoken = [];
  window.__cancels = 0;
  window.__voices = [
    { lang: 'ko-KR', name: 'Test Korean' },
    { lang: 'en-US', name: 'Test US' },
  ];
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: class { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; } },
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => window.__voices,
      addEventListener: (type, fn) => { if (type === 'voiceschanged') window.__onVoices = fn; },
      cancel: () => { window.__cancels++; },
      speak: utterance => window.__spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate, pitch: utterance.pitch, voice: utterance.voice && utterance.voice.name }),
    },
  });
};
// 음성 목록이 아직 비어 있는 브라우저(voiceschanged 전).
const LATE = () => { window.__voices = []; };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(SPY);

    const mode = value => page.locator(`[data-selection-action="mode"][data-mode="${value}"]`);
    const startWith = async (modeValue, ids) => {
      await mode(modeValue).click();
      await page.evaluate(list => setDraftSelection(list), ids);
      await page.locator('[data-selection-action="start"]').click();
    };
    const answer = async correct => {
      const i = await page.evaluate(want => state.options.findIndex(o => o.correct === want), correct);
      await page.locator(`[data-choice="${i}"]`).click();
    };
    const spoken = () => page.evaluate(() => window.__spoken);
    const clear = () => page.evaluate(() => { window.__spoken.length = 0; });
    const openLesson = () => page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => page.locator(`[data-lesson="${LESSON}"]`).click());

    await page.goto(pageURL);
    await openLesson();

    // --- 선택 화면: 영어 음성이 있으면 '듣고 뜻 고르기' 버튼이 켜진 채로 '문장 완성'과 '섞어서' 사이에 있다.
    assert.equal(await mode('listen').count(), 1, 'the listen button exists when speech + english voice are present');
    assert(await mode('listen').isEnabled(), 'enabled with an english voice');
    assert.equal(await mode('listen').innerText(), '듣고 뜻 고르기');
    assert.deepEqual(await page.locator('[data-selection-action="mode"]').evaluateAll(els => els.map(e => e.dataset.mode)), ['en', 'ko', 'cloze', 'sentence', 'listen', 'mix']);
    assert.equal(await mode('listen').getAttribute('aria-pressed'), 'false');
    assert.equal(await mode('en').getAttribute('aria-pressed'), 'true');

    await mode('listen').click();
    assert.equal(await mode('listen').getAttribute('aria-pressed'), 'true');
    const help = await page.locator('#mode-help').innerText();
    assert.match(help, /소리로만 듣고 한글 뜻을 골라요/);
    assert.match(help, /철자는 보이지 않아요/);
    assert.match(help, /자동 읽기가 꺼져 있어도/);
    assert.equal(await page.evaluate(() => localStorage.getItem('albatross-mode')), 'listen', 'the choice is saved');

    // --- 문제 화면: 자동 읽기를 꺼 두어도 단어를 정확히 한 번 읽어준다(소리가 곧 문제니까).
    await page.evaluate(() => setSound('autoRead', false));
    await clear();
    await startWith('listen', [0, 1, 2, 3]);
    const view = await page.evaluate(() => {
      const entry = currentWord();
      return {
        mode: state.mode,
        heading: document.getElementById('screen-title').textContent,
        prompt: document.getElementById('question-prompt').textContent.trim(),
        choices: [...document.querySelectorAll('.choice-text')].map(el => el.textContent),
        langs: [...document.querySelectorAll('.choice-text')].map(el => el.getAttribute('lang')),
        correct: state.options.find(o => o.correct).text,
        ko: entry.ko, word: entry.word,
        allKo: words.map(w => w.ko),
      };
    });
    let heard = await spoken();
    assert.equal(heard.length, 1, 'exactly one utterance on entry');
    assert.equal(heard[0].text, view.word, 'the word is read on entry');
    assert.equal(heard[0].lang, 'en-US');
    assert.equal(heard[0].voice, 'Test US');
    assert(heard[0].rate < 1, 'slowed down a little for learners');
    assert.equal(await page.locator('#sound-toggles [data-sound="autoRead"]').getAttribute('aria-pressed'), 'false', 'auto-read is off, the listen question still spoke once');
    assert.equal(await page.evaluate(() => state.phase), 'question');

    // 철자는 어디에도 없다: 제목은 스크린리더용 문구 + ♪ 뿐이고, 표현 블록과 예문 듣기도 없다.
    assert.equal(view.mode, 'listen');
    assert(!view.heading.toLowerCase().includes(view.word.toLowerCase()), 'the spelling never appears');
    assert(view.heading.includes('소리로 들려주는 단어'), 'screen readers get a title');
    assert.match(view.prompt, /들리는 단어의 뜻은\?/);
    assert.equal(await page.locator('.mode-chip').innerText(), '듣고 뜻 고르기');
    assert.equal(await page.locator('.question-card .word').count(), 0, 'no headword element');
    assert.equal(await page.locator('.expression').count(), 0, 'the phrase would give the spelling away');
    assert.equal(await page.locator('.question-card [data-speak="example"]').count(), 0);
    assert.equal(await page.locator('.question-card .part').count(), 1, 'the part-of-speech chip stays');
    await snap(page, { path: path.join(__dirname, 'screenshots', 'listen-question.png'), fullPage: true });

    // 보기 4개는 모두 이 수업의 서로 다른 한글 뜻이고, 정답은 이 단어의 뜻이다.
    assert.equal(view.choices.length, 4);
    assert.equal(new Set(view.choices).size, 4, 'no duplicate meanings');
    assert(view.choices.includes(view.ko), 'the answer meaning is offered');
    assert.equal(view.correct, view.ko, 'the correct option is the korean meaning');
    for (const choice of view.choices) assert(view.allKo.includes(choice), `"${choice}" must be a real Korean meaning from the lesson`);
    assert.deepEqual(view.langs, ['ko', 'ko', 'ko', 'ko'], 'choices are marked as Korean');
    assert.deepEqual(await page.locator('.choice-letter').allTextContents(), ['1', '2', '3', '4']);

    // 상단 단어 스트립은 번호·상태만 남고, 포커스는 제목으로 간다.
    assert.equal(await page.evaluate(() => document.getElementById('word-list').classList.contains('is-masked')), true);
    assert.equal(await page.locator('#word-list [lang="en"]').count(), 0, 'the strip must not spell the words');
    assert.equal(await page.locator('#word-list li').count(), 4);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'screen-title');

    // '다시 듣기': 클릭과 S 키 모두 단어를 다시 읽고, 답은 고르지 않는다.
    const replay = page.locator('.question-card [data-speak="word"]');
    assert.equal(await replay.count(), 1, 'exactly one replay button');
    assert.match(await replay.innerText(), /다시 듣기/);
    assert.equal(await replay.getAttribute('aria-keyshortcuts'), 'S');
    assert.equal(await replay.evaluate(el => el.classList.contains('listen-replay')), true, 'styled as the hero button');
    await clear();
    await replay.click();
    await page.keyboard.press('KeyS');
    assert.deepEqual((await spoken()).map(h => [h.text, h.lang]), [[view.word, 'en-US'], [view.word, 'en-US']], 'click and S both replay the word');
    assert.equal(await page.evaluate(() => state.phase), 'question', 'replaying must not select');
    const hint = await page.locator('.card-bottom .shortcut').innerText();
    assert(hint.includes('S') && hint.includes('다시 듣기'), `shortcut hint names the replay: ${hint}`);

    // 보기 읽기: "일번" + 한글 뜻을 한국어 음성으로.
    await clear();
    await page.locator('.choice-speak[data-index="0"]').click();
    assert.deepEqual((await spoken()).map(h => [h.text, h.lang, h.voice]), [['일번', 'ko-KR', 'Test Korean'], [view.choices[0], 'ko-KR', 'Test Korean']], 'number, then the meaning, both in Korean');
    assert.equal(await page.evaluate(() => state.phase), 'question', 'reading a choice must not select it');

    // '보기 모두 듣기': 단어를 앞에 붙이지 않고 일번 뜻 … 사번 뜻만.
    const allLabel = await page.locator('.question-card [data-action="speak-all"]').innerText();
    assert.match(allLabel, /보기 모두 듣기/);
    assert.equal(allLabel.includes('단어'), false, 'the all-read button must not offer the word');
    await clear();
    await page.locator('.question-card [data-action="speak-all"]').click();
    heard = await spoken();
    assert.equal(heard.length, 8, '4 × (number, meaning)');
    assert.deepEqual(heard.map(h => h.text), view.choices.flatMap((text, i) => [['일번', '이번', '삼번', '사번'][i], text]));
    assert(heard.every(h => h.lang === 'ko-KR'), 'all in Korean');
    assert(heard.every(h => h.text !== view.word), 'the word is never spelled out by the all-read');

    // 틀리면 '내가 고른 뜻' 아래 고른 한글 뜻이 보이고, 그제야 철자가 드러난다. 자동 읽기가 꺼져 있으니 단어는 다시 읽지 않는다.
    await clear();
    await answer(false);
    assert.equal(await page.locator('.your-answer span').innerText(), '내가 고른 뜻');
    assert.equal(await page.locator('.your-answer div').getAttribute('lang'), 'ko');
    const chosen = await page.locator('.your-answer div').textContent();
    assert(view.choices.includes(chosen) && chosen !== view.ko, 'the chosen meaning is one of the wrong choices');
    assert((await page.locator('.feedback-card .word').textContent()).includes(view.word), 'spelling revealed after answering');
    assert.equal(await page.locator('.feedback-card [data-speak="word"]').count(), 1);
    assert.equal(await page.locator('#word-list [lang="en"]').count(), 4, 'the strip names the words again');
    assert.equal(await page.evaluate(() => document.getElementById('word-list').classList.contains('is-masked')), false);
    await page.waitForFunction(() => window.__spoken.some(s => s.text === '틀렸어요~'), null, { timeout: 3000 });
    assert((await spoken()).every(h => h.text !== view.word), 'autoRead off: no post-answer word read-out');

    // 새로고침해도 세션의 mode 가 listen 으로 남고, 이어하기는 같은 피드백 화면을 보여준다.
    await page.reload();
    await openLesson();
    assert.equal(await mode('listen').getAttribute('aria-pressed'), 'true', 'mode survives a reload');
    assert(await mode('listen').isEnabled());
    assert.equal(await page.evaluate(id => loadSession(lessons.find(l => l.id === id)).mode, LESSON), 'listen', 'the saved session keeps mode listen');
    assert.equal(await page.locator('.selection-resume').count(), 1);
    await page.locator('[data-selection-action="resume"]').click();
    assert.equal(await page.locator('.feedback-card').count(), 1);
    assert.equal(await page.evaluate(() => state.mode), 'listen');
    assert.equal(await page.evaluate(() => state.phase), 'feedback');
    assert.equal(await page.locator('.your-answer span').innerText(), '내가 고른 뜻');

    // 숫자키로 정답을 고르면 Leitner 단계가 평소처럼 오른다.
    await page.locator('[data-action="next"]').click();
    assert.equal(await page.evaluate(() => state.mode), 'listen');
    const boxBefore = await page.evaluate(() => { const s = statOf(currentWord()); return s ? s.box : 1; });
    const index = await page.evaluate(() => state.options.findIndex(o => o.correct) + 1);
    await page.keyboard.press(String(index));
    assert.equal(await page.evaluate(() => state.answers.at(-1).correct), true, 'number key picks the answer');
    assert.equal(await page.evaluate(() => statOf(words[state.answers.at(-1).id]).box), Math.min(boxBefore + 1, 5), 'Leitner box advances');

    // '섞어서'는 듣기까지 네 방식을 모두 낸다.
    await page.locator('#change-words').click();
    await startWith('mix', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      seen.add(await page.evaluate(() => state.mode));
      await page.evaluate(() => { state.cursor = (state.cursor + 1) % state.queue.length; renderQuestion(false); });
    }
    assert(seen.has('listen'), `mix never produced listen: ${[...seen]}`);
    assert.deepEqual([...seen].sort(), ['cloze', 'en', 'ko', 'listen'], `mix produced only ${[...seen]}`);

    // wordOptions: ko 키는 서로 다른 한글 뜻 4개 + 정답 1개, 기본(word 키)은 그대로다.
    const koShapes = await page.evaluate(() => words.map(w => {
      const o = wordOptions(w, 'ko');
      return [o.length, new Set(o.map(x => x.text)).size, o.filter(x => x.correct).length, o.find(x => x.correct).text === w.ko, o.every(x => words.some(v => v.ko === x.text))];
    }));
    for (const shape of koShapes) assert.deepEqual(shape, [4, 4, 1, true, true], 'ko-keyed options: 4 distinct meanings, one correct, all from the lesson');
    assert.equal(await page.evaluate(() => words.every(w => { const o = wordOptions(w); return o.length === 4 && new Set(o.map(x => x.text)).size === 4 && o.find(x => x.correct).text === w.word; })), true, 'default word-keyed options untouched');
    assert.equal(await page.evaluate(() => availableModes(words[0]).at(-1)), 'listen', 'listen is appended last');

    assert.deepEqual(errors, []);
    await page.close();

    // --- 음성 목록이 늦게 오는 브라우저: 버튼은 꺼져 있다가 voiceschanged 뒤에 제자리에서 켜진다.
    const late = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    late.setDefaultTimeout(5000);
    const lateErrors = [];
    late.on('pageerror', e => lateErrors.push(e.message));
    await late.addInitScript(SPY);
    await late.addInitScript(LATE);
    const lateMode = value => late.locator(`[data-selection-action="mode"][data-mode="${value}"]`);
    await late.goto(pageURL);
    await late.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => late.locator(`[data-lesson="${LESSON}"]`).click());
    assert.equal(await lateMode('listen').count(), 1, 'the button is rendered (speech exists)');
    assert.equal(await lateMode('listen').isDisabled(), true, 'but disabled without an english voice');
    assert.equal(await lateMode('listen').getAttribute('title'), '영어 음성이 없어요');
    assert.equal(await late.evaluate(() => { setStudyMode('listen'); return studyMode; }), 'listen', 'the preference is kept while speech exists');
    assert.match(await late.locator('#mode-help').innerText(), /영어 음성이 없어요/, 'the help explains the fallback');
    assert.equal(await late.evaluate(() => availableModes(words[0]).includes('listen')), false);
    await late.evaluate(() => setDraftSelection([0, 1]));
    await late.locator('[data-selection-action="start"]').click();
    assert.equal(await late.evaluate(() => state.mode), 'en', 'falls back to en without a voice');
    assert.equal(await late.locator('.question-card .word').count(), 1);
    assert.equal(await late.locator('.mode-chip').innerText(), '영어 뜻 고르기');
    assert.equal(await late.locator('#round-label').count(), 1);
    // 음성이 도착하면 다시 그리지 않고 그 자리에서 켜진다.
    await late.locator('#change-words').click();
    assert.equal(await lateMode('listen').isDisabled(), true, 're-rendered picker is still off');
    assert.equal(await lateMode('listen').getAttribute('aria-pressed'), 'true');
    await late.evaluate(() => { window.__voices = [{ lang: 'en-US', name: 'Late US' }]; window.__onVoices(); });
    assert.equal(await lateMode('listen').isEnabled(), true, 'enabled in place on voiceschanged');
    assert.equal(await lateMode('listen').getAttribute('title'), null);
    assert.match(await late.locator('#mode-help').innerText(), /소리로만 듣고/);
    await late.evaluate(() => { window.__spoken.length = 0; });
    await late.evaluate(() => setDraftSelection([0, 1, 2, 3]));
    await late.locator('[data-selection-action="start"]').click();
    assert.equal(await late.evaluate(() => state.mode), 'listen', 'listen works once the voice is there');
    assert.equal((await late.evaluate(() => window.__spoken))[0].voice, 'Late US');
    assert.deepEqual(lateErrors, []);
    await late.close();

    // --- 음성 합성이 아예 없는 브라우저: 버튼이 없고, 저장된 '듣고 뜻 고르기'는 되살리지 않는다(저장값은 그대로).
    const noVoice = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    noVoice.setDefaultTimeout(5000);
    const quiet = [];
    noVoice.on('pageerror', e => quiet.push(e.message));
    await noVoice.addInitScript(() => { Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); localStorage.setItem('albatross-mode', 'listen'); });
    const quietMode = value => noVoice.locator(`[data-selection-action="mode"][data-mode="${value}"]`);
    await noVoice.goto(pageURL);
    await noVoice.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => noVoice.locator(`[data-lesson="${LESSON}"]`).click());
    assert.equal(await quietMode('listen').count(), 0, 'no listen button without speech');
    assert.equal(await quietMode('en').getAttribute('aria-pressed'), 'true', 'saved listen is not restored without speech');
    assert.deepEqual(await noVoice.locator('[data-selection-action="mode"]').evaluateAll(els => els.map(e => e.dataset.mode)), ['en', 'ko', 'cloze', 'sentence', 'mix']);
    assert.equal(await noVoice.evaluate(() => { setStudyMode('listen'); return studyMode; }), 'en', 'setStudyMode rejects listen without speech');
    await noVoice.evaluate(() => setDraftSelection([0, 1]));
    await noVoice.locator('[data-selection-action="start"]').click();
    assert.equal(await noVoice.evaluate(() => state.mode), 'en');
    assert.equal(await noVoice.locator('[data-speak]').count(), 0);
    assert.equal(await noVoice.locator('.choice-speak, [data-action="speak-all"]').count(), 0);
    await noVoice.keyboard.press('1');
    assert.equal(await noVoice.locator('.feedback-card').count(), 1, 'answering still works');
    assert.deepEqual(quiet, []);
    await noVoice.close();

    console.log('PASS: listen mode — button gated on speech + english voice (hidden / disabled+title / enabled in place on voiceschanged), spelling hidden (sr-only heading, masked strip, no phrase), 4 distinct Korean choices from the lesson with the answer ko, word auto-read once even with autoRead off, 다시 듣기 click + S, choices read in Korean (no leading word), 내가 고른 뜻 on wrong, session mode listen survives reload, mix includes listen, fallback to en without voice, graceful without speechSynthesis.');
  } finally {
    await browser.close();
  }
})();
