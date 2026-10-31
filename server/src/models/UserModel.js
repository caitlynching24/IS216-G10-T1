import mongoose from 'mongoose'

export const pet_types = ["Dog", "Cat", "Bird", "Rabbit", "Hamster", "Other"];
export const services = ["Feeding", "Grooming", "Dog walking", "Cat walking", "Feeding Medication", "Cleaning", "Playtime"]

// location schema
const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"] },
    coordinates: { type: [Number], default: undefined }
  },
  { _id: false }
);

// address schema containing location schema
const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true },
    unit: { type: String, trim: true, maxlength: 20 }, 
    postalCode: { type: String, trim: true, match: /^\d{6}$/ }, 
    location: pointSchema                                       
  },
  { _id: false }
);

// sitter gallery
const galleryPhotoSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: { type: String, required: true }   
})

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true,
    unique: true
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
  },
  bio: {
    type: String,
    default: "",
    maxLength: 500
  },
  
  profilePicture: {
    url: { 
      type: String, 
      default: "" 
    },        
    publicId: { 
      type: String, 
      default: "" 
    }    
  },

  ownerProfile: {
    address: { 
      type: 
      addressSchema, 
      select: false 
    },
    // Services this owner's pets need (e.g. Grooming), used to recommend matching sitters
    servicesNeeded: {
      type: [{ type: String, enum: services }],
      default: []
    },
    instructions: {
      type: String,
      default: '',
      trim: true,
      maxlength: 300,
      select: false
    }
  },

  sitterProfile: {
    experienceStart: {
      type: Date 
    },                
    petTypes: { 
      type: [{ 
        type: String, 
        enum: pet_types 
      }], 
      default: [] 
    },
    services: { 
      type: [{ 
        type: String, 
        enum: services 
      }], 
      default: [] 
    },
    address: { 
      type: addressSchema, 
      select: false 
    },
    serviceArea: {
      label: { 
        type: String, 
        trim: true 
      },
      radiusKm: { 
        type: Number, 
        min: 0, 
        max: 50,
      },
      location: pointSchema
    },
    ratingAvg: { 
      type: Number, 
      default: 0, 
      min: 0, 
      max: 5 
    },
    ratingCount: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
    gallery: {
      type: [galleryPhotoSchema],
      default: [],
      validate: { validator: (v) => v.length <= 5, message: 'You can add up to 5 photos.' }
    }
  }
},
{ timestamps: true }
);

userSchema.statics.getUserByEmail = function(email) {
  return this.findOne({ email });
};

userSchema.statics.getUserByUsername = function(username) {
  return this.findOne({ username });
};

const User = mongoose.model("User", userSchema, "users");

export default User;