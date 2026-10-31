<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { currentUser } from '../services/auth.js'
import { usersApi } from '../services/api.js'
import defaultAvatar from '../assets/img/tempProfile.jpg'
import { usePhotoPicker } from '../utils/usePhotoPicker.js'
import LocationQuery from '../components/LocationQuery.vue'
import { useLocationSearch } from '../utils/useLocationSearch.js'

const router = useRouter()

const pet_types = ["Dog", "Cat", "Bird", "Rabbit", "Hamster", "Other"];
const services = ["Feeding", "Grooming", "Dog walking", "Cat walking", "Feeding Medication", "Cleaning", "Playtime"] 

const isOwner = computed(() => currentUser.value?.role === 'owner')
const isSitter = computed(() => currentUser.value?.role === 'sitter')

const { file: picFile, preview, error: picError, input: fileInput, onPick, clear: clearSelection } = usePhotoPicker()
const removing = ref(false)

async function removePicture() {
  if (!confirm('Remove your profile picture?')) {
    return
  }
  removing.value = true
  picError.value = ''
  try {
    currentUser.value = await usersApi.removePicture()
    clearSelection()
  } catch (err) {
    picError.value = err.response?.data?.message || 'Could not remove picture.'
  } finally {
    removing.value = false
  }
}

// location
const { locationQuery, locationSuggestions, selected: place, onLocationInput, selectLocation } =
  useLocationSearch({ addressesOnly: true })
const unit = ref('')

function toTitleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

// form
const form = ref({
  username: '',
  bio: '',
  instructions: '',
  sitterProfile: {
    experienceStart: '',
    serviceArea: '',
    petTypes: [],
    services: []
  },
  servicesNeeded: [] // owners only: what their pets need (used to recommend sitters)
})

let filled = false
let hadAddress = false 

function fillForm(user) {
  const sp = user.sitterProfile || {}
  form.value = {
    username: user.username || '',
    bio: user.bio || '',
    instructions: user.ownerProfile?.instructions || '',
    sitterProfile: {
      experienceStart: sp.experienceStart ? sp.experienceStart.slice(0, 7) : '',
      serviceArea: sp.serviceArea?.label || '',
      petTypes: [...(sp.petTypes || [])],
      services: [...(sp.services || [])]
    },
    servicesNeeded: [...(user.ownerProfile?.servicesNeeded || [])]
  }

  const saved = user.role === 'sitter' ? user.sitterProfile?.address : user.ownerProfile?.address
  const coords = saved?.location?.coordinates
  if (saved?.postalCode && coords?.length === 2) {
    place.value = {
      label: `${saved.line1} SINGAPORE ${saved.postalCode}`,
      line1: saved.line1,
      road: '',
      postalCode: saved.postalCode,
      lat: coords[1],
      lng: coords[0]
    }
    locationQuery.value = place.value.label
    hadAddress = true
  }
  unit.value = saved?.unit || ''
}


function onPlacePick(s) {
  selectLocation(s)
  const name = place.value?.road || place.value?.line1
  if (isSitter.value && name) {
    form.value.sitterProfile.serviceArea = toTitleCase(name)
  }
}

// sitter gallery
const MAX_GALLERY = 5
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 2 * 1024 * 1024

const savedGallery = computed(() => currentUser.value?.sitterProfile?.gallery ?? [])
const pending = ref([])                 
const galleryError = ref('')
const removingId = ref(null)
let nextId = 0

const slotsLeft = computed(() => MAX_GALLERY - savedGallery.value.length - pending.value.length)

function onGalleryPick(e) {
  galleryError.value = ''
  const files = Array.from(e.target.files ?? [])
  e.target.value = ''                    
  for (const file of files) {
    if (!ALLOWED.includes(file.type)) {
      galleryError.value = 'Please choose JPG, PNG or WebP images.'
      continue
    }
    if (file.size > MAX_BYTES) {
      galleryError.value = 'Each image must be under 2 MB.'
      continue
    }
    if (slotsLeft.value <= 0) {
      galleryError.value = `You can have up to ${MAX_GALLERY} photos.`
      break
    }
    pending.value.push({ id: nextId++, file, url: URL.createObjectURL(file) })
  }
}

