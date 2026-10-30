<script setup>

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter  } from 'vue-router'
import { currentUser, logout } from "../services/auth.js";
import { unreadCount, startCheckingUnread, stopCheckingUnread } from '../utils/useNotificationBadge.js'
import NotificationIcon from './NotificationIcon.vue';

const route = useRoute()
const router = useRouter()

const hideElem = computed(() => route.meta.hideElem === true)
const searchLink = computed(() => (currentUser.value ? '/home' : '/browse'))
const searchLabel = computed(() => (currentUser.value?.role === 'sitter' ? '🏠︎ Home' : '🔍︎ Search Sitters'))

// open = off-canvas below lg, profile dropdown at lg and up
const open = ref(false);

watch(() => route.fullPath, () => {
  open.value = false;
});

// Only the off-canvas locks page scroll; the desktop dropdown doesn't
watch(open, (isOpen) => {
  document.body.style.overflow = isOpen && window.innerWidth < 992 ? 'hidden' : ''
})

function onKey(e) {
  if (e.key === 'Escape') {
    open.value = false
  }
}

// Crossing the lg breakpoint switches between off-canvas and dropdown, so close whichever was open
let wasDesktop = window.innerWidth >= 992
function onResize() {
  const isDesktop = window.innerWidth >= 992
  if (isDesktop !== wasDesktop) open.value = false
  wasDesktop = isDesktop
}

// Unread notifications badge: every logged-in user, checked every 10 seconds
watch(() => currentUser.value?.role, (role) => {
  if (role) startCheckingUnread()
  else stopCheckingUnread()
}, { immediate: true })


onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
})


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

      <!-- lg and up: Search Sitters sits on the left of the bar -->
      <ul v-if="!hideElem" class="navbar-nav nav-search d-none d-lg-flex">
        <li class="nav-item">
          <router-link class="nav-link" :to="searchLink">{{ searchLabel }}</router-link>
        </li>
      </ul>

      <router-link class="navbar-brand" to="/">
        <!-- <span class="brand-emoji">🐾</span>  -->
        PetSociety
      </router-link>
      <template v-if="!hideElem">
        <div v-if="open" class="nav-backdrop" @click="open = false">
        </div>

        <!-- below lg: off-canvas. lg and up: dropdown under the profile button (logged in only) -->
        <div class="nav-menu" :class="{ 'nav-menu--open': open, 'nav-menu--guest': !currentUser }">
          <button type="button" class="btn-close btn-close-white d-lg-none ms-auto mb-3"
                  aria-label="Close menu" @click="open = false">
          </button>
          <ul class="navbar-nav">
            <li class="nav-item d-lg-none">
              <router-link class="nav-link" :to="searchLink">{{ searchLabel }}</router-link>
            </li>
            <li v-if="currentUser?.role === 'owner'" class="nav-item">
              <router-link class="nav-link" to="/owner/bookings">🗒 My Bookings</router-link>
            </li>
            <li v-if="currentUser" class="nav-item">
              <router-link class="nav-link" to="/session">𓃠 Session</router-link>
            </li>
            <li v-if="currentUser?.role === 'owner'" class="nav-item">
              <router-link class="nav-link" to="/owner/routes">🏞 My Routes</router-link>
            </li>
            <li v-if="currentUser?.role === 'sitter'" class="nav-item">
              <router-link class="nav-link" to="/sitter/calendar">𝄜 Calendar</router-link>
            </li>
            <li v-if="currentUser?.role === 'sitter'" class="nav-item">
              <router-link class="nav-link" to="/sitter/requests">✉︎ Booking Requests</router-link>
            </li>
            <li v-if="currentUser?.role === 'sitter'" class="nav-item">
              <router-link class="nav-link" to="/sitter/transactions">⛁ Transactions</router-link>
            </li>
          </ul>

          <!-- Profile + log out: bottom of the off-canvas, bottom of the dropdown -->
          <div v-if="currentUser" class="nav-account">
            <router-link to="/profile" class="nav-user" aria-label="Your profile">
              <span class="nav-user__avatar" aria-hidden="true">
                <img v-if="currentUser.profilePicture?.url" :src="currentUser.profilePicture.url" alt="" />
                <template v-else>{{ currentUser.username.charAt(0).toUpperCase() }}</template>
              </span>
              <span class="nav-user__name">{{ currentUser.username }}</span>
            </router-link>
            <button class="btn nav-btn" @click="handleLogout">Log out</button>
          </div>
        </div>

        <div class="nav-action">
          <!-- Bell: visible at every width -->
          <NotificationIcon v-if="currentUser" :count="unreadCount" />

          <!-- Profile button: md and up. Opens the off-canvas below lg, the dropdown at lg and up -->
          <button v-if="currentUser" type="button" class="nav-user nav-user--toggle d-none d-md-flex"
                  aria-label="Account menu" aria-haspopup="true" :aria-expanded="open" @click="open = !open">
            <span class="nav-user__avatar" aria-hidden="true">
              <img v-if="currentUser.profilePicture?.url" :src="currentUser.profilePicture.url" alt="" />
              <template v-else>{{ currentUser.username.charAt(0).toUpperCase() }}</template>
            </span>
            <span class="nav-user__name d-none d-lg-inline">{{ currentUser.username }}</span>
            <span class="nav-user__caret d-none d-lg-inline" aria-hidden="true">▾</span>
          </button>

          <router-link v-if="!currentUser" class="btn nav-btn" to="/login">Log in</router-link>
        </div>
      </template>
    </div>
  </nav>

</template>
