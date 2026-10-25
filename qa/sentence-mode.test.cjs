const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snap = (page, options) => process.env.QA_SCREENSHOTS ? (fs.mkdirSync(path.dirname(options.path), { recursive: true }), page.screenshot(options)) : Promise.resolve(); // 스크린샷은 QA_SCREENSHOTS=1 일 때만 qa/screenshots/ 에 남겨요.
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'albatross-c2-lesson-03.html');
const pageURL = pathToFileURL(file).href;
const LESSON = 'albatross-c1-lesson-08';

// 사용자가 준 C1 Lesson 08 '단어 : 문장' 20세트 그대로. [표제어, 문장 속 답, 문장]
const SETS = [
  ['renowned', 'renowned', 'Taylor was a(n) renowned chef who was often invited as a live guest for cooking channels.'],
  ['hive', 'hive', 'The hive is usually filled with bees.'],
  ['variety', 'varieties', 'As an experiment, scientists imported African bee varieties which produced more honey.'],
  ['deliberately', 'deliberately', 'Pop scientists want to gain more public attention, so they deliberately write in a way that makes science fun.'],
  ['credible', 'credible', 'The detective started to look for a(n) credible witness for the case.'],
  ['general', 'general', 'No smoking inside the building is a(n) general rule in public.'],
  ['gross', 'gross', 'Comparing finding the Higgs boson to finding God was a(n) gross exaggeration.'],
  ['substantially', 'substantially', 'The demand for bananas has increased substantially since the broadcast about the effectiveness of them.'],
  ['specifics', 'specifics', "The guide explained the specifics to the visitors, so that they wouldn't have to read it from the brochures."],
  ['out of reach', 'out of reach', "The mother's medicines were placed out of reach of the children lest they eat them."],
  ['equation', 'equation', "The math equation was simple, but it was difficult for Susan who didn't like numbers."],
  ['death toll', 'death toll', 'Each killer bee attack is guaranteed to generate news headlines, but the actual death toll has been small.'],
  ['catchy', 'catchy', "Scientists try to pique people's interest in the new discoveries by using catchy terms."],
  ['pale', 'pales', 'The bees have killed about 1,000 people, but that figure pales in comparison to the 600,000 people killed annually by malaria-infected mosquitoes.'],
  ['imply', 'implied', "Although she was smiling, the judge's comment implied that the performance was terrible."],
  ['breakthrough', 'breakthroughs', 'Informing the public about scientific breakthroughs has never been easy.'],
  ['keep abreast of', 'keep abreast', 'Some people just want to keep abreast of the latest scientific findings.'],
  ['cross-breed', 'cross-bred', 'Scientists cross-bred African bees with European bees.'],
  ['review', 'review', 'As one book review puts it, Hawking\'s book "marries a child\'s wonder to a genius\'s intellect."'],
  ['resist', 'resist', 'The story of an army of deadly bees relentlessly marching north was too good for the audience to resist.'],
];

// --- 데이터: C1 Lesson 08 의 20개 단어에만, 준 문장 그대로, 답은 문장에 앞뒤가 떨어진 채 정확히 한 번.
const html = fs.readFileSync(file, 'utf8');
const OPEN = '<script type="application/json" id="lesson-data">';
const data = JSON.parse(html.slice(html.indexOf(OPEN) + OPEN.length, html.indexOf('</script>', html.indexOf(OPEN))));
const withSentence = data.lessons.flatMap(lesson => lesson.words.filter(w => w.sentence).map(w => [lesson.id, w]));
assert.equal(withSentence.length, 20, 'exactly 20 sentence sets');
assert(withSentence.every(([id]) => id === LESSON), 'only C1 Lesson 08 has sentences for now');
const lesson08 = data.lessons.find(l => l.id === LESSON);
for (const [word, answer, text] of SETS) {
  const entry = lesson08.words.find(w => w.word === word);
  assert(entry, `${word} is in the lesson`);
  assert.deepEqual(entry.sentence, { text, answer }, `${word}: the given sentence verbatim`);
  const keys = Object.keys(entry);
  assert.equal(keys[keys.indexOf('translation') + 1], 'sentence', `${word}: sentence sits after translation`);
  assert.equal(keys[keys.indexOf('sentence') + 1], 'sources', `${word}: and before sources`);
  const esc = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.equal((text.match(new RegExp(`(?<![A-Za-z-])${esc}(?![A-Za-z-])`, 'g')) || []).length, 1, `${word}: the answer appears once, standalone`);
}

