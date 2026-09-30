const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const baseUrl = process.env.PARTY_CATS_URL || 'http://127.0.0.1:4173';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      errors.push(`http ${response.status()}: ${response.url()}`);
    }
  });

  const out = path.join(__dirname, 'qa');
  fs.mkdirSync(out, { recursive: true });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#gameCanvas')?.dataset.questionId);
  await page.screenshot({ path: path.join(out, '01-game-start.png'), fullPage: true });

  const resourceAudit = await page.evaluate(async () => {
    const results = [];
    for (let id = 1; id <= 10; id += 1) {
      const key = String(id).padStart(2, '0');
      const base = `assets/questions/question-${key}/`;
      const mappingResponse = await fetch(`${base}mapping.json`);
      if (!mappingResponse.ok) throw new Error(`Question ${id} mapping HTTP ${mappingResponse.status}`);
      const mapping = await mappingResponse.json();
      const imageResponse = await fetch(`${base}${mapping.image}`);
      results.push({ id, cats: mapping.cats.length, unique: new Set(mapping.cats.map(cat => cat.name)).size, imageStatus: imageResponse.status });
    }
    return results;
  });
  if (resourceAudit.some(item => item.cats !== 23 || item.unique !== 23 || item.imageStatus !== 200)) {
    throw new Error(`Question resource audit failed: ${JSON.stringify(resourceAudit)}`);
  }

  const catCount = 23;
  const firstQuestion = await page.locator('#gameCanvas').getAttribute('data-question-id');
  if (!Array.from({ length: 10 }, (_, index) => String(index + 1)).includes(firstQuestion)) {
    throw new Error(`Unexpected first question: ${firstQuestion}`);
  }
  const canvas = page.locator('#gameCanvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');

  // Selecting before all four reveals must be blocked.
  await page.mouse.click(box.x + box.width * .5, box.y + box.height * .5);
  if (!(await page.locator('#confirmButton').isDisabled())) throw new Error('Selection was allowed before four reveals');

  // Reveal three distinct cells from the fixed 3x4 reveal grid.
  const revealPoints = [[.125,.16],[.375,.16],[.625,.16],[.875,.16]];
  for (const [rx, ry] of revealPoints) {
    await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry);
  }
  const usedPaws = await page.locator('#turnPaws .used').count();
  if (usedPaws !== 4) throw new Error(`Expected 4 used reveals, got ${usedPaws}`);

  const questionId = await canvas.getAttribute('data-question-id');
  const target = await page.evaluate(async id => {
    const base = `assets/questions/question-${String(id).padStart(2, '0')}/mapping.json`;
    const mapping = await (await fetch(base)).json();
    const cat = mapping.cats[0];
    return { name: cat.name, region: cat.region };
  }, Number(questionId));
  await page.mouse.click(
    box.x + box.width * (target.region.x + target.region.width / 2),
    box.y + box.height * (target.region.y + target.region.height / 2)
  );
  if (await page.locator('#confirmButton').isDisabled()) throw new Error('No cat slot could be selected');
  await page.screenshot({ path: path.join(out, '03-game.png'), fullPage: true });

  await page.click('#confirmButton');
  await page.waitForSelector('#resultModal.show', { timeout: 3000 });
  const resultTitle = await page.locator('#resultTitle').textContent();
  if (!resultTitle.includes(target.name) || /正确|错误|猜错/.test(resultTitle)) throw new Error(`Unexpected nickname result: ${resultTitle}`);
  await page.screenshot({ path: path.join(out, '04-result.png'), fullPage: true });

  // A new round must switch away from the immediately previous question.
  await page.click('#playAgainButton');
  await page.waitForSelector('#gameView.active');
  const secondQuestion = await page.locator('#gameCanvas').getAttribute('data-question-id');
  if (!Array.from({ length: 10 }, (_, index) => String(index + 1)).includes(secondQuestion) || secondQuestion === firstQuestion) {
    throw new Error(`Question did not switch: ${firstQuestion} -> ${secondQuestion}`);
  }
  await page.screenshot({ path: path.join(out, '05-second-question.png'), fullPage: true });

  // Two complete bags must each contain all ten questions exactly once.
  const rotationAudit = await page.evaluate(async () => {
    questionBag = [];
    state.lastQuestionId = null;
    const ids = [];
    for (let index = 0; index < 20; index += 1) {
      await startGame();
      ids.push(Number(canvas.dataset.questionId));
    }
    return ids;
  });
  const firstBag = rotationAudit.slice(0, 10);
  const secondBag = rotationAudit.slice(10, 20);
  if (new Set(firstBag).size !== 10 || new Set(secondBag).size !== 10) {
    throw new Error(`Question shuffle bag is incomplete: ${JSON.stringify(rotationAudit)}`);
  }
  if (rotationAudit.some((id, index) => index > 0 && id === rotationAudit[index - 1])) {
    throw new Error(`Question repeated consecutively: ${JSON.stringify(rotationAudit)}`);
  }

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ catCount, usedPaws, resourceAudit, questions: [firstQuestion, secondQuestion], rotationAudit, screenshots: 5, errors: 0 }));
  await browser.close();
})().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
