// Sizes a full-height map so it ends just above the bottom of the screen, wherever the page puts it.
// The whole map is then visible without scrolling, below the navbar and whatever is above it on the page.
// Only the height is set, never the width. It recalculates when the window resizes or the page's content changes
// (e.g. a message appearing above the map).
//   target: a ref to the element (or to a component, such as WalkMap)
//   gap: space to leave below it (the page's bottom padding), in px
//   min: the smallest it gets on very short screens (the page scrolls then)
//   fromWidth: below this screen width the page's own CSS height applies instead (e.g. phones, where the map sits under a list)
//   fromParent: measure where it starts from its parent, for a sticky map that moves while scrolling
import { onBeforeUnmount, onMounted } from 'vue'

export function useFitHeight(target, { gap = 24, min = 260, fromWidth = 0, fromParent = false } = {}) {
  let observer = null
  let frame = 0

  function fit() {
    const el = target.value?.$el ?? target.value
    if (!el) return
    if (window.innerWidth < fromWidth) {
      el.style.height = ''
      el.style.minHeight = ''
      return
    }
    const top = (fromParent ? el.parentElement : el).getBoundingClientRect().top + window.scrollY
    const height = `${Math.max(min, Math.floor(window.innerHeight - top - gap))}px`
    if (el.style.height !== height) {
      el.style.height = height
      el.style.minHeight = `${min}px` // overrides the map's own 400px minimum, so it can fit short screens
    }
  }
  // at most once per frame, however many changes happen at once
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(fit)
  }

  onMounted(() => {
    fit()
    window.addEventListener('resize', schedule)
    // content above the map can change height (messages, buttons), which moves the map down
    observer = new ResizeObserver(schedule)
    observer.observe(document.body)
  })
  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', schedule)
    observer?.disconnect()
  })
  return { fit }
}