const SPY = () => {
  window.__spoken = [];
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; } } });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [{ lang: 'ko-KR', name: 'Test Korean', localService: true }, { lang: 'en-US', name: 'Test US', localService: true }],
    addEventListener: () => {}, cancel: () => {},
    speak: u => window.__spoken.push({ text: u.text, lang: u.lang }),
  } });
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
    const open = id => page.evaluate(id => { chooseLevel(lessons.find(l => l.id === id).level); }, id).then(() => page.locator(`[data-lesson="${id}"]`).click());
    await page.goto(pageURL);

    // --- 문장 세트가 없는 수업: 버튼은 보이되 꺼져 있고, 빠른 선택에도 없다.
    await open('albatross-c2-lesson-03');
    assert.deepEqual(await page.locator('[data-selection-action="mode"]').evaluateAll(els => els.map(e => e.dataset.mode)), ['en', 'ko', 'cloze', 'sentence', 'listen', 'mix']);
    assert(await mode('sentence').isDisabled(), 'off in a lesson without sentences');
    assert.equal(await mode('sentence').getAttribute('title'), '이 수업에는 아직 문장 세트가 없어요');
    assert.equal(await page.locator('[data-filter="sentence"]').count(), 0);
    // 다른 수업에서 골라 둔 문장 완성이 남아 있으면, 도움말이 쓸 수 있는 수업과 대신 내는 방식을 알려 준다.
    await page.evaluate(() => setStudyMode('sentence'));
    assert.match(await page.locator('#mode-help').innerText(), /아직 문장 세트가 없어요.*Albatross C1 Lesson 08.*영어 뜻 고르기로/);
    await page.evaluate(() => { setDraftSelection([0, 1]); beginSelectedStudy(); });
    assert.equal(await page.evaluate(() => state.mode), 'en', 'falls back to English definitions');
    await page.evaluate(() => { setStudyMode('en'); showLessons(); });

    // --- C1 Lesson 08: 버튼이 켜지고, 도움말이 20개에만 나온다고 알려 주고, 빠른 선택이 그 20개를 고른다.
    await open(LESSON);
    assert(await mode('sentence').isEnabled());
    assert.equal(await mode('sentence').innerText(), '문장 완성');
    await mode('sentence').click();
    assert.equal(await mode('sentence').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => localStorage.getItem('albatross-mode')), 'sentence', 'the choice is saved');
    const help = await page.locator('#mode-help').innerText();
    assert.match(help, /바뀐 꼴/); assert.match(help, /20개 단어에만/); assert.match(help, /문장 있는 단어/);
    const quick = page.locator('[data-selection-action="filter"][data-filter="sentence"]');
    assert.equal(await quick.innerText(), '문장 있는 단어 20개');
    await quick.click();
    assert.equal(await quick.getAttribute('aria-pressed'), 'true');
    const picked = await page.evaluate(() => [...state.draftIds].sort((a, b) => a - b).map(i => words[i].word));
    assert.deepEqual(picked.slice().sort(), SETS.map(s => s[0]).sort(), 'the quick pick selects exactly the 20 sentence words');
    await snap(page, { path: path.join(__dirname, 'screenshots', 'sentence-selection.png'), fullPage: false });

    // --- 20문제를 모두 풀어 본다: 빈칸 문장, 보기 4개(모두 문장 답, 정답 하나), 읽기·피드백.
    await page.locator('[data-selection-action="start"]').click();
    const answers = SETS.map(s => s[1]);
    const family = part => /adverb/.test(part) ? 'adv' : /adjective/.test(part) ? 'adj' : /noun/.test(part) ? 'noun' : /verb/.test(part) ? 'verb' : 'other';
    const parts = Object.fromEntries(SETS.map(([word, answer]) => [answer, lesson08.words.find(w => w.word === word).part]));
    for (let n = 0; n < 20; n++) {
      await page.evaluate(() => { window.__spoken.length = 0; });
      const q = await page.evaluate(() => ({
        mode: state.mode, word: currentWord().word, set: currentWord().sentence,
        heading: document.getElementById('screen-title').textContent,
        blanks: document.querySelectorAll('#screen-title .cloze-blank[role="img"][aria-label="빈칸"]').length,
        prompt: document.getElementById('question-prompt').textContent,
        chip: document.querySelector('.mode-chip').textContent,
        options: state.options.map(o => ({ text: o.text, correct: o.correct })),
        shown: [...document.querySelectorAll('.choice-text')].map(el => el.textContent),
        wordButton: document.querySelectorAll('.question-card [data-speak="word"]').length,
        masked: document.getElementById('word-list').classList.contains('is-masked'),
        rivals: state.options.filter(o => !o.correct).map(o => words.find(w => w.sentence && w.sentence.answer === o.text)).filter(other => isRival(currentWord(), other)).length,
      }));
      const [, answer, text] = SETS.find(s => s[0] === q.word);
      assert.equal(q.mode, 'sentence', `${q.word}: asked as a sentence`);
      assert.equal(q.chip, '문장 완성');
      const at = text.indexOf(answer);
      assert.equal(q.heading, `${text.slice(0, at)}\u00a0\u00a0\u00a0\u00a0${text.slice(at + answer.length)}`, `${q.word}: the sentence with the answer blanked`);
      assert.equal(q.blanks, 1);
      assert.match(q.prompt, /빈칸에 알맞은 말은\?/);
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options.map(o => o.text.toLowerCase())).size, 4, 'no duplicate options');
      assert.deepEqual(q.options.filter(o => o.correct).map(o => o.text), [answer], 'one correct option, the in-sentence form');
      assert(q.options.every(o => answers.includes(o.text)), `${q.word}: every option is another sentence's answer`);
      assert.deepEqual(q.shown, q.options.map(o => o.text));
      assert.equal(q.rivals, 0, 'same-meaning pairs are kept out');
      // 같은 품사 계열이 3개 이상이면 오답 3개가 모두 그 계열이다(형용사 5개·명사 7개·동사 4개).
      const same = answers.filter(a => a !== answer && family(parts[a]) === family(parts[answer])).length;
      if (same >= 3) assert(q.options.every(o => family(parts[o.text]) === family(parts[answer])), `${q.word}: distractors share the part of speech`);
      assert.equal(q.wordButton, 0, 'no "단어 듣기" while the word is the answer');
      assert(q.masked, 'the word strip is masked');
      assert.deepEqual(await page.evaluate(() => window.__spoken), [], 'nothing is read on entry (it would read a gap)');

      // 짝수 번째는 맞히고 홀수 번째는 틀린다.
      const right = n % 2 === 0;
      const index = q.options.findIndex(o => o.correct === right);
      await page.locator(`[data-choice="${index}"]`).click();
      await page.waitForFunction(t => window.__spoken.some(s => s.text === t), text);
      const f = await page.evaluate(() => ({
        sentence: document.querySelector('.sentence-answer p[lang="en"]')?.textContent,
        fill: document.querySelector('.sentence-answer .sentence-fill')?.textContent,
        form: document.querySelector('.sentence-answer .sentence-form')?.textContent || null,
        sentenceButton: document.querySelectorAll('.sentence-answer [data-speak="sentence"]').length,
        yours: document.querySelector('.your-answer > span')?.textContent || null,
        spoken: window.__spoken.map(s => s.text),
      }));
      assert.equal(f.sentence, text, `${q.word}: the completed sentence`);
      assert.equal(f.fill, answer);
      if (answer.toLowerCase() === q.word) assert.equal(f.form, null, `${q.word}: no form note when the form is the headword`);
      else assert.equal(f.form, `빈칸에 들어간 꼴 ${answer} · 학습 단어 ${q.word}`, `${q.word}: form note`);
      assert.equal(f.sentenceButton, 1);
      assert.equal(f.yours, right ? null : '내가 고른 단어');
      assert.deepEqual(f.spoken, right ? [text] : ['틀렸어요~', text], `${q.word}: reads the whole completed sentence`);
      if (n === 13) await snap(page, { path: path.join(__dirname, 'screenshots', 'sentence-feedback.png'), fullPage: true });
      // '문장 듣기' 버튼은 문장 전체를 읽는다.
      await page.evaluate(() => { window.__spoken.length = 0; });
      await page.locator('.sentence-answer [data-speak="sentence"]').click();
      await page.waitForFunction(t => window.__spoken.some(s => s.text === t), text);
      // 기록은 원래 단어(표제어)로 남는다.
      assert.equal(await page.evaluate(w => progress.stats['albatross-c1-lesson-08'][w].lastResult, q.word), right);
      if (n === 19) break;
      await page.locator('[data-action="next"]').click();
    }

    // --- 피드백 화면에서 새로 고침해도 문장 완성 피드백이 그대로 돌아온다(세션에 mode 'sentence' 저장).
    await page.reload();
    await open(LESSON);
    await page.locator('[data-selection-action="resume"]').click();
    assert.equal(await page.evaluate(() => state.mode), 'sentence');
    assert.equal(await page.locator('.sentence-answer').count(), 1, 'the feedback is restored');
    await page.locator('[data-action="next"]').click();
    assert.equal(await page.evaluate(() => state.phase), 'summary');

    // --- 문장이 없는 단어는 문장 완성을 골라도 영어 뜻 고르기로, 섞어서에는 문장이 있는 단어에만 들어간다.
    await page.evaluate(() => showLessons());
    await open(LESSON);
    const fallback = await page.evaluate(() => {
      const nuance = words.findIndex(w => w.word === 'nuance'), pale = words.findIndex(w => w.word === 'pale');
      return { nuance: availableModes(words[nuance]), pale: availableModes(words[pale]) };
    });
    assert(!fallback.nuance.includes('sentence'));
    assert.deepEqual(fallback.pale, ['en', 'ko', 'cloze', 'sentence', 'listen'], 'pale: sentence sits after cloze, listen stays last');
    await page.evaluate(() => { setDraftSelection([words.findIndex(w => w.word === 'nuance')]); beginSelectedStudy(); });
    assert.equal(await page.evaluate(() => state.mode), 'en');

    // --- 오답 노트: 틀린 문장 단어는 노트에서도 문장 완성으로 나오고, 보기는 원래 수업의 문장 답이다.
    await page.evaluate(() => showLessons());
    await page.evaluate(() => openLesson(WRONG_ID));
    assert(await mode('sentence').isEnabled(), 'the notebook has sentence words');
    const notebook = await page.evaluate(() => {
      const ids = words.map((w, i) => w.sentence ? i : -1).filter(i => i >= 0);
      setDraftSelection(ids); beginSelectedStudy();
      return { count: ids.length, mode: state.mode, options: state.options.map(o => o.text), lessonId: currentWord().lessonId };
    });
    assert.equal(notebook.count, 10, 'the 10 missed sentence words are in the notebook');
    assert.equal(notebook.mode, 'sentence');
    assert.equal(notebook.lessonId, LESSON);
    assert(notebook.options.every(o => answers.includes(o)), 'options come from the original lesson');

    // --- 폰 폭: 문제·피드백 모두 가로로 넘치지 않는다.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.evaluate(() => showLessons());
    await open(LESSON);
    await page.evaluate(() => { setDraftSelection([words.findIndex(w => w.word === 'pale')]); beginSelectedStudy(); });
    assert.equal(await page.evaluate(() => state.mode), 'sentence');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'question fits at 360px');
    await page.locator('[data-choice="0"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'feedback fits at 360px');
    await snap(page, { path: path.join(__dirname, 'screenshots', 'sentence-feedback-mobile.png'), fullPage: true });

    assert.deepEqual(errors, []);
    console.log('PASS: C1 Lesson 08 carries the 20 given sentence sets verbatim (only there; answer once, standalone; field order kept); "문장 완성" is offered only where sentences exist (off with a help note elsewhere, fallback to English definitions); quick pick selects the 20; all 20 questions blank the in-sentence form, offer 4 distinct in-sentence answers with one correct, same part of speech first, no rivals, no word audio; feedback shows the completed sentence, form note (pales ← pale), reads the sentence, records the headword; feedback survives reload; words without sentences fall back; the wrong notebook keeps the mode; fits 360px.');
  } finally {
    await browser.close();
  }
})();
