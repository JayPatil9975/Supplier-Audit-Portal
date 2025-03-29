const mongoose = require("mongoose");

const AuditSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  questions: [
    {
      question: String,
      rating: { type: Number, min: 0, max: 5, required: true },
      proofFile: String, // Cloudinary URL
      remark: String,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Audit", AuditSchema);
