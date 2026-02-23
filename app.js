// app.js
// Plain global JS, no modules.

// -------------------
// Data generator
// -------------------
const TAGS = [
  "Coffee","Hiking","Movies","Live Music","Board Games","Cats","Dogs","Traveler",
  "Foodie","Tech","Art","Runner","Climbing","Books","Yoga","Photography"
];
const FIRST_NAMES = [
  "Alex","Sam","Jordan","Taylor","Casey","Avery","Riley","Morgan","Quinn","Cameron",
  "Jamie","Drew","Parker","Reese","Emerson","Rowan","Shawn","Harper","Skyler","Devon"
];
const CITIES = [
  "Brooklyn","Manhattan","Queens","Jersey City","Hoboken","Astoria",
  "Williamsburg","Bushwick","Harlem","Lower East Side"
];
const JOBS = [
  "Product Designer","Software Engineer","Data Analyst","Barista","Teacher",
  "Photographer","Architect","Chef","Nurse","Marketing Manager","UX Researcher"
];
const BIOS = [
  "Weekend hikes and weekday lattes.",
  "Dog parent. Amateur chef. Karaoke enthusiast.",
  "Trying every taco in the city — for science.",
  "Bookstore browser and movie quote machine.",
  "Gym sometimes, Netflix always.",
  "Looking for the best slice in town.",
  "Will beat you at Mario Kart.",
  "Currently planning the next trip."
];

const UNSPLASH_SEEDS = [
  "1515462277126-2b47b9fa09e6",
  "1520975916090-3105956dac38",
  "1519340241574-2cec6aef0c01",
  "1554151228-14d9def656e4",
  "1548142813-c348350df52b",
  "1517841905240-472988babdf9",
  "1535713875002-d1d0cf377fde",
  "1545996124-0501ebae84d0",
  "1524504388940-b1c1722653e1",
  "1531123897727-8f129e1688ce",
];

