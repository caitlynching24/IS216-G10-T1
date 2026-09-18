import { Router } from 'express'
import {
  getPets,
  getPetById,
  createPet,
  updatePet,
  deletePet
} from '../controllers/petController.js'
import asyncHandler from '../middleware/asyncHandler.js'

const router = Router()

router.get('/', asyncHandler(getPets))
router.get('/:id', asyncHandler(getPetById))
router.post('/', asyncHandler(createPet))
router.put('/:id', asyncHandler(updatePet))
router.delete('/:id', asyncHandler(deletePet))

export default router
