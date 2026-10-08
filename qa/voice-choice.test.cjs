const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/21cra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const pageURL = pathToFileURL(path.join(root, 'albatross-c2-lesson-03.html')).href;

// 브라우저마다 내주는 음성 목록을 흉내 내서, 앱이 가장 자연스러운 음성을 고르는지 확인해요.
const v = (name, lang, local) => ({ name, lang, localService: local, default: false, voiceURI: name });
const SETS = {
  // Windows Edge(인터넷 연결): 옛 음성(Heami·David)이 목록 앞에 있고, 신경망 'Online (Natural)' 음성이 뒤에 와요.
  edge: [v('Microsoft Heami - Korean (Korean)', 'ko-KR', true), v('Microsoft David - English (United States)', 'en-US', true), v('Microsoft Zira - English (United States)', 'en-US', true),
    v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false), v('Microsoft SunHi Online (Natural) - Korean (Korea)', 'ko-KR', false), v('Microsoft InJoon Online (Natural) - Korean (Korea)', 'ko-KR', false), v('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', false)],
  // Windows Chrome: Google 음성(온라인)과 Windows 옛 음성이 섞여 있어요.
  chrome: [v('Microsoft Heami - Korean (Korean)', 'ko-KR', true), v('Microsoft David - English (United States)', 'en-US', true), v('Google US English', 'en-US', false), v('Google UK English Female', 'en-GB', false), v('Google 한국의', 'ko-KR', false)],
  // 아이폰 Safari: 기본 음성과 내려받은 향상된 음성.
  ios: [v('Yuna', 'ko-KR', true), v('Samantha', 'en-US', true), v('Yuna (향상됨)', 'ko-KR', true), v('Daniel (Enhanced)', 'en-GB', true)],
  // 옛 음성만 있는 기기에서도 그대로 읽어야 해요.
  legacy: [v('Microsoft Heami Desktop - Korean', 'ko-KR', true), v('Microsoft Heami - Korean (Korean)', 'ko-KR', true), v('Microsoft David Desktop - English (United States)', 'en-US', true), v('Microsoft David - English (United States)', 'en-US', true)],
};
const STUB = ([voices, offline]) => {
  window.__spoken = [];
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.onerror = null; } } });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => voices, addEventListener: () => {}, cancel: () => {},
    speak: u => {
      window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, lang: u.lang });
      // 인터넷이 끊긴 상황: 온라인 음성은 'network' 오류를 내요.
      if (offline && u.voice && u.voice.localService === false && u.onerror) setTimeout(() => u.onerror({ error: offline }), 0);
    },
  } });
  localStorage.setItem('albatross-sound', JSON.stringify({ autoRead: false, effects: true }));
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const open = async (set, offline = null) => {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(STUB, [SETS[set], offline]);
      await page.goto(pageURL);
      const picked = await page.evaluate(() => ({ ko: koreanVoice && koreanVoice.name, en: englishVoice && englishVoice.name, koLocal: koreanLocalVoice && koreanLocalVoice.name, enLocal: englishLocalVoice && englishLocalVoice.name }));
      return { page, errors, picked };
    };

    // 1) Edge: 목록 앞의 Heami(옛 기계음) 대신 SunHi 신경망 음성, 영어는 영국 영어 신경망 음성.
    let { page, errors, picked } = await open('edge');
    assert.equal(picked.ko, 'Microsoft SunHi Online (Natural) - Korean (Korea)', 'Edge: natural Korean voice beats Heami');
    assert.equal(picked.en, 'Microsoft Sonia Online (Natural) - English (United Kingdom)', 'Edge: natural voice, British preferred on a tie');
    assert.equal(picked.koLocal, 'Microsoft Heami - Korean (Korean)', 'offline fallback is the on-device Korean voice');
    // 한국어를 읽는 곳(틀렸을 때 '틀렸어요~')이 실제로 그 음성을 써요.
    await page.evaluate(() => { openLesson('albatross-c2-lesson-09'); setStudyMode('en'); setDraftSelection([0]); beginSelectedStudy(); selectAnswer(state.options.findIndex(o => !o.correct)); });
    await page.waitForFunction(() => window.__spoken.some(s => s.text === '틀렸어요~'));
    assert.equal(await page.evaluate(() => window.__spoken.find(s => s.text === '틀렸어요~').voice), 'Microsoft SunHi Online (Natural) - Korean (Korea)');
    assert.deepEqual(errors, []); await page.close();

    // 2) Chrome: Google 음성.
    ({ page, errors, picked } = await open('chrome'));
    assert.equal(picked.ko, 'Google 한국의'); assert.equal(picked.en, 'Google UK English Female');
    assert.deepEqual(errors, []); await page.close();

    // 3) 아이폰: 향상된 음성.
    ({ page, errors, picked } = await open('ios'));
    assert.equal(picked.ko, 'Yuna (향상됨)'); assert.equal(picked.en, 'Daniel (Enhanced)');
    assert.deepEqual(errors, []); await page.close();

    // 4) 옛 음성만 있을 때: 그래도 한국어 음성을 쓰고, SAPI 'Desktop' 음성보다 OneCore 음성을 앞세워요.
    ({ page, errors, picked } = await open('legacy'));
    assert.equal(picked.ko, 'Microsoft Heami - Korean (Korean)'); assert.equal(picked.en, 'Microsoft David - English (United States)');
    assert.deepEqual(errors, []); await page.close();

    // 5) 인터넷이 끊겨 신경망 음성이 실패하면, 같은 문장을 기기 안 음성으로 한 번 더 읽어요(순서 그대로).
    ({ page, errors } = await open('edge', 'network'));
    await page.evaluate(() => speakSequence([{ text: '구별하다', lang: 'ko' }, { text: 'differentiate', lang: 'en' }]));
    await page.waitForFunction(() => window.__spoken.length >= 4);
    assert.deepEqual(await page.evaluate(() => window.__spoken.map(s => `${s.text}|${s.voice}`)), [
      '구별하다|Microsoft SunHi Online (Natural) - Korean (Korea)', 'differentiate|Microsoft Sonia Online (Natural) - English (United Kingdom)',
      '구별하다|Microsoft Heami - Korean (Korean)', 'differentiate|Microsoft David - English (United States)',
    ]);
    assert.deepEqual(errors, []); await page.close();

    // 6) 우리가 끊은 읽기(새 읽기·화면 이동으로 interrupted)는 다시 읽지 않아요.
    ({ page, errors } = await open('edge', 'interrupted'));
    await page.evaluate(() => speakSequence([{ text: '구별하다', lang: 'ko' }]));
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__spoken.length), 1, 'no retry after an interruption');
    assert.deepEqual(errors, []); await page.close();

    console.log('PASS: natural voices first — Edge Online (Natural) SunHi/Sonia over Heami/David, Google voices in Chrome, Enhanced voices on iPhone, legacy-only devices still speak (OneCore over Desktop); offline neural failures retry once with the on-device voice in order; interruptions are not retried.');
  } finally {
    await browser.close();
  }
})();
