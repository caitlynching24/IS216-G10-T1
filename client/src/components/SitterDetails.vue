<script setup>
import { computed } from 'vue'
import { formatAge } from '../utils/formatAge.js'
import PhotoCarousel from './SitterPhotosCarousel.vue'
import StatsBand from './StatsBand.vue'
import InfoCard from './InfoCard.vue'
import PillList from './PillList.vue'


const props = defineProps({
  profile: { type: Object, required: true },
  editable: { type: Boolean, default: false }
})

const sp = computed(() => props.profile.sitterProfile || {})
const gallery = computed(() => sp.value.gallery ?? [])
// Prices are the same for every sitter now, so we show how many services they offer instead of a rate
const serviceCount = computed(() => sp.value.services?.length || 0)

const experience = computed(() => {
  if (!sp.value.experienceStart) {
    return 'Not set'
  }
  const start = new Date(sp.value.experienceStart)
  const now = new Date()
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  return formatAge(Math.max(0, months))
})

const hasExperience = computed(() => !!sp.value.experienceStart)
const hasArea = computed(() => !!sp.value.serviceArea?.label)
const area = computed(() => sp.value.serviceArea?.label || '')
const ratingAvg = computed(() => sp.value.ratingAvg || 0)
const ratingCount = computed(() => sp.value.ratingCount || 0)

function stars(n) {
  const full = Math.round(n)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

const sitterStats = computed(() => [
  ratingCount.value
    ? {
        key: 'rating',
        value: ratingAvg.value.toFixed(1),
        stars: stars(ratingAvg.value),
        starsLabel: `Rated ${ratingAvg.value.toFixed(1)} out of 5`,
        label: `from ${ratingCount.value} ${ratingCount.value === 1 ? 'rating' : 'ratings'}`
      }
    : { key: 'rating', value: '–', empty: true, label: 'no ratings yet' },
  {
    key: 'services',
    value: serviceCount.value || '–',
    empty: !serviceCount.value,
    label: serviceCount.value
      ? (serviceCount.value === 1 ? 'service offered' : 'services offered')
      : 'services not set'
  },
  {
    key: 'exp',
    value: hasExperience.value ? experience.value : '–',
    empty: !hasExperience.value,
    label: hasExperience.value ? 'of experience' : 'experience not set'
  }
])

// to check if they are ready to be listed on an owner's home page
const isListed = computed(() =>
  !!(sp.value.serviceArea?.label && sp.value.services?.length && sp.value.petTypes?.length)
)

</script>

<template>
  <div class="sd">
    <div v-if="editable && !isListed" class="sd-nudge">
      <p class="mb-2">Owners can’t find you yet. Add your experience, the pets you look after and your services.</p>
      <router-link to="/editProfile" class="btn btn-sm text-white" style="background-color:#a85a38;">
        Add your details
      </router-link>
    </div>

    <StatsBand :stats="sitterStats" />

    <InfoCard>
      <p class="sd-area">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"
                fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
          <circle cx="12" cy="10" r="2.3" fill="currentColor" />
        </svg>
        <span v-if="hasArea">Service Area: <strong>{{ area }}</strong></span>
        <span v-else class="text-muted">Service area not set</span>
      </p>

      <div class="sd-groups">
        <section>
          <h4 class="sd-heading">Looks after</h4>
          <PillList v-if="sp.petTypes?.length" :items="sp.petTypes" />
          <p v-else class="text-muted mb-0">None listed yet</p>
        </section>

        <section>
          <h4 class="sd-heading">Services</h4>
          <PillList v-if="sp.services?.length" :items="sp.services" />
          <p v-else class="text-muted mb-0">None listed yet</p>
        </section>
      </div>
    </InfoCard>

    <PhotoCarousel v-if="gallery.length" :photos="gallery" :name="profile.username"  class="sd-photos" />

    <div v-else-if="editable" class="sd-nudge">
      <p class="mb-2">Add photos of yourself so owners know who is coming to their home.</p>
      <router-link to="/editProfile" class="btn btn-sm text-white" style="background-color:#a85a38;">
        Add photos
      </router-link>
    </div>   
  </div>
</template>

<style scoped>
.sd-nudge {
  margin: 1.25rem 0;
  padding: 1rem 1.15rem;
  border: 1px dashed #e6d3c0;
  border-radius: 12px;
  background: #fbf1e6;               
  color: #2b2420;
}

.sd-area {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #f0e3d4;
  font-size: 1.2rem;
  color: #2b2420;
}
.sd-area svg {
  flex: 0 0 auto;
  color: #c44f1c;
}

.sd-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1.5rem;
}
.sd-heading {
  margin: 0 0 0.6rem;
  font-size: 1.2rem;
  font-weight: 700;
  color: #2b2420;
}

.sd-photos {
  margin-top: 1.5rem;
}
</style>