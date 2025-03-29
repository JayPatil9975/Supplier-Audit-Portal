const express = require("express");
const passport = require("passport");
const User = require("../models/User");
const Audit = require("../models/Audit");
const bcrypt = require("bcryptjs");

const router = express.Router();

// ✅ Middleware: Redirect logged-in users away from login/signup pages
function ensureGuest(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect("/dashboard");
  }
  next();
}

// ✅ Middleware: Ensure user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

// ✅ Render login & signup pages (Only for guests)
router.get("/login", ensureGuest, (req, res) => res.render("login", { error: req.query.error || null }));
router.get("/signup", ensureGuest, (req, res) => res.render("signup", { error: null }));

// ✅ Handle user registration
router.post("/signup", async (req, res) => {
  const { fullName, email, companyName, password, confirmPassword } = req.body;

  // 🔹 Validate Input Fields
  if (!fullName || !email || !companyName || !password || !confirmPassword) {
    return res.render("signup", { error: "All fields are required!" });
  }

  if (password.length < 6) {
    return res.render("signup", { error: "Password must be at least 6 characters long!" });
  }

  if (password !== confirmPassword) {
    return res.render("signup", { error: "Passwords do not match!" });
  }

  try {
    // 🔹 Check if User Already Exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render("signup", { error: "Email is already registered!" });
    }

    // 🔹 Hash the Password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔹 Create and Save New User
    const newUser = new User({
      fullName,
      email,
      companyName,
      password: hashedPassword,
    });

    await newUser.save();
    console.log("✅ User registered successfully:", newUser);

    // Redirect to Login Page after successful signup
    res.redirect("/login");

  } catch (err) {
    console.error("❌ Signup Error:", err);
    res.render("signup", { error: "Registration failed. Please try again later." });
  }
});

// ✅ Handle login
router.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/dashboard",
    failureRedirect: "/login?error=Invalid credentials",
  })
);

// ✅ Logout route (Clears session and redirects)
router.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("connect.sid"); // Ensure session cookie is cleared
      res.redirect("/login");
    });
  });
});

// ✅ Dashboard route (Requires authentication)
// ✅ Dashboard route (Requires authentication)
router.get("/dashboard", ensureAuthenticated, async (req, res) => {
  try {
    // Fetch user audits
    const audits = await Audit.find({ user: req.user._id }).sort({ createdAt: 1 });
    const totalAudits = audits.length;
    let latestScore = "N/A";
    let latestAuditId = null;
    let auditData = [];

    if (audits.length > 0) {
      const lastAudit = audits[audits.length - 1];
      latestAuditId = lastAudit._id;
      const totalQuestions = lastAudit.questions.length;

      if (totalQuestions > 0) {
        const totalPossibleScore = totalQuestions * 4;
        const totalAchievedScore = lastAudit.questions.reduce((sum, q) => sum + parseInt(q.rating || 0), 0);
        latestScore = ((totalAchievedScore / totalPossibleScore) * 100).toFixed(1) + "%";
      } else {
        latestScore = "0%";
      }
    }

    // Prepare audit data for graph
    auditData = audits.map(audit => ({
      date: audit.createdAt.toDateString(),
      score: (audit.questions.reduce((sum, q) => sum + parseInt(q.rating || 0), 0) / (audit.questions.length * 4) * 100).toFixed(1)
    }));

    const lastAuditDate = audits.length > 0 ? audits[audits.length - 1].createdAt.toDateString() : "N/A";
    res.render("dashboard", { user: req.user, totalAudits, latestScore, lastAuditDate, latestAuditId, audits, auditData });
  } catch (error) {
    console.error("Error loading dashboard:", error);
    res.render("dashboard", { user: req.user, totalAudits: 0, latestScore: "N/A", lastAuditDate: "N/A", latestAuditId: null, audits: [], auditData: [] });
  }
});




module.exports = router;
