<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { currentUser } from '../services/auth.js'
import { visitsApi } from '../services/api.js'
import SessionCard from '../components/SessionCard.vue'
import { usePagination } from '../utils/usePagination.js'
import PaginationBar from '../components/PaginationBar.vue'

const data = ref(null) 
const loading = ref(true)
const error = ref('')

const PAGE_SIZE = 1
const listEl = ref(null)

const isSitter = computed(() => currentUser.value?.role === 'sitter')

const allDone = computed(
  () => data.value?.sessions.length > 0 && data.value.sessions.every((s) => s.visit?.status === 'completed')
)

function fmt(d) {
  return new Date(`${d}T00:00:00+08:00`).toLocaleDateString('en-SG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
}

async function load(quiet = false) {
  try {
    data.value = await visitsApi.today()
    error.value = ''
  } catch (err) {
    if (!quiet) {
      error.value = err.response?.data?.message || 'Could not load today’s sessions.'
    }
  } finally {
    loading.value = false
  }
}

const allSessions = computed(() => data.value?.sessions ?? [])

const { page, pageItems: pagedSessions, goPage } = usePagination(allSessions, {
  pageSize: PAGE_SIZE,
  scrollRef: listEl
})

// the owner's page refreshes itself while a sitter works
let timer = null
onMounted(() => {
  load()
  timer = setInterval(() => {
    if (!isSitter.value && !document.hidden && data.value?.sessions.length && !allDone.value) {
      load(true)
    }
  }, 10000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="sesh container-fluid mt-1 mb-4">
    <div class="border-bottom pb-2 mb-3">
      <h3 class="mb-0">Today's sessions</h3>
      <p v-if="data" class="text-muted small mb-0">{{ fmt(data.today) }}</p>
    </div>

    <div v-if="error" class="alert alert-warning">{{ error }}</div>

    <div v-else-if="loading" class="d-flex align-items-center text-muted">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Loading…
    </div>

    <div v-else-if="!data.sessions.length" class="text-center text-muted py-5">
      <p class="fs-5 mb-1">No sessions for today</p>
      <p class="small mb-0">Paid bookings that are happening today will show up here.</p>
    </div>

    <div v-else ref="listEl">
      <SessionCard v-for="(s, i) in pagedSessions" :key="s.booking._id" :session="s"
                  :today="data.today" :is-sitter="isSitter"
                  :index="(page - 1) * PAGE_SIZE + i" class="mb-4" />

      <PaginationBar :page="page" :total="allSessions.length" :page-size="PAGE_SIZE" @change="goPage" />
    </div>
  </div>
</template>