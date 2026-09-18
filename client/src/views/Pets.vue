<script setup>
import { onMounted, reactive, ref } from 'vue'
import { petsApi } from '../services/api'
import PetCard from '../components/PetCard.vue'

const pets = ref([])
const loading = ref(true)
const error = ref('')
const submitting = ref(false)

const form = reactive({
  name: '',
  species: '',
  breed: '',
  age: '',
  description: ''
})

async function loadPets() {
  loading.value = true
  error.value = ''
  try {
    pets.value = await petsApi.getAll()
  } catch (err) {
    error.value =
      'Could not reach the API. Is the Express server running on the expected port?'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function addPet() {
  if (!form.name || !form.species) return
  submitting.value = true
  try {
    const payload = { ...form, age: form.age ? Number(form.age) : undefined }
    const created = await petsApi.create(payload)
    pets.value.unshift(created)
    Object.assign(form, { name: '', species: '', breed: '', age: '', description: '' })
  } catch (err) {
    error.value = 'Could not add pet.'
    console.error(err)
  } finally {
    submitting.value = false
  }
}

async function deletePet(id) {
  try {
    await petsApi.remove(id)
    pets.value = pets.value.filter((p) => p._id !== id)
  } catch (err) {
    error.value = 'Could not remove pet.'
    console.error(err)
  }
}

onMounted(loadPets)
</script>

<template>
  <h2 class="mb-4">Pets</h2>

  <div v-if="error" class="alert alert-warning">{{ error }}</div>

  <form class="row g-2 align-items-end mb-4" @submit.prevent="addPet">
    <div class="col-sm-3">
      <label class="form-label">Name</label>
      <input v-model="form.name" type="text" class="form-control" required />
    </div>
    <div class="col-sm-3">
      <label class="form-label">Species</label>
      <input v-model="form.species" type="text" class="form-control" required />
    </div>
    <div class="col-sm-2">
      <label class="form-label">Breed</label>
      <input v-model="form.breed" type="text" class="form-control" />
    </div>
    <div class="col-sm-1">
      <label class="form-label">Age</label>
      <input v-model="form.age" type="number" min="0" class="form-control" />
    </div>
    <div class="col-sm-2">
      <label class="form-label">Description</label>
      <input v-model="form.description" type="text" class="form-control" />
    </div>
    <div class="col-sm-1">
      <button type="submit" class="btn btn-primary w-100" :disabled="submitting">
        Add
      </button>
    </div>
  </form>

  <div v-if="loading" class="text-muted">Loading pets…</div>
  <div v-else-if="!pets.length" class="text-muted">
    No pets yet &mdash; add the first one above.
  </div>
  <div v-else class="row g-3">
    <PetCard
      v-for="pet in pets"
      :key="pet._id"
      :pet="pet"
      @delete="deletePet"
    />
  </div>
</template>
