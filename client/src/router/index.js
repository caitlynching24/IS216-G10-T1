import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Pets from '../views/Pets.vue'
import LoginView from "../views/Login.vue";
import RegisterView from "../views/Register.vue";

const routes = [
{ path: "/login", component: LoginView, meta : { hideElem: true } },
{ path: "/register", component: RegisterView, meta : { hideElem: true } },
{ path: '/', name: 'home', component: Home },
{ path: '/pets', name: 'pets', component: Pets }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
