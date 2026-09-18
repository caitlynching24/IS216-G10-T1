export function errorHandler(err, req, res, next) {
  console.error(err)

  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message })
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid id' })
  }

  res.status(err.status || 500).json({ message: err.message || 'Server error' })
}

export default errorHandler
