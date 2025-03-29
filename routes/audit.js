const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const Audit = require("../models/Audit");
const nodemailer = require("nodemailer");
require("dotenv").config();
const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465, // Secure SSL port
  secure: true, // true for port 465, false for port 587
  auth: {
    user: process.env.ADMIN_EMAIL, // Your Gmail email
    pass: process.env.ADMIN_PASSWORD, // 16-character App Password
  },
});
// Ensure reports directory exists
const reportsDir = path.join(__dirname, "../public/reports");
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// Multer storage (store files in memory)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Define all audit questions
const auditQuestions = [
  "Is management policy available?",
  "Is QMS established, implemented & maintained by the organization?",
  "Is ISO 9001:2015 certification available?",
  "Is a quality person available in the plant? If available, can they understand technical terms?",
  "Does first part approval, in-process inspection, and inward inspection of RM carried out?",
  "Does the supplier provide UT, PDI, Supplier 3.1 TC, NABL Lab TC with Mill TC documents as agreed in the purchase order?",
  "Is UT testing initiated for every lot?",
  "Is identification/traceability maintained for RM and finished goods material?",
  "Are the required equipment & gauges available and calibrated by a NABL-approved lab?",
  "Is a separate area available to keep NC material? If yes, how are controls incorporated in the NC material?",
  "Are quality training programs organized for operators/supervisors?",
  "Check for records of NC and verify corrective and preventive actions.",
  "Are sampling plans available?",
  "Is the material/component stored properly to avoid damages/deterioration?",
  "Is the material identified properly on the shop floor?",
  "Is the proper material handling facility available?",
  "Is there traceability on raw material? What are the preventive measures implemented to avoid mixing of RM?",
  "How are shelf-life items controlled? Is the FEFO system in place (applicable for shelf-life items like rubber gaskets, O-rings & paint)?",
  "Is the RM/consumable stored in proper environmental conditions if applicable?",
  "Is there a machine list available in the plant?",
  "Is there any plan for preventive maintenance of machines & WI, SOP displayed?",
  "Are the people competent to perform their jobs/activities?",
  "Is there capacity to read and understand drawing the technical specification?",
  "Are the working areas in the shop floor properly cleaned & maintained 5S? Also, are they adequately lighted?",
  "Is sufficient workforce available?",
  "Are safety precautions taken to avoid accidents (e.g., PPE)?",
  "Does the supplier adhere to the delivery schedule?",
  "Is there evidence of an effective communication system from the supplier to the customer?",
  "Is customer satisfaction evaluated?",
  "Does the mode of packing and dispatch assure damage-free supplies?",
  "Does the supplier provide a thread protective cap with material to avoid dents and damage?",
  "Does the supplier follow all norms under EHS (Environment, Health, and Safety)?",
  "Does the supplier have EHS and OSHAS certification including all norms?"
];

// Render audit form
router.get("/form", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  res.render("audit-form", { error: null, questions: auditQuestions });
});

// Function to upload file to Cloudinary
const uploadToCloudinary = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "auto" },
      (error, uploadedFile) => {
        if (error) {
          reject(error);
        } else {
          resolve(uploadedFile.secure_url);
        }
      }
    );
    stream.end(fileBuffer);
  });
};

// Handle audit submission
router.post(
  "/submit",
  upload.fields(
    auditQuestions.map((_, index) => ({ name: `proof_${index}`, maxCount: 1 }))
  ),
  async (req, res) => {
    try {
      console.log("Received form data:", req.body);

      // Ensure ratings and remarks exist
      const ratings = Array.isArray(req.body.ratings) ? req.body.ratings : [req.body.ratings];
      const remarks = Array.isArray(req.body.remarks) ? req.body.remarks : [req.body.remarks];

      // Upload images to Cloudinary
      const proofFiles = {};
      const uploadPromises = [];

      // Process all possible proof files
      for (let i = 0; i < auditQuestions.length; i++) {
        if (req.files[`proof_${i}`]) {
          uploadPromises.push(
            uploadToCloudinary(req.files[`proof_${i}`][0].buffer).then((url) => {
              proofFiles[`proof_${i}`] = url;
            })
          );
        }
      }

      // Wait for all uploads to complete
      await Promise.all(uploadPromises);

      // Prepare questions array for saving
      const questionsData = auditQuestions.map((question, index) => ({
        question,
        rating: ratings[index] || "0",
        proofFile: proofFiles[`proof_${index}`] || null,
        remark: remarks[index] || ""
      }));

      // Save audit details in MongoDB
      const newAudit = new Audit({
        user: req.user._id,
        questions: questionsData
      });

      await newAudit.save();
      console.log("Audit saved successfully:", newAudit);

      // Redirect to the specific audit report
      res.redirect(`/audit/report/${newAudit._id}`);
    } catch (error) {
      console.error("Error saving audit:", error);
      res.render("audit-form", { error: "File upload failed. Please try again.", questions: auditQuestions });
    }
  }
);

