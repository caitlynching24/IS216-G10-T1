<script setup>

import { computed } from 'vue'
import { useRoute, useRouter  } from 'vue-router'
import { currentUser, logout } from "../services/auth.js";

const route = useRoute()
const router = useRouter()
const hideElem = computed(() => route.meta.hideElem === true)

async function handleLogout() {
  await logout();
  router.push("/");
}

</script>

<template>
  <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
    <div class="container-fluid">
      <router-link class="navbar-brand" to="/">🐾 PetSociety</router-link>
      <button
        class="navbar-toggler"
        type="button"
        data-bs-toggle="collapse"
        data-bs-target="#navbarNav"
        aria-controls="navbarNav"
        aria-expanded="false"
        aria-label="Toggle navigation"
      >
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="navbarNav">
        <ul class="navbar-nav ms-auto">
          <li v-if="!hideElem" class="nav-item">
            <router-link class="nav-link" to="/">Home</router-link>
          </li>
          <li v-if="!hideElem" class="nav-item">
            <router-link class="nav-link" to="/pets">Pets</router-link>
          </li>
          <li v-if="!currentUser && !hideElem" class="nav-item">
            <router-link class="btn btn-light ms-lg-3" to="/login">Log in</router-link>
          </li>
        <template v-if="currentUser">
          <li class="nav-item">
            <button class="btn btn-secondary ms-lg-2" @click="handleLogout">Log out</button>
          </li>
        </template>
        </ul>
      </div>
    </div>

  </nav>
</template>
