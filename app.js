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

function generateProfiles(count = 12) {
  const profiles = [];
  for (let i = 0; i < count; i++) {
    // Pick 3 unique seeds per profile so double-tap has photos to cycle through.
    // Fisher-Yates produces an unbiased shuffle (sort-based shuffle is biased).
    const shuffled = [...UNSPLASH_SEEDS];
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const imgs = shuffled.slice(0, 3).map(imgFor);
    profiles.push({
      id: `p_${i}_${Date.now().toString(36)}`,
      name: sample(FIRST_NAMES),
      age: 18 + Math.floor(Math.random() * 22),
      city: sample(CITIES),
      title: sample(JOBS),
      bio: sample(BIOS),
      tags: pickTags(),
      imgs,
    });
  }
  return profiles;
}

// -------------------
// DOM refs
// -------------------
const deckEl      = document.getElementById("deck");
const shuffleBtn  = document.getElementById("shuffleBtn");
const likeBtn     = document.getElementById("likeBtn");
const nopeBtn     = document.getElementById("nopeBtn");
const superLikeBtn = document.getElementById("superLikeBtn");

let profiles = [];
let dismissTimerId = null; // track in-flight dismissal timer so Shuffle can cancel it

// -------------------
// Card builder
// -------------------
function buildCard(p, idx, total) {
  const card = document.createElement("article");
  card.className = "card";
  // Higher z-index for lower idx so profiles[0] sits on top.
  card.style.zIndex = total - idx;
  card.dataset.profileIdx = idx;
  card.dataset.photoIdx   = "0";

  // Swipe overlay labels
  const likeLabel  = document.createElement("div");
  likeLabel.className  = "swipe-label swipe-label--like";
  likeLabel.textContent = "LIKE";

  const nopeLabel  = document.createElement("div");
  nopeLabel.className  = "swipe-label swipe-label--nope";
  nopeLabel.textContent = "NOPE";

  const superLabel = document.createElement("div");
  superLabel.className  = "swipe-label swipe-label--super";
  superLabel.textContent = "SUPER";

  // Photo
  const img = document.createElement("img");
  img.className   = "card__media";
  img.src         = p.imgs[0];
  img.alt         = `${p.name} — profile photo`;
  img.draggable   = false;
  // Some Unsplash seeds are stale (photo removed/private). Fall back to picsum.
  img.onerror = () => {
    img.onerror = null; // prevent infinite error loop
    img.src = `https://picsum.photos/seed/${p.id}-0/1200/800`;
  };

  // Photo dots
  const dots = document.createElement("div");
  dots.className = "card__dots";
  p.imgs.forEach((_, di) => {
    const dot = document.createElement("span");
    dot.className = "dot" + (di === 0 ? " dot--active" : "");
    dots.appendChild(dot);
  });

  // Card body
  const body = document.createElement("div");
  body.className = "card__body";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";
  // Use textContent instead of innerHTML to avoid injection if data ever comes
  // from an external source.
  const nameEl = document.createElement("h2");
  nameEl.className   = "card__title";
  nameEl.textContent = p.name;
  const ageEl = document.createElement("span");
  ageEl.className   = "card__age";
  ageEl.textContent = p.age;
  titleRow.appendChild(nameEl);
  titleRow.appendChild(ageEl);

  const meta = document.createElement("div");
  meta.className   = "card__meta";
  meta.textContent = `${p.title} • ${p.city}`;

  const chips = document.createElement("div");
  chips.className = "card__chips";
  p.tags.forEach(t => {
    const c = document.createElement("span");
    c.className   = "chip";
    c.textContent = t;
    chips.appendChild(c);
  });

  body.appendChild(titleRow);
  body.appendChild(meta);
  body.appendChild(chips);

  card.appendChild(likeLabel);
  card.appendChild(nopeLabel);
  card.appendChild(superLabel);
  card.appendChild(img);
  card.appendChild(dots);
  card.appendChild(body);

  return card;
}

