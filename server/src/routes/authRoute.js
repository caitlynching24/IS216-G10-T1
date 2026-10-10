import { Router } from 'express'
import { postSignup, postLogin, me, logout } from '../controllers/authController.js'

const router = Router()

router.post("/register", postSignup);
router.post("/login", postLogin);
router.get("/me", me);
router.post("/logout", logout);

export default router