// Render reports page (List all audits)
router.get("/reports", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const audits = await Audit.find({ user: req.user._id });
    res.render("reports", { audits, message: req.query.message || null }); // ✅ Pass `message`
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.render("reports", { audits: [], error: "Failed to load reports", message: req.query.message || null });
  }
});


router.get("/report/:auditId", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const audit = await Audit.findById(req.params.auditId);
    if (!audit) return res.status(404).send("Audit not found");

    // ✅ Calculate total score
    const totalQuestions = audit.questions.length;
    let overallScore = "N/A";
    let category = "Not Approved";

    if (totalQuestions > 0) {
      const totalPossibleScore = totalQuestions * 4; // Max rating per question = 4
      const totalAchievedScore = audit.questions.reduce((sum, q) => sum + (parseInt(q.rating) || 0), 0);
      
      overallScore = ((totalAchievedScore / totalPossibleScore) * 100).toFixed(2); // Convert to percentage

      // ✅ Define category based on score
      if (overallScore >= 80) category = "Approved";
      else if (overallScore >= 51) category = "Needs Improvement";
    }

    res.render("audit-report", { audit, overallScore, category });
  } catch (error) {
    console.error("Error fetching audit report:", error);
    res.status(500).send("Failed to load audit report.");
  }
});
// Route to generate and send audit PDF via email
router.get("/report/mail/:auditId", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const audit = await Audit.findById(req.params.auditId);
    if (!audit) return res.status(404).send("Audit not found");

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const filePath = `./public/reports/audit-${audit._id}.pdf`;
    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);

    // 📄 Top margin
    doc.moveDown(2);

    // 🔤 Header
    doc.fontSize(22).fillColor("#1E3A8A").text("Supplier Quality Audit Report", { align: "center" });
    doc.moveDown(1);

    // 📋 Supplier & Audit Info
    doc.fontSize(12).fillColor("#000000");
    
    // Create a simple table for metadata
    const metadataTable = {
      headers: ["Audit Date:", "Supplier:", "Auditor:"],
      rows: [[
        audit.createdAt.toDateString(),
        req.user.companyName,
        req.user.fullName
      ]]
    };
    
    // Draw metadata table
    const metadataX = 40;
    let metadataY = doc.y;
    const colWidth = 150;
    
    metadataTable.headers.forEach((header, i) => {
      doc.text(header, metadataX + (i * colWidth), metadataY);
      doc.text(metadataTable.rows[0][i], metadataX + (i * colWidth), metadataY + 20);
    });
    
    doc.moveDown(3);

    // ✅ Score Calculation
    const totalQuestions = audit.questions.length;
    let overallScore = "N/A";
    let category = "Not Approved";
    let scoreColor = "#DC2626"; // Default: Red 🔴

    if (totalQuestions > 0) {
      const totalPossibleScore = totalQuestions * 4;
      const validRatings = audit.questions.map(q => parseInt(q.rating) || 0);
      const totalAchievedScore = validRatings.reduce((sum, rating) => sum + rating, 0);

      overallScore = ((totalAchievedScore / totalPossibleScore) * 100).toFixed(2) + "%";

      if (parseFloat(overallScore) >= 80) {
        category = "Approved";
        scoreColor = "#16A34A"; // Green 🟢
      } else if (parseFloat(overallScore) >= 51) {
        category = "Needs Improvement";
        scoreColor = "#EAB308"; // Yellow 🟡
      }
    }

    // 📊 Score Summary
    doc.fontSize(16).fillColor(scoreColor).text(`Overall Score: ${overallScore}`, { align: "center" });
    doc.fontSize(14).fillColor("#000000").text(`Category: ${category}`, { align: "center" }).moveDown(1.5);

    // 📝 Table Header
    doc.fontSize(12).fillColor("#1E3A8A").text("Audit Questions and Responses:", { underline: true });
    doc.moveDown(0.5);

    // 📏 Table Setup
    const startX = 40;
    let startY = doc.y;

    // Table Column Widths - adjusted for better proportions
    const colWidths = {
      no: 30,
      question: 250,
      rating: 40,
      remarks: 100,
      proof: 80
    };
    
    const rowHeight = 40; // Increased for better readability
    
    // Fill header with light blue background
    doc.fillColor("#E6EFFD").rect(
      startX, 
      startY, 
      colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks + colWidths.proof, 
      rowHeight
    ).fill();

    // 📊 Table Header Borders
    doc.strokeColor("#1E3A8A");
    doc.lineWidth(1);
    doc.rect(startX, startY, colWidths.no, rowHeight).stroke();
    doc.rect(startX + colWidths.no, startY, colWidths.question, rowHeight).stroke();
    doc.rect(startX + colWidths.no + colWidths.question, startY, colWidths.rating, rowHeight).stroke();
    doc.rect(startX + colWidths.no + colWidths.question + colWidths.rating, startY, colWidths.remarks, rowHeight).stroke();
    doc.rect(startX + colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks, startY, colWidths.proof, rowHeight).stroke();

    // 🔤 Table Header Text
    doc.fillColor("#000000").fontSize(11).font('Helvetica-Bold');
    doc.text("No.", startX + 5, startY + (rowHeight/2) - 5, { width: colWidths.no - 10, align: 'center' });
    doc.text("Question", startX + colWidths.no + 5, startY + (rowHeight/2) - 5, { width: colWidths.question - 10, align: 'center' });
    doc.text("Rating", startX + colWidths.no + colWidths.question + 5, startY + (rowHeight/2) - 5, { width: colWidths.rating - 10, align: 'center' });
    doc.text("Remarks", startX + colWidths.no + colWidths.question + colWidths.rating + 5, startY + (rowHeight/2) - 5, { width: colWidths.remarks - 10, align: 'center' });
    doc.text("Proof", startX + colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks + 5, startY + (rowHeight/2) - 5, { width: colWidths.proof - 10, align: 'center' });

    startY += rowHeight; // Move below the header
    
    // Reset to normal font
    doc.font('Helvetica');
    
    // 🎨 Zebra striping for table rows
    let isEvenRow = false;

    // 📑 Table Rows with dynamic height based on content
    audit.questions.forEach((q, index) => {
      // Calculate row height based on content
      const questionText = q.question || "";
      const questionTextHeight = doc.heightOfString(questionText, { 
        width: colWidths.question - 10,
        fontSize: 10
      });
      
      const remarkText = q.remark || "N/A";
      const remarkTextHeight = doc.heightOfString(remarkText, {
        width: colWidths.remarks - 10,
        fontSize: 10
      });
      
      // Determine row height based on the tallest content
      const dynamicRowHeight = Math.max(rowHeight, questionTextHeight + 15, remarkTextHeight + 15);
      
      // 📄 Page break if required
      if (startY + dynamicRowHeight > 780) {
        doc.addPage();
        startY = 50;
        isEvenRow = false;
      }
      
      // Zebra striping
      if (isEvenRow) {
        doc.fillColor("#F8FAFC").rect(
          startX, 
          startY, 
          colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks + colWidths.proof, 
          dynamicRowHeight
        ).fill();
      }
      isEvenRow = !isEvenRow;
      
      // Draw row borders
      doc.strokeColor("#1E3A8A").lineWidth(0.5);
      doc.rect(startX, startY, colWidths.no, dynamicRowHeight).stroke();
      doc.rect(startX + colWidths.no, startY, colWidths.question, dynamicRowHeight).stroke();
      doc.rect(startX + colWidths.no + colWidths.question, startY, colWidths.rating, dynamicRowHeight).stroke();
      doc.rect(startX + colWidths.no + colWidths.question + colWidths.rating, startY, colWidths.remarks, dynamicRowHeight).stroke();
      doc.rect(startX + colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks, startY, colWidths.proof, dynamicRowHeight).stroke();

      // 📝 Fill row data
      doc.fontSize(10).fillColor("#000000");
      
      // Number
      doc.text(`${index + 1}.`, startX + 5, startY + 10, { 
        width: colWidths.no - 10,
        align: 'center'
      });
      
      // Question
      doc.text(questionText, startX + colWidths.no + 5, startY + 10, { 
        width: colWidths.question - 10
      });
      
      // Rating
      doc.text(`${q.rating || "0"}/4`, startX + colWidths.no + colWidths.question + 5, startY + 10, { 
        width: colWidths.rating - 10,
        align: 'center'
      });
      
      // Remarks
      doc.text(remarkText, startX + colWidths.no + colWidths.question + colWidths.rating + 5, startY + 10, { 
        width: colWidths.remarks - 10
      });

      // Proof
      const proofText = q.proofFile ? "View Proof" : "No proof";
      
      if (q.proofFile) {
        doc.fillColor("#2563EB").text(proofText, 
          startX + colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks + 5, 
          startY + 10, 
          { 
            link: q.proofFile, 
            underline: true,
            width: colWidths.proof - 10,
            align: 'center'
          }
        );
      } else {
        doc.fillColor("#666666").text(proofText, 
          startX + colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks + 5, 
          startY + 10, 
          { 
            width: colWidths.proof - 10,
            align: 'center'
          }
        );
      }

      startY += dynamicRowHeight; // Move to next row with dynamic height
    });
    
    // ✍️ Signature section
    doc.moveDown(2);
    doc.fontSize(12).fillColor("#000000").text("Signatures:", { underline: true });
    doc.moveDown(1);
    
    // Create signature lines
    doc.text("____________________", 100, doc.y);
    doc.text("____________________", 400, doc.y);
    doc.moveDown(0.5);
    doc.text("Auditor", 100, doc.y);
    doc.text("Supplier Representative", 400, doc.y);
    
    // 📋 Footer
    doc.fontSize(8).fillColor("#666666").text(
      `Generated on ${new Date().toLocaleString()} - Supplier Audit Portal`,
      40,
      doc.page.height - 50,
      { align: 'center' }
    );

    doc.end();

    // 📧 Send Email with PDF attachment
    writeStream.on("finish", async () => {
      const mailOptions = {
        from: process.env.ADMIN_EMAIL,
        to: process.env.ADMIN_EMAIL,
        subject: `Audit Report - ${req.user.companyName}`,
        text: `Hello Admin,\n\nPlease find the attached audit report for ${req.user.companyName}.\n\nRegards,\nSupplier Audit Portal`,
        attachments: [{ filename: `audit-report-${audit._id}.pdf`, path: filePath }]
      };

      try {
        await transporter.sendMail(mailOptions);
        fs.unlinkSync(filePath); // 🗑️ Cleanup
        res.redirect("/audit/reports?message=success");
      } catch (emailError) {
        console.error("Error sending email:", emailError);
        res.redirect("/audit/reports?message=failed");
      }
    });
  } catch (error) {
    console.error("Error generating audit PDF:", error);
    res.status(500).send("Failed to generate report.");
  }
});