// -------------------
// Deck rendering
// -------------------
function renderDeck() {
  // Cancel any in-flight dismissal timer so its callback can't attach duplicate
  // listeners to the freshly-rendered deck.
  clearTimeout(dismissTimerId);
  dismissTimerId = null;

  deckEl.setAttribute("aria-busy", "true");
  deckEl.innerHTML = "";

  profiles.forEach((p, idx) => {
    deckEl.appendChild(buildCard(p, idx, profiles.length));
  });

  deckEl.removeAttribute("aria-busy");
  attachTopCardHandlers();
}

function resetDeck() {
  profiles = generateProfiles(12);
  renderDeck();
}

// -------------------
// Photo cycling (double-tap)
// -------------------
function cyclePhoto(card) {
  const p       = profiles[parseInt(card.dataset.profileIdx)];
  const current = parseInt(card.dataset.photoIdx);
  const next    = (current + 1) % p.imgs.length;

  card.dataset.photoIdx = next;
  const img = card.querySelector(".card__media");
  img.onerror = () => {
    img.onerror = null;
    img.src = `https://picsum.photos/seed/${p.id}-${next}/1200/800`;
  };
  img.src = p.imgs[next];
  card.querySelectorAll(".dot").forEach((dot, i) => {
    dot.classList.toggle("dot--active", i === next);
  });
}

// -------------------
// Backend API
// -------------------
const API_BASE = "http://localhost:3000";

// -------------------
// User identity (persisted in localStorage so push subscriptions are tied to this browser)
// -------------------
const USER_ID_KEY = "tinder_user_id";

function getOrCreateUserId() {
  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = "u_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
    localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}

function recordSwipe(profile, action) {
  fetch(`${API_BASE}/api/swipes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId:   profile.id,
      profileName: profile.name,
      action,
      userId:      getOrCreateUserId(),
    }),
  }).catch(err => console.warn("Swipe not recorded:", err.message));
}

// -------------------
// Push notifications
// -------------------
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function setupPushNotifications() {
  if (!("serviceWorker" in navigator)) {
    console.log("Push: service workers not supported in this browser.");
    return;
  }
  if (!("PushManager" in window)) {
    console.log("Push: Push API not supported in this browser.");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    console.log("Push: service worker registered.");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("Push: notification permission denied.");
      return;
    }

    // Fetch the server's VAPID public key
    const resp = await fetch(`${API_BASE}/api/push/vapid-public-key`);
    if (!resp.ok) throw new Error("Failed to fetch VAPID public key.");
    const { publicKey } = await resp.json();

    // Subscribe through the browser's Push Manager
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // Send subscription to backend
    const userId = getOrCreateUserId();
    await fetch(`${API_BASE}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, subscription }),
    });

    console.log("Push: subscribed successfully. Matches will trigger notifications!");
  } catch (err) {
    console.warn("Push: setup failed:", err.message);
  }
}

// -------------------
// Card dismissal
// -------------------
function dismissTop(direction) {
  const card = deckEl.firstElementChild;
  if (!card || card.classList.contains("card--leaving")) return;
  card.classList.add("card--leaving");

  const profile = profiles[parseInt(card.dataset.profileIdx)];
  const action  = direction === "super" ? "superlike" : direction;
  recordSwipe(profile, action);

  const likeLabel  = card.querySelector(".swipe-label--like");
  const nopeLabel  = card.querySelector(".swipe-label--nope");
  const superLabel = card.querySelector(".swipe-label--super");

  let tx, ty, rot;
  if (direction === "like") {
    tx = "160%";  ty = "-10%"; rot = "30deg";
    likeLabel.style.opacity = "1";
  } else if (direction === "nope") {
    tx = "-160%"; ty = "-10%"; rot = "-30deg";
    nopeLabel.style.opacity = "1";
  } else {
    tx = "0";     ty = "-160%"; rot = "0deg";
    superLabel.style.opacity = "1";
  }

  card.style.transition = "transform 380ms ease, opacity 380ms ease";
  card.style.transform  = `translate(${tx}, ${ty}) rotate(${rot})`;
  card.style.opacity    = "0";

  dismissTimerId = setTimeout(() => {
    dismissTimerId = null;
    card.remove();
    if (deckEl.children.length === 0) {
      showEmptyState();
    } else {
      attachTopCardHandlers();
    }
  }, 380);
}

