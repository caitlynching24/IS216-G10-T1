<script setup>
// One booking's care report rows: one row per day that had a session, newest first.
// Tapping a row emits `open` with that day's place in entry.days, for the visit report window.
// Used in the owner's "Recently ended" cards (Session page) and the "Visit reports" card on Booking Detail.
// `entry` is one report entry from the server (server/src/utils/visitReports.js).
import { computed } from 'vue'
import { dayLabel, summarize, timeOf } from '../utils/visitReport.js'

const props = defineProps({
  entry: { type: Object, required: true }
})
const emit = defineEmits(['open'])

const rows = computed(() => {
  const e = props.entry
  return e.days.map((day, index) => {
    const s = summarize(day, e.booking.pets)
    return {
      index,
      day,
      times: `${timeOf(day.visit.startedAt)} – ${day.visit.endedAt ? timeOf(day.visit.endedAt) : '…'}`,
      count: `${s.done}/${s.expected}`,
      photos: s.photos.length,
      walks: s.walks.length,
      warning: s.warn.length ? `${s.warn[0].short}${s.warn.length > 1 ? ` +${s.warn.length - 1}` : ''}` : '',
      last: day.dayNumber === e.totalDays
    }
  }).reverse()
})
const count = computed(() => props.entry.days.length)
</script>

<template>
  <div class="rr">
    <p class="rr-label">Care reports · {{ count }} session{{ count === 1 ? '' : 's' }}<span class="rr-hint"> · Tap a row for the full report</span></p>
    <button v-for="r in rows" :key="r.day.date" type="button" class="rr-row" @click="emit('open', r.index)">
      <span class="rr-row__date">
        <strong>{{ dayLabel(r.day.date) }}</strong>
        <small>Day {{ r.day.dayNumber }}<span class="rr-wide"> of {{ entry.totalDays }}</span>{{ r.last ? ' · last' : '' }}</small>
      </span>
      <span class="rr-row__times">{{ r.times }}</span>
      <strong class="rr-row__count">{{ r.count }}</strong>
      <span class="rr-row__meta">
        <span v-if="r.photos" class="rr-icon" :aria-label="`${r.photos} photos`">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>{{ r.photos }}
        </span>
        <span v-if="r.walks" class="rr-icon" :aria-label="`${r.walks} walks`">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M13 4a1.5 1.5 0 1 0 0 .01M10 21l2-6-3-3 2-4 3 2 3 1M7 13l1-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>{{ r.walks }}
        </span>
        <span v-if="r.warning" class="rr-warn">⚠ {{ r.warning }}</span>
      </span>
      <span class="rr-row__go" aria-hidden="true">›</span>
    </button>
  </div>
</template>

<style scoped>
.rr-label {
  margin: 0 0 0.6rem;
  color: #5c524b;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.rr-row {
  display: grid;
  grid-template-columns: 6.4rem 8.6rem 2.8rem 1fr 1rem;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  margin-bottom: 0.7rem;
  padding: 0.75rem 1rem;
  border: 1px solid #e6dcd3;
  border-radius: 10px;
  background: #fff;
  color: #2b2420;
  text-align: left;
}
.rr-row:last-child {
  margin-bottom: 0;
}
.rr-row:hover {
  border-color: var(--accent-main);
}
.rr-row:focus-visible {
  outline: 3px solid var(--accent-deep);
  outline-offset: 2px;
}
.rr-row__date {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.rr-row__date small,
.rr-row__times {
  color: #6b5f56;
  font-size: 0.85rem;
}
.rr-row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.7rem;
  min-width: 0;
}
.rr-icon {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: #6b5f56;
  font-size: 0.85rem;
}
.rr-warn {
  color: #7a5a00;
  font-size: 0.85rem;
  font-weight: 800;
  white-space: nowrap; /* the warning wraps as a whole, never mid-phrase */
}
.rr-row__go {
  color: #6b5f56;
  font-size: 1.3rem;
}

@media (max-width: 767.98px) {
  .rr-hint,
  .rr-wide {
    display: none;
  }
  /* rows become three lines: date and ›, then times / count / icons, then the warning */
  .rr-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.75rem;
  }
  .rr-row__date {
    order: 1;
    flex: 1 1 calc(100% - 2rem);
    flex-direction: row;
    gap: 0.35rem;
    align-items: baseline;
  }
  .rr-row__date small::before {
    content: '· ';
  }
  .rr-row__go { order: 2; }
  .rr-row__times { order: 3; }
  .rr-row__count { order: 4; }
  .rr-row__meta { display: contents; } /* its icons and warning join the row's own lines */
  .rr-icon { order: 5; }
  .rr-warn { order: 6; flex: 1 1 100%; }
}
</style>
