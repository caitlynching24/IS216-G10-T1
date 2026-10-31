<script setup>
// "Recommended for you" strip on the owner's home page.
// The owner picks "Services I need" on the Edit Profile page (saved as ownerProfile.servicesNeeded).
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { currentUser } from '../services/auth.js'
import defaultAvatar from '../assets/img/tempProfile.jpg'

const MAX_SHOWN = 3 // only show the best few

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', withCredentials: true })

const sitters = ref([])
const needs = computed(() => currentUser.value?.ownerProfile?.servicesNeeded || [])

// The services a sitter offers that this owner needs, e.g. ['Grooming']
function matchesFor(sitter) {
  const offers = sitter.sitterProfile?.services || []
  return needs.value.filter((s) => offers.includes(s))
}

// Sitters who match at least one need: most matches first, then the higher rating first
const recommended = computed(() =>
  sitters.value
    .map((s) => ({ sitter: s, matches: matchesFor(s) }))
    .filter((r) => r.matches.length > 0)
    .sort((a, b) =>
      b.matches.length - a.matches.length ||
      (b.sitter.sitterProfile?.ratingAvg || 0) - (a.sitter.sitterProfile?.ratingAvg || 0)
    )
    .slice(0, MAX_SHOWN)
)

onMounted(async () => {
  if (!needs.value.length) return // nothing to match on, so no need to ask the server
  try {
    const res = await api.get('/sitters')
    sitters.value = res.data
  } catch {
    sitters.value = [] // recommendations are a bonus; if they fail the rest of the page still works
  }
})
</script>

<template>
  <section v-if="currentUser?.role === 'owner'" class="rec mb-3">
    <h2 class="fs-6 fw-bold mb-2">Recommended for you</h2>

    <!-- No needs picked yet: point them to Edit Profile -->
    <p v-if="!needs.length" class="small text-muted mb-0">
      Tell us what your pets need (e.g. Grooming) in
      <router-link to="/editProfile">Edit Profile</router-link> and we'll suggest matching sitters here.
    </p>

    <p v-else-if="!recommended.length" class="small text-muted mb-0">
      No sitters offer {{ needs.join(' or ') }} yet. Try the search below.
    </p>

    <div v-else class="row g-2">
      <div v-for="r in recommended" :key="r.sitter._id" class="col-12 col-md-4">
        <router-link :to="`/users/${r.sitter._id}`" class="rec-card d-flex align-items-center gap-2 text-reset text-decoration-none">
          <img :src="r.sitter.profilePicture?.url || defaultAvatar" class="rounded-circle rec-avatar" alt="" />
          <div class="min-w-0">
            <div class="fw-semibold text-truncate">{{ r.sitter.username }}</div>
            <div class="small text-muted text-truncate">Offers {{ r.matches.join(', ') }}</div>
          </div>
        </router-link>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rec-card {
  background: #fff;
  border: 1px solid rgba(196, 119, 86, 0.3);
  border-top: 4px solid #e6d3c0;    
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 6px 16px rgba(120, 70, 40, 0.1);
}
.rec-card:hover {
  border-color: #c44f1c;
}
.rec-avatar {
  width: 44px;
  height: 44px;
  object-fit: cover;
  flex-shrink: 0;
}
.min-w-0 {
  min-width: 0;
}
</style>