const cats = [
  ['momo','momo.png'], ['阿残','阿残.png'], ['阿呆','阿呆.png'], ['臭头','臭头.png'],
  ['大金子','大金子.png'], ['大暑','大暑.png'], ['瓜瓜','瓜瓜.png'], ['虎子','虎子.png'],
  ['荔咚','荔咚.png'], ['胖福','胖福.png'], ['胖妮','胖妮.png'], ['皮皮','皮皮.png'],
  ['秋秋','秋秋.png'], ['球球','球球.png'], ['兽兽','兽兽.png'], ['松果','松果.png'],
  ['图图','图图.png'], ['小嘎子','小嘎子.png'], ['小猫','小猫.png'], ['小胖','小胖.png'],
  ['雪球','雪球.png'], ['元宝','元宝.png'], ['铁蛋','铁蛋.png']
].map(([name,file], id) => ({ id, name, src: `assets/cats/${file}`, image: null }));

const $ = (s) => document.querySelector(s);
const views = [...document.querySelectorAll('.view')];
const canvas = $('#gameCanvas');
const ctx = canvas.getContext('2d');
const scene = document.createElement('canvas'); scene.width = canvas.width; scene.height = canvas.height;
const sceneCtx = scene.getContext('2d');
const maskBase = document.createElement('canvas'); maskBase.width = canvas.width; maskBase.height = canvas.height;
const maskCtx = maskBase.getContext('2d');
const QUESTION_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const REVEAL_ROWS = 3;
const REVEAL_COLS = 4;
const MAX_REVEALS = 4;
const MASK_COLORS = ['#7357a6','#ef5f89','#ee8d45','#2f9ea0','#487bb8','#c65485','#d7a62f','#5264a1','#a74f68','#278984','#b86b36','#64508f'];
const questions = [];
let currentQuestion = null;
var questionBag = [];
const state = {
  target: null, layout: [], revealed: new Set(), selectedSlot: null, submitted: false,
  sound: true, resultTimer: null, lastQuestionId: null
};

function showView(id) {
  views.forEach(v => v.classList.toggle('active', v.id === id));
}

async function loadImages() {
  const loadedQuestions = await Promise.all(QUESTION_IDS.map(async id => {
    const base = `assets/questions/question-${String(id).padStart(2, '0')}/`;
    const mappingResponse = await fetch(`${base}mapping.json`);
    if (!mappingResponse.ok) throw new Error(`第${id}题映射加载失败：${mappingResponse.status}`);
    const mapping = await mappingResponse.json();
    if (mapping.cats.length !== 23) throw new Error(`第${id}题必须包含23只猫`);
    const mappedNames = new Set(mapping.cats.map(item => item.name));
    if (mappedNames.size !== 23 || cats.some(cat => !mappedNames.has(cat.name))) {
      throw new Error(`第${id}题映射与猫咪名单不一致`);
    }
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`第${id}题图片加载失败`));
      img.src = `${base}${mapping.image}`;
    });
    return { id, mapping, image };
  }));
  questions.push(...loadedQuestions);

  await Promise.all(cats.map(cat => new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => { cat.image = img; cat.crop = alphaBounds(img); resolve(); }; img.onerror = reject; img.src = cat.src;
  })));
}

function alphaBounds(img) {
  const probe = document.createElement('canvas'); probe.width = img.width; probe.height = img.height;
  const g = probe.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, img.width, img.height).data;
  let left=img.width, top=img.height, right=-1, bottom=-1;
  for(let y=0;y<img.height;y++) for(let x=0;x<img.width;x++) {
    if(data[(y*img.width+x)*4+3] > 8) { if(x<left)left=x;if(x>right)right=x;if(y<top)top=y;if(y>bottom)bottom=y; }
  }
  return right < left ? {x:0,y:0,w:img.width,h:img.height} : {x:left,y:top,w:right-left+1,h:bottom-top+1};
}

