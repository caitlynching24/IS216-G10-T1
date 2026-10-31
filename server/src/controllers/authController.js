import bcrypt from 'bcrypt'
import User from '../models/UserModel.js'

export const postSignup = async (req, res) => {
  try {
    const { username, email, password, confirmPassword, role } = req.body;

    if (!username || !email || !password || !confirmPassword || !role) {
      return res.status(400).json({ errors: ["Please fill in all fields."] });
    }

    const errors = [];
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail.includes('.com')) {
        errors.push("Must be a valid email.");
    }

    if (password !== confirmPassword) {
        errors.push("Passwords do not match.");
    }

    if (password.length < 8) {
        errors.push("Password must be at least 8 characters.");
    }

    const passwordRegex = /[!@#$%^&*]/;
    if (!passwordRegex.test(password)) {
        errors.push("Password must contain at least 1 special character.");
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least 1 uppercase letter.')
    }

    const existingUser = await User.getUserByEmail(cleanEmail);
    if (existingUser) {
        errors.push("Email is already registered."); 
    }

    const existingUser2 = await User.getUserByUsername(username);
    if (existingUser2) {
        errors.push("Username is already registered."); 
    }

    if (errors.length > 0) {
        return res.status(400).json({ errors });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      username: username.trim(),
      email: cleanEmail,
      password: hashedPassword,
      role
    });

    req.session.userId = newUser._id;
    req.session.username = newUser.username;
    req.session.role = newUser.role;

    return res.status(201).json({ id: newUser._id, username: newUser.username, role: newUser.role });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ errors: ["Something went wrong during signup."] });
  }
};

export const postLogin = async (req, res) => {
  try {
    const { emailOrUser, password } = req.body;

    if (!emailOrUser || !password) {
      return res.status(400).json({ message: "Please fill in both boxes." });
    }

    const input = emailOrUser.trim();
    const user = input.includes("@")
      ? await User.getUserByEmail(input.toLowerCase())
      : await User.getUserByUsername(input);

    const isMatch = user && (await bcrypt.compare(password, user.password));
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid login details." });
    }

    req.session.userId = user._id;
    req.session.username = user.username;
    req.session.role = user.role;

    return res.json({ id: user._id, username: user.username, role: user.role });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong during login." });
  }
};

export const me = async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not logged in" });
    }
  const user = await User.findById(req.session.userId).select('-password +ownerProfile.address +ownerProfile.instructions +sitterProfile.address')  
  // res.json({ id: user._id, username: user.username, role: user.role, bio: user.bio });
  // if (!user){
  //   return res.status(401).json({ message: "Not logged in" });
  // }
  res.json(user); // to return all
};

export const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Error logging out." });
    }
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out" });
  });
};