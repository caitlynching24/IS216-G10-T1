<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { visitsApi, reviewsApi } from '../services/api.js'
import { walkApi } from '../services/walkApi.js'
import { usePhotoPicker } from '../utils/usePhotoPicker.js'
import ReviewForm from '../components/ReviewForm.vue'

const props = defineProps({
  session: { type: Object, required: true },    
  today: { type: String, required: true },    
  isSitter: { type: Boolean, default: false },
  index: { type: Number, default: 0 }
})

const ACCENTS = [
  { main: '#c47756', tint: '#f6e3d6' },     
  { main: '#6f8f5a', tint: '#e6eedd' }, 
  { main: '#5f84a2', tint: '#e1ebf3' },    
  { main: '#8e6b8f', tint: '#eee3ef' }      
]
const accent = computed(() => ACCENTS[props.index % ACCENTS.length])
const STATUS_LABELS = { confirmed: 'Confirmed', paid: 'Paid', 'in-progress': 'In progress', completed: 'Completed' }
const statusLabel = computed(() => STATUS_LABELS[status.value] ?? status.value)

const initial = computed(() => (other.value?.username || '?').trim().charAt(0).toUpperCase())


const timeRange = computed(() => {
  const b = props.session.booking
  return b.startDate === b.endDate && b.startTime && b.endTime ? `${b.startTime} to ${b.endTime}` : ''
})

const totalTicks = computed(() => props.session.items.reduce((sum, it) => sum + it.dailyFrequency, 0))
const doneTicks = computed(() =>
  props.session.items.reduce((sum, it) => sum + Math.min(countFor(it), it.dailyFrequency), 0)
)

const visit = ref(props.session.visit)
const status = ref(props.session.booking.status)
watch(() => props.session, (s) => {
  visit.value = s.visit
  status.value = s.booking.status
})

const actionError = ref('')
const starting = ref(false)
const savingTask = ref(false)
const ending = ref(false)
const notes = ref('')

const slots = [0, 1, 2].map(() => reactive(usePhotoPicker()))
const photoError = computed(() => slots.map((s) => s.error).find(Boolean) || '')

const isActive = computed(() => visit.value?.status === 'active')
const isCompleted = computed(() => visit.value?.status === 'completed')
const canStart = computed(() => !visit.value && ['confirmed', 'in-progress'].includes(status.value))
const other = computed(() => (props.isSitter ? props.session.booking.owner : props.session.booking.sitter))

