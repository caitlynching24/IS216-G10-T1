// Wraps an async route handler so rejected promises are passed to Express's
// error handler instead of crashing the process (Express 4 does not do this
// automatically for async functions).
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export default asyncHandler
