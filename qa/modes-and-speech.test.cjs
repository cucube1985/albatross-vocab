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
// SpeechSynthesisUtterance 도 같이 바꿔야 한다 — 진짜 utterance.voice 에는 진짜 음성 객체만
// 넣을 수 있어서, 가짜 음성을 넣으면 TypeError 가 난다.
const SPY = () => {
  window.__spoken = [];
  // window.speechSynthesis 는 읽기 전용 접근자라, 일반 대입은 조용히 무시된다.
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: class { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; } },
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [
        { lang: 'ko-KR', name: 'Test Korean' },
        { lang: 'en-US', name: 'Test US' },
        { lang: 'en-GB', name: 'Test GB' },
      ],
      addEventListener: () => {},
      cancel: () => { window.__cancels = (window.__cancels || 0) + 1; },
      speak: utterance => window.__spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate, pitch: utterance.pitch, voice: utterance.voice && utterance.voice.name }),
    },
  });
};

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

    await page.goto(pageURL);
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => page.locator(`[data-lesson="${LESSON}"]`).click());

    // 기본값은 기존 동작(영어 뜻 고르기) 그대로여야 한다.
    assert.equal(await mode('en').getAttribute('aria-pressed'), 'true');
    for (const other of ['ko', 'cloze', 'listen', 'mix']) assert.equal(await mode(other).getAttribute('aria-pressed'), 'false');
    assert.match(await page.locator('#mode-help').innerText(), /영어 설명을 골라요/);

    // --- 모드 1: 영어 뜻 고르기 (단어 제시 → 영어 정의 보기)
    await startWith('en', [0, 1]);
    let view = await page.evaluate(() => ({
      mode: state.mode,
      heading: document.getElementById('screen-title').textContent.trim(),
      prompt: document.getElementById('question-prompt').textContent.trim(),
      choices: [...document.querySelectorAll('.choice-text')].map(el => el.textContent),
      correct: state.options.find(o => o.correct).text,
      word: words[state.queue[0]].word,
      definition: words[state.queue[0]].en,
    }));
    assert.equal(view.mode, 'en');
    assert.equal(view.heading, view.word, 'the word is the prompt');
    assert.equal(view.correct, view.definition, 'the answer is the english definition');
    assert.match(view.prompt, /영어 설명은\?/);
    assert.equal(await page.locator('.mode-chip').innerText(), '영어 뜻 고르기');

    // 문제로 넘어오면 단어를 자동으로 읽어준다.
    let heard = await spoken();
    assert.equal(heard.length, 1, 'the word is read automatically on entry');
    assert.equal(heard[0].text, view.word);
    assert.equal(await page.evaluate(() => state.phase), 'question', 'auto-read must not touch the quiz state');
    await page.evaluate(() => { window.__spoken.length = 0; });
    // 이 모드에서는 발음 듣기를 내준다. 클릭과 S 단축키 모두 영어 음성으로 단어를 읽어야 한다.
    await page.locator('.question-card [data-speak="word"]').click();
    await page.keyboard.press('KeyS');
    heard = await spoken();
    assert.equal(heard.length, 2, 'click and the S shortcut both speak');
    assert.deepEqual(heard.map(h => h.text), [view.word, view.word]);
    assert.equal(heard[0].voice, 'Test GB', 'prefers a British english voice over Korean/US');
    assert.equal(heard[0].lang, 'en-GB');
    assert(heard[0].rate < 1, 'slowed down a little for learners');

    // 보기마다 "N번 + 보기" 를 읽는 버튼이 있고, 눌러도 답이 골라지지 않는다.
    assert.equal(await page.locator('.choice-row .choice-speak').count(), 4);
    await page.evaluate(() => { window.__spoken.length = 0; });
    await page.locator('.choice-speak[data-index="1"]').click();
    heard = await spoken();
    assert.deepEqual(heard.map(h => [h.text, h.lang]), [['이번', 'ko-KR'], [view.choices[1], 'en-GB']], 'number in Korean, then the choice in English');
    assert.equal(await page.evaluate(() => state.phase), 'question', 'reading a choice must not select it');
    // "단어와 보기 모두 듣기": 단어 → 1번 … 4번.
    await page.evaluate(() => { window.__spoken.length = 0; });
    await page.locator('.question-card [data-action="speak-all"]').click();
    heard = await spoken();
    assert.equal(heard.length, 9, 'word + 4 × (number, choice)');
    assert.equal(heard[0].text, view.word);
    assert.deepEqual(heard.slice(1).map(h => h.text), view.choices.flatMap((text, i) => [['일번', '이번', '삼번', '사번'][i], text]));

    // 맞히면 딩동댕(효과음)만 울리고 TTS 는 없다(en 모드에서는 단어를 이미 들었다).
    await page.evaluate(() => { window.__spoken.length = 0; });
    await answer(true);
    await page.waitForTimeout(800);
    assert.deepEqual(await spoken(), [], 'a correct answer in en mode plays the chime only');
    // 피드백에서는 단어와 예문을 모두 읽을 수 있다.
    await page.evaluate(() => { window.__spoken.length = 0; });
    await page.locator('.example [data-speak="example"]').click();
    heard = await spoken();
    assert.equal(heard.length, 1);
    assert.equal(heard[0].text, await page.evaluate(() => currentWord().example));
    assert.equal(await page.locator('.feedback-card [data-speak="word"]').count(), 1);

    // --- 모드 2: 뜻 → 영단어
    await page.locator('#change-words').click();
    await page.evaluate(() => { window.__spoken.length = 0; });
    await startWith('ko', [0, 1, 2, 3]);
    view = await page.evaluate(() => {
      const entry = words[state.queue[state.cursor]];
      return {
        mode: state.mode,
        heading: document.getElementById('screen-title').textContent.trim(),
        prompt: document.getElementById('question-prompt').textContent.trim(),
        choices: [...document.querySelectorAll('.choice-text')].map(el => el.textContent),
        correct: state.options.find(o => o.correct).text,
        ko: entry.ko, word: entry.word, part: entry.part,
        allWords: words.map(w => w.word),
      };
    });
    assert.equal(view.mode, 'ko');
    assert.equal(view.heading, view.ko, 'the korean meaning is the prompt');
    assert.equal(view.correct, view.word, 'the answer is the english word');
    assert.match(view.prompt, /영어 단어는\?/);
    assert.equal(view.choices.length, 4);
    assert.equal(new Set(view.choices).size, 4, 'no duplicate choices');
    for (const choice of view.choices) assert(view.allWords.includes(choice), `distractor "${choice}" must be a real word from the lesson`);
    assert.equal(await page.locator('.expression').count(), 0, 'the phrase would give the word away');
    // 상단 단어 스트립도 정답을 노출하면 안 된다 (번호와 상태만 남는다).
    assert.equal(await page.locator('#word-list [lang="en"]').count(), 0, 'the strip must not name the words while they are the answer');
    assert.equal(await page.locator('#word-list li').count(), 4, 'the strip still shows progress');
    assert(await page.evaluate(() => document.getElementById('word-list').classList.contains('is-masked')));
    assert.equal(await page.locator('.question-card [data-speak]').count(), 0, 'speaking the word would give the answer away');
    // 자동 읽기는 단어 대신 한글 뜻을 한국어 음성으로 읽는다.
    const koAuto = await spoken();
    assert.equal(koAuto.length, 1, 'ko mode auto-reads exactly one thing');
    assert.equal(koAuto[0].text, view.ko);
    assert.equal(koAuto[0].lang, 'ko-KR');
    assert(koAuto.every(h => h.text !== view.word), 'the answer word is never spoken before choosing');
    const allLabel = await page.locator('.question-card [data-action="speak-all"]').innerText();
    assert.match(allLabel, /보기 모두 듣기/);
    assert.equal(allLabel.includes('단어'), false, 'the all-read button must not offer the word');
    // "보기 모두 듣기": 단어를 앞에 붙이지 않고 1번 … 4번만 읽는다(정답 단어는 네 보기 중 하나로만 들린다).
    await page.evaluate(() => { window.__spoken.length = 0; });
    await page.locator('.question-card [data-action="speak-all"]').click();
    heard = await spoken();
    assert.deepEqual(heard.map(h => h.text), view.choices.flatMap((text, i) => [['일번', '이번', '삼번', '사번'][i], text]), 'ko: 4 × (number, choice), no leading word');
    assert.equal(heard.filter(h => h.text === view.word).length, 1, 'the answer is spoken exactly once, as one of the four choices');
    await page.evaluate(() => { window.__spoken.length = 0; });
    await page.keyboard.press('KeyS');
    assert.deepEqual(await spoken(), [], 'the S shortcut is inert while the word is the answer');

    // 오답 라벨이 "내가 고른 단어"로 바뀐다. 틀리면 시무룩한 "틀렸어요~" 뒤에 정답 단어를 읽어준다.
    await page.evaluate(() => { window.__spoken.length = 0; });
    await answer(false);
    assert.equal(await page.locator('.your-answer span').innerText(), '내가 고른 단어');
    await page.waitForFunction(() => window.__spoken.length >= 2, null, { timeout: 3000 });
    const sad = await spoken();
    assert.deepEqual(sad.map(h => h.text), ['틀렸어요~', view.word]);
    assert.equal(sad[0].lang, 'ko-KR');
    assert(sad[0].pitch < 1, 'dejected: lower pitch');
    assert(sad[0].rate < 0.9, 'dejected: slower');
    assert.equal(sad[1].lang, 'en-GB', 'then the correct word, in English');

    // 소리 설정: 자동 읽기를 끄면 다음 문제에서 읽지 않고, 설정은 저장된다.
    assert.equal(await page.locator('#sound-toggles [data-sound]').count(), 2);
    await page.locator('#sound-toggles [data-sound="autoRead"]').click();
    assert.equal(await page.locator('#sound-toggles [data-sound="autoRead"]').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('albatross-sound')).autoRead), false);
    await page.evaluate(() => { window.__spoken.length = 0; });
    await page.locator('[data-action="next"]').click();
    await page.waitForTimeout(150);
    assert.deepEqual(await spoken(), [], 'auto-read off: nothing is spoken on the next question');
    await page.locator('#sound-toggles [data-sound="autoRead"]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('albatross-sound')).autoRead), true);
    await page.locator('#change-words').click();
    await startWith('ko', [0, 1, 2, 3]);
    await answer(false);
    assert.equal(await page.locator('.feedback-card [data-speak="word"]').count(), 1, 'the answer is out, so speaking is fine now');
    assert.equal(await page.locator('#word-list [lang="en"]').count(), 4, 'the strip names the words again once the answer is out');
    assert.equal(await page.evaluate(() => document.getElementById('word-list').classList.contains('is-masked')), false);

    // 맞히면 딩동댕 뒤에 정답 단어만 읽는다(ko 모드는 문제에서 단어를 못 들었으므로). "틀렸어요"는 없다.
    await page.locator('[data-action="next"]').click();
    const koWord = await page.evaluate(() => currentWord().word);
    await page.evaluate(() => { window.__spoken.length = 0; });
    await answer(true);
    await page.waitForFunction(() => window.__spoken.length >= 1, null, { timeout: 3000 });
    assert.deepEqual((await spoken()).map(h => [h.text, h.lang]), [[koWord, 'en-GB']], 'correct in ko: the word alone, in English');

    // 답을 고르는 순간 읽던 것을 끊는다(보기 읽기가 딩동댕과 겹치지 않게).
    await page.locator('[data-action="next"]').click();
    await page.locator('.question-card [data-action="speak-all"]').click();
    const cancelsAtAnswer = await page.evaluate(() => window.__cancels || 0);
    await answer(false);
    assert(await page.evaluate(() => window.__cancels || 0) > cancelsAtAnswer, 'answering cancels the in-flight narration immediately');

    // 예약된 "틀렸어요~"가 울리기 전에 선택 화면으로 나가면 아무것도 읽지 않는다.
    await page.evaluate(() => { window.__spoken.length = 0; });
    await page.locator('#change-words').click();
    await page.waitForTimeout(900);
    assert.deepEqual(await spoken(), [], 'leaving the study screen drops the pending sad read-out');
    await startWith('ko', [0, 1, 2, 3]);

    // --- 모드 3: 예문 빈칸
    await page.locator('#change-words').click();
    await startWith('cloze', [0, 1, 2, 3]);
    view = await page.evaluate(() => {
      const entry = words[state.queue[state.cursor]];
      return {
        mode: state.mode,
        heading: document.getElementById('screen-title').textContent,
        prompt: document.getElementById('question-prompt').textContent.trim(),
        correct: state.options.find(o => o.correct).text,
        word: entry.word, example: entry.example,
        blanks: document.querySelectorAll('.cloze-blank').length,
      };
    });
    assert.equal(view.mode, 'cloze');
    assert.equal(view.blanks, 1, 'exactly one blank');
    assert.equal(view.correct, view.word);
    assert.match(view.prompt, /빈칸에 들어갈 단어는\?/);
    assert(!view.heading.toLowerCase().includes(view.word.toLowerCase()), 'the answer must not appear in the sentence');
    // 빈칸을 뺀 나머지는 원문 예문과 같아야 한다.
    const rebuilt = view.heading.replace(/\s+/g, ' ').trim();
    const withoutWord = view.example.replace(new RegExp(view.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ').replace(/\s+/g, ' ').trim();
    assert.equal(rebuilt, withoutWord, 'the sentence around the blank is untouched');
    assert.equal(await page.locator('.question-card [data-speak]').count(), 0);
    // 다음 문제로 넘어가면 읽던 음성을 끊는다(빈칸 모드는 자동 읽기가 없어 이전 단어 음성이 흘러들 수 있으므로).
    const cancelsBefore = await page.evaluate(() => window.__cancels || 0);
    await answer(false);
    await page.waitForFunction(() => window.__spoken.some(s => s.text === '틀렸어요~'), null, { timeout: 3000 });
    await page.locator('[data-action="next"]').click();
    assert(await page.evaluate(() => window.__cancels || 0) > cancelsBefore, 'moving to the next question cancels any speech still playing');
    assert.equal(await page.evaluate(() => state.phase), 'question');

    // --- 모드 4: 섞어서 — 네 방식이 모두 나와야 한다.
    await page.locator('#change-words').click();
    await startWith('mix', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      seen.add(await page.evaluate(() => state.mode));
      await page.evaluate(() => { state.cursor = (state.cursor + 1) % state.queue.length; renderQuestion(false); });
    }
    assert.deepEqual([...seen].sort(), ['cloze', 'en', 'ko', 'listen'], `mix produced only ${[...seen]}`);

    // 예문에 원형이 없는 구동사는 빈칸을 못 만들므로 다른 방식으로 넘어가야 한다.
    const fallback = await page.evaluate(() => {
      const entry = words.find(w => w.word === 'quadruple') || words[0];
      return { cloze: Boolean(clozeParts(entry)), modes: availableModes({ word: 'lay off', part: 'verb', example: 'The company laid off staff.' }) };
    });
    assert.deepEqual(fallback.modes, ['en', 'ko', 'listen'], 'a phrasal verb with no literal match drops cloze only');

    // 선택한 방식은 새로고침 후에도 유지되고, 학습 기록 초기화와는 무관하다.
    await page.locator('#change-words').click();
    await mode('ko').click();
    await page.reload();
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => page.locator(`[data-lesson="${LESSON}"]`).click());
    assert.equal(await mode('ko').getAttribute('aria-pressed'), 'true', 'mode survives a reload');
    await page.locator('#back-to-lessons').click();
    page.on('dialog', d => d.accept());
    await page.locator('#reset-progress').click();
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => page.locator(`[data-lesson="${LESSON}"]`).click());
    assert.equal(await mode('ko').getAttribute('aria-pressed'), 'true', 'resetting progress must not reset the mode');
    assert.equal(await page.locator('#round-label').count(), 1);

    await snap(page, { path: path.join(__dirname, 'screenshots', 'modes-selection.png'), fullPage: true });
    await startWith('cloze', [0, 1, 2]);
    await snap(page, { path: path.join(__dirname, 'screenshots', 'modes-cloze.png'), fullPage: true });
    await page.locator('#change-words').click();
    await startWith('ko', [0, 1, 2]);
    await snap(page, { path: path.join(__dirname, 'screenshots', 'modes-ko.png'), fullPage: true });

    assert.deepEqual(errors, []);
    await page.close();

    // 스텁 없이 브라우저의 진짜 Web Speech API 를 태워도 오류가 없어야 한다.
    const real = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const realErrors = [];
    real.on('pageerror', e => realErrors.push(e.message));
    await real.goto(pageURL);
    assert(await real.evaluate(() => Boolean(window.speechSynthesis)), 'this browser should expose speechSynthesis');
    await real.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => real.locator(`[data-lesson="${LESSON}"]`).click());
    await real.evaluate(() => setDraftSelection([0, 1]));
    await real.locator('[data-selection-action="start"]').click();
    await real.locator('.question-card [data-speak="word"]').click();
    await real.keyboard.press('KeyS');
    await real.keyboard.press('1');
    await real.locator('.example [data-speak="example"]').click();
    assert.deepEqual(realErrors, [], 'the real speech API path must not throw');
    await real.close();

    // 음성 합성이 아예 없는 브라우저에서도 페이지가 정상 동작해야 한다.
    const noVoice = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const quiet = [];
    noVoice.on('pageerror', e => quiet.push(e.message));
    await noVoice.addInitScript(() => { Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); });
    await noVoice.goto(pageURL);
    await noVoice.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), LESSON).then(() => noVoice.locator(`[data-lesson="${LESSON}"]`).click());
    assert.equal(await noVoice.locator('[data-selection-action="mode"][data-mode="listen"]').count(), 0, 'no listen mode without speech');
    await noVoice.evaluate(() => setDraftSelection([0, 1]));
    await noVoice.locator('[data-selection-action="start"]').click();
    assert.equal(await noVoice.locator('[data-speak]').count(), 0, 'no speak buttons without speech support');
    assert.equal(await noVoice.locator('.choice-speak, [data-action="speak-all"], [data-action="speak-choice"]').count(), 0, 'no per-choice/all-read buttons without speech');
    assert.deepEqual(await noVoice.locator('#sound-toggles [data-sound]').evaluateAll(els => els.map(e => e.dataset.sound)), ['effects'], 'only the effects toggle without speech');
    assert.equal(await noVoice.locator('.question-card').count(), 1, 'the quiz still renders');
    await noVoice.keyboard.press('KeyS');
    await noVoice.keyboard.press('1');
    assert.equal(await noVoice.locator('.feedback-card').count(), 1, 'answering still works');
    assert.deepEqual(quiet, []);
    await noVoice.close();

    console.log('PASS: four question directions (definition / meaning-to-word / cloze / listen), mix cycles all four, phrasal-verb fallback, real-word distractors, answer never leaked by phrase or audio, auto-read on entry (word / korean meaning / silent), per-choice and all-choices reading without selecting, chime-only on correct, dejected 틀렸어요 + word on wrong, sound toggles persisted, TTS click + S shortcut, mode persistence, graceful degradation without speechSynthesis.');
  } finally {
    await browser.close();
  }
})();