// ✅ Generate & Download PDF Report
router.get("/report/pdf/:auditId", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const audit = await Audit.findById(req.params.auditId);
    if (!audit) return res.status(404).send("Audit not found");

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const filePath = `./public/reports/audit-${audit._id}.pdf`;
    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);

    // Top margin
    doc.moveDown(2);

    // Header info - Large text with proper spacing as shown in the image
    doc.fontSize(18).fillColor("#000000");
    doc.text(`Audit Date: ${audit.createdAt.toDateString()}`, 40, doc.y);
    doc.moveDown(0.5);
    doc.text(`Supplier: ${req.user.companyName}`, 40, doc.y);
    doc.moveDown(0.5);
    doc.text(`Auditor: ${req.user.fullName}`, 40, doc.y);
    
    // Large gap before score
    doc.moveDown(4);

    // ✅ Score Calculation
    const totalQuestions = audit.questions.length;
    let overallScore = "N/A";
    let category = "Not Approved";
    let scoreColor = "#DC2626"; // Default to Red

    if (totalQuestions > 0) {
      const totalPossibleScore = totalQuestions * 4; // Max rating per question = 4
      const totalAchievedScore = audit.questions.reduce((sum, q) => sum + (parseInt(q.rating) || 0), 0);
      
      if (totalPossibleScore > 0) {
        overallScore = ((totalAchievedScore / totalPossibleScore) * 100).toFixed(2) + "%";
      } else {
        overallScore = "0%"; // Default to 0% if no questions exist
      }

      // ✅ Define category based on score
      if (parseFloat(overallScore) >= 80) {
        category = "Approved";
        scoreColor = "#16A34A"; // 🟢 Green
      } else if (parseFloat(overallScore) >= 51) {
        category = "Needs Improvement";
        scoreColor = "#EAB308"; // 🟡 Yellow
      }
    }

    // Score display - Center-aligned large green text as shown in the image
    doc.fontSize(32).fillColor(scoreColor).text(`Overall Score: ${overallScore}`, { align: "center" });
    // Category display - Center-aligned black text
    doc.fontSize(24).fillColor("#000000").text(`Category: ${category}`, { align: "center" });
    
    // Large gap before questions
    doc.moveDown(4);

    // 📝 "Audit Questions and Responses:" in blue with underline matching the image
    doc.fontSize(18).fillColor("#1E3A8A").text("Audit Questions and Responses:", { underline: true });
    doc.moveDown(1);

    // Table Setup
    const startX = 40;
    let startY = doc.y;

    // Table Column Widths - adjusted to match your content
    const colWidths = {
      no: 30,
      question: 250,
      rating: 40,
      remarks: 100,
      proof: 80
    };
    
    const rowHeight = 40;
    
    // Fill header with light blue background
    doc.fillColor("#E6EFFD").rect(
      startX, 
      startY, 
      colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks + colWidths.proof, 
      rowHeight
    ).fill();

    // Table Header Borders
    doc.strokeColor("#1E3A8A");
    doc.lineWidth(1);
    doc.rect(startX, startY, colWidths.no, rowHeight).stroke();
    doc.rect(startX + colWidths.no, startY, colWidths.question, rowHeight).stroke();
    doc.rect(startX + colWidths.no + colWidths.question, startY, colWidths.rating, rowHeight).stroke();
    doc.rect(startX + colWidths.no + colWidths.question + colWidths.rating, startY, colWidths.remarks, rowHeight).stroke();
    doc.rect(startX + colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks, startY, colWidths.proof, rowHeight).stroke();

    // Table Header Text
    doc.fillColor("#000000").fontSize(11).font('Helvetica-Bold');
    doc.text("No.", startX + 5, startY + (rowHeight/2) - 5, { width: colWidths.no - 10, align: 'center' });
    doc.text("Question", startX + colWidths.no + 5, startY + (rowHeight/2) - 5, { width: colWidths.question - 10, align: 'center' });
    doc.text("Rating", startX + colWidths.no + colWidths.question + 5, startY + (rowHeight/2) - 5, { width: colWidths.rating - 10, align: 'center' });
    doc.text("Remarks", startX + colWidths.no + colWidths.question + colWidths.rating + 5, startY + (rowHeight/2) - 5, { width: colWidths.remarks - 10, align: 'center' });
    doc.text("Proof", startX + colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks + 5, startY + (rowHeight/2) - 5, { width: colWidths.proof - 10, align: 'center' });

    startY += rowHeight; // Move below the header
    
    // Reset to normal font
    doc.font('Helvetica');
    
    // Zebra striping for table rows
    let isEvenRow = false;

    // Table Rows with dynamic height based on content
    audit.questions.forEach((q, index) => {
      // Calculate row height based on content
      const questionText = q.question || "";
      const questionTextHeight = doc.heightOfString(questionText, { 
        width: colWidths.question - 10,
        fontSize: 10
      });
      
      const remarkText = q.remark || "N/A";
      const remarkTextHeight = doc.heightOfString(remarkText, {
        width: colWidths.remarks - 10,
        fontSize: 10
      });
      
      // Determine row height based on the tallest content
      const dynamicRowHeight = Math.max(rowHeight, questionTextHeight + 15, remarkTextHeight + 15);
      
      // Page break if required
      if (startY + dynamicRowHeight > 780) {
        doc.addPage();
        startY = 50;
        isEvenRow = false;
      }
      
      // Zebra striping
      if (isEvenRow) {
        doc.fillColor("#F8FAFC").rect(
          startX, 
          startY, 
          colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks + colWidths.proof, 
          dynamicRowHeight
        ).fill();
      }
      isEvenRow = !isEvenRow;
      
      // Draw row borders
      doc.strokeColor("#1E3A8A").lineWidth(0.5);
      doc.rect(startX, startY, colWidths.no, dynamicRowHeight).stroke();
      doc.rect(startX + colWidths.no, startY, colWidths.question, dynamicRowHeight).stroke();
      doc.rect(startX + colWidths.no + colWidths.question, startY, colWidths.rating, dynamicRowHeight).stroke();
      doc.rect(startX + colWidths.no + colWidths.question + colWidths.rating, startY, colWidths.remarks, dynamicRowHeight).stroke();
      doc.rect(startX + colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks, startY, colWidths.proof, dynamicRowHeight).stroke();

      // Fill row data
      doc.fontSize(10).fillColor("#000000");
      
      // Number
      doc.text(`${index + 1}.`, startX + 5, startY + 10, { 
        width: colWidths.no - 10,
        align: 'center'
      });
      
      // Question
      doc.text(questionText, startX + colWidths.no + 5, startY + 10, { 
        width: colWidths.question - 10
      });
      
      // Rating
      doc.text(`${q.rating || "0"}/4`, startX + colWidths.no + colWidths.question + 5, startY + 10, { 
        width: colWidths.rating - 10,
        align: 'center'
      });
      
      // Remarks
      doc.text(remarkText, startX + colWidths.no + colWidths.question + colWidths.rating + 5, startY + 10, { 
        width: colWidths.remarks - 10
      });

      // Proof
      const proofText = q.proofFile ? "View Proof" : "No proof";
      
      if (q.proofFile) {
        doc.fillColor("#2563EB").text(proofText, 
          startX + colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks + 5, 
          startY + 10, 
          { 
            link: q.proofFile, 
            underline: true,
            width: colWidths.proof - 10,
            align: 'center'
          }
        );
      } else {
        doc.fillColor("#666666").text(proofText, 
          startX + colWidths.no + colWidths.question + colWidths.rating + colWidths.remarks + 5, 
          startY + 10, 
          { 
            width: colWidths.proof - 10,
            align: 'center'
          }
        );
      }

      startY += dynamicRowHeight; // Move to next row with dynamic height
    });

    // Add signature section
    doc.moveDown(2);
    doc.fontSize(12).fillColor("#000000").text("Signatures:", { underline: true });
    doc.moveDown(1);
    
    // Create signature lines
    doc.text("____________________", 100, doc.y);
    doc.text("____________________", 400, doc.y);
    doc.moveDown(0.5);
    doc.text("Auditor", 100, doc.y);
    doc.text("Supplier Representative", 400, doc.y);
    
    // Footer
    doc.fontSize(8).fillColor("#666666").text(
      `Generated on ${new Date().toLocaleString()} - Supplier Audit Portal`,
      40,
      doc.page.height - 50,
      { align: 'center' }
    );

    doc.end();

    // 📥 Send PDF after writing
    writeStream.on("finish", () => {
      res.download(filePath, `audit-report-${audit._id}.pdf`, (err) => {
        if (err) console.error("Error sending PDF:", err);
        fs.unlinkSync(filePath); // 🗑 Cleanup after download
      });
    });
  } catch (error) {
    console.error("Error generating audit PDF:", error);
    res.status(500).send("Failed to generate report.");
  }
});

module.exports = router;