function showEmptyState() {
  deckEl.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">👀</div>
      <p>You've seen everyone!</p>
      <p class="empty-hint">Hit Shuffle to meet more people.</p>
    </div>
  `;
}

// -------------------
// Swipe + double-tap handlers
// (attached only to the current top card)
// -------------------
function attachTopCardHandlers() {
  const card = deckEl.firstElementChild;
  if (!card || card.tagName !== "ARTICLE") return;

  const likeLabel  = card.querySelector(".swipe-label--like");
  const nopeLabel  = card.querySelector(".swipe-label--nope");
  const superLabel = card.querySelector(".swipe-label--super");

  const SWIPE_X      = 80;   // px to commit a left/right swipe
  const SWIPE_Y      = 90;   // px to commit an upward swipe
  const DOUBLE_TAP_MS = 300; // ms window for double-tap

  let startX = 0, startY = 0, isDragging = false, lastTapTime = 0;

  function resetLabels() {
    likeLabel.style.opacity  = "0";
    nopeLabel.style.opacity  = "0";
    superLabel.style.opacity = "0";
  }

  card.addEventListener("pointerdown", e => {
    startX    = e.clientX;
    startY    = e.clientY;
    isDragging = true;
    card.setPointerCapture(e.pointerId);
    card.style.transition = "none";
  });

  card.addEventListener("pointermove", e => {
    if (!isDragging) return;
    const dx  = e.clientX - startX;
    const dy  = e.clientY - startY;
    const rot = dx * 0.07; // subtle rotation proportional to horizontal drag

    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;

    // Fade labels in relative to drag distance
    if (dy < -40 && Math.abs(dy) > Math.abs(dx)) {
      superLabel.style.opacity = Math.min(1, (-dy - 40) / 70).toFixed(2);
      likeLabel.style.opacity  = "0";
      nopeLabel.style.opacity  = "0";
    } else if (dx > 20) {
      likeLabel.style.opacity  = Math.min(1, (dx - 20) / 60).toFixed(2);
      nopeLabel.style.opacity  = "0";
      superLabel.style.opacity = "0";
    } else if (dx < -20) {
      nopeLabel.style.opacity  = Math.min(1, (-dx - 20) / 60).toFixed(2);
      likeLabel.style.opacity  = "0";
      superLabel.style.opacity = "0";
    } else {
      resetLabels();
    }
  });

  card.addEventListener("pointerup", e => {
    if (!isDragging) return;
    isDragging = false;
    card.style.transition = "";

    const dx   = e.clientX - startX;
    const dy   = e.clientY - startY;
    const dist = Math.hypot(dx, dy);
    const now  = Date.now();

    // Double-tap: minimal movement + second tap within window
    if (dist < 12 && now - lastTapTime < DOUBLE_TAP_MS) {
      lastTapTime = 0;
      resetLabels();
      card.style.transform = "";
      cyclePhoto(card);
      return;
    }
    lastTapTime = now;

    // Decide swipe direction by threshold
    if (dy < -SWIPE_Y && Math.abs(dy) > Math.abs(dx)) {
      dismissTop("super");
    } else if (dx > SWIPE_X) {
      dismissTop("like");
    } else if (dx < -SWIPE_X) {
      dismissTop("nope");
    } else {
      // Didn't cross threshold — snap back
      card.style.transform = "";
      resetLabels();
    }
  });

  card.addEventListener("pointercancel", () => {
    isDragging = false;
    card.style.transition = "";
    card.style.transform  = "";
    resetLabels();
  });
}

// -------------------
// Action buttons
// -------------------
likeBtn.addEventListener("click",      () => dismissTop("like"));
nopeBtn.addEventListener("click",      () => dismissTop("nope"));
superLikeBtn.addEventListener("click", () => dismissTop("super"));
shuffleBtn.addEventListener("click",   resetDeck);

// Boot
resetDeck();
setupPushNotifications();
