import { createRouter, createWebHistory } from 'vue-router'
import { currentUser, fetchUser } from '../services/auth.js'
import LoginView from "../views/Login.vue";
import RegisterView from "../views/Register.vue";
import Home from "../views/Home.vue"
import ProfileView from "../views/Profile.vue";
import EditProfile from '../views/EditProfile.vue'
import OwnerHome from '../views/OwnerHome.vue'
import RolePicker from '../components/RolePicker.vue'
import BookingRequests from '../views/BookingRequests.vue'
import MyBookings from '../views/MyBookings.vue'
import SitterCalendar from '../views/SitterCalendar.vue'
import NewBookingRequest from '../views/NewBookingRequest.vue'
import Session from '../views/Session.vue'
import BookingDetail from '../views/BookingDetail.vue'
import RecordRoute from '../views/RecordRoute.vue'
import MyRoutes from '../views/MyRoutes.vue'
import SitterWalk from '../views/SitterWalk.vue'
import OwnerNotifications from '../views/OwnerNotifications.vue'
import PaymentGateway from '../views/PaymentGateway.vue'
import Transactions from '../views/Transactions.vue'

const routes = [
{ path: '/', name: 'welcome', component: RolePicker, meta: { hideElem: true } }, // landing page 
{ path: "/login", component: LoginView, meta : { hideElem: true } },
{ path: "/register", component: RegisterView, meta : { hideElem: true } },
{ path: '/home', name: 'home', component: Home }, // logged in users
{ path: '/browse', component: OwnerHome }, // logged out users
{ path: '/profile', name: 'profile', component: ProfileView, meta: { auth: true } },
{ path: '/editProfile', name: 'editProfile', component: EditProfile, meta: { auth: true, hideElem: true } },
{ path: '/users/:id', name: 'user', component: ProfileView },
{ path: '/session', name: 'session', component: Session, meta: { auth: true } },
{ path: '/sitter/requests', name: 'sitter-requests', component: BookingRequests, meta: { role: 'sitter' } },
{ path: '/sitter/transactions', name: 'sitter-transactions', component: Transactions, meta: { role: 'sitter' } },
{ path: '/bookings/:id/pay', name: 'pay', component: PaymentGateway, meta: { role: 'owner' } },
{ path: '/owner/bookings', name: 'owner-bookings', component: MyBookings, meta: { role: 'owner' } },
{ path: '/sitter/calendar', name: 'sitter-calendar', component: SitterCalendar, meta: { role: 'sitter' } },
{ path: '/bookings/:id', name: 'booking-detail', component: BookingDetail, meta: { auth: true } },
{ path: '/bookings/new', name: 'new-booking', component: NewBookingRequest, meta: { role: 'owner' } },
{ path: '/owner/routes', name: 'my-routes', component: MyRoutes, meta: { role: 'owner' } },
{ path: '/owner/routes/new', name: 'record-route', component: RecordRoute, meta: { role: 'owner' } },
{ path: '/owner/routes/:id/record', name: 'rerecord-route', component: RecordRoute, meta: { role: 'owner' } },
{ path: '/sitter/walks/:id', name: 'sitter-walk', component: SitterWalk, meta: { role: 'sitter' } },
{ path: '/owner/notifications', name: 'owner-notifications', component: OwnerNotifications, meta: { role: 'owner' } },
]

// connects a url path to the vue page which shd be displayed, tgt with the components it needs 

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  if (to.path === '/') {
    if (!currentUser.value) await fetchUser() 
    if (currentUser.value) return '/home'
  }
})

export default router
