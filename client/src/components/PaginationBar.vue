<script setup>
import { computed } from 'vue'

const props = defineProps({
  page: { type: Number, required: true },
  total: { type: Number, required: true },       
  pageSize: { type: Number, default: 5 }
})
defineEmits(['change'])

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

const rangeText = computed(() => {
  if (props.total === 0) {
    return ''
  }
  const from = (props.page - 1) * props.pageSize + 1
  const to = Math.min(props.page * props.pageSize, props.total)
  return `${from}–${to} of ${props.total}`
})

const pageNumbers = computed(() => {
  const last = totalPages.value
  const cur = props.page
  if (last <= 7) {
    return Array.from({ length: last }, (_, i) => i + 1)
  }
  const nums = [...new Set([1, last, cur - 1, cur, cur + 1])]
    .filter((n) => n >= 1 && n <= last)
    .sort((a, b) => a - b)
    const out = []
    nums.forEach((n, i) => {
      if (i > 0) {
        const gap = n - nums[i - 1]
        if (gap === 2) {
          out.push(n - 1)          
        } else if (gap > 2) {
          out.push('…')
        }
      }
      out.push(n)
    })
    return out
})
</script>

<template>
  <nav v-if="totalPages > 1" class="pg" aria-label="Pages">
    <span class="pg__range">{{ rangeText }}</span>
    <ul class="pg__list">
      <li>
        <button type="button" class="pg__btn" :disabled="page === 1" aria-label="Previous page"
                @click="$emit('change', page - 1)">‹</button>
      </li>
      <li v-for="(p, i) in pageNumbers" :key="`${p}-${i}`">
        <span v-if="p === '…'" class="pg__btn pg__btn--gap">…</span>
        <button v-else type="button" class="pg__btn" :class="{ 'pg__btn--on': p === page }"
                :aria-current="p === page ? 'page' : undefined" :aria-label="`Page ${p}`"
                @click="$emit('change', p)">{{ p }}</button>
      </li>
      <li>
        <button type="button" class="pg__btn" :disabled="page === totalPages" aria-label="Next page"
                @click="$emit('change', page + 1)">›</button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.pg {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-top: 0.9rem;
}
.pg__range {
  font-size: 0.9rem;
  color: #5c524b;
}
.pg__list {
  display: flex;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pg__btn {
  min-width: 2.2rem;
  height: 2.2rem;
  padding: 0 0.6rem;
  display: grid;
  place-items: center;
  border: 1px solid #e6d3c0;
  border-radius: 10px;
  background: #fff;
  color: #2b2420;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
.pg__btn:hover:not(:disabled):not(.pg__btn--on) {
  background: rgba(196, 119, 86, 0.16);
  border-color: #c47756;
}
.pg__btn--on {
  background: #a85a38;
  border-color: #a85a38;
  color: #fff;
}
.pg__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pg__btn--gap {
  border-color: transparent;
  background: none;
  cursor: default;
}
.pg__btn:focus-visible {
  outline: 2px solid #c44f1c;
  outline-offset: 2px;
}
</style>