function buildPicker() {
  const picker = $('#catPicker');
  picker.innerHTML = cats.map(cat => `<button class="cat-card" data-id="${cat.id}"><img src="${cat.src}" alt="${cat.name}"><strong>${cat.name}</strong></button>`).join('');
  picker.addEventListener('click', e => {
    const card = e.target.closest('.cat-card'); if (!card) return;
    state.target = cats[Number(card.dataset.id)];
    sound('select'); startGame();
  });
}

function startGame() {
  if (questionBag.length === 0) {
    questionBag = questions.map(question => question.id);
    for (let index = questionBag.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [questionBag[index], questionBag[swapIndex]] = [questionBag[swapIndex], questionBag[index]];
    }
    if (questionBag.length > 1 && questionBag[0] === state.lastQuestionId) {
      [questionBag[0], questionBag[1]] = [questionBag[1], questionBag[0]];
    }
  }
  const nextQuestionId = questionBag.shift();
  currentQuestion = questions.find(question => question.id === nextQuestionId) || questions[0];
  state.lastQuestionId = currentQuestion.id;
  canvas.dataset.questionId = String(currentQuestion.id);
  state.revealed.clear(); state.selectedSlot = null; state.submitted = false;
  state.layout = currentQuestion.mapping.cats.map(slot => {
    const cat = cats.find(item => item.name === slot.name);
    if (!slot.region) throw new Error(`槽位 ${slot.slot} 缺少定制区域`);
    return { ...cat, slot: slot.slot, row: slot.row, column: slot.column, region: slot.region };
  });
  $('#guessText').textContent = '还没有选择'; $('#confirmButton').disabled = true;
  $('#panelTitle').textContent = '先揭开几块看看';
  $('#panelCopy').textContent = '请揭开 4 块彩色蒙版。每块可能出现多只猫或猫咪局部。';
  $('#stageHint').textContent = '点击一块彩色蒙版揭开线索'; $('#stageHint').style.opacity = '1';
  renderPaws(); buildScene(); buildMask(); render(); showView('gameView');
}

function slotMeta(index) {
  const item = state.layout[index];
  return item ? { row: item.row - 1, col: item.column - 1 } : { row: 0, col: 0 };
}

function drawPaw(g, cx, cy, scale, color) {
  g.save(); g.fillStyle=color; g.translate(cx,cy); g.rotate(-.15);
  g.beginPath(); g.ellipse(0,8,26*scale,22*scale,0,0,Math.PI*2); g.fill();
  [[-22,-17],[-7,-27],[10,-27],[24,-15]].forEach(([x,y])=>{g.beginPath();g.ellipse(x*scale,y*scale,9*scale,12*scale,0,0,Math.PI*2);g.fill();});
  g.restore();
}

function buildScene() {
  const W=scene.width,H=scene.height;
  sceneCtx.clearRect(0,0,W,H);
  sceneCtx.drawImage(currentQuestion.image, 0, 0, W, H);
}

function drawPartyTitle(g) {
  const text='PARTY CATS', colors=['#ff547f','#ff9f43','#ffd23f','#58c9a9','#57b9e8','#8a66be','#ff547f','#ff9f43','#ffd23f','#58c9a9'];
  g.save(); g.font='900 150px Arial Rounded MT Bold, Microsoft YaHei'; g.textAlign='center'; g.textBaseline='middle';
  const widths=[...text].map(ch=>g.measureText(ch).width), total=widths.reduce((a,b)=>a+b,0), start=(canvas.width-total)/2;
  let x=start; [...text].forEach((ch,i)=>{const w=widths[i]; if(ch!==' '){g.lineWidth=16;g.strokeStyle='rgba(255,255,255,.92)';g.strokeText(ch,x+w/2,canvas.height/2);g.fillStyle=colors[i%colors.length];g.fillText(ch,x+w/2,canvas.height/2);}x+=w;});
  g.restore();
}

