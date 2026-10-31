<script setup>
import { ref, watch, onMounted } from 'vue'
import { walkRoutesApi } from '../services/walkRouteApi.js'
import { SERVICE_PRICES, SERVICE_LABELS, SERVICE_HINTS } from '../utils/servicePrices.js'

// The care checklist part of the booking form: the owner adds tasks (feed, walk, medication...).
// The page gives it the pets that were picked (prop), and it tells the page the list of tasks
// whenever it changes (the 'change' event).
defineProps({
  pets: { type: Array, required: true } // the selected pets, as full objects: [{ _id, name, ... }]
})
const emit = defineEmits(['change'])

const categories = Object.keys(SERVICE_PRICES) // same 6 types the server accepts (each has a fixed price)
const tasks = ref([]) // each task: { category, title, dailyFrequency, petIds, walkRouteId }

// The owner's recorded walking routes, for the route dropdown on walk tasks
const walkRoutes = ref([])
const routesError = ref('')

onMounted(async () => {
  try {
    walkRoutes.value = await walkRoutesApi.getMyRoutes()
  } catch {
    routesError.value = 'Could not load your walking routes.'
  }
})

const formatDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`)

function addTask() {
  // petIds: [] means "all the selected pets"
  // walkRouteId (walk tasks only): a route's id, 'instructions', or '' (not chosen yet)
  tasks.value.push({ category: 'feed', title: '', dailyFrequency: 1, petIds: [], walkRouteId: '' })
}

function removeTask(index) {
  tasks.value.splice(index, 1) // remove 1 task at this position
}

// Same idea as togglePet (on the booking page), but for the pets chosen on one task
function toggleTaskPet(task, id) {
  if (task.petIds.includes(id)) task.petIds = task.petIds.filter((p) => p !== id)
  else task.petIds.push(id)
}

// Tell the page whenever the tasks change (deep: also when a task's title or pets change)
watch(tasks, () => emit('change', tasks.value), { deep: true })
</script>

<template>
  <h3 class="h6 text-uppercase text-muted fw-bold mt-4">Care Checklist</h3>
  <p class="small text-muted">What should the sitter do each day? Add at least one task. The price is based on these tasks.
    Pick the type that really matches the job; the sitter can decline a request whose tasks don't match.</p>

  <div v-for="(task, i) in tasks" :key="i" class="border rounded p-2 mb-2">
    <div class="row g-2 align-items-end">
      <div class="col-sm-3">
        <label class="form-label small mb-1">Type</label>
        <select v-model="task.category" class="form-select form-select-sm">
          <option v-for="c in categories" :key="c" :value="c">{{ SERVICE_LABELS[c] }} (${{ SERVICE_PRICES[c] }})</option>
        </select>
        <div class="form-text">{{ SERVICE_HINTS[task.category] }}</div>
      </div>
      <div class="col-sm-5">
        <label class="form-label small mb-1">What to do</label>
        <input v-model="task.title" type="text" maxlength="120" class="form-control form-control-sm" placeholder="e.g. Feed 1 cup kibble at 8am" />
      </div>
      <div class="col-6 col-sm-2">
        <label class="form-label small mb-1">Times a day</label>
        <input v-model.number="task.dailyFrequency" type="number" min="1" max="10" class="form-control form-control-sm" />
      </div>
      <div class="col-6 col-sm-2 text-end">
        <button type="button" class="btn btn-sm btn-outline-danger" @click="removeTask(i)">Remove</button>
      </div>
    </div>
    <!-- Walk tasks: which route the sitter should follow -->
    <div v-if="task.category === 'walk'" class="mt-2">
      <label class="form-label small mb-1" :for="`walk-route-${i}`">Route</label>
      <select :id="`walk-route-${i}`" v-model="task.walkRouteId" class="form-select form-select-sm">
        <option value="" disabled>Choose a route…</option>
        <option v-for="r in walkRoutes" :key="r._id" :value="r._id">{{ r.name }} · {{ formatDistance(r.distanceM) }}</option>
        <option value="instructions">No route – follow my instructions</option>
      </select>
      <p v-if="routesError" class="small text-danger mb-0 mt-1">{{ routesError }}</p>
      <p v-else-if="walkRoutes.length === 0" class="small text-muted mb-0 mt-1">
        You haven't recorded any routes yet.
        <router-link to="/owner/routes/new" target="_blank">Record a route</router-link>, or choose "follow my instructions".
      </p>
      <p v-else-if="task.walkRouteId === 'instructions'" class="small text-muted mb-0 mt-1">
        Put the instructions in "What to do". The walk is still tracked, but can't be checked against a route.
      </p>
    </div>
    <!-- Only worth choosing pets when more than one is selected -->
    <div v-if="pets.length > 1" class="d-flex flex-wrap align-items-center gap-2 mt-2">
      <span class="small text-muted">For:</span>
      <button
        v-for="pet in pets"
        :key="pet._id"
        type="button"
        class="btn btn-sm rounded-pill px-2 py-0"
        :class="task.petIds.includes(pet._id) ? 'btn-dark' : 'btn-outline-secondary'"
        @click="toggleTaskPet(task, pet._id)"
      >
        {{ pet.name }}
      </button>
      <span v-if="task.petIds.length === 0" class="small text-muted">(all selected pets)</span>
    </div>
  </div>

  <button type="button" class="btn btn-outline-secondary btn-sm" @click="addTask">+ Add Task</button>
</template>
