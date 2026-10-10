<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { API } from "../services/api.js";
import { currentUser } from "../services/auth.js";

const router = useRouter();
const form = ref({ username: "", email: "", password: "", confirmPassword: "", role: "owner" });
const errors = ref([]);

async function submit() {
  errors.value = [];
  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(form.value)
    });
    const data = await res.json();
    if (!res.ok) { // if there are errors 
      errors.value = data.errors || [data.message];
      return; 
    }
    currentUser.value = data;
    router.push("/");
  } catch (err) {
    console.error(err); 
    errors.value = ["Cannot reach the server"];
  }
}

</script>

<template>
  <div class="container" style="max-width: 420px">
    <h1 class="h3 my-4">Create account</h1>

    <div v-if="errors.length" class="alert alert-danger">
      <div v-for="e in errors" :key="e">{{ e }}</div>
    </div>

    <form @submit.prevent="submit">
      <div class="mb-3">
        <label class="form-label">I am a</label>
        <select v-model="form.role" class="form-select">
          <option value="owner">Pet owner</option>
          <option value="sitter">Pet sitter</option>
        </select>
      </div>
      <input v-model="form.username" class="form-control mb-3" placeholder="Username" required />
      <input v-model="form.email" type="email" class="form-control mb-3" placeholder="Email" required />
      <input v-model="form.password" type="password" class="form-control mb-3" placeholder="Password" required />
      <input v-model="form.confirmPassword" type="password" class="form-control mb-3" placeholder="Confirm password" required />
      <button class="btn btn-primary w-100 mb-3">Sign up</button>
    </form>

    <span> Already have an account? </span>
    <a href="../login" class="link-primary link-underline-opacity-100-hover">Log In</a>

  </div>
</template>