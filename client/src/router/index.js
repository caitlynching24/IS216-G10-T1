import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Pets from '../views/Pets.vue'

const routes = [
  { path: '/', name: 'home', component: Home },
  { path: '/pets', name: 'pets', component: Pets }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
