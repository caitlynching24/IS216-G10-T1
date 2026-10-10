import { ref } from "vue";
import { API } from "./api.js";

export const currentUser = ref(null); // logged out

export async function fetchUser() {
  try {
    const res = await fetch(`${API}/api/auth/me`, { credentials: "include" });
    currentUser.value = res.ok ? await res.json() : null;
  } catch {
    currentUser.value = null;
  }
}

export async function logout() {
  await fetch(`${API}/api/auth/logout`, {
    method: "POST", 
    credentials: "include" 
    });
  currentUser.value = null;
}