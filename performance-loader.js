const questionImageCache = new Map();

function shuffledQuestionIds() {
  const ids = questions.map(question => question.id);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }
  return ids;
}

function refillQuestionBag() {
  questionBag = shuffledQuestionIds();
  if (questionBag.length > 1 && questionBag[0] === state.lastQuestionId) {
    const swapIndex = questionBag.findIndex(id => id !== state.lastQuestionId);
    [questionBag[0], questionBag[swapIndex]] = [questionBag[swapIndex], questionBag[0]];
  }
}

function takeNextQuestion() {
  if (!questionBag.length) refillQuestionBag();
  const nextId = questionBag.shift();
  return questions.find(question => question.id === nextId) || questions[0];
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

loadImages = async function () {
  const loaded = await Promise.all(QUESTION_IDS.map(async id => {
    const base = `assets/questions/question-${String(id).padStart(2, '0')}/`;
    const response = await fetchWithRetry(`${base}mapping.json`);
    const mapping = await response.json();
    if (mapping.cats.length !== 23 || new Set(mapping.cats.map(cat => cat.name)).size !== 23) throw new Error(`Invalid mapping ${id}`);
    return { id, mapping, imageUrl: `${base}${mapping.image}`, image: null };
  }));
  questions.push(...loaded);
};

function loadQuestionImage(question) {
  if (question.image?.complete && question.image.naturalWidth) return Promise.resolve(question.image);
  if (questionImageCache.has(question.id)) return questionImageCache.get(question.id);
  const task = (async () => {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.decoding = 'async';
          const timer = setTimeout(() => reject(new Error('timeout')), 15000);
          img.onload = async () => { clearTimeout(timer); try { await img.decode?.(); } catch (_) {} resolve(img); };
          img.onerror = () => { clearTimeout(timer); reject(new Error('read failed')); };
          img.src = `${question.imageUrl}?attempt=${attempt}`;
        });
        question.image = image;
        return image;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 350 * attempt));
      }
    }
    questionImageCache.delete(question.id);
    throw new Error(`第 ${question.id} 题图片加载失败：${lastError.message}`);
  })();
  questionImageCache.set(question.id, task);
  return task;
}

function warmNextQuestion(excludeId) {
  const nextId = questionBag.find(id => id !== excludeId);
  const next = questions.find(question => question.id === nextId && !question.image);
  if (!next) return;
  const warm = () => loadQuestionImage(next).catch(() => questionImageCache.delete(next.id));
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 3000 }); else setTimeout(warm, 600);
}

buildPicker = function () {
  const picker = $('#catPicker');
  picker.innerHTML = cats.map(cat => `<button class="cat-card" data-id="${cat.id}"><img src="${cat.src}" alt="${cat.name}" loading="lazy" decoding="async"><strong>${cat.name}</strong></button>`).join('');
  picker.addEventListener('click', async event => {
    const card = event.target.closest('.cat-card'); if (!card || card.disabled) return;
    card.disabled = true; state.target = cats[Number(card.dataset.id)]; sound('select');
    try { await startGame(); } catch (error) { alert(`题目图片加载失败，请重新点击。\n${error.message}`); } finally { card.disabled = false; }
  });
};

startGame = async function () {
  currentQuestion = takeNextQuestion();
  await loadQuestionImage(currentQuestion);
  state.lastQuestionId = currentQuestion.id; canvas.dataset.questionId = String(currentQuestion.id);
  state.revealed.clear(); state.selectedSlot = null; state.submitted = false;
  state.layout = currentQuestion.mapping.cats.map(slot => {
    const cat = cats.find(item => item.name === slot.name);
    if (!slot.region) throw new Error(`Missing region ${slot.slot}`);
    return { ...cat, slot: slot.slot, row: slot.row, column: slot.column, region: slot.region };
  });
  $('#guessText').textContent = '还没有选择'; $('#confirmButton').disabled = true;
  $('#panelTitle').textContent = '先揭开几块看看';
  $('#panelCopy').textContent = '请揭开 4 块彩色蒙版。每块可能出现多只猫或猫咪局部。';
  $('#stageHint').textContent = '点击一块彩色蒙版揭开线索'; $('#stageHint').style.opacity = '1';
  renderPaws(); buildScene(); buildMask(); render(); showView('gameView'); warmNextQuestion(currentQuestion.id);
};

window.startPartyCats();
