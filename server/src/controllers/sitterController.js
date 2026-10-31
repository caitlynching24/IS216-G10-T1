import User from '../models/UserModel.js'


export async function getSitters(req, res) {
    try {
        const sitters = await User.find({ role: 'sitter',
            'sitterProfile.serviceArea.label': { $exists: true, $nin: ['', null] },
            'sitterProfile.services.0': { $exists: true },
            'sitterProfile.petTypes.0': { $exists: true }
        }).select('-password -email')
        res.json(sitters)
    } catch (error) {
        console.log(error)
        return res.status(500).json({ message: 'Error in loading sitter profiles' });
    }
}