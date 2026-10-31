<script setup>

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter  } from 'vue-router'
import { currentUser, logout } from "../services/auth.js";
import { unreadCount, startCheckingUnread, stopCheckingUnread } from '../utils/useNotificationBadge.js'

const route = useRoute()
const router = useRouter()

const hideElem = computed(() => route.meta.hideElem === true)
const searchLink = computed(() => (currentUser.value ? '/home' : '/browse'))

const open = ref(false);

watch(() => route.fullPath, () => {
  open.value = false; 
});

watch(open, (isOpen) => {
  document.body.style.overflow = isOpen ? 'hidden' : ''
})

function onKey(e) {
  if (e.key === 'Escape') {
    open.value = false
  }
}

function onResize() {
  if (window.innerWidth >= 992) {
    open.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
})

// Unread notifications badge: owners only, checked every 10 seconds while logged in
watch(() => currentUser.value?.role, (role) => {
  if (role === 'owner') startCheckingUnread()
  else stopCheckingUnread()
}, { immediate: true })

onBeforeUnmount(() => {
  stopCheckingUnread()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
  document.body.style.overflow = ''
})

async function handleLogout() {
  open.value = false
  await logout();
  router.push("/");
}

</script>

<template>
  <nav class="topbar navbar navbar-expand-lg navbar-dark">
    <div class="container-fluid">
      <button v-if="!hideElem" class="navbar-toggler" type="button" aria-label="Open menu"
              :aria-expanded="open" @click="open = !open">
        <span class="navbar-toggler-icon"></span>
      </button>
      <router-link class="navbar-brand" to="/">
        PetSociety
      </router-link>
      <template v-if="!hideElem">
        <div v-if="open" class="nav-backdrop" @click="open = false">
        </div>
        <div class="nav-menu" :class="{ 'nav-menu--open': open }">
          <button type="button" class="btn-close btn-close-white d-lg-none ms-auto mb-3"
                  aria-label="Close menu" @click="open = false">
          </button>
          <ul class="navbar-nav align-items-lg-center">
            <li v-if="!hideElem" class="nav-item">
              <router-link class="nav-link" :to="searchLink">{{ currentUser?.role === 'sitter' ? '🏠︎ Home' : '🔍︎ Search Sitters' }}</router-link>
            </li>
            <li v-if="currentUser?.role === 'owner' && !hideElem" class="nav-item">
              <router-link class="nav-link" to="/owner/bookings">🗒 My Bookings</router-link>
            </li>
            <li v-if="!hideElem && currentUser" class="nav-item">
              <router-link class="nav-link" to="/session">𓃠 Session</router-link>
            </li>
            <li v-if="currentUser?.role === 'owner' && !hideElem" class="nav-item">
              <router-link class="nav-link" to="/owner/routes">🏞 My Routes</router-link>
            </li>
                        <li v-if="currentUser?.role === 'owner' && !hideElem" class="nav-item">
              <router-link class="nav-link d-flex align-items-center gap-1" to="/owner/notifications"
                           :aria-label="unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'">
                🕭 Notifications
                <span v-if="unreadCount" class="badge rounded-pill bg-danger">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
              </router-link>
            </li>
            <li v-if="currentUser?.role === 'sitter' && !hideElem" class="nav-item">
              <router-link class="nav-link" to="/sitter/calendar">𝄜 Calendar</router-link>
            </li>
            <li v-if="currentUser?.role === 'sitter' && !hideElem" class="nav-item">
              <router-link class="nav-link" to="/sitter/requests">✉︎ Booking Requests</router-link>
            </li>
            <li v-if="currentUser?.role === 'sitter' && !hideElem" class="nav-item">
              <router-link class="nav-link" to="/sitter/transactions">⛁ Transactions</router-link>
            </li>
          </ul>
          <div class="nav-account">
            <template v-if="currentUser">
              <router-link to="/profile" class="nav-user" aria-label="Your profile">
                <span class="nav-user__avatar" aria-hidden="true">
                  <img v-if="currentUser.profilePicture?.url" :src="currentUser.profilePicture.url" alt="" />
                  <template v-else>{{ currentUser.username.charAt(0).toUpperCase() }}</template>
                </span>
                <span class="nav-user__name">{{ currentUser.username }}</span>
              </router-link>
              <button class="btn nav-btn" @click="handleLogout">Log out</button>
            </template>
            <router-link v-else class="btn nav-btn" to="/login">Log in</router-link>
          </div>
        </div>
      </template>
    </div>
  </nav>
</template>