<script setup>
</script>

<template>
  <div class="p-5 mb-4 bg-light rounded-3">
    <div class="container-fluid py-4">
      <h1 class="display-5 fw-bold">Welcome to PetSociety 🐾</h1>
      <p class="col-md-8 fs-5">
        A community platform for pet lovers &mdash; find, list, and connect
        over pets that need a home. This starter wires up a Vue 3 + Bootstrap
        client talking to an Express + MongoDB API.
      </p>
      <router-link class="btn btn-primary btn-lg" to="/pets">
        Browse Pets
      </router-link>
    </div>
  </div>
</template>
