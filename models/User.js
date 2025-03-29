const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    companyName: { type: String, required: true },
    password: { type: String, required: true }, // Hashed in auth.js
  },
  { timestamps: true } // ✅ Automatically adds createdAt & updatedAt
);

module.exports = mongoose.model("User", UserSchema);
