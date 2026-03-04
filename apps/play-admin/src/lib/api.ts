import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pp_admin_token')
  if (token) {
    config.headers = config.headers ?? {}
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status
    const msg = error?.response?.data?.message || ''
    if (status === 401) {
      const lower = typeof msg === 'string' ? msg.toLowerCase() : ''
      if (lower.includes('expired') || lower.includes('unauthorized')) {
        try {
          localStorage.removeItem('pp_admin_token')
          localStorage.removeItem('pp_admin_user')
        } catch {}
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login?session=expired'
        }
      }
    }
    return Promise.reject(error)
  }
)

export default api
