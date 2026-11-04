<script setup>
import { computed, ref } from 'vue'

const slides = [
  { key: 'find', title: 'Find a sitter near you', text: 'Filter by price, rating and distance, or pick your dates and see who is free.' },
  { key: 'book', title: 'Book the days you need', text: 'Choose dates and times, send a request, and your sitter accepts or declines.' },
  { key: 'tasks', title: 'Get live updates', text: 'Add feeding, medication and walk tasks. Sitters tick them off as they go.' },
  { key: 'route', title: 'Plan the walk', text: 'Draw a walk route on the map, or record one as you go.' },
  { key: 'report', title: 'Hear back after every visit', text: 'Get notes and photos when a visit ends, then leave a review if you like.' }
]

const weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const days = Array.from({ length: 14 }, (_, i) => i + 12) 
const booked = (d) => d >= 15 && d <= 17

const current = ref(0)
const restart = ref(0)    
const hovered = ref(false)
const focused = ref(false)
const isPaused = computed(() => hovered.value || focused.value)

function go(i) {
  current.value = (i + slides.length) % slides.length
  restart.value++
}
const next = () => go(current.value + 1)
const prev = () => go(current.value - 1)

// pause for keyboard users, but not after a mouse click
function onFocusIn(e) {
  focused.value = e.target.matches(':focus-visible')
}

let touchStartX = 0
function onTouchStart(e) {
  touchStartX = e.changedTouches[0].clientX
}
function onTouchEnd(e) {
  const dx = e.changedTouches[0].clientX - touchStartX
  if (Math.abs(dx) > 40) {
    if (dx < 0) {
      next()
    } else {
      prev()
    }
  }
}
</script>

