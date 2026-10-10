import axios from 'axios'

// In dev, Vite proxies /api to the Express server (see vite.config.js),
// so VITE_API_URL only needs to be set explicitly for production builds.
const baseURL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({ baseURL })

export const petsApi = {
  getAll: () => api.get('/pets').then((res) => res.data),
  getById: (id) => api.get(`/pets/${id}`).then((res) => res.data),
  create: (pet) => api.post('/pets', pet).then((res) => res.data),
  update: (id, pet) => api.put(`/pets/${id}`, pet).then((res) => res.data),
  remove: (id) => api.delete(`/pets/${id}`).then((res) => res.data)
}

// export default api
export const API = import.meta.env.VITE_API_URL || "http://localhost:5000";
