require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

// Rate Limiting Middleware
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: "Too many requests, please try again later."
});
app.use(limiter);

// Database Connection
let db;
const initDB = async () => {
    try {
        db = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
        });
        console.log("Connected to MySQL database!");
    } catch (err) {
        console.error("Database connection failed:", err);
        setTimeout(initDB, 5000); // Retry after 5 seconds
    }
};
initDB();

// Nodemailer Configuration
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Helper function for email validation
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Helper function to send emails with retry logic
const sendEmail = async (email, subject, text) => {
    try {
        await transporter.sendMail({ from: process.env.EMAIL_USER, to: email, subject, text });
        console.log(`📧 Email sent to ${email}`);
        return true;
    } catch (error) {
        console.error("❌ Email send failed:", error);
        return false;
    }
};

// Add a Student
app.post("/add-student", async (req, res) => {
    const { name, email, request_type } = req.body;
    if (!name || !email || !request_type) return res.status(400).json({ error: "Name, email, and request type are required" });
    if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email format" });
    if (!["transcript", "recommendation_letter"].includes(request_type)) return res.status(400).json({ error: "Invalid request type." });

    try {
        const [existing] = await db.execute("SELECT * FROM students WHERE email = ? AND request_type = ?", [email, request_type]);
        if (existing.length > 0) return res.status(400).json({ error: "Request already exists for this student." });
        
        await db.execute("INSERT INTO students (name, email, request_type, request_ready) VALUES (?, ?, ?, FALSE)", [name, email, request_type]);
        const emailSent = await sendEmail(email, "Application Received", `Hello ${name},\n\nWe have received your application for a ${request_type}. You will be notified when it is ready.`);
        if (!emailSent) return res.status(500).json({ error: "Email service unavailable." });

        res.status(201).json({ message: "Student added and confirmation email sent!" });
    } catch (err) {
        console.error("Database error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// Get All Students
app.get("/students", async (req, res) => {
    try {
        const [results] = await db.execute("SELECT * FROM students");
        res.json(results);
    } catch (err) {
        console.error("Failed to fetch students:", err);
        res.status(500).json({ error: "Failed to fetch students" });
    }
});

// Mark Request as Ready
app.post("/mark-ready", async (req, res) => {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ error: "Student ID is required" });

    try {
        const [studentResult] = await db.execute("SELECT email, name, request_type FROM students WHERE id = ?", [student_id]);
        if (studentResult.length === 0) return res.status(404).json({ error: "Student not found" });
        
        const { email, name, request_type } = studentResult[0];
        await db.execute("UPDATE students SET request_ready = TRUE WHERE id = ?", [student_id]);

        const subject = `Your ${request_type.replace("_", " ")} is Ready`;
        const text = `Hello ${name},\n\nYour ${request_type.replace("_", " ")} is now ready for collection.`;
        
        const emailSent = await sendEmail(email, subject, text);
        if (!emailSent) return res.status(500).json({ error: "Failed to send email." });

        await db.execute("INSERT INTO notifications (student_id, email_sent, sent_at, request_type) VALUES (?, TRUE, NOW(), ?)", [student_id, request_type]);
        res.json({ message: "Request marked as ready, email sent, and notification logged!" });
    } catch (err) {
        console.error("Database error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// Delete Student
// Delete Student
app.delete("/delete-student", async (req, res) => {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ error: "Student ID is required" });

    try {
        // Fetch the student details before deletion
        const [studentResult] = await db.execute("SELECT * FROM students WHERE id = ?", [student_id]);
        if (studentResult.length === 0) return res.status(404).json({ error: "Student not found" });

        const student = studentResult[0]; // Store student details

        // Proceed with deletion
        const [deleteResult] = await db.execute("DELETE FROM students WHERE id = ?", [student_id]);

        // Log deleted student details
        console.log(`🗑️ Student Deleted: ID=${student.id}, Name=${student.name}, Email=${student.email}, Request Type=${student.request_type}`);

        res.json({ message: "Student deleted successfully!" });
    } catch (err) {
        console.error("Database error:", err);
        res.status(500).json({ error: "Server error while deleting student" });
    }
});

app.get("/", (req, res) => {
    res.send("Hello! Your HTTPS setup is working 🚀");
});


// Start Server
app.listen(5000, '0.0.0.0', () => {
    console.log("Server running on http://0.0.0.0:5000");
});