<template>
  <section class="fc" role="region" aria-roledescription="carousel" aria-label="What you can do on PetSociety"
           @mouseenter="hovered = true" @mouseleave="hovered = false"
           @focusin="onFocusIn" @focusout="focused = false"
           @keydown.left="prev" @keydown.right="next"
           @touchstart.passive="onTouchStart" @touchend="onTouchEnd">

    <!-- one paw shape, reused in the report photos -->
    <svg width="0" height="0" class="position-absolute" aria-hidden="true" focusable="false">
      <symbol id="fc-paw" viewBox="0 0 24 24">
        <ellipse cx="12" cy="16.5" rx="5.2" ry="4.2" fill="currentColor" />
        <circle cx="5.5" cy="11.5" r="2.1" fill="currentColor" />
        <circle cx="9.6" cy="6.8" r="2.3" fill="currentColor" />
        <circle cx="14.4" cy="6.8" r="2.3" fill="currentColor" />
        <circle cx="18.5" cy="11.5" r="2.1" fill="currentColor" />
      </symbol>
    </svg>

    <div class="fc-stack">

        <article v-for="(s, i) in slides" :key="s.key" class="fc-slide" :class="{ 'is-active': i === current }"
               role="group" aria-roledescription="slide" :aria-label="`${i + 1} of ${slides.length}`">

        <div class="fc-stage" aria-hidden="true">
            <!-- find a sitter -->
            <div v-if="s.key === 'find'" class="mock">
                <div class="chips">
                <span class="chip chip--on">Dog</span>
                <span class="chip">Cat</span>
                </div>
                <div class="panel sitter">
                <span class="avatar">M</span>
                <span class="sitter-main">
                    <strong>Kieran T.</strong>
                    <span class="stars">★★★★★ (12)</span>
                    <span class="sub">~ 1.2 km away</span>
                </span>
                </div>
                <div class="panel sitter sitter--dim">
                <span class="avatar avatar--b">J</span>
                <span class="sitter-main">
                    <strong>Belle b.</strong>
                    <span class="stars">★★★★☆ (23)</span>
                    <span class="sub">~ 3.4 km away</span>
                </span>
                </div>
            </div>

            <!-- book -->
            <div v-else-if="s.key === 'book'" class="mock mock-book">
                <div class="panel cal">
                <span v-for="(w, k) in weekdays" :key="k" class="cal-h">{{ w }}</span>
                <span v-for="d in days" :key="d" class="cal-d"
                        :class="{ 'cal-d--in': booked(d), 'cal-d--start': d === 15, 'cal-d--end': d === 17 }">{{ d }}</span>
                </div>
            </div>

            <!-- checklist -->
            <div v-else-if="s.key === 'tasks'" class="mock panel">
              <div class="task-row">
                <svg class="task-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 11h16a8 8 0 0 1-16 0zM9 20h6M12 4v3" fill="none" stroke="currentColor"
                        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <div class="task-main">
                  <strong class="task-title">Feed kibble</strong>
                  <span class="task-sub">2 cups of Kibble · at 6:30 pm</span>
                </div>
                <span class="task-btn">6:30 pm</span>
              </div>

              <div class="task-row">
                <svg class="task-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="14" cy="5" r="1.8" fill="currentColor" />
                  <path d="M8 21l2.5-6 3 2v4M10.5 15l1-5 3 1.5 2.5 2M9 9.5l3.5-1" fill="none" stroke="currentColor"
                        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <div class="task-main">
                  <strong class="task-title">Just one round</strong>
                  <span class="task-sub">Route: smu · 705 m · at 7:30 pm</span>
                </div>
                <span class="task-btn task-btn--accent">Start walk</span>
              </div>

              <div class="task-row">
                <svg class="task-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10.5 20a4.5 4.5 0 0 1-3.2-7.7l5-5a4.5 4.5 0 0 1 6.4 6.4l-5 5A4.5 4.5 0 0 1 10.5 20zM9.6 9.6l4.8 4.8"
                        fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <div class="task-main">
                  <strong class="task-title">Hide in wet food</strong>
                  <span class="task-sub">Meloxicam, Half a tablet · with food</span>
                </div>
                <span class="task-btn task-btn--done">Done</span>
              </div>
            </div>

            <!-- route -->
            <div v-else-if="s.key === 'route'" class="mock">
            <svg class="map" viewBox="0 0 300 160" aria-hidden="true">
                <rect width="300" height="160" rx="12" fill="#fbf4ec" />
                <path class="street" d="M0 105 H300 M70 0 V160 M190 0 V160 M0 40 H300" />
                <rect class="park" x="200" y="14" width="86" height="64" rx="10" />

                <!-- out to the park, around inside it, and back home by a different street -->
                <path class="route" pathLength="1"
                    d="M40 128 C 66 110, 78 80, 112 76 C 146 72, 172 80, 198 62
                        C 212 38, 244 22, 266 36 C 282 48, 270 70, 244 68 C 224 66, 208 70, 198 62
                        C 190 92, 150 120, 112 122 C 84 124, 62 126, 40 128" />

                <!-- home -->
                <circle class="pin-ring" cx="40" cy="128" r="17" />
                <circle class="home-dot" cx="40" cy="128" r="11" />
                <path d="M34.5 128.5 L40 122.5 L45.5 128.5 M36 127.5 V133.5 H44 V127.5"
                    fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <p class="map-label">A 1.4 km loop from home through the park</p>
            </div>

            <!-- report -->
            <div v-else class="mock panel">
                <p class="note">Fed and walked as asked. Buddy drank lots of water.</p>
                <div class="photos">
                <span v-for="n in 3" :key="n" class="ph" :class="`ph--${n}`">
                    <svg viewBox="0 0 24 24"><use href="#fc-paw" /></svg>
                </span>
                </div>
            </div>
        </div>

        <h3 class="fc-title">{{ s.title }}</h3>
        <p class="fc-text">{{ s.text }}</p>
      </article>
    </div>

    <div class="fc-footer">
      <div class="fc-dots">
        <button v-for="(s, i) in slides" :key="s.key" type="button" class="fc-dot"
                :aria-label="`Go to: ${s.title}`" :aria-current="i === current" @click="go(i)">
          <span class="fc-dot__bar" :class="{ 'fc-dot__bar--active': i === current }">
            <span v-if="i === current" :key="restart" class="fc-dot__fill"
                  :style="{ animationPlayState: isPaused ? 'paused' : 'running' }" @animationend="next"></span>
          </span>
        </button>
      </div>

      <div class="fc-arrows">
        <button type="button" class="fc-arrow" aria-label="Previous feature" @click="prev">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button type="button" class="fc-arrow" aria-label="Next feature" @click="next">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.fc {
  --ink: #2b2420;
  --accent: var(--accent-main);
  --glow: #e3946f;                
  --muted: #5c524b;                  
  --fc-interval: 6s;
  position: relative;
  width: 100%;
  min-width: 0;
  max-width: 460px;
  margin-inline: auto;
  padding: 1.1rem 1.1rem 0.9rem;
  overflow: hidden;
  border-radius: 20px;
  background: rgba(43, 36, 32, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.fc-stack {
  display: grid;
  grid-template-columns: minmax(0, 1fr);   
}
.fc-slide {
  grid-area: 1 / 1;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.5s ease, visibility 0s linear 0.5s;
  min-width: 0;
}
.fc-slide.is-active {
  opacity: 1;
  visibility: visible;
  transition: opacity 0.5s ease, visibility 0s;
}

.fc-stage {
  min-width: 0;
  min-height: 220px;
  padding: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.fc-title {
  margin: 1.1rem 0 0.3rem;
  font-size: 1.4rem;
  color: #fff;
}
.fc-text {
  margin: 0;
  max-width: 36ch;
  color: rgba(255, 255, 255, 0.78);
}

@media (max-width: 400px) {
  .fc {
    padding: 0.8rem 0.8rem 0.6rem;
  }
  .fc-stage {
    padding: 0.75rem;
    min-height: 200px;
  }
  .sitter {
    gap: 0.5rem;
  }
  .avatar {
    width: 2rem;
    height: 2rem;
  }
  .task-btn {
    padding: 0.15rem 0.5rem;
  }
  .task-title {
    font-size: 0.75rem;
  }
}

.mock {
  width: 100%;
  max-width: 300px;
  min-width: 0;
}
.panel {
  background: #fff;
  border-radius: 12px;
  padding: 0.7rem 0.85rem;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3);
}
.stars {
  color: var(--accent-deep);
  letter-spacing: 0.05em;
}

.chips {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
}
.chip {
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  font-size: 0.75rem;
}
.chip--on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.sitter {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}
.sitter + .sitter {
  margin-top: 0.5rem;
}
.sitter--dim {
  opacity: 0.8;
}
.avatar {
  flex: 0 0 auto;
  width: 2.3rem;
  height: 2.3rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
}
.avatar--b {
  background: var(--ink);
}
.sitter-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  font-size: 0.9rem;
  line-height: 1.25;
}
.sub {
  font-size: 0.75rem;
  color: var(--muted);
}
.mock-book {
  text-align: center;
}
.cal {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  row-gap: 2px;
  font-size: 0.8rem;
}
.cal-h {
  padding-bottom: 0.2rem;
  font-size: 0.7rem;
  color: var(--muted);
}
.cal-d {
  padding: 0.3rem 0;
  color: var(--ink);
}
.cal-d--in {
  background: var(--accent);
  color: #fff;
}
.cal-d--start {
  border-radius: 999px 0 0 999px;
}
.cal-d--end {
  border-radius: 0 999px 999px 0;
}
.sent {
  display: inline-block;
  margin-top: 0.7rem;
  padding: 0.3rem 0.8rem;
  border-radius: 999px;
  background: var(--ink);
  color: #fff;
  font-size: 0.8rem;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0;
}
.task-row + .task-row {
  border-top: 1px solid #f0e3d4;
}
.task-icon {
  flex: none;
  width: 1.15rem;
  height: 1.15rem;
  color: var(--accent-deep);
}
.task-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.task-title {
  font-size: 0.8rem;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.task-sub {
  font-size: 0.68rem;
  color: var(--muted);
}
.task-btn {
  flex: none;
  padding: 0.2rem 0.65rem;
  border: 1px solid #d9c3ad;
  border-radius: 999px;
  background: #fff;
  color: var(--ink);
  font-size: 0.7rem;
  font-weight: 700;
  white-space: nowrap;
}
.task-btn--accent {
  border-color: var(--accent-deep);
  color: var(--accent-deep);
}

.map {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 12px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3);
}

.street {
  fill: none;
  stroke: #eadbc8;
  stroke-width: 8;
}
.park {
  fill: #dbe5c9;
}
.route {
  fill: none;
  stroke: var(--accent-deep);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 0;
}
.home-dot {
  fill: var(--ink);
}
.pin-ring {
  fill: rgba(196, 79, 28, 0.2);
}
.fc-slide.is-active .task-btn {
  animation: fc-pop 0.35s ease-out 0.5s backwards;
}
.fc-slide.is-active .task-row:nth-child(2) .task-btn {
  animation-delay: 0.9s;
}
.fc-slide.is-active .task-row:nth-child(3) .task-btn {
  animation-delay: 1.3s;
}
.map-label {
  margin: 0.5rem 0 0;
  text-align: center;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.72);
}