function clearPending(item) {
  URL.revokeObjectURL(item.url)
  pending.value = pending.value.filter((p) => p.id !== item.id)
}

async function deleteSaved(photo) {
  if (!confirm('Delete this photo?')) {
    return
  }
  removingId.value = photo._id
  galleryError.value = ''
  try {
    currentUser.value = await usersApi.removeGalleryPhoto(photo._id)
  } catch (err) {
    galleryError.value = err.response?.data?.message || 'Could not delete the photo.'
  } finally {
    removingId.value = null
  }
}

onBeforeUnmount(() => {
  pending.value.forEach((p) => URL.revokeObjectURL(p.url))
})

watch(currentUser, (user) => {
  if (user && !filled) {
    fillForm(user)
    filled = true
  }
}, { immediate: true })

const error = ref('')
const saving = ref(false)

async function save() {
  error.value = ''
  saving.value = true
  let detailsSaved = false

  try {
    const payload = { username: form.value.username, bio: form.value.bio }
    if (place.value) {
      payload.address = {
        line1: place.value.line1,
        postalCode: place.value.postalCode,
        lat: place.value.lat,
        lng: place.value.lng,
        unit: isOwner.value ? unit.value : ''
      }
    } else if (hadAddress && locationQuery.value.trim() === '') {
      payload.address = null      
    }

    if (isSitter.value) {
      payload.sitterProfile = { ...form.value.sitterProfile }
    }
    if (isOwner.value) {
      payload.servicesNeeded = [...form.value.servicesNeeded]
      payload.instructions = form.value.instructions
    }

    currentUser.value = await usersApi.updateMe(payload)
    detailsSaved = true

    if (picFile.value) {
      const data = new FormData()
      data.append('photo', picFile.value)
      currentUser.value = await usersApi.updatePicture(data)
    }
    if (pending.value.length > 0) {
      const data = new FormData()
      pending.value.forEach((p) => data.append('photos', p.file))     
      currentUser.value = await usersApi.addGallery(data)
      pending.value.forEach((p) => URL.revokeObjectURL(p.url))
      pending.value = []
    }
    router.push('/profile')
  } catch (err) {
    const message = err.response?.data?.message
    if (detailsSaved) {
      error.value = `Your details were saved, but your photos could not be updated${message ? `: ${message}` : '.'}`
    } else {
      error.value = message || 'Could not save changes.'
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="currentUser" class="mx-auto mt-4 mb-4 px-2" style="max-width: 1100px">
    <h3 class="border-bottom pb-2 mb-4">Edit profile</h3>

    <form @submit.prevent="save">
      <div class="row g-4">
        <!-- side column: private -->
        <div class="col-12 col-lg-4 order-lg-last" :class="{ 'order-last': isOwner }">
          <section class="ef-card ef-card--private">
            <h4 class="ef-card__title">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
              Private
            </h4>
            <p class="ef-card__hint">
              {{ isSitter ? 'Owners only see your service area, never your address.' : 'Private. Shared only with a sitter once they confirm your booking.' }}
            </p>

            <div class="form-label">{{ isSitter ? 'Home address' : 'Address' }}</div>
            <LocationQuery
              label=""
              v-model:location-query="locationQuery"
              :location-suggestions="locationSuggestions"
              @enterLocation="onLocationInput"
              @selectLocation="onPlacePick" />
            <div v-if="locationQuery.trim() && locationQuery !== place?.label" class="form-text text-danger">
              Pick an address from the list.
            </div>  
            <template v-if="isSitter">            
              <label class="form-label mt-2" for="area">Service area</label>
              <input id="area" v-model="form.sitterProfile.serviceArea" class="form-control"
                    placeholder="e.g. Tampines" />
            </template>
            <template v-if="isOwner">
              <label class="form-label mt-2" for="unit">Unit number</label>
              <input id="unit" v-model="unit" class="form-control mb-2" placeholder="#05-123" maxlength="20" />
            </template>
            <template v-if="isOwner">
              <label class="form-label mt-2" for="instr">Instructions to get in</label>
              <textarea id="instr" v-model="form.instructions" class="form-control" rows="3" maxlength="300"
                        placeholder="e.g. Door code 1234"></textarea>
            </template>
          </section>
        </div>

        <!-- main column -->
        <div class="col-12 col-lg-8">

          <section class="ef-card">
            <h4 class="ef-card__title">Your profile</h4>
            <p class="ef-card__hint">This is what other people see.</p>

            <div class="ef-who">
              <div>
                <div class="ef-avatar">
                  <img :src="preview || currentUser?.profilePicture?.url || defaultAvatar" alt="Profile picture" />
                  <label class="ef-avatar__change">
                    Change
                    <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp"
                           class="visually-hidden" @change="onPick" />
                  </label>
                </div>

                <div class="ef-avatar__actions">
                  <button v-if="picFile" type="button" class="btn btn-link btn-sm p-0" @click="clearSelection">
                    Clear selection
                  </button>
                  <button v-if="currentUser?.profilePicture?.url && !picFile" type="button"
                          class="btn btn-link btn-sm p-0 text-danger" :disabled="removing" @click="removePicture">
                    <span v-if="removing" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
                    {{ removing ? 'Removing…' : 'Remove picture' }}
                  </button>
                </div>
                <div v-if="picError" class="alert alert-warning py-1 mt-2">{{ picError }}</div>
              </div>

              <div class="ef-who__fields">
                <label class="form-label" for="username">Username</label>
                <input id="username" v-model="form.username" class="form-control mb-3" required />

                <label class="form-label" for="bio">Bio</label>
                <textarea id="bio" v-model="form.bio" class="form-control" rows="4" maxlength="500"
                          placeholder="Tell us more about yourself!"></textarea>
                <div class="text-muted small text-end">{{ form.bio.length }}/500</div>
              </div>
            </div>
          </section>

          <section v-if="isOwner" class="ef-card">
            <h4 class="ef-card__title">Services I need</h4>
            <p class="ef-card__hint">We'll recommend sitters who offer these on your home page.</p>
            <div class="ef-chips" role="group" aria-label="Services I need">
              <label v-for="s in services" :key="s" class="ef-chip">
                <input type="checkbox" :value="s" v-model="form.servicesNeeded" />
                <span>{{ s }}</span>
              </label>
            </div>
          </section>

          <section v-if="isSitter" class="ef-card">
            <h4 class="ef-card__title">Sitter details</h4>
            <p class="ef-card__hint">Owners use these to find and compare sitters.</p>

            <div class="row g-3 mb-3">
              <div class="col-12 col-sm-6">
                <label class="form-label" for="since">Sitting since</label>
                <input id="since" v-model="form.sitterProfile.experienceStart" type="month" class="form-control" />
              </div>
            </div>

            <div id="petsLabel" class="form-label">I look after</div>
            <div class="ef-chips mb-3" role="group" aria-labelledby="petsLabel">
              <label v-for="t in pet_types" :key="t" class="ef-chip">
                <input type="checkbox" :value="t" v-model="form.sitterProfile.petTypes" />
                <span>{{ t }}</span>
              </label>
            </div>

            <div id="servicesLabel" class="form-label">Services</div>
            <div class="ef-chips" role="group" aria-labelledby="servicesLabel">
              <label v-for="s in services" :key="s" class="ef-chip">
                <input type="checkbox" :value="s" v-model="form.sitterProfile.services" />
                <span>{{ s }}</span>
              </label>
            </div>
          </section>

          <section v-if="isSitter" class="ef-card">
            <h4 class="ef-card__title">Your photos</h4>
            <p class="ef-card__hint">Add up to 5 photos. Owners will see them on your profile.</p>

            <div class="eg-grid">
              <div v-for="photo in savedGallery" :key="photo._id" class="eg-tile">
                <img :src="photo.url" alt="One of your photos" />
                <button type="button" class="btn-close eg-x bg-white p-1" aria-label="Delete photo"
                        :disabled="removingId === photo._id" @click="deleteSaved(photo)"></button>
              </div>

              <div v-for="item in pending" :key="item.id" class="eg-tile">
                <img :src="item.url" alt="A new photo that is not saved yet" />
                <button type="button" class="btn-close eg-x bg-white p-1" aria-label="Clear selection"
                        @click="clearPending(item)"></button>
              </div>

              <label v-if="slotsLeft > 0" class="eg-tile eg-add">
                <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
                <span>Add photos</span>
                <input type="file" multiple accept="image/jpeg,image/png,image/webp" class="visually-hidden"
                       @change="onGalleryPick" />
              </label>
            </div>

            <div v-if="galleryError" class="alert alert-warning py-1 mt-2">{{ galleryError }}</div>
            <p v-if="pending.length" class="form-text mb-0">New photos are saved when you press Save.</p>
          </section>
        </div>
      </div>

      <div class="ef-bar">
        <p v-if="error" class="ef-bar__error" role="alert">{{ error }}</p>
        <router-link class="btn btn-outline-secondary" to="/profile">Cancel</router-link>
        <button type="submit" class="btn ef-save" :disabled="saving || removing">
          <span v-if="saving" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
          {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </form>
  </div>
  <p v-else class="container mt-4">Loading…</p>
</template>

<style scoped>
.sc-instructions {
  white-space: pre-line;        
  overflow-wrap: anywhere;      
}
.eg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.75rem;
}
.eg-tile {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 12px;
  background: #f4e4d3;
}
.eg-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.eg-x {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
}
.eg-badge {
  position: absolute;
  left: 0.4rem;
  bottom: 0.4rem;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  background: rgba(43, 36, 32, 0.85);
  color: #fff;
  font-size: 0.7rem;
}
.eg-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  border: 2px dashed #c9a98f;
  background: #f8eee3;
  color: #5c524b;
  font-size: 0.85rem;
  cursor: pointer;
}
.eg-add:hover {
  border-color: #c47756;
  background: #f4e4d3;
}
.eg-add:focus-within {
  outline: 2px solid #c44f1c;
  outline-offset: 2px;
}

.ef-card {
  margin-bottom: 1.5rem;
  padding: 1.25rem 1.35rem;
  border: 1px solid rgba(196, 119, 86, 0.3);
  border-top: 4px solid #e6d3c0;    
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 6px 16px rgba(120, 70, 40, 0.1);
}
.ef-card__title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.2rem;
  font-size: 1.2rem;
  font-weight: 700;
  color: #2b2420;
}
.ef-card__hint {
  margin: 0 0 1.1rem;
  font-size: 0.9rem;
  color: #5c524b;
}
.ef-card--private {
  background: #fbf1e6;
}

.ef-who {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
@media (max-width: 575.98px) {
  .ef-who {
    grid-template-columns: 1fr;
  }
}
.ef-avatar {
  position: relative;
  width: 150px;
  height: 150px;
  overflow: hidden;
  border-radius: 20px;
  background: #f4e4d3;
}
.ef-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ef-avatar__change {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0.35rem 0;
  background: rgba(43, 36, 32, 0.72);
  color: #fff;
  text-align: center;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
.ef-avatar__change:hover {
  background: rgba(43, 36, 32, 0.88);
}
.ef-avatar:focus-within {
  outline: 2px solid #c44f1c;
  outline-offset: 2px;
}
.ef-avatar__actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.ef-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.ef-chip {
  position: relative;
  margin: 0;
}
.ef-chip input {
  position: absolute;
  opacity: 0;
  inset: 0;
  cursor: pointer;
}
.ef-chip span {
  display: inline-block;
  padding: 0.30em 0.8rem;
  border: 1px solid #d9c3ad;
  border-radius: 999px;
  background: #fff;
  color: #2b2420;
  font-size: 0.9rem;
  font-weight: 600;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ef-chip input:hover + span {
  border-color: #c47756;
}
.ef-chip input:checked + span {
  background: #a85a38;
  border-color: #a85a38;
  color: #fff;
}
.ef-chip input:checked + span::before {
  content: '✓ ';
}
.ef-chip input:focus-visible + span {
  outline: 2px solid #c44f1c;
  outline-offset: 2px;
}

.ef-bar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 0.5rem;
  padding: 0.8rem 0;
  border-top: 1px solid #e6d3c0;
  background: rgba(255, 250, 245, 0.94);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.ef-bar__error {
  margin: 0 auto 0 0;
  color: #b3261e;
  font-size: 0.9rem;
}
.ef-save {
  padding: 0.5rem 1.5rem;
  border: 0;
  background: #a85a38;
  color: #fff;
  font-weight: 600;
}
.ef-save:hover:not(:disabled) {
  background: #8f4a2c;
  color: #fff;
}
</style>