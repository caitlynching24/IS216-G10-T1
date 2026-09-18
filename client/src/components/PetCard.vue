<script setup>
defineProps({
  pet: {
    type: Object,
    required: true
  }
})

defineEmits(['delete'])
</script>

<template>
  <div class="col-sm-6 col-lg-4">
    <div class="card h-100 shadow-sm">
      <div class="card-body">
        <h5 class="card-title mb-1">{{ pet.name }}</h5>
        <h6 class="card-subtitle mb-2 text-muted">
          {{ pet.species }}<span v-if="pet.breed"> · {{ pet.breed }}</span>
        </h6>
        <p class="card-text mb-1" v-if="pet.age !== undefined && pet.age !== null">
          Age: {{ pet.age }}
        </p>
        <p class="card-text">{{ pet.description }}</p>
      </div>
      <div class="card-footer bg-transparent border-top-0 text-end">
        <button
          class="btn btn-sm btn-outline-danger"
          @click="$emit('delete', pet._id)"
        >
          Remove
        </button>
      </div>
    </div>
  </div>
</template>
