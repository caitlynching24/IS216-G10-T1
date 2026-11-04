<script setup>
// The owner's "Recently ended" section on the Session page: finished bookings from the last 30 days,
// each with a row per day that had a session (opens the visit report) and the review card.
import { computed, onMounted, ref } from 'vue'
import { visitsApi } from '../services/api.js'
import { dateRange, shortDate } from '../utils/visitReport.js'
import PaginationBar from './PaginationBar.vue'
import ReportRows from './ReportRows.vue'
import ReviewCard from './ReviewCard.vue'
import SessionChat from './SessionChat.vue'

const emit = defineEmits(['count', 'open-report'])

const PAGE_SIZE = 5
const DAY_MS = 24 * 60 * 60 * 1000
const entries = ref([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const openIds = ref(new Set()) // which bookings are expanded

const shown = computed(() => entries.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

// The first booking on the page starts open
function openFirst() {
  openIds.value = new Set(shown.value[0] ? [shown.value[0].booking._id] : [])
}
function toggle(id) {
  const next = new Set(openIds.value)
  next.has(id) ? next.delete(id) : next.add(id)
  openIds.value = next
}
function changePage(p) {
  page.value = p
  openFirst()
}

async function load() {
  try {
    entries.value = (await visitsApi.recent()).bookings
    error.value = ''
    if (page.value > Math.ceil(entries.value.length / PAGE_SIZE)) page.value = 1
    openFirst()
  } catch (err) {
    error.value = err.response?.data?.message || 'Could not load your recent bookings.'
  } finally {
    loading.value = false
    emit('count', entries.value.length)
  }
}
onMounted(load)
defineExpose({ load })

const sitterName = (e) => e.booking.sitter?.username ?? 'Your sitter'
const initialOf = (e) => sitterName(e).charAt(0).toUpperCase()
const stars = (n) => '★'.repeat(n)
// "Mochi, Kopi · 24 – 27 Oct · 3 sessions"
const metaLine = (e) => [
  e.booking.pets.map((p) => p.name).join(', '),
  dateRange(e.booking.startDate, e.booking.endDate),
  `${e.days.length} session${e.days.length === 1 ? '' : 's'}`
].join(' · ')

// The review chip: reviewed, closing within 14 days (yellow), or open until a date (peach)
function reviewChip(e) {
  if (e.review) return { tone: 'done', text: `Reviewed ${stars(e.review.rating)}` }
  const daysLeft = Math.ceil((e.reviewOpenUntil - Date.now()) / DAY_MS)
  if (daysLeft <= 14) return { tone: 'soon', text: `Review closes in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` }
  return { tone: 'open', text: `Review open until ${shortDate(new Date(e.reviewOpenUntil))}` }
}

function reviewSaved(e, review) {
  e.review = review
}
</script>

<template>
  <section class="re">
    <!-- on phones the page's tab names this section, so the dot and title hide (Session.vue) -->
    <div class="re-head">
      <span class="re-dot" aria-hidden="true"></span>
      <h3 class="re-title">Recently ended</h3>
      <span class="re-explain">Each booking stays here for 30 days after it ends</span>
    </div>

    <div v-if="loading" class="d-flex align-items-center text-muted">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Loading recent bookings…
    </div>
    <div v-else-if="error" class="alert alert-warning">{{ error }}</div>
    <div v-else-if="!entries.length" class="re-empty">
      <p class="fw-bold mb-1">No bookings ended in the last 30 days</p>
      <p class="mb-0">When a booking finishes, its care reports show up here.</p>
    </div>

    <template v-else>
      <article v-for="e in shown" :key="e.booking._id" class="re-card">
        <!-- a div, not a button: it holds two separate buttons (the toggle and the chat) -->
        <div class="re-card__head">
          <button type="button" class="re-toggle" :aria-expanded="openIds.has(e.booking._id)" @click="toggle(e.booking._id)">
            <span class="re-avatar" aria-hidden="true">
              <img v-if="e.booking.sitter?.profilePicture?.url" :src="e.booking.sitter.profilePicture.url" alt="" />
              <template v-else>{{ initialOf(e) }}</template>
            </span>
            <span class="re-who">
              <strong class="re-name">{{ sitterName(e) }} (sitter)</strong>
              <span class="re-meta">{{ metaLine(e) }}</span>
            </span>
            <span class="re-chips">
              <span class="re-chip re-chip--ended">Ended {{ shortDate(e.booking.endDate) }}</span>
              <span class="re-chip" :class="`re-chip--${reviewChip(e).tone}`">{{ reviewChip(e).text }}</span>
            </span>
            <span class="re-showhide"><span class="re-showhide__word">{{ openIds.has(e.booking._id) ? 'Hide' : 'Show' }} </span>{{ openIds.has(e.booking._id) ? '▴' : '▾' }}</span>
          </button>
          <SessionChat v-if="e.messageCount > 0" class="re-chat" :booking-id="e.booking._id" :can-send="false"
                       :label="`Chat history with ${sitterName(e)}`" />
          <!-- no chat: an empty slot keeps the Show button and chips in the same place as the rows that have one -->
          <span v-else class="re-chat-slot" aria-hidden="true"></span>
        </div>

        <div v-if="openIds.has(e.booking._id)" class="re-body">
          <ReportRows :entry="e" @open="emit('open-report', { entry: e, dayIndex: $event })" />
          <ReviewCard class="re-review" :booking-id="e.booking._id" :sitter-name="sitterName(e)" :review="e.review"
                      :open-until="e.reviewOpenUntil" compact @saved="reviewSaved(e, $event)" />
        </div>
      </article>

      <PaginationBar v-if="entries.length > PAGE_SIZE" :page="page" :total="entries.length" :page-size="PAGE_SIZE" @change="changePage" />
      <p class="re-foot">
        After 30 days a booking leaves this list. Its details stay on the Booking Detail page, reached from
        <router-link to="/owner/bookings">My Bookings</router-link>.
      </p>
    </template>
  </section>
</template>

<style scoped>
.re-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.65rem;
  margin-bottom: 1rem;
}
.re-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #8a7d73;
}
.re-title {
  margin: 0;
  color: #2b2420;
  font-size: 1.35rem;
  font-weight: 800;
}
.re-explain {
  color: #6b5f56;
  font-size: 0.9rem;
}
.re-empty {
  padding: 1.5rem;
  border: 2px dashed #e6dcd3;
  border-radius: 14px;
  color: #6b5f56;
  text-align: center;
}

.re-card {
  margin-bottom: 0.9rem;
  border: 1px solid #e6dcd3;
  border-radius: 14px;
  background: #f3ece6;
  overflow: hidden;
}
.re-card__head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 1rem 1.3rem;
}
.re-toggle {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.9rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: #2b2420;
  text-align: left;
}
.re-avatar {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: #e8ddd3;
  color: #2b2420;
  font-weight: 800;
}
.re-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.re-who {
  display: flex;
  flex: 1 1 12rem;
  flex-direction: column;
  min-width: 0;
}
.re-name {
  font-size: 1.02rem;
}
.re-meta {
  color: #6b5f56;
  font-size: 0.88rem;
  overflow-wrap: anywhere;
}
.re-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.re-chip {
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 800;
  white-space: nowrap;
}
.re-chip--ended {
  background: #e8ddd3;
  color: #5c524b;
}
.re-chip--done {
  background: #e8f5ec;
  color: #14532d;
}
.re-chip--soon {
  background: #fdf0c4;
  color: #7a5a00;
}
.re-chip--open {
  background: #fbe3d6;
  color: #a8421a;
}
.re-showhide {
  flex: none;
  font-weight: 800;
}
.re-chat :deep(.chat-btn) {
  width: 40px;
  height: 40px;
}
.re-chat-slot {
  flex: none;
  width: 40px;
  height: 40px;
}

