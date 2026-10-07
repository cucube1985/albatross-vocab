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

// 영어 뜻 고르기의 보기는 '다른 단어의 실제 교재 정의'로 만들어서, 길이·'or'·쉼표 같은 겉모습으로 정답을 고를 수 없어야 해요.
// 데이터: 뜻이 겹치는 단어 짝(definitionRivals)은 최상위 키에 있고, 짝의 두 단어는 모두 실제 표제어예요.
const headwords = new Set(data.lessons.flatMap(l => l.words.map(w => w.word.toLowerCase())));
assert(Array.isArray(data.definitionRivals), 'definitionRivals is a top-level array');
assert(data.definitionRivals.length > 0, 'the audit found overlapping pairs');
for (const pair of data.definitionRivals) {
  assert(Array.isArray(pair) && pair.length === 2 && pair.every(w => typeof w === 'string' && headwords.has(w.toLowerCase())), `rival pair uses real headwords: ${JSON.stringify(pair)}`);
  assert.notEqual(pair[0].toLowerCase(), pair[1].toLowerCase(), `rival pair has two different words: ${JSON.stringify(pair)}`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('albatross-sound', JSON.stringify({ autoRead: false, effects: false })); localStorage.setItem('albatross-mode', 'en'); });
    await page.goto(pageURL);

    // 1) 모든 수업·모든 단어: 보기 4개, 글자가 모두 다르고, 정답은 교재 정의 하나, 오답은 같은 틀의 다른 단어 정의(경쟁어 아님).
    const shape = await page.evaluate(() => {
      const problems = [], lower = v => String(v).trim().toLowerCase();
      // commission·grant·moderate 처럼 수업마다 품사·뜻이 다른 같은 표제어가 있어서, 출처는 표제어+정의로 찾아요.
      const byWord = new Map(lessons.flatMap(l => l.words.map(w => [`${lower(w.word)}\n${w.en}`, w])));
      let questions = 0, fallback = 0, crossLesson = 0;
      for (const lesson of lessons) {
        openLesson(lesson.id);
        const own = new Set(lesson.words.map(w => lower(w.word)));
        for (const w of words) for (let i = 0; i < 6; i++) {
          const options = definitionOptions(w); questions++;
          const texts = options.map(o => lower(o.text));
          if (options.length !== 4 || new Set(texts).size !== 4) problems.push(`${w.word}: not 4 distinct options`);
          const sources = options.filter(o => o.word).map(o => lower(o.word));
          if (new Set(sources).size !== sources.length) problems.push(`${w.word}: two options come from the same headword`);
          const right = options.filter(o => o.correct);
          if (right.length !== 1 || right[0].text !== w.en) problems.push(`${w.word}: the one correct option must be its own en`);
          for (const o of options.filter(o => !o.correct)) {
            if (!o.word) { fallback++; if (!w.distractors.includes(o.text)) problems.push(`${w.word}: a fallback option must come from its distractors`); continue; }
            const other = byWord.get(`${lower(o.word)}\n${o.text}`);
            if (!other) { problems.push(`${w.word}: unknown source word ${o.word}`); continue; }
            if (lower(other.word) === lower(w.word)) problems.push(`${w.word}: offered its own headword's definition`);
            if (definitionFrame(other) !== definitionFrame(w)) problems.push(`${w.word}: ${o.word} has a different definition frame`);
            if (isRival(w, other)) problems.push(`${w.word}: ${o.word} is a rival and must not be offered`);
            if (!own.has(lower(o.word))) crossLesson++;
          }
        }
      }
      // 틀과 설명 첫머리가 어긋나면 그 한 단어만 모양으로 티가 나요: 'to' 틀은 전부 'to …', 명사처럼 시작하는 설명은 전부 명사 틀.
      for (const w of lessons.flatMap(l => l.words)) {
        const frame = definitionFrame(w), en = w.en.trim();
        if (frame === 'to' && !/^to\s/i.test(en)) problems.push(`${w.word}: 'to' frame but its definition does not start with 'to'`);
        if (/^(a|an|the|someone|somebody|something)\s/i.test(en) && frame !== 'n') problems.push(`${w.word}: noun-shaped definition outside the noun frame`);
      }
      return { problems: [...new Set(problems)].slice(0, 20), questions, fallbackRate: fallback / (questions * 3), crossRate: crossLesson / (questions * 3) };
    });
    assert.deepEqual(shape.problems, [], 'every en question is well formed');
    assert(shape.fallbackRate < 0.01, `hand-written distractors are only a rare fallback (was ${shape.fallbackRate})`);
    assert(shape.crossRate < 0.1, `most distractors come from the same lesson (cross-lesson ${shape.crossRate})`);

    // 2) 겉모습 단서로는 우연(25%) 이상 맞힐 수 없어요: 가장 긴 보기, 'or'가 하나뿐인 보기, 쉼표가 하나뿐인 보기.
    const cues = await page.evaluate(() => {
      const stats = { longest: [0, 0], or: [0, 0], comma: [0, 0] };
      const only = (options, test, key) => { const hit = options.filter(o => test(o.text)); if (hit.length === 1) { stats[key][1]++; if (hit[0].correct) stats[key][0]++; } };
      for (const lesson of lessons) {
        openLesson(lesson.id);
        for (const w of words) for (let i = 0; i < 20; i++) {
          const options = definitionOptions(w);
          const max = Math.max(...options.map(o => o.text.length)), longest = options.filter(o => o.text.length === max);
          stats.longest[1]++; if (longest.length === 1 && longest[0].correct) stats.longest[0]++;
          only(options, t => /\bor\b/.test(t), 'or'); only(options, t => t.includes(','), 'comma');
        }
      }
      return Object.fromEntries(Object.entries(stats).map(([k, [hit, n]]) => [k, hit / n]));
    });
    assert(cues.longest > 0.19 && cues.longest < 0.30, `'pick the longest' should be near chance, was ${cues.longest}`);
    assert(cues.or < 0.33, `'pick the only option with or' should be near chance, was ${cues.or}`);
    assert(cues.comma < 0.33, `'pick the only option with a comma' should be near chance, was ${cues.comma}`);

    // 3) 뜻이 겹치는 짝은 영어 뜻 보기에서도, 뜻→단어 보기에서도 함께 나오지 않아요.
    const clashes = await page.evaluate(pairs => {
      const lower = v => String(v).trim().toLowerCase(), found = [];
      for (const [a, b] of pairs) for (const lesson of lessons) {
        const wa = lesson.words.find(w => lower(w.word) === lower(a)), wb = lesson.words.find(w => lower(w.word) === lower(b));
        if (!wa || !wb) continue;
        openLesson(lesson.id);
        for (let i = 0; i < 25; i++) {
          if (definitionOptions(wa).some(o => lower(o.word || '') === lower(b)) || definitionOptions(wb).some(o => lower(o.word || '') === lower(a))) { found.push(`${a}/${b} in en`); break; }
          if (wordOptions(wa).some(o => lower(o.text) === lower(b)) || wordOptions(wb).some(o => lower(o.text) === lower(a))) { found.push(`${a}/${b} in ko`); break; }
        }
      }
      return found;
    }, data.definitionRivals);
    assert.deepEqual(clashes, [], 'overlapping pairs are never offered together');

    // 4) 실제 화면: 영어 뜻 문제에서 오답을 고르면 그 설명이 어느 단어의 뜻인지 알려 주고, 새로고침 뒤에도 그대로예요.
    const LESSON = 'albatross-c2-lesson-10';
    await page.evaluate(() => { chooseLevel('C2'); });
    await page.locator(`[data-lesson="${LESSON}"]`).click();
    await page.evaluate(() => setDraftSelection([0, 1, 2]));
    await page.locator('[data-selection-action="start"]').click();
    const question = await page.evaluate(() => ({ mode: state.mode, texts: [...document.querySelectorAll('.choice-text')].map(el => el.textContent), options: state.options.map(o => ({ text: o.text, correct: o.correct, word: o.word || null })) }));
    assert.equal(question.mode, 'en');
    assert.deepEqual(question.texts, question.options.map(o => o.text), 'the rendered choices are the built options');
    const wrongIndex = question.options.findIndex(o => !o.correct && o.word);
    assert(wrongIndex >= 0, 'a wrong option carries its source word');
    await page.locator(`[data-choice="${wrongIndex}"]`).click();
    const owner = () => page.locator('.your-answer-owner');
    assert.equal(await owner().count(), 1);
    assert.equal(await owner().innerText(), `이 설명은 ${question.options[wrongIndex].word}의 뜻이에요.`);
    assert.equal(await page.locator('.your-answer-owner b').getAttribute('lang'), 'en');
    await snap(page, { path: path.join(__dirname, 'screenshots', 'definition-owner.png'), fullPage: true });
    await page.reload();
    await page.evaluate(() => chooseLevel('C2'));
    await page.locator(`[data-lesson="${LESSON}"]`).click();
    await page.locator('[data-selection-action="resume"]').click();
    assert.equal(await owner().innerText(), `이 설명은 ${question.options[wrongIndex].word}의 뜻이에요.`, 'the source word survives a reload');
    // 맞히면 표시가 없어요.
    await page.locator('[data-action="next"]').click();
    await page.locator(`[data-choice="${await page.evaluate(() => state.options.findIndex(o => o.correct))}"]`).click();
    assert.equal(await owner().count(), 0, 'no owner line after a correct answer');

    // 5) 오답 노트(여러 수업 섞임)에서도 보기는 그 단어의 원래 수업에서 와요.
    const notebook = await page.evaluate(() => {
      openLesson('wrong-notebook');
      const lower = v => String(v).trim().toLowerCase(), out = [];
      for (const w of words) { const origin = lessons.find(l => l.id === w.lessonId); const own = new Set(origin.words.map(x => lower(x.word))); const options = definitionOptions(w); out.push(options.filter(o => !o.correct && o.word).every(o => own.has(lower(o.word)) || origin.words.filter(x => definitionFrame(x) === definitionFrame(w)).length < 5)); }
      return { count: words.length, allFromOrigin: out.every(Boolean) };
    });
    assert(notebook.count >= 1, 'the wrong notebook has at least the word we missed');
    assert.equal(notebook.allFromOrigin, true, 'notebook distractors come from each word\'s original lesson');

    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS: en choices use other words' real definitions (same frame, rivals excluded; fallback ${(shape.fallbackRate * 100).toFixed(2)}%, cross-lesson ${(shape.crossRate * 100).toFixed(1)}%) — longest ${(cues.longest * 100).toFixed(1)}%, only-'or' ${(cues.or * 100).toFixed(1)}%, only-comma ${(cues.comma * 100).toFixed(1)}% (chance 25%); ${data.definitionRivals.length} overlapping pairs never shown together; wrong-answer feedback names the source word and survives reload; notebook uses origin lessons.`);
  } finally {
    await browser.close();
  }
})();