.photos {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
}
.ph {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.8);
}
.ph svg {
  width: 45%;
  height: auto;
}
.ph--1 {
  background: #d9a98a;
}
.ph--2 {
  background: #c9906e;
}
.ph--3 {
  background: #e3bfa4;
}
.note {
  margin: 0.6rem 0 0.3rem;
  font-size: 0.85rem;
  color: var(--ink);
}
.fc-slide.is-active .route {
  animation: fc-draw 1.8s ease-out 0.3s backwards;
}
.fc-slide.is-active .pin,
.fc-slide.is-active .pin-ring {
  transform-box: fill-box;
  transform-origin: center;
  animation: fc-pop 0.35s ease-out 2s backwards;
}
@keyframes fc-pop {
  from {
    transform: scale(0.3);
    opacity: 0;
  }
}
@keyframes fc-draw {
  from {
    stroke-dashoffset: 1;
  }
}
@keyframes fc-fill {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

/* footer: dots on the left, arrows on the right */
.fc-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.9rem;
}
.fc-dots {
  display: flex;
  align-items: center;
}
.fc-dot {
  padding: 0.6rem 0.2rem;
  border: 0;
  background: none;
  cursor: pointer;
}
.fc-dot__bar {
  position: relative;
  display: block;
  width: 0.55rem;
  height: 0.55rem;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
  transition: width 0.3s ease;
}
.fc-dot__bar--active {
  width: 2.1rem;
}
.fc-dot__fill {
  position: absolute;
  inset: 0;
  background: var(--glow);
  transform-origin: left;
  animation: fc-fill var(--fc-interval) linear forwards;
}
.fc-arrows {
  display: flex;
  gap: 0.4rem;
}
.fc-arrow {
  width: 2.2rem;
  height: 2.2rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
.fc-arrow:hover {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.5);
}
.fc-dot:focus-visible,
.fc-arrow:focus-visible {
  outline: 2px solid var(--glow);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .fc-slide,
  .fc-slide.is-active {
    transition: none;
  }
  .fc-slide.is-active .task-btn,
  .fc-slide.is-active .route,
  .fc-slide.is-active .pin,
  .fc-slide.is-active .pin-ring {
    animation: none;
  }
  .fc-dot__fill {
    animation: none;          
  }
}
</style>