/* wide screens: every row uses the same columns (avatar, who, Ended, Review, Show) so the chips line up */
@media (min-width: 768px) {
  .re-toggle {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 7.5rem 12.5rem 4.5rem;
    gap: 0 0.9rem;
  }
  .re-chips {
    display: contents;
  }
  .re-chip {
    justify-self: stretch;
    text-align: center;
  }
  .re-showhide {
    text-align: right;
  }
}

.re-body {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 1.3rem;
  align-items: start;
  padding: 1.2rem 1.3rem;
  border-top: 1px solid #e6dcd3;
  background: #faf6f2;
}
.re-toggle:focus-visible {
  outline: 3px solid var(--accent-deep);
  outline-offset: 2px;
}
.re-foot {
  margin-top: 0.8rem;
  color: #6b5f56;
  font-size: 0.88rem;
}
.re-foot a {
  color: var(--accent-deep);
  font-weight: 700;
}

@media (max-width: 767.98px) {
  .re-card__head {
    padding: 0.85rem 1rem;
  }
  .re-avatar,
  .re-chip--ended,
  .re-showhide__word {
    display: none;
  }
  .re-who {
    flex: 1 1 calc(100% - 2rem);
    order: 1;
  }
  .re-showhide {
    order: 2;
  }
  .re-chips {
    order: 3;
    flex: 1 1 100%;
  }
  .re-body {
    grid-template-columns: 1fr;
    padding: 1rem;
  }
  .re-review {
    order: -1; /* the review card comes first on phones */
  }
}
</style>
