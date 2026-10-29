const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

// 단어장 HTML 은 template.html + data/*.json 을 build.cjs 로 합친 결과여야 해요. 손으로 HTML 만 고치면 여기서 걸려요.
const out = execFileSync(process.execPath, [path.join(root, 'build.cjs'), '--check'], { encoding: 'utf8' });
assert.match(out, /같음: albatross-c2-lesson-03\.html/);

// 틀에는 단어 자리표시가 하나, 저장 키는 모두 자리표시로 — 단어장마다 저장소가 나뉘어요.
const template = fs.readFileSync(path.join(root, 'template.html'), 'utf8');
assert.equal(template.split('/*{{LESSON_DATA}}*/').length, 2, 'one data placeholder');
assert.equal((template.match(/'\{\{STORAGE_PREFIX\}\}-(progress-v1|mode|sound|view|theme)'/g) || []).length, 6, 'all six storage keys use the prefix');
assert(!/'albatross-(progress|mode|sound|view|theme)/.test(template), 'no hard-coded storage key left');
assert(!/"lessons"\s*:/.test(template), 'no word data inside the template');

// 단어 파일: 21개 수업 / 950단어, 문장 세트 40개.
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'albatross-c1-c2.json'), 'utf8'));
assert.equal(data.lessons.length, 21);
assert.equal(data.lessons.reduce((sum, lesson) => sum + lesson.words.length, 0), 950);
assert.equal(data.lessons.flatMap(lesson => lesson.words).filter(w => w.sentence).length, 40);

console.log('PASS: albatross-c2-lesson-03.html is exactly template.html + data/albatross-c1-c2.json (build --check); the template holds one data placeholder and all six storage keys use the per-book prefix; the data file has 21 lessons / 950 words / 40 sentence sets.');
