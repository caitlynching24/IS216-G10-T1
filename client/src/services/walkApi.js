import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true
})

// A sitter's walk along an owner's route (server: /api/walks)
// No try/catch here: errors are passed up to the page, which shows the message to the user
export const walkApi = {
  // ids: { visitId, taskId }: a walk task in the sitter's session for today.
  // If a walk for that task is already under way, the server sends that one back.
  async create(ids) {
    const res = await api.post('/walks', ids)
    return res.data
  },

  async getById(id) {
    const res = await api.get(`/walks/${id}`)
    return res.data
  },

  // location: [lng, lat]
  async start(id, location) {
    const res = await api.post(`/walks/${id}/start`, { location })
    return res.data
  },

  // level: 'warning' | 'notify'
  async reportDeviation(id, level, location, distanceM) {
    const res = await api.post(`/walks/${id}/deviations`, { level, location, distanceM })
    return res.data
  },

  async reportBackOnRoute(id, location) {
    const res = await api.post(`/walks/${id}/back-on-route`, { location })
    return res.data
  },

  // path: [[lng, lat], ...]
  async finish(id, path) {
    const res = await api.post(`/walks/${id}/finish`, { path })
    return res.data
  },

  async endEarly(id, path, reason) {
    const res = await api.post(`/walks/${id}/end-early`, { path, reason })
    return res.data
  }
}
