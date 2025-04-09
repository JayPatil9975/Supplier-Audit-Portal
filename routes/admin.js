// routes/admin.js
const express = require("express");
const router = express.Router();

// Hardcoded admin credentials
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123"; // You can change this

// Show login page
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

// Logout route
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
});

// Middleware to protect admin routes
function isAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.redirect("/admin/login");
  }
}

// Admin dashboard
router.get("/dashboard", isAdmin, async (req, res) => {
  const db = require("../models/Audit"); // update path if needed
  const audits = await db.find({}); // load all audits
  res.render("admindashboard", { audits });
});

module.exports = router;
