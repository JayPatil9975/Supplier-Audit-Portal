const express = require("express");
const router = express.Router();
const Audit = require("../models/Audit"); // 🛠️ You were missing this!

// Hardcoded admin credentials
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

// Login page
router.get("/login", (req, res) => {
  res.render("adminlogin");
});

// Handle login form
router.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect("/admin/dashboard");
  } else {
    res.send("Invalid admin credentials");
  }
});

// Logout
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
});

// Middleware
function isAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect("/admin/login");
}

// Admin Dashboard
router.get("/dashboard", isAdmin, async (req, res) => {
  const audits = await Audit.find({}).populate("user");
  res.render("admindashboard", { audits });
});

// 🚨 FIXED: Remove `/admin` prefix since it's already mounted
router.get("/audit/:id/remarks", isAdmin, async (req, res) => {
  const audit = await Audit.findById(req.params.id).populate("user");
  res.render("adminremarks", { audit });
});

router.post("/audit/:id/remarks", isAdmin, async (req, res) => {
  const remarkObj = {
    text: req.body.newRemark,
    createdAt: new Date()
  };

  await Audit.findByIdAndUpdate(req.params.id, {
    $push: { adminRemarks: remarkObj }
  });

  res.redirect("/admin/dashboard");
});


module.exports = router;
