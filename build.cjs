// 단어장 만들기: template.html(화면·기능) + data/*.json(단어) → 단어장 HTML 파일 하나.
// 결과물은 지금처럼 의존성 없는 파일 하나라서 더블클릭(file://)으로 열어도, GitHub Pages 에서도 그대로 동작해요.
//
//   node build.cjs            모든 단어장을 다시 만들어요.
//   node build.cjs --check    다시 만든 결과가 저장된 HTML 과 똑같은지만 확인해요(QA 가 씀). 다르면 실패.
//
// 새 단어장을 만들 때는 data/ 에 단어 파일을 넣고 아래 BOOKS 에 한 줄을 더해요.
// storagePrefix 는 단어장마다 달라야 해요. 같은 GitHub 주소의 파일들은 브라우저 저장소를 함께 쓰므로, 같으면 학습 기록·설정이 섞여요.
const fs = require('node:fs');
const path = require('node:path');

const BOOKS = [
  { data: 'data/albatross-c1-c2.json', out: 'albatross-c2-lesson-03.html', storagePrefix: 'albatross' },
];

const root = __dirname;
const TEMPLATE = path.join(root, 'template.html');
const DATA_MARK = '/*{{LESSON_DATA}}*/';
const PREFIX_MARK = '{{STORAGE_PREFIX}}';

function render(template, book) {
  const data = JSON.parse(fs.readFileSync(path.join(root, book.data), 'utf8'));
  for (const key of ['lessons', 'synonymHints', 'definitionRivals']) if (!(key in data)) throw new Error(`${book.data}: '${key}' 가 없어요`);
  if (!/^[a-z0-9-]+$/.test(book.storagePrefix)) throw new Error(`${book.out}: storagePrefix 는 영문 소문자·숫자·하이픈만 써요`);
  // <script> 안에 넣으므로 '</' 가 데이터에 있으면 블록이 끊겨요. JSON 의미는 같게 '<\/' 로 바꿔 넣어요.
  const json = JSON.stringify(data, null, 2).replace(/<\//g, '<\\/');
  if (template.split(DATA_MARK).length !== 2) throw new Error('template.html 에 단어 자리표시가 정확히 하나 있어야 해요');
  return template.split(DATA_MARK).join(json).split(PREFIX_MARK).join(book.storagePrefix);
}

function main() {
  const check = process.argv.includes('--check');
  const prefixes = BOOKS.map(book => book.storagePrefix);
  if (new Set(prefixes).size !== prefixes.length) throw new Error('단어장마다 storagePrefix 가 달라야 해요');
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  let stale = 0;
  for (const book of BOOKS) {
    const html = render(template, book), target = path.join(root, book.out);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (check) {
      if (current !== html) { stale++; console.error(`다름: ${book.out} — node build.cjs 로 다시 만들어 주세요.`); }
      else console.log(`같음: ${book.out}`);
    } else if (current === html) console.log(`그대로: ${book.out}`);
    else { fs.writeFileSync(target, html); console.log(`만듦: ${book.out}`); }
  }
  if (stale) process.exit(1);
}

main();