function sample(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickTags() { return Array.from(new Set(Array.from({length:4}, ()=>sample(TAGS)))); }
function imgFor(seed) {
  return `https://images.unsplash.com/photo-${seed}?auto=format&fit=crop&w=1200&q=80`;
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pickPhotos(count = 4) {
  const photos = [];
  for (let i = 0; i < count; i += 1) {
    photos.push(imgFor(sample(UNSPLASH_SEEDS)));
  }
  return photos;
}

function generateProfiles(count = 12) {
  const profiles = [];
  for (let i = 0; i < count; i++) {
    const photos = pickPhotos(4);
    profiles.push({
      id: `p_${i}_${Date.now().toString(36)}`,
      name: sample(FIRST_NAMES),
      age: 18 + Math.floor(Math.random() * 22),
      city: sample(CITIES),
      title: sample(JOBS),
      bio: sample(BIOS),
      tags: pickTags(),
      img: photos[0],
      photos,
    });
  }
  return profiles;
}

// -------------------
// UI rendering
// -------------------
const deckEl = document.getElementById("deck");
const shuffleBtn = document.getElementById("shuffleBtn");
const likeBtn = document.getElementById("likeBtn");
const nopeBtn = document.getElementById("nopeBtn");
const superLikeBtn = document.getElementById("superLikeBtn");

let profiles = [];
let photoIndexById = new Map();
let isAnimating = false;
let dragState = null;
let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;

const SWIPE_DISTANCE_X = 110;
const SWIPE_DISTANCE_UP = 120;
const SWIPE_VELOCITY = 0.55;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_RADIUS = 36;
const TAP_MOVE_THRESHOLD = 10;

function currentPhotoFor(profile) {
  const photos = profile.photos && profile.photos.length ? profile.photos : [profile.img];
  const idx = photoIndexById.get(profile.id) || 0;
  return photos[idx % photos.length];
}

function setCardTransform(card, x, y) {
  const rotate = clamp(x * 0.06, -24, 24);
  const lift = Math.min(Math.abs(x) / 18, 8);
  card.style.transform = `translate3d(${x}px, ${y - lift}px, 0) rotate(${rotate}deg)`;
}

function springBack(card) {
  card.style.transition = "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)";
  card.style.transform = "translate3d(0, 0, 0) rotate(0deg)";
  card.classList.remove("card--dragging");
}

function removeTopProfile() {
  const top = profiles.shift();
  if (top) {
    photoIndexById.delete(top.id);
  }
}

function animateTopCardOut(action, card, startX = 0, startY = 0) {
  if (!card || !profiles.length || isAnimating) return;

  isAnimating = true;
  card.classList.remove("card--dragging");
  card.style.transition = "transform 330ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 330ms ease";

  const outX = window.innerWidth * 1.25;
  const outY = window.innerHeight * 1.25;

  let targetX = startX;
  let targetY = startY;
  let targetRot = 0;

  if (action === "like") {
    targetX = outX;
    targetY = startY * 0.2;
    targetRot = 24;
  } else if (action === "nope") {
    targetX = -outX;
    targetY = startY * 0.2;
    targetRot = -24;
  } else {
    targetX = startX * 0.2;
    targetY = -outY;
    targetRot = clamp(startX * 0.03, -12, 12);
  }

  requestAnimationFrame(() => {
    card.style.opacity = "0.08";
    card.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) rotate(${targetRot}deg)`;
  });

  window.setTimeout(() => {
    removeTopProfile();
    isAnimating = false;
    renderDeck();
  }, 340);
}

function detectAction(dx, dy, durationMs) {
  const safeDuration = Math.max(durationMs, 1);
  const vx = dx / safeDuration;
  const vy = dy / safeDuration;

  const upByDistance = dy < -SWIPE_DISTANCE_UP && Math.abs(dy) > Math.abs(dx) * 0.8;
  const upByVelocity = vy < -SWIPE_VELOCITY && Math.abs(dy) > Math.abs(dx) * 0.7;
  if (upByDistance || upByVelocity) {
    return "superlike";
  }

  const horizontalByDistance = Math.abs(dx) > SWIPE_DISTANCE_X;
  const horizontalByVelocity = Math.abs(vx) > SWIPE_VELOCITY;
  if (horizontalByDistance || horizontalByVelocity) {
    return dx > 0 ? "like" : "nope";
  }

  return null;
}

function cycleCurrentPhoto() {
  if (!profiles.length) return;
  const profile = profiles[0];
  const photos = profile.photos && profile.photos.length ? profile.photos : [profile.img];
  const currentIdx = photoIndexById.get(profile.id) || 0;
  const nextIdx = (currentIdx + 1) % photos.length;
  photoIndexById.set(profile.id, nextIdx);

  const topMedia = deckEl.querySelector(".card--top .card__media");
  if (topMedia) {
    topMedia.src = photos[nextIdx];
  }
}

function handleTapGesture(x, y) {
  const now = performance.now();
  const withinTime = now - lastTapTime <= DOUBLE_TAP_MS;
  const withinRadius = Math.hypot(x - lastTapX, y - lastTapY) <= DOUBLE_TAP_RADIUS;

  if (withinTime && withinRadius) {
    lastTapTime = 0;
    cycleCurrentPhoto();
    return;
  }

  lastTapTime = now;
  lastTapX = x;
  lastTapY = y;
}

function wireTopCardGestures(card) {
  card.addEventListener("pointerdown", (event) => {
    if (isAnimating) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: 0,
      y: 0,
      startTime: performance.now(),
    };

    card.setPointerCapture(event.pointerId);
    card.classList.add("card--dragging");
    card.style.transition = "none";
  });

  card.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId || isAnimating) return;

    dragState.x = event.clientX - dragState.startX;
    dragState.y = event.clientY - dragState.startY;
    setCardTransform(card, dragState.x, dragState.y);
  });

  function finishPointer(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const { x, y, startTime } = dragState;
    const moved = Math.hypot(x, y);
    const durationMs = performance.now() - startTime;
    dragState = null;

    if (moved <= TAP_MOVE_THRESHOLD) {
      springBack(card);
      handleTapGesture(event.clientX, event.clientY);
      return;
    }

    const action = detectAction(x, y, durationMs);
    if (!action) {
      springBack(card);
      return;
    }

    animateTopCardOut(action, card, x, y);
  }

  card.addEventListener("pointerup", finishPointer);
  card.addEventListener("pointercancel", finishPointer);
}

function createCard(profile, layerIndex) {
  const card = document.createElement("article");
  card.className = "card";
  if (layerIndex === 0) card.classList.add("card--top");
  if (layerIndex === 1) card.classList.add("card--next");
  if (layerIndex === 2) card.classList.add("card--back");

  const img = document.createElement("img");
  img.className = "card__media";
  img.src = currentPhotoFor(profile);
  img.alt = `${profile.name} — profile photo`;

  const body = document.createElement("div");
  body.className = "card__body";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";
  titleRow.innerHTML = `
      <h2 class="card__title">${profile.name}</h2>
      <span class="card__age">${profile.age}</span>
    `;

  const meta = document.createElement("div");
  meta.className = "card__meta";
  meta.textContent = `${profile.title} • ${profile.city}`;

  const chips = document.createElement("div");
  chips.className = "card__chips";
  profile.tags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = tag;
    chips.appendChild(chip);
  });

  body.appendChild(titleRow);
  body.appendChild(meta);
  body.appendChild(chips);

  card.appendChild(img);
  card.appendChild(body);

  if (layerIndex === 0) {
    wireTopCardGestures(card);
  }

  return card;
}

function renderDeck() {
  deckEl.setAttribute("aria-busy", "true");
  deckEl.innerHTML = "";

  const visibleProfiles = profiles.slice(0, 3);
  visibleProfiles.forEach((profile, idx) => {
    const card = createCard(profile, idx);
    card.style.zIndex = String(50 - idx);
    deckEl.appendChild(card);
  });

  if (!visibleProfiles.length) {
    const empty = document.createElement("article");
    empty.className = "card";
    empty.style.display = "grid";
    empty.style.placeItems = "center";
    empty.style.padding = "24px";
    empty.innerHTML = "<p class=\"note\">No more profiles. Tap Shuffle to reset.</p>";
    deckEl.appendChild(empty);
  }

  deckEl.removeAttribute("aria-busy");
}

function resetDeck() {
  profiles = generateProfiles(12);
  photoIndexById = new Map();
  isAnimating = false;
  dragState = null;
  lastTapTime = 0;
  renderDeck();
}

function triggerAction(action) {
  if (isAnimating || !profiles.length) return;
  const topCard = deckEl.querySelector(".card--top");
  animateTopCardOut(action, topCard, 0, 0);
}

function flashActionButton(button) {
  button.classList.remove("ctrl--feedback");
  void button.offsetWidth;
  button.classList.add("ctrl--feedback");

  window.setTimeout(() => {
    button.classList.remove("ctrl--feedback");
  }, 170);

  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(16);
  }
}

function onActionClick(button, action) {
  flashActionButton(button);
  triggerAction(action);
}

likeBtn.addEventListener("click", () => onActionClick(likeBtn, "like"));
nopeBtn.addEventListener("click", () => onActionClick(nopeBtn, "nope"));
superLikeBtn.addEventListener("click", () => onActionClick(superLikeBtn, "superlike"));
shuffleBtn.addEventListener("click", resetDeck);

// Boot
resetDeck();