function buildMask() {
  maskCtx.clearRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<REVEAL_ROWS*REVEAL_COLS;i++){
    const s=revealRect(i);
    maskCtx.fillStyle=MASK_COLORS[i%MASK_COLORS.length];maskCtx.fillRect(s.x,s.y,s.w,s.h);
    maskCtx.fillStyle='rgba(255,255,255,.08)';maskCtx.fillRect(s.x,s.y,s.w,s.h*.18);
    maskCtx.strokeStyle='rgba(255,255,255,.94)';maskCtx.lineWidth=7;maskCtx.strokeRect(s.x+3.5,s.y+3.5,s.w-7,s.h-7);
    maskCtx.fillStyle='rgba(255,255,255,.82)';maskCtx.font='900 34px Microsoft YaHei';maskCtx.textAlign='left';maskCtx.textBaseline='top';maskCtx.fillText(String(i+1).padStart(2,'0'),s.x+22,s.y+18);
  }
  drawPartyTitle(maskCtx);
}

function render() {
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(scene,0,0);
  if(!state.submitted){
    for(let i=0;i<REVEAL_ROWS*REVEAL_COLS;i++) if(!state.revealed.has(i)) { const s=revealRect(i);ctx.drawImage(maskBase,s.x,s.y,s.w,s.h,s.x,s.y,s.w,s.h); }
    if(state.selectedSlot!==null) drawSelection(state.selectedSlot,'#ffd45c');
  } else if(state.selectedSlot!==null) drawSelection(state.selectedSlot,'#ffd45c');
}

function slotRect(index){
  const region = state.layout[index]?.region;
  if (!region) return {x:0,y:0,w:0,h:0};
  return {
    x: region.x * canvas.width,
    y: region.y * canvas.height,
    w: region.width * canvas.width,
    h: region.height * canvas.height
  };
}
function revealRect(index){
  const row=Math.floor(index/REVEAL_COLS),col=index%REVEAL_COLS;
  return{x:col*canvas.width/REVEAL_COLS,y:row*canvas.height/REVEAL_ROWS,w:canvas.width/REVEAL_COLS,h:canvas.height/REVEAL_ROWS};
}
function hitReveal(p){
  const col=Math.floor(p.x/(canvas.width/REVEAL_COLS)),row=Math.floor(p.y/(canvas.height/REVEAL_ROWS));
  return row>=0&&row<REVEAL_ROWS&&col>=0&&col<REVEAL_COLS?row*REVEAL_COLS+col:-1;
}
function hitSlot(p){
  return state.layout.findIndex((_,i)=>{const s=slotRect(i);return p.x>=s.x&&p.x<s.x+s.w&&p.y>=s.y&&p.y<s.y+s.h;});
}
function drawSelection(index,color){
  const r=slotRect(index);
  ctx.save();
  ctx.strokeStyle=color;ctx.lineWidth=9;ctx.setLineDash([18,10]);
  ctx.shadowColor='rgba(255,212,92,.5)';ctx.shadowBlur=16;
  ctx.strokeRect(r.x+8,r.y+8,r.w-16,r.h-16);
  ctx.setLineDash([]);ctx.shadowColor='rgba(56,44,70,.35)';ctx.shadowBlur=12;
  drawPaw(ctx,r.x+r.w-32,r.y+34,.55,color);
  ctx.restore();
}

function drawResultHighlight(){
  const correct=state.layout.findIndex(c=>c&&c.id===state.target.id);
  const s=slotRect(correct),safe=18;
  const targetX=s.x+s.w/2,targetY=s.y+Math.min(s.h*.36,115);
  const fromRight=targetX>canvas.width*.68;
  const finger=fromRight?'👈':'👉';
  ctx.save();ctx.font='68px "Segoe UI Emoji"';ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='rgba(56,44,70,.32)';ctx.shadowBlur=14;
  let fx=targetX+(fromRight?92:-92),fy=Math.max(58,targetY-58);ctx.fillText(finger,fx,fy);ctx.restore();
  const label=`${state.target.name} 在这里`;ctx.font='900 20px Microsoft YaHei';const tw=ctx.measureText(label).width+30,lh=40;
  const lx=Math.max(safe,Math.min(canvas.width-tw-safe,fx-tw/2));const ly=Math.max(safe,fy-68);
  ctx.fillStyle='#ffd45c';ctx.beginPath();ctx.roundRect(lx,ly,tw,lh,13);ctx.fill();ctx.fillStyle='#382c46';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,lx+tw/2,ly+lh/2);
}