function fmt(d) {
  return new Date(`${d}T00:00:00+08:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

const dateRange = computed(() => {
  const b = props.session.booking
  return b.startDate === b.endDate ? fmt(b.startDate) : `${fmt(b.startDate)} – ${fmt(b.endDate)}`
})

function formatTime(d) {
  return new Date(d).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })
}

async function startSession() {
  starting.value = true
  actionError.value = ''
  try {
    visit.value = await visitsApi.start(props.session.booking._id)
    status.value = 'in-progress'
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not start the session.'
  } finally {
    starting.value = false
  }
}

function countFor(item) {
  if (!visit.value) {
    return 0
  }
  return visit.value.completedTasks.filter((t) => String(t.task) === String(item._id)).length
}

async function tick(item, n, event) {
  const current = countFor(item)
  if (!props.isSitter || !isActive.value || savingTask.value) {
    event.target.checked = n <= current
    return
  }
  savingTask.value = true
  actionError.value = ''
  try {
    visit.value = await visitsApi.setTask(visit.value._id, item._id, n <= current ? n - 1 : n)
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not save. Try again.'
    event.target.checked = n <= current         
  } finally {
    savingTask.value = false
  }
}

// ---- Walk tasks: ticked by doing a tracked walk, not by hand ----
const router = useRouter()
const startingWalk = ref(null) // id of the walk task being started

const isWalkTask = (item) => item.category === 'walk'

// the walks that ticked this task today: [{ walk: walkId, ... }]
function walksFor(item) {
  return (visit.value?.completedTasks ?? []).filter((t) => String(t.task) === String(item._id) && t.walk)
}

// "Block loop · 1.2 km", or how to walk without a route
function routeText(item) {
  const r = item.walkRoute
  if (r?.mode === 'route') {
    const km = r.distanceM >= 1000 ? `${(r.distanceM / 1000).toFixed(1)} km` : `${r.distanceM} m`
    return `Route: ${r.name} · ${km}`
  }
  return 'No set route: follow the instructions'
}

// Opens the walk page for this task. The server gives back the walk already under way
// for this task if there is one, so pressing this again carries on with the same walk.
async function startWalk(item) {
  startingWalk.value = item._id
  actionError.value = ''
  try {
    const walk = await walkApi.create({ visitId: visit.value._id, taskId: item._id })
    router.push({ name: 'sitter-walk', params: { id: walk._id } })
  } catch (err) {
    if (err.response?.status === 409 && err.response.data.walkId) {
      // already on another walk: go back to that one
      router.push({ name: 'sitter-walk', params: { id: err.response.data.walkId } })
      return
    }
    actionError.value = err.response?.data?.message || 'Could not start the walk.'
  } finally {
    startingWalk.value = null
  }
}

async function submitReport() {
  if (!notes.value.trim()) {
    actionError.value = 'Please write a short note for the owner.'
    return
  }
  const unfinished = props.session.items.some((item) => countFor(item) < item.dailyFrequency)
  if (unfinished && !confirm("Some tasks aren't ticked. Submit the report anyway?")) {
    return
  }
  ending.value = true
  actionError.value = ''
  try {
    const form = new FormData()
    form.append('notes', notes.value.trim())
    slots.forEach((s) => {
      if (s.file) {
        form.append('photos', s.file)       
      }
    })
    visit.value = await visitsApi.end(visit.value._id, form)
    if (props.today === props.session.booking.endDate) {
      status.value = 'completed'
    }
    slots.forEach((s) => s.clear())
  } catch (err) {
    actionError.value = err.response?.data?.message || 'Could not submit the report.'
  } finally {
    ending.value = false
  }
}

const review = ref(null)
const reviewLoaded = ref(false)

const reviewStars = computed(() =>
  review.value ? '★'.repeat(review.value.rating) + '☆'.repeat(5 - review.value.rating) : ''
)

// getting address into google maps
const address = computed(() => props.session.ownerAddress)
const mapsUrl = computed(() =>
  address.value
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address.value.line1} Singapore ${address.value.postalCode}`)}`
    : ''
)

watch(status, async (s) => {
  if (['completed', 'paid'].includes(s) && !reviewLoaded.value) {
    try {
      review.value = await reviewsApi.getForBooking(props.session.booking._id)
    } catch (err) {
      console.warn('Could not load review', err)
    } finally {
      reviewLoaded.value = true
    }
  }
}, { immediate: true })

</script>

<template>
  <article class="sc" :style="{ '--bk': accent.main, '--bk-tint': accent.tint }">
    <header class="sc-head">
      <div class="sc-who">
        <span class="sc-avatar" aria-hidden="true">
          <img v-if="other?.profilePicture?.url" :src="other.profilePicture.url" alt="" />
          <template v-else>{{ initial }}</template>
        </span>
        <div class="sc-who__text">
          <router-link v-if="other" :to="`/users/${other._id}`" class="sc-name">{{ other.username }}</router-link>
          <span class="sc-role">{{ isSitter ? 'Owner' : 'Sitter' }}</span>
        </div>
      </div>

      <div class="sc-meta">
        <span class="sc-when">{{ dateRange }}<template v-if="timeRange">, {{ timeRange }}</template></span>
        <span class="sc-pets">
          <span v-for="p in session.booking.pets" :key="p._id" class="sc-pet">{{ p.name }}</span>
        </span>
      </div>

      <span class="sc-status" :class="`sc-status--${status}`">{{ statusLabel }}</span>
    </header>

    <div class="sc-body">
      <div class="row g-3">
        <div class="col-12 col-lg-4 order-lg-last">
          <section class="sc-card" :class="{ 'sc-card--live': isActive }">
            <h4 class="sc-title">Live session</h4>

            <template v-if="!visit">
              <template v-if="isSitter">
                <p class="sc-hint">
                  Starting a session shares your live location with the owner, including the walking route (if any), until you end it.
                </p>
                <button type="button" class="sc-btn" :disabled="!canStart || starting" @click="startSession">
                  <span v-if="starting" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
                  {{ starting ? 'Starting…' : 'Start session (go live)' }}
                </button>
              </template>
              <p v-else class="sc-hint mb-0">The sitter hasn't started today's session yet.</p>
            </template>

            <template v-else-if="isActive">
              <p class="sc-live"><span class="sc-live__dot" aria-hidden="true"></span>Session in progress</p>
              <p class="sc-hint mb-0">Started at {{ formatTime(visit.startedAt) }}</p>
            </template>

            <p v-else class="sc-hint mb-0">Today's session is complete.</p>
          </section>

          <section v-if="session.ownerAddress !== undefined && ['confirmed', 'in-progress'].includes(status)" class="sc-card">
            <h4 class="sc-title">Where to go</h4>

            <template v-if="address">
              <address class="sc-address">
                <strong>{{ address.line1 }}</strong>
                <span v-if="address.unit">{{ address.unit }}</span>
                <span v-if="address.postalCode">Singapore {{ address.postalCode }}</span>
              </address>
              <a :href="mapsUrl" target="_blank" rel="noopener" class="sc-link">Open in Google Maps</a>
              <p class="sc-hint mt-2 mb-0">Shared with you because this booking is confirmed. <br> Do <strong style="color:red;">not</strong> share this with anyone else.</p>
            </template>

            <p v-else class="sc-hint mb-0">The owner hasn't added an address yet.</p>
          </section>

          <section v-if="session.booking.notes" class="sc-card">
            <h4 class="sc-title">{{ isSitter ? 'Notes from the owner' : 'Your notes for the sitter' }}</h4>
            <p class="sc-notes">{{ session.booking.notes }}</p>
          </section>

        </div>

        <div class="col-12 col-lg-8">
          <div v-if="actionError" class="alert alert-warning">{{ actionError }}</div>

          <!-- care checklist -->
          <section class="sc-card">
            <div class="sc-card__head">
              <h4 class="sc-title">Care checklist</h4>
              <span v-if="totalTicks" class="sc-count">{{ doneTicks }} of {{ totalTicks }} done</span>
            </div>
            <div v-if="totalTicks" class="sc-progress" role="progressbar" aria-label="Checklist progress"
                 aria-valuemin="0" :aria-valuemax="totalTicks" :aria-valuenow="doneTicks">
              <span :style="{ width: `${(doneTicks / totalTicks) * 100}%` }"></span>
            </div>

            <p v-if="!session.items.length" class="sc-hint mb-0">No care checklist was added to this booking.</p>
            <div v-else class="sc-tasks">
              <div v-for="item in session.items" :key="item._id" class="sc-task">
                <div class="d-flex gap-1">
                  <!-- walk tasks: the boxes only show progress; they're ticked by finishing a walk -->
                  <input v-for="n in item.dailyFrequency" :key="n" type="checkbox"
                         class="form-check-input mt-0 task-check"
                         :checked="n <= countFor(item)"
                         :disabled="isWalkTask(item) || !isSitter || !isActive || savingTask"
                         :aria-label="isWalkTask(item) ? `Walk ${n}, ticked when the walk ends` : undefined"
                         @change="tick(item, n, $event)" />
                </div>
                <div class="flex-grow-1">
                  <span class="sc-task__title"
                        :class="{ 'sc-task__title--done': countFor(item) >= item.dailyFrequency }">{{ item.title }}</span>
                  <template v-if="isWalkTask(item)">
                    <small class="d-block text-muted">{{ routeText(item) }}</small>
                    <!-- the sitter can look back at each walk done for this task -->
                    <small v-if="isSitter && walksFor(item).length" class="d-flex flex-wrap gap-2">
                      <router-link v-for="(t, i) in walksFor(item)" :key="t._id" class="sc-link"
                                   :to="{ name: 'sitter-walk', params: { id: t.walk } }">View walk {{ i + 1 }}</router-link>
                    </small>
                  </template>
                </div>
                <small v-if="item.dailyFrequency > 1" class="text-muted">
                  {{ countFor(item) }}/{{ item.dailyFrequency }}
                </small>
                <button v-if="isWalkTask(item) && isSitter && isActive && countFor(item) < item.dailyFrequency"
                        type="button" class="sc-btn sc-btn--small" :disabled="startingWalk === item._id"
                        @click="startWalk(item)">
                  {{ startingWalk === item._id ? 'Opening…' : 'Start walk' }}
                </button>
              </div>
            </div>
          </section>

          <!-- completion report -->
          <section class="sc-card">
            <h4 class="sc-title">Visit report</h4>

            <template v-if="isCompleted">
              <p class="text-break" style="white-space: pre-line">{{ visit.report.notes }}</p>
              <div class="d-flex flex-wrap gap-2">
                <img v-for="p in visit.report.photos" :key="p.url" :src="p.url" alt="Report photo"
                     class="rounded" style="width: 120px; height: 120px; object-fit: cover;" />
              </div>
            </template>

            <form v-else-if="isSitter" @submit.prevent="submitReport">
              <fieldset :disabled="!isActive || ending">
                <label :for="`notes-${session.booking._id}`" class="form-label small">Notes for the owner</label>
                <textarea :id="`notes-${session.booking._id}`" v-model="notes" class="form-control mb-3" rows="4"
                          maxlength="2000" placeholder="What did you do this visit?"></textarea>

                <div class="row g-2 mb-2">
                  <div v-for="(slot, i) in slots" :key="i" class="col-4">
                    <label class="photo-slot">
                      <img v-if="slot.preview" :src="slot.preview" alt="Report photo" class="photo-slot__img" />
                      <span v-else>+ photo</span>
                      <input :ref="(el) => (slot.input = el)" type="file" accept="image/jpeg,image/png,image/webp"
                             class="d-none" @change="slot.onPick" />
                      <button v-if="slot.preview" type="button" class="btn-close photo-slot__remove bg-white p-1"
                              aria-label="Remove photo" @click.prevent="slot.clear()"></button>
                    </label>
                  </div>
                </div>
                <div v-if="photoError" class="alert alert-warning py-1">{{ photoError }}</div>

                <button type="submit" class="sc-btn">
                  <span v-if="ending" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
                  {{ ending ? 'Submitting…' : 'Submit report and end session' }}
                </button>
              </fieldset>
              <p v-if="!isActive" class="sc-hint mt-2 mb-0">Start the session to fill in the report.</p>
            </form>

            <p v-else class="sc-hint mb-0">The sitter's report will appear here once the visit ends.</p>
          </section>

          <!-- owner: optional review -->
          <section v-if="!isSitter && status === 'completed' && reviewLoaded" class="sc-card">
            <h4 class="sc-title">Review your sitter (optional)</h4>

            <template v-if="review">
              <div class="fs-5" style="color:#FFD700;">{{ reviewStars }}</div>
              <p v-if="review.comment" class="mb-1 text-break">{{ review.comment }}</p>
              <p class="sc-hint mb-0">Thanks, your review has been posted.</p>
            </template>

            <ReviewForm v-else :booking-id="session.booking._id" @saved="review = $event" />
          </section>

          <!-- sitter: the owner's review -->
          <section v-if="isSitter && status === 'completed' && reviewLoaded" class="sc-card">
            <h4 class="sc-title">Owner's review</h4>

            <template v-if="review">
              <div class="fs-5" style="color:#FFD700;">{{ reviewStars }}</div>
              <p v-if="review.comment" class="mb-0 text-break">{{ review.comment }}</p>
            </template>

            <p v-else class="sc-hint mb-0">The owner hasn't reviewed you yet.</p>
          </section>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.sc {
  overflow: hidden;
  border: 1px solid rgba(43, 36, 32, 0.12);
  border-radius: 20px;
  background: var(--bk-tint);
  box-shadow: 0 10px 24px rgba(120, 70, 40, 0.14);
}

.sc-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.25rem;
  padding: 1rem 1.25rem;
  background: #2b2420;
  color: #fff;
  border-bottom: 4px solid var(--bk);        
}
.sc-who {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}
.sc-avatar {
  flex: none;
  width: 2.6rem;
  height: 2.6rem;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: var(--bk);
  color: #fff;
  font-weight: 700;
}
.sc-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.sc-who__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}
.sc-name {
  color: #fff;
  font-family: var(--font-heading, 'Trirong', Georgia, serif);
  font-size: 1.15rem;
  font-weight: 700;
  text-decoration: none;
  overflow-wrap: anywhere;
}
.sc-name:hover {
  text-decoration: underline;
}
.sc-role {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.7);
}
.sc-meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.sc-when {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.85);
}
.sc-pets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.sc-pet {
  padding: 0.1rem 0.6rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  font-size: 0.8rem;
}
.sc-status {
  margin-left: auto;
  padding: 0.25rem 0.85rem;
  border-radius: 999px;
  background: #fff;
  color: #2b2420;
  font-size: 0.8rem;
  font-weight: 700;
}
.sc-status--in-progress {
  background: #e3946f;
}
.sc-status--completed {
  background: #cfe0c0;
  color: #2b3d22;
}

.sc-body {
  padding: 1.1rem 1.25rem 1.25rem;
}

.sc-card {
  padding: 1.1rem 1.2rem;
  border: 1px solid rgba(43, 36, 32, 0.08);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(120, 70, 40, 0.08);
}
.sc-card + .sc-card {
  margin-top: 1rem;
}
.sc-card--live {
  box-shadow: 0 0 0 2px #4f8a3a, 0 4px 12px rgba(120, 70, 40, 0.08);
}
.sc-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.sc-title {
  margin: 0 0 0.6rem;
  font-size: 1.1rem;
  font-weight: 700;
  color: #2b2420;
}
.sc-hint {
  font-size: 0.9rem;
  color: #5c524b;
}
.sc-count {
  font-size: 0.85rem;
  color: #5c524b;
}

.sc-btn {
  width: 100%;
  padding: 0.6rem 1rem;
  border: 0;
  border-radius: 10px;
  background: #a85a38;
  color: #fff;
  font-weight: 700;
  transition: background 0.2s;
}
.sc-btn:hover:not(:disabled) {
  background: #8f4a2c;
}
.sc-btn:disabled {
  opacity: 0.55;
}
.sc-btn--small {
  width: auto;
  flex: none;
  padding: 0.35rem 0.8rem;
  font-size: 0.85rem;
}

.sc-live {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.25rem;
  font-weight: 700;
  color: #3f5a33;
}
.sc-live__dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: #4f8a3a;
  animation: sc-pulse 1.6s ease-out infinite;
}
@keyframes sc-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(79, 138, 58, 0.5);
  }
  100% {
    box-shadow: 0 0 0 0.6rem rgba(79, 138, 58, 0);
  }
}

/* checklist */
.sc-progress {
  height: 0.4rem;
  margin-bottom: 0.6rem;
  overflow: hidden;
  border-radius: 999px;
  background: #efe3d6;
}
.sc-progress span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--bk);
  transition: width 0.4s ease;
}
.sc-task {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0;
}
.sc-task + .sc-task {
  border-top: 1px solid #f0e3d4;
}
.sc-task__title--done {
  color: #5c524b;
  text-decoration: line-through;
}

/* report photos */
.photo-slot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  overflow: hidden;
  border: 2px dashed #c9a98f;
  border-radius: 10px;
  background: #f8eee3;
  color: #5c524b;
  font-size: 0.85rem;
  cursor: pointer;
}
.photo-slot:hover {
  border-color: #c47756;
}
.photo-slot__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-slot__remove {
  position: absolute;
  top: 4px;
  right: 4px;
}
fieldset:disabled .photo-slot {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .sc-live__dot {
    animation: none;
  }
  .sc-progress span {
    transition: none;
  }
}

.form-check-input.task-check {
  width: 1.2rem;
  height: 1.2rem;
  border: 2px solid #2b2420;
  background-color: #fff;
  cursor: pointer;
}
.form-check-input.task-check:checked {
  background-color: #c47756;
  border-color: #c47756;
}
.form-check-input.task-check:focus {
  border-color: #c44f1c;
  box-shadow: 0 0 0 0.2rem rgba(196, 79, 28, 0.25);
}
.form-check-input.task-check:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.form-check-input.task-check:disabled:checked {
  opacity: 1;
}
.sc-address {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin: 0 0 0.6rem;
  font-style: normal;          
  color: #2b2420;
  overflow-wrap: anywhere;
}
.sc-link {
  color: #a85a38;
  font-weight: 700;
}
.sc-notes {
  margin: 0;
  color: #2b2420;
  white-space: pre-line;    
  overflow-wrap: anywhere;
}
</style>