<script setup>
import { defineProps } from 'vue'

const props = defineProps({
  count: {
    type: Number,
    default: 0
  }
})
</script>

<template>
  <div class="notification-wrapper">
    <!-- Notification Icon (Bell) -->
    <router-link
      to="/notifications"
      class="icon-button"
      :aria-label="count ? `Notifications, ${count} unread` : 'Notifications'"
    >
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        class="bell-icon" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
      >
        <path 
          stroke-linecap="round" 
          stroke-linejoin="round" 
          stroke-width="2" 
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" 
        />
      </svg>
      
      <span v-if="count" class="badge" aria-hidden="true">
        {{ count > 9 ? '9+' : count }}
      </span>

      
      
    </router-link>
  </div>
</template>

<style scoped>
.notification-wrapper {
  position: relative;
  display: inline-block;
}

.icon-button {
  background: none;
  border: none;
  cursor: pointer;
  position: relative;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-button:hover{
    background-color: rgb(51, 49, 49);
    border-radius: 100%;
}

.bell-icon {
  width: 24px;
  height: 24px;
  color: #83868b;
}

.badge {
  position: absolute;
  top: 0;
  right: 0;
  background-color: #e11d48; /* Red color */
  color: #ffffff;
  font-size: 0.7rem;
  font-weight: bold;
  border-radius: 9999px;
  min-width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  line-height: 1;
}
</style>

