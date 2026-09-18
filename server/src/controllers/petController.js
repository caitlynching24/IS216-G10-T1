import Pet from '../models/Pet.js'

export async function getPets(req, res) {
  const pets = await Pet.find().sort({ createdAt: -1 })
  res.json(pets)
}

export async function getPetById(req, res) {
  const pet = await Pet.findById(req.params.id)
  if (!pet) return res.status(404).json({ message: 'Pet not found' })
  res.json(pet)
}

export async function createPet(req, res) {
  const { name, species, breed, age, description } = req.body

  if (!name || !species) {
    return res.status(400).json({ message: 'name and species are required' })
  }

  const pet = await Pet.create({ name, species, breed, age, description })
  res.status(201).json(pet)
}

export async function updatePet(req, res) {
  const pet = await Pet.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  })
  if (!pet) return res.status(404).json({ message: 'Pet not found' })
  res.json(pet)
}

export async function deletePet(req, res) {
  const pet = await Pet.findByIdAndDelete(req.params.id)
  if (!pet) return res.status(404).json({ message: 'Pet not found' })
  res.json({ message: 'Pet removed' })
}
