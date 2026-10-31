<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { usersApi } from '../services/api.js'
import { usePagination } from '../utils/usePagination.js'
import PaginationBar from './PaginationBar.vue'

const props = defineProps({
  sitterId: { type: String, default: '' },
  mode: { type: String, default: 'received' }
})

// for owner page 
const isGiven = computed(() => props.mode === 'given')
function person(r) {
  return isGiven.value ? r.sitter : r.owner
}

const PAGE_SIZE = 5
const reviews = ref([])
const loading = ref(true)
const error = ref('')
const listEl = ref(null)

const total = computed(() => reviews.value.length || 1)

// filters
const ratingFilter = ref(0)         
const commentsOnly = ref(false)
const sortBy = ref('newest')     

const counts = computed(() => {
  const c = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  reviews.value.forEach((r) => {
    if (c[r.rating] !== undefined) {
      c[r.rating]++
    }
  })
  return c
})

const filtered = computed(() => {
  let list = reviews.value
  if (ratingFilter.value) {
    list = list.filter((r) => r.rating === ratingFilter.value)
  }
  if (commentsOnly.value) {
    list = list.filter((r) => r.comment && r.comment.trim())
  }
  if (sortBy.value === 'highest') {
    list = [...list].sort((a, b) => b.rating - a.rating)
  } else if (sortBy.value === 'lowest') {
    list = [...list].sort((a, b) => a.rating - b.rating)
  }
  return list
})

const { page, pageItems: pagedReviews, goPage, reset } = usePagination(filtered, {
  pageSize: PAGE_SIZE,
  scrollRef: listEl
})
watch([ratingFilter, commentsOnly, sortBy], reset)

const filtersActive = computed(
  () => ratingFilter.value !== 0 || commentsOnly.value || sortBy.value !== 'newest'
)

function initial(name) {
  return name ? name.trim().charAt(0).toUpperCase() : '?'
}

function clearFilters() {
  ratingFilter.value = 0
  commentsOnly.value = false
  sortBy.value = 'newest'
}

function stars(n) {
  const full = Math.round(n)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

function formatDate(d) {
  if (!d) {
    return ''
  }
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function loadReviews(id) {
  loading.value = true
  error.value = ''
  page.value = 1
  clearFilters()
  try {
    const data = isGiven.value
      ? await usersApi.getReviewsGiven(id)
      : await usersApi.getReviews(id)
    reviews.value = Array.isArray(data) ? data : []
  } catch (err) {
    error.value = err.response?.data?.message || 'Could not load reviews.'
    console.error(err)
  } finally {
    loading.value = false
  }
}

watch(() => props.sitterId, (id) => {
  if (id) {
    loadReviews(id)
  }
}, { immediate: true })

watch(ratingFilter, (r) => {
  if (r !== 0 && sortBy.value !== 'newest') {
    sortBy.value = 'newest'
  }
})
watch([ratingFilter, commentsOnly, sortBy], () => {
  page.value = 1
})


</script>

<template>
  <section class="sr">
    <div class="sr-head">
      <h4 class="sr-title">
        {{ isGiven ? 'Reviews written' : 'Reviews' }}<span v-if="!loading"> ({{ reviews.length }})</span>
      </h4>
      <div v-if="reviews.length > 1" class="sr-sort">
        <label for="reviewSort" class="visually-hidden">Sort reviews</label>
        <select id="reviewSort" v-model="sortBy" class="form-select form-select-sm">
          <option value="newest">Newest</option>
          <option value="highest" :disabled="ratingFilter !== 0">Highest rated</option>
          <option value="lowest" :disabled="ratingFilter !== 0">Lowest rated</option>
        </select>
      </div>
    </div>

    <div v-if="error" class="alert alert-warning">{{ error }}</div>

    <div v-else-if="loading" class="d-flex align-items-center text-muted">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Loading reviews…
    </div>

    <p v-else-if="!reviews.length" class="text-muted">
      {{ isGiven ? 'No reviews written yet.' : 'No reviews yet.' }}
    </p>

    <div v-else class="sr-layout" :class="{ 'sr-layout--solo': mode === 'given' }">
      <aside v-if="!isGiven" class="sr-breakdown" aria-label="Filter by rating">
        <button v-for="n in [5, 4, 3, 2, 1]" :key="n" type="button" class="sr-bar"
                :class="{ 'sr-bar--on': ratingFilter === n }"
                :disabled="!counts[n]" :aria-pressed="ratingFilter === n"
                @click="ratingFilter = ratingFilter === n ? 0 : n">
          <span>{{ n }}★</span>
          <span class="sr-bar__track">
            <span class="sr-bar__fill" :style="{ width: `${(counts[n] / total) * 100}%` }"></span>
          </span>
          <span class="sr-bar__count">{{ counts[n] }}</span>
        </button>

        <div class="form-check mt-3 mb-0">
          <input id="commentsOnly" v-model="commentsOnly" type="checkbox" class="form-check-input review-check" />
          <label for="commentsOnly" class="form-check-label small">With comments only</label>
        </div>
        <button v-if="filtersActive" type="button" class="btn btn-link btn-sm p-0 mt-2 text-decoration-none"
                style="color: #a75836;" @click="clearFilters">
          Clear filters
        </button>
      </aside>

      <div ref="listEl" class="sr-list">
        <p v-if="!filtered.length" class="sr-empty text-muted mb-0">No reviews match these filters.</p>

        <template v-else>
          <div class="data-table-wrap">
            <table class="sr-table">
              <thead>
                <tr>
                  <th scope="col" class="sr-th--by">{{ isGiven ? 'Sitter' : 'Reviewer' }}</th>
                  <th scope="col" class="sr-th--rating">Rating</th>
                  <th scope="col">Review</th>
                  <th scope="col" class="sr-th--date">Date</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in pagedReviews" :key="r._id" class="sr-row">
                  <td class="sr-td sr-td--by">
                    <div class="sr-by">
                      <span class="sr-avatar" aria-hidden="true">
                        <img v-if="person(r)?.profilePicture?.url" :src="person(r).profilePicture.url" alt="" loading="lazy" />
                        <template v-else>{{ initial(person(r)?.username) }}</template>
                      </span>
                      <router-link v-if="person(r)?._id" :to="`/users/${person(r)._id}`" class="sr-by__link">
                        {{ person(r).username }}
                      </router-link>
                      <span v-else>Anonymous</span>
                    </div>
                  </td>
                  <td class="sr-td sr-td--rating">
                    <span class="sr-stars" :aria-label="`${r.rating} out of 5`">{{ stars(r.rating) }}</span>
                  </td>
                  <td class="sr-td sr-td--comment">
                    <span v-if="r.comment">{{ r.comment }}</span>
                    <span v-else class="sr-none">No comment</span>
                  </td>
                  <td class="sr-td sr-td--date">
                    <time v-if="r.createdAt" :datetime="r.createdAt">{{ formatDate(r.createdAt) }}</time>
                    <span v-else class="sr-none">–</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <PaginationBar :page="page" :total="filtered.length" :page-size="PAGE_SIZE" @change="goPage" />
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid #e6d3c0;
}
.sr-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: #2b2420;
}
.sr-sort {
  width: auto;
}

