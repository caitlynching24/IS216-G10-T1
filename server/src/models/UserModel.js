import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ["owner", "sitter"],
    required: true
    // default: "owner"
  },
  bio: {
    type: String,
    default: ""
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.statics.createUser = function(newUser) {
  return this.create(newUser);
};

userSchema.statics.getUserByEmail = function (email) {
  return this.findOne({ email });
};

const User = mongoose.model("User", userSchema, "users");

export default User;