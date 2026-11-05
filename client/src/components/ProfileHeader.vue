<script setup>
import defaultAvatar from '../assets/img/tempProfile.jpg'
import { ref, watch } from 'vue'
import { usersApi } from '../services/api.js'
import { BADGES } from '../utils/badges.js'
import ProfileActions from './ProfileActions.vue'

const props = defineProps({
  profile: { type: Object, required: true },
  editable: { type: Boolean, default: false }
})

const badges = ref([])
watch(() => props.profile._id, async (id) => {
  badges.value = []
  if (!id || props.profile.role !== 'sitter') {
    return
  }
  try {
    const keys = await usersApi.getBadges(id)
    badges.value = Array.isArray(keys) ? keys.filter((k) => BADGES[k]) : []
  } catch (err) {
    console.warn('Could not load badges', err)
  }
}, { immediate: true })

</script>

<template>
  <div class="ph-card">
    <img :src="profile.profilePicture?.url || defaultAvatar" alt="Profile picture" class="ph-photo" />
    <p class="ph-name">{{ profile.username }}</p>
    <p v-if="editable && profile.email" class="ph-email">{{ profile.email }}</p>
    <p class="ph-bio">{{ profile.bio || 'No bio yet.' }}</p>  
    <ul v-if="badges.length" class="ph-badges" aria-label="Highlights">
      <li v-for="b in badges" :key="b" class="ph-badge" :title="BADGES[b].tip">{{ BADGES[b].label }}</li>
    </ul>
    <ProfileActions :profile="profile" :editable="editable" />

  </div>
</template>

<style scoped>
.ph-card {
  width: 100%; /* its column is d-flex, so without this the card only grows as wide as its content (the photo's 220px) */
  padding: 1.25rem;
  border: 1px solid rgba(196, 119, 86, 0.3);
  border-top: 4px solid var(--line);             
  border-radius: 20px;
  background: var(--tint-soft);                   
  box-shadow: 0 8px 20px rgba(120, 70, 40, 0.14);
}

.ph-photo {
  display: block;
  width: 100%;
  max-width: 220px;
  aspect-ratio: 1;
  margin-bottom: 1rem;
  border-radius: 20px;
  object-fit: cover;
}
.ph-name {
  margin: 0 0 0.15rem;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.15;
  color: black;
}
.ph-email {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  color: #5c524b;
  overflow-wrap: anywhere;
}
.ph-bio {
  color: black;
  overflow-wrap: anywhere;
  margin-top: 0.9rem;
  padding-top: 0.9rem;
  border-top: 1px solid rgba(43, 36, 32, 0.12);
}
.ph-badges {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
  gap: 0.4rem;
  margin: 0.9rem 0 0;
  padding: 0;
  list-style: none;
}
@media (max-width: 767.98px) {
  .ph-card {
    text-align: center;
  }
  .ph-photo {
    margin-inline: auto;        
  }
  .ph-bio {
    margin-inline: auto;      
  }
  .ph-badges {
    align-items: center;         
  }
  .ph-card .btn {
    display: block;
    margin-inline: auto;
  }
}
.ph-badge {
  padding: 0.2rem 0.7rem;
  border: 1px solid rgba(196, 119, 86, 0.45);
  border-radius: 999px;
  background: #fff;
  color: var(--accent-hover);
  font-size: 0.8rem;
  font-weight: 700;
}
</style>