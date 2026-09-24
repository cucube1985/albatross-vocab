const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snap = (page, options) => process.env.QA_SCREENSHOTS ? (fs.mkdirSync(path.dirname(options.path), { recursive: true }), page.screenshot(options)) : Promise.resolve(); // 스크린샷은 QA_SCREENSHOTS=1 일 때만 qa/screenshots/ 에 남겨요.
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const pageURL = pathToFileURL(path.join(root, 'albatross-c2-lesson-03.html')).href;
const C2 = 'albatross-c2-lesson-03', C1 = 'albatross-c1-lesson-02';

// speechSynthesis 와 AudioContext 를 스텁해서, 무엇을 읽고 어떤 음을 울렸는지 기록한다.
const SPY = () => {
  window.__spoken = [];
  window.__tones = [];
  window.__contexts = 0;
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: class { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; } },
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [{ lang: 'ko-KR', name: 'Test Korean' }, { lang: 'en-GB', name: 'Test GB' }],
      addEventListener: () => {}, cancel: () => {},
      speak: u => window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate, pitch: u.pitch }),
    },
  });
  class Param { constructor() { this.events = []; } setValueAtTime(v, t) { this.events.push(['set', v, t]); } exponentialRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); } }
  class Osc { constructor() { this.frequency = new Param(); this.type = 'sine'; } connect() { return this; } start(t) { window.__tones.push({ type: this.type, freq: this.frequency.events[0][1], start: t }); } stop() {} }
  class Gain { constructor() { this.gain = new Param(); } connect() { return this; } }
  class Ctx { constructor() { window.__contexts++; this.currentTime = 0; this.state = 'running'; this.destination = {}; } createOscillator() { return new Osc(); } createGain() { return new Gain(); } resume() { return Promise.resolve(); } }
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: Ctx });
  Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.addInitScript(SPY);

    const answer = async correct => {
      const i = await page.evaluate(want => state.options.findIndex(o => o.correct === want), correct);
      await page.locator(`[data-choice="${i}"]`).click();
    };
    const next = () => page.locator('[data-action="next"]').click();
    const tones = () => page.evaluate(() => window.__tones);
    const spoken = () => page.evaluate(() => window.__spoken);
    const clear = () => page.evaluate(() => { window.__tones.length = 0; window.__spoken.length = 0; });
    const notebookButton = page.locator('#wrong-notebook .notebook-start');

    await page.goto(pageURL);

    /* ---------- 오답 노트: 처음엔 비어 있다 ---------- */
    assert(await notebookButton.isDisabled(), 'empty notebook must be disabled');
    assert.match(await page.locator('#wrong-notebook .notebook-copy').innerText(), /아직 틀린 단어가 없어요/);
    assert.equal(await page.locator('#wrong-notebook .notebook-chip').count(), 0);

    /* ---------- 수업 C2·03: pessimistic·implement 틀리고 external 맞히기 (효과음 검증 포함) ---------- */
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), C2).then(() => page.locator(`[data-lesson="${C2}"]`).click());
    await page.evaluate(() => setDraftSelection([0, 1, 2]));
    await page.locator('[data-selection-action="start"]').click();
    assert.equal(await page.evaluate(() => window.__contexts), 0, 'AudioContext is created lazily, not at load');
    let checkedWrongSound = false, checkedRightSound = false;
    for (let i = 0; i < 3; i++) {
      const word = await page.evaluate(() => currentWord().word);
      await clear();
      const correct = word === 'external';
      await answer(correct);
      const played = await tones();
      if (correct && !checkedRightSound) {
        // 딩동댕: 도(523)·미(659)·솔(784) 상승 + 반짝임 한 음, 시작 시각도 순서대로.
        assert.equal(played.length, 4, 'the chime is four tones');
        const [a, b, c] = played;
        assert(a.freq < b.freq && b.freq < c.freq, `chime must rise: ${a.freq} ${b.freq} ${c.freq}`);
        assert(a.start < b.start && b.start < c.start, 'chime notes are staggered in time');
        assert.equal(Math.round(a.freq), 523); assert.equal(Math.round(b.freq), 659); assert.equal(Math.round(c.freq), 784);
        await page.waitForTimeout(900);
        assert.deepEqual(await spoken(), [], 'correct in en mode: chime only, no speech');
        checkedRightSound = true;
      }
      if (!correct && !checkedWrongSound) {
        // 오답: 낮게 내려가는 두 음, 그 다음 시무룩한 "틀렸어요~" (en 모드라 단어는 다시 읽지 않는다).
        assert.equal(played.length, 2, 'the wrong sound is two tones');
        assert(played[0].freq > played[1].freq, 'wrong sound must fall');
        await page.waitForFunction(() => window.__spoken.length >= 1, null, { timeout: 3000 });
        const sad = await spoken();
        assert.deepEqual(sad.map(s => s.text), ['틀렸어요~']);
        assert.equal(sad[0].lang, 'ko-KR');
        assert(sad[0].pitch < 1 && sad[0].rate < 0.9, 'dejected voice');
        checkedWrongSound = true;
      }
      await next();
    }
    assert(checkedWrongSound && checkedRightSound);
    assert.equal(await page.evaluate(() => window.__contexts), 1, 'one AudioContext, reused');
    assert.equal(await page.locator('.summary-title').count(), 1);

    /* ---------- 효과음 끄기: 소리도 "틀렸어요"도 없다 ---------- */
    await page.locator('#back-to-lessons').click();
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), C1).then(() => page.locator(`[data-lesson="${C1}"]`).click());
    await page.evaluate(() => setDraftSelection([0]));
    await page.locator('[data-selection-action="start"]').click();
    await page.locator('#sound-toggles [data-sound="effects"]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('albatross-sound')).effects), false);
    await clear();
    await answer(false);
    await page.waitForTimeout(900);
    assert.deepEqual(await tones(), [], 'effects off: no tones');
    assert.deepEqual(await spoken(), [], 'effects off: no 틀렸어요 either');
    await page.locator('#sound-toggles [data-sound="effects"]').click();
    await next();

    /* ---------- 라이브러리: 오답 노트에 3개 (C2·03 2개, C1·02 1개) ---------- */
    await page.locator('#back-to-lessons').click();
    assert.match(await notebookButton.innerText(), /틀린 단어만 공부하기 \(3개\)/);
    assert(await notebookButton.isEnabled());
    assert.deepEqual(await page.locator('#wrong-notebook .notebook-chip').allInnerTexts(), ['C2·03 2개', 'C1·02 1개']);
    assert.match(await page.locator('#wrong-notebook .notebook-copy').innerText(), /틀린 단어 3개/);

    /* ---------- 노트 열기: 전부 선택된 채로, 출처가 보인다 ---------- */
    await notebookButton.click();
    assert.equal(await page.locator('#edition').innerText(), 'WRONG NOTEBOOK');
    assert.equal(await page.locator('.word-pick').count(), 3);
    assert.equal(await page.evaluate(() => state.draftIds.size), 3, 'all wrong words are pre-selected');
    assert.deepEqual(await page.locator('.pick-origin').allInnerTexts(), ['C2·03 · 1번', 'C2·03 · 2번', 'C1·02 · 1번']);
    assert.deepEqual(await page.locator('.pick-word').allInnerTexts(), ['pessimistic', 'implement', 'neurotransmitter']);
    assert.equal(await page.locator('.notebook-note').count(), 1);
    assert.equal(await page.locator('.selection-resume').count(), 0);
    assert.equal(await page.locator('.pick-state.is-wrong').count(), 3, 'every notebook word carries its wrong badge');

    /* ---------- 노트 학습: 기록은 원래 수업에 쌓이고, 노트 id 로는 쌓이지 않는다 ---------- */
    await page.locator('[data-selection-action="start"]').click();
    assert.deepEqual(await page.locator('#word-list .word-num').allInnerTexts(), ['01', '02', '03'], 'notebook renumbers 1..N');
    assert.match(await page.locator('.expression-label').innerText(), /^C[12]·0\d · 학습 목록 0\d · 함께 익힐 표현$/);
    const first = await page.evaluate(() => ({ word: currentWord().word, lessonId: currentWord().lessonId }));
    const before = await page.evaluate(({ lessonId, word }) => ({ ...progress.stats[lessonId][word] }), first);
    assert.equal(before.lastResult, false);
    await answer(true);
    const after = await page.evaluate(({ lessonId, word }) => ({ ...progress.stats[lessonId][word] }), first);
    assert.equal(after.lastResult, true, 'the origin lesson record is updated');
    assert.equal(after.box, before.box + 1, 'the Leitner box advances on the origin record');
    assert.equal(await page.evaluate(() => progress.stats['wrong-notebook']), undefined, 'no stats are filed under the virtual lesson');
    assert.match(await page.locator('.result-meaning, .meaning-ko').first().innerText(), /.+/);

    /* ---------- 풀던 중 새로고침: 스냅샷으로 같은 단어에서 이어진다 ---------- */
    await page.reload();
    assert.match(await notebookButton.innerText(), /풀던 오답 노트 이어하기/);
    await notebookButton.click();
    assert.equal(await page.locator('.selection-resume').count(), 1, 'in-progress notebook session survives reload');
    assert.equal(await page.locator('.word-pick').count(), 3, 'the snapshot keeps all three words even though one is now correct');
    await page.locator('[data-selection-action="resume"]').click();
    assert.equal(await page.locator('.feedback-card').count(), 1);
    assert.equal(await page.evaluate(() => currentWord().word), first.word, 'resumed on the same word');
    await next();
    // 두 번째는 틀리고 세 번째는 맞힌다 → 노트에는 1개만 남아야 한다.
    const second = await page.evaluate(() => currentWord().word);
    await answer(false); await next();
    await answer(true); await next();
    assert.equal(await page.locator('.summary-title').count(), 1);
    assert.equal(await page.locator('.result-list li').count(), 3);
    assert.match(await page.locator('.result-list li .result-meaning').first().innerText(), / · C[12]·0\d$/, 'summary rows show the origin lesson');
    assert.match(await page.locator('.weak-words .section-title').innerText(), /원래 수업 기록 기준/);
    // TXT 저장: 노트에서는 [C2·03 2] 처럼 출처 수업과 원래 번호가 붙고, 파일명은 오답_노트_ 로 시작한다.
    const downloading = page.waitForEvent('download');
    await page.locator('[data-action="export-wrong"]').click();
    const download = await downloading;
    assert.match(download.suggestedFilename(), /^오답_노트_오답_/);
    const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const exported = Buffer.concat(chunks).toString('utf8');
    assert.match(exported, /^\[C[12]·0\d \d+\] \S+/m, 'export lines carry the origin lesson label and the original number');
    assert.equal(/^\[\d+\] /m.test(exported), false, 'the notebook never prints its own 1..N index');

    /* ---------- 결과까지 본 뒤 다시 열면: 최신 목록(1개)으로 새로 시작, 이어하기 없음 ---------- */
    await page.locator('#back-to-lessons').click();
    assert.match(await notebookButton.innerText(), /틀린 단어만 공부하기 \(1개\)/);
    await notebookButton.click();
    assert.equal(await page.locator('.word-pick').count(), 1);
    assert.equal(await page.locator('.pick-word').innerText(), second);
    assert.equal(await page.locator('.selection-resume').count(), 0, 'a finished notebook session is not offered again');

    /* ---------- 노트가 1개뿐이어도 뜻→영단어 보기는 원래 수업에서 4개를 만든다 ---------- */
    await page.locator('[data-selection-action="mode"][data-mode="ko"]').click();
    await page.evaluate(() => setDraftSelection([0]));
    await page.locator('[data-selection-action="start"]').click();
    const koView = await page.evaluate(() => ({ mode: state.mode, options: state.options.map(o => o.text), lessonId: currentWord().lessonId, pool: lessons.find(l => l.id === currentWord().lessonId).words.map(w => w.word) }));
    assert.equal(koView.mode, 'ko');
    assert.equal(koView.options.length, 4);
    for (const text of koView.options) assert(koView.pool.includes(text), `"${text}" must come from the origin lesson`);
    await answer(true); await next();
    await page.locator('#back-to-lessons').click();
    assert(await notebookButton.isDisabled(), 'once every word is answered right, the notebook empties');
    await page.locator('[data-selection-action="mode"][data-mode="en"]').click().catch(() => {});

    /* ---------- 같은 단어가 두 수업에 있을 때(incentive: C2·05 / C1·04) 노트는 (수업, 단어) 쌍으로 구분한다 ---------- */
    const miss = async (lessonId, index) => {
      await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), lessonId).then(() => page.locator(`[data-lesson="${lessonId}"]`).click());
      await page.evaluate(i => setDraftSelection([i]), index);
      await page.locator('[data-selection-action="start"]').click();
      await answer(false); await next();
      await page.locator('#back-to-lessons').click();
    };
    const [twinA, twinB] = await page.evaluate(() => ['albatross-c2-lesson-05', 'albatross-c1-lesson-04'].map(id => lessons.find(l => l.id === id).words.findIndex(w => w.word === 'incentive')));
    assert(twinA >= 0 && twinB >= 0, 'the data still has incentive in both lessons');
    await miss('albatross-c2-lesson-05', twinA);
    await miss('albatross-c1-lesson-04', twinB);
    assert.match(await notebookButton.innerText(), /\(2개\)/);
    await notebookButton.click();
    assert.deepEqual(await page.locator('.pick-word').allInnerTexts(), ['incentive', 'incentive'], 'both twins are listed');
    assert.deepEqual(await page.locator('.pick-origin').allInnerTexts(), await page.evaluate(() => words.map(w => `${w.lessonLabel} · ${w.sourceNumber}번`)));
    assert.deepEqual(await page.locator('.pick-origin').evaluateAll(els => els.map(e => e.id)), ['pick-origin-0', 'pick-origin-1']);
    assert.match(await page.locator('.word-pick input').nth(1).getAttribute('aria-describedby'), /pick-origin-1$/, 'the origin is part of the checkbox description');

    // 선택 화면에서 하나를 해제하고 나갔다 돌아오면 그 선택이 남는다(정체성 기준).
    await page.locator('.word-pick input').nth(1).click();
    assert.equal(await page.evaluate(() => state.draftIds.size), 1);
    await page.locator('#back-to-lessons').click();
    await notebookButton.click();
    assert.deepEqual(await page.evaluate(() => [...state.draftIds]), [0], 'the unchecked twin stays unchecked after leaving and returning');
    await page.evaluate(() => setDraftSelection([0, 1]));
    await page.locator('[data-selection-action="start"]').click();
    const firstTwin = await page.evaluate(() => currentWord().lessonId);
    const otherTwin = firstTwin === 'albatross-c2-lesson-05' ? 'albatross-c1-lesson-04' : 'albatross-c2-lesson-05';
    await answer(true);
    assert.equal(await page.evaluate(id => progress.stats[id].incentive.lastResult, firstTwin), true, 'only the answered lesson record flips');
    assert.equal(await page.evaluate(id => progress.stats[id].incentive.lastResult, otherTwin), false, 'the twin in the other lesson stays wrong');
    await page.reload();
    await notebookButton.click();
    assert.equal(await page.locator('.word-pick').count(), 2, 'the snapshot resolves both twins after reload');
    await page.locator('[data-selection-action="resume"]').click();
    await next(); await answer(true); await next();
    await page.locator('#back-to-lessons').click();
    assert(await notebookButton.isDisabled());

    /* ---------- 노트 1개를 풀던 중 원래 수업에서 맞히면: 스냅샷에 틀린 단어가 없으니 세션을 버린다 ---------- */
    await miss(C2, 5);
    await notebookButton.click();
    await page.locator('[data-selection-action="start"]').click();
    await page.locator('#back-to-lessons').click();
    assert.match(await notebookButton.innerText(), /풀던 오답 노트 이어하기/);
    await page.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), C2).then(() => page.locator(`[data-lesson="${C2}"]`).click());
    await page.evaluate(() => setDraftSelection([5]));
    await page.locator('[data-selection-action="start"]').click();
    await answer(true); await next();
    await page.locator('#back-to-lessons').click();
    assert(await notebookButton.isDisabled(), 'a snapshot with no remaining wrong words is stale, so nothing is offered');
    assert.match(await page.locator('#wrong-notebook .notebook-copy').innerText(), /아직 틀린 단어가 없어요/);
    await miss(C2, 6);
    await notebookButton.click();
    assert.equal(await page.locator('.word-pick').count(), 1);
    assert.equal(await page.locator('.selection-resume').count(), 0, 'the stale session never resurfaces');
    await page.locator('#back-to-lessons').click();

    await snap(page, { path: path.join(__dirname, 'screenshots', 'notebook-library-empty.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();

    /* ---------- 소리 설정 불러오기: 저장된 OFF 가 화면과 동작에 반영되고, 학습 기록 초기화에도 남는다 ---------- */
    const quiet = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    quiet.setDefaultTimeout(8000);
    const quietErrors = [];
    quiet.on('pageerror', e => quietErrors.push(e.message));
    quiet.on('dialog', d => d.accept());
    await quiet.addInitScript(SPY);
    await quiet.goto(pageURL);
    await quiet.evaluate(() => localStorage.setItem('albatross-sound', JSON.stringify({ autoRead: false, effects: false })));
    await quiet.reload();
    await quiet.evaluate(id => chooseLevel(lessons.find(l => l.id === id).level), C2).then(() => quiet.locator(`[data-lesson="${C2}"]`).click());
    await quiet.evaluate(() => setDraftSelection([0, 1]));
    await quiet.locator('[data-selection-action="start"]').click();
    assert.deepEqual(await quiet.locator('#sound-toggles [data-sound]').evaluateAll(els => els.map(e => e.getAttribute('aria-pressed'))), ['false', 'false'], 'saved OFF state is shown');
    assert.deepEqual(await quiet.evaluate(() => window.__spoken), [], 'auto-read off: nothing spoken on entry');
    await quiet.locator(`[data-choice="${await quiet.evaluate(() => state.options.findIndex(o => !o.correct))}"]`).click();
    await quiet.waitForTimeout(900);
    assert.deepEqual(await quiet.evaluate(() => [window.__tones.length, window.__spoken.length]), [0, 0], 'effects off: neither tones nor 틀렸어요');
    // 키보드로 토글해도 포커스가 버튼에 남는다.
    await quiet.locator('#sound-toggles [data-sound="effects"]').focus();
    await quiet.keyboard.press('Enter');
    assert.equal(await quiet.evaluate(() => document.activeElement && document.activeElement.dataset.sound), 'effects', 'toggling keeps keyboard focus on the button');
    assert.equal(await quiet.locator('#sound-toggles [data-sound="effects"]').getAttribute('aria-pressed'), 'true');
    await quiet.locator('#back-to-lessons').click();
    await quiet.locator('#reset-progress').click();
    assert.deepEqual(await quiet.evaluate(() => JSON.parse(localStorage.getItem('albatross-sound'))), { autoRead: false, effects: true }, 'resetting progress leaves the sound settings alone');
    assert.deepEqual(quietErrors, []);
    await quiet.close();
    console.log('PASS: chime rises (C5·E5·G5), wrong sound falls then 틀렸어요~ in a dejected Korean voice, effects toggle silences both, lazy single AudioContext; wrong notebook gathers last-wrong words across lessons with origin labels, files records on the origin lesson, survives reload via snapshot, drops finished sessions, refreshes membership, builds ko choices from the origin lesson, empties when all are correct.');
  } finally {
    await browser.close();
  }
})();
