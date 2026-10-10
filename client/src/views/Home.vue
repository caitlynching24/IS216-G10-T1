<script setup>

import { currentUser } from "../services/auth.js";

</script>

<template>
  <div class="p-5 mb-4 bg-light rounded-3">
    <div class="container-fluid py-4">
      <h1 v-if="currentUser" class="display-5 fw-bold">Welcome back, {{ currentUser.username }}🐾</h1>
      <h1 v-else class="display-5 fw-bold">Welcome to Pet Society🐾</h1>

      <p class="col-md-8 fs-5">
        A community platform for pet lovers &mdash; find, list, and connect
        over pets that need a home. 
      </p>
      <router-link class="btn btn-primary btn-lg" to="/pets">
        Browse Pets
      </router-link>
    </div>
  </div>
</template>
