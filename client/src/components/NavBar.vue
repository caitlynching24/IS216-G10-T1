<script setup>

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter  } from 'vue-router'
import { currentUser, logout } from "../services/auth.js";
import { unreadCount, startCheckingUnread, stopCheckingUnread } from '../utils/useNotificationBadge.js'
import NotificationIcon from './NotificationIcon.vue';
import { showToast } from '../utils/useToast.js'

const route = useRoute()
const router = useRouter()

const hideElem = computed(() => route.meta.hideElem === true)
const searchLink = computed(() => (currentUser.value ? '/home' : '/browse'))
// icon and text are split so every icon sits in the same fixed-width column
const searchIcon = computed(() => (currentUser.value?.role === 'sitter' ? '🏠︎' : '🔍︎'))
const searchLabel = computed(() => (currentUser.value?.role === 'sitter' ? 'Home' : 'Search Sitters'))

// open = page menu from the left button (off-canvas below lg, dropdown at lg and up)
const open = ref(false);
// accountOpen = the small dropdown beside the avatar that holds Log out
const accountOpen = ref(false)

const menuEl = ref(null)
const menuBtnEl = ref(null)
const accountEl = ref(null)

watch(() => route.fullPath, () => {
  open.value = false;
  accountOpen.value = false
});

// Only the off-canvas locks page scroll; the desktop dropdown doesn't
watch(open, (isOpen) => {
  document.body.style.overflow = isOpen && window.innerWidth < 992 ? 'hidden' : ''
})

function toggleMenu() {
  open.value = !open.value
  accountOpen.value = false
}

function toggleAccount() {
  accountOpen.value = !accountOpen.value
  open.value = false
}

function onKey(e) {
  if (e.key === 'Escape') {
    open.value = false
    accountOpen.value = false
  }
}

// clicking anywhere outside a dropdown closes it
function onDocClick(e) {
  if (open.value && !menuEl.value?.contains(e.target) && !menuBtnEl.value?.contains(e.target)) {
    open.value = false
  }
  if (accountOpen.value && !accountEl.value?.contains(e.target)) {
    accountOpen.value = false
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
  document.addEventListener('click', onDocClick)
})


onBeforeUnmount(() => {
  stopCheckingUnread()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('click', onDocClick)
  document.body.style.overflow = ''
})

async function handleLogout() {
  open.value = false
  accountOpen.value = false
  await logout();
  showToast('Logged out successfully')
  router.push("/");
}

</script>

<template>
  <nav class="topbar navbar navbar-dark">
    <div class="container-fluid">
      <!-- page links open from this button on the left, at every width -->
      <button v-if="!hideElem" ref="menuBtnEl" class="nav-menu-btn" type="button" aria-label="Open menu"
              aria-haspopup="true" :aria-expanded="open" @click="toggleMenu">
        <span aria-hidden="true">☰</span>
        <span class="d-none d-sm-inline">Menu</span>
      </button>

      <router-link class="navbar-brand" to="/">
        <img src="../assets/img/PetSocietyPin.png" alt="" class="brand-logo" width="28" height="34" />
        PetSociety
      </router-link>
      <template v-if="!hideElem">
        <div v-if="open" class="nav-backdrop" @click="open = false">
        </div>

        <!-- below lg: off-canvas. lg and up: dropdown under the menu button -->
        <div ref="menuEl" class="nav-menu" :class="{ 'nav-menu--open': open }">
          <button type="button" class="btn-close btn-close-white d-lg-none ms-auto mb-3"
                  aria-label="Close menu" @click="open = false">
          </button>
          <ul class="navbar-nav">
            <li class="nav-item">
              <router-link class="nav-link" :to="searchLink">
                <span class="nav-icon" aria-hidden="true">{{ searchIcon }}</span>{{ searchLabel }}
              </router-link>
            </li>
            <li v-if="currentUser?.role === 'owner'" class="nav-item">
              <router-link class="nav-link" to="/owner/bookings"><span class="nav-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-book" viewBox="0 0 16 16">
                  <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/>
                </svg>
              </span>My Bookings</router-link>
            </li>
            <li v-if="currentUser" class="nav-item">
              <router-link class="nav-link" to="/session"><span class="nav-icon" aria-hidden="true">
              <i class="fa-solid fa-cat"></i>
              </span>Session</router-link>
            </li>
            <li v-if="currentUser?.role === 'owner'" class="nav-item">
              <router-link class="nav-link" to="/owner/routes"><span class="nav-icon" aria-hidden="true">
              <i class="fa-solid fa-location-dot"></i>
              </span>My Routes</router-link>
            </li>
            <li v-if="currentUser?.role === 'sitter' && !hideElem" class="nav-item">
              <router-link class="nav-link" to="/sitter/calendar"><span class="nav-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-calendar" viewBox="0 0 16 16">
                <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/>
              </svg>
              </span>Calendar</router-link>
            </li>
            <li v-if="currentUser?.role === 'sitter'" class="nav-item">
              <router-link class="nav-link" to="/sitter/requests"><span class="nav-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-book" viewBox="0 0 16 16">
                  <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/>
                </svg>
              </span>Booking Requests</router-link>
            </li>
            <li v-if="currentUser?.role === 'sitter'" class="nav-item">
              <router-link class="nav-link" to="/sitter/transactions"><span class="nav-icon" aria-hidden="true">
              <i class="fa-solid fa-credit-card"></i>
              </span>Transactions</router-link>
            </li>
          </ul>
        </div>

        <div class="nav-action">
          <!-- Bell: visible at every width -->
          <NotificationIcon v-if="currentUser" :count="unreadCount" />

          <!-- one button (avatar + name + caret) opens a dropdown with Profile and Log out -->
          <div v-if="currentUser" ref="accountEl" class="nav-account">
            <button type="button" class="nav-user nav-user--toggle" aria-label="Account menu" aria-haspopup="true"
                    :aria-expanded="accountOpen" @click="toggleAccount">
              <span class="nav-user__avatar" aria-hidden="true">
                <img v-if="currentUser.profilePicture?.url" :src="currentUser.profilePicture.url" alt="" />
                <template v-else>{{ currentUser.username.charAt(0).toUpperCase() }}</template>
              </span>
              <!-- hidden under 560px, cut short up to 899px, in full from 900px (main.css) -->
              <span class="nav-user__name">{{ currentUser.username }}</span>
              <span class="nav-user__caret" aria-hidden="true">▾</span>
            </button>
            <div v-if="accountOpen" class="nav-account-menu">
              <!-- phones only: the name, since the button shows just the avatar there -->
              <div class="nav-account-menu__name">{{ currentUser.username }}</div>
              <router-link to="/profile" class="nav-link">
                <span class="nav-icon" aria-hidden="true">
                  <i class="fa-regular fa-circle-user"></i>
                </span>Profile
              </router-link>
              <button type="button" class="nav-link" @click="handleLogout">
                <span class="nav-icon" aria-hidden="true">
                <i class="fa-solid fa-right-from-bracket"></i>
                </span>Log out
              </button>
            </div>
          </div>

          <router-link v-if="!currentUser" class="btn nav-btn" to="/login">Log in</router-link>
        </div>
      </template>
    </div>
  </nav>

</template>