function renderPaws(){ $('#turnPaws').innerHTML=Array.from({length:MAX_REVEALS},(_,i)=>`<i class="${i<state.revealed.size?'used':''}">🐾</i>`).join(''); }
function canvasPoint(event){const r=canvas.getBoundingClientRect();return{x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height};}

canvas.addEventListener('click', e=>{
  if(state.submitted)return; const p=canvasPoint(e);
  const region=hitReveal(p); if(region<0)return;
  if(!state.revealed.has(region)&&state.revealed.size<MAX_REVEALS){
    state.revealed.add(region);sound('reveal');renderPaws();render();
    $('#stageHint').textContent=state.revealed.size===MAX_REVEALS?'线索用完啦，点击你猜的猫咪':'还可以继续揭图，或点击已揭区域里的猫咪';return;
  }
  if(state.revealed.size<MAX_REVEALS)return;
  const slot=hitSlot(p); if(slot<0)return;
  state.selectedSlot=slot; const cat=state.layout[slot]; $('#guessText').textContent=`已选择这个位置${cat?'':'（装饰）'}`;
  $('#confirmButton').disabled=false; $('#stageHint').textContent='已选择，确认前还能换'; sound('select');render();
});

$('#confirmButton').addEventListener('click',()=>{
  if(state.selectedSlot===null||state.submitted)return;state.submitted=true;render();
  const chosen=state.layout[state.selectedSlot];sound('success');
  $('#resultIcon').textContent='🐱';$('#resultKicker').textContent='CAT NICKNAME';
  $('#resultTitle').textContent=`这只猫叫「${chosen.name}」！`;
  $('#resultCopy').textContent='看看和你刚才说出的昵称一样吗？';
  $('#panelTitle').textContent='昵称揭晓';$('#panelCopy').textContent=`你选择的猫咪是 ${chosen.name}。`;
  $('#stageHint').style.opacity='0'; state.resultTimer=setTimeout(()=>$('#resultModal').classList.add('show'),900);
});

$('#startButton').addEventListener('click',()=>{sound('select');startGame();});
$('#restartButton').addEventListener('click',()=>{clearTimeout(state.resultTimer);$('#resultModal').classList.remove('show');startGame();});
$('#playAgainButton').addEventListener('click',()=>{
  clearTimeout(state.resultTimer);
  $('#resultModal').classList.remove('show');
  startGame();
});
$('#soundToggle').addEventListener('click',()=>{state.sound=!state.sound;$('#soundToggle').textContent=state.sound?'🔊':'🔇';});

let audioContext;
function sound(kind){
  if(!state.sound)return; audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
  const o=audioContext.createOscillator(),g=audioContext.createGain();o.connect(g);g.connect(audioContext.destination);
  const now=audioContext.currentTime, map={select:[420,.07],reveal:[260,.12],success:[660,.28],wrong:[170,.18]},[freq,dur]=map[kind]||map.select;
  o.type=kind==='wrong'?'sawtooth':'sine';o.frequency.setValueAtTime(freq,now);if(kind==='success')o.frequency.exponentialRampToValueAtTime(990,now+dur);
  g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.16,now+.015);g.gain.exponentialRampToValueAtTime(.0001,now+dur);o.start(now);o.stop(now+dur);
}

window.startPartyCats = () => loadImages().then(()=>{startGame();}).catch(err=>{document.body.innerHTML=`<pre>Party Cats load failed: ${err}</pre>`;});