.sr-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 1.75rem;
  align-items: start;
}
.sr-layout--solo {
  grid-template-columns: minmax(0, 1fr);
}
@media (max-width: 767.98px) {
  .sr-layout {
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }
}

.sr-bar {
  display: grid;
  grid-template-columns: 2.2rem minmax(0, 1fr) 1.5rem;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.3rem 0.45rem;
  border: 0;
  border-radius: 8px;
  background: none;
  color: #2b2420;
  font-size: 0.9rem;
  text-align: left;
}
.sr-bar:hover:not(:disabled) {
  background: rgba(196, 119, 86, 0.12);
}
.sr-bar--on {
  background: rgba(196, 119, 86, 0.2);
}
.sr-bar:disabled {
  opacity: 0.45;
}
.sr-bar:focus-visible {
  outline: 2px solid #c44f1c;
  outline-offset: 2px;
}
.sr-bar__track {
  height: 0.5rem;
  overflow: hidden;
  border-radius: 999px;
  background: #ead9c8;
}
.sr-bar__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: #c47756;
}
.sr-bar__count {
  text-align: right;
  color: #5c524b;
}

/* the table */
.sr-list {
  min-width: 0;
}
.sr-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
.sr-table thead th {
  padding: 0.7rem 0.5rem;
  text-align: left;
}
.sr-th--by {
  width: 24%;
}
.sr-th--rating {
  width: 8.5rem;
}
.sr-th--date {
  width: 7.5rem;
}

.sr-row {
  border-top: 1px solid #ede3d8;
}
.sr-td {
  padding: 0.85rem 0.5rem;
  vertical-align: middle;
  color: #2b2420;
  overflow-wrap: anywhere;
}
.sr-td--rating,
.sr-td--date {
  white-space: nowrap;
}
.sr-td--date {
  font-size: 0.9rem;
  color: #5c524b;
}
.sr-stars {
  color: #c44f1c;
  letter-spacing: 0.05em;
}
.sr-none {
  color: #5c524b;
  opacity: 0.7;
}

.sr-by {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.sr-avatar {
  flex: none;
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: #a85a38;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
}
.sr-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.sr-by__link {
  color: inherit;
  font-weight: 600;
  text-decoration: none;
}
.sr-by__link:hover {
  color: #a85a38;
  text-decoration: underline;
}
.sr-by__link:focus-visible {
  outline: 2px solid #c44f1c;
  outline-offset: 2px;
  border-radius: 4px;
}
@media (max-width: 767.98px) {
  .data-table-wrap {
    position: relative;
    padding: 0 0.75rem;
  }

  .sr-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .sr-table,
  .sr-table tbody {
    display: block;
    width: 100%;
  }

  .sr-table .sr-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'by date'
      'rating rating'
      'comment comment';
    gap: 0.35rem 0.75rem;
    align-items: center;
    padding: 0.85rem 0.25rem;
  }
  .sr-table .sr-row:first-child {
    border-top: 0;
  }

  .sr-table .sr-td {
    display: block;
    min-width: 0;
    padding: 0;
  }
  .sr-table .sr-td--by {
    grid-area: by;
  }
  .sr-table .sr-td--date {
    grid-area: date;
  }
  .sr-table .sr-td--rating {
    grid-area: rating;
  }
  .sr-table .sr-td--comment {
    grid-area: comment;
  }
}
</style>