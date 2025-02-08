require("dotenv").config();
const fs = require("fs");
const https = require("https");
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");

const app = express();
const port = process.env.PORT || 5000;

// Trust proxy for rate limiting to work properly
app.set("trust proxy", 1);

app.use(cors());
app.use(bodyParser.json());

// Rate Limiting Middleware
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: "Too many requests, please try again later."
});
app.use(limiter);

// Load SSL Certificate and Key
const options = {
    key: fs.readFileSync("server.key"),
    cert: fs.readFileSync("server.cert")
};

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

// Email validation function
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Email sending function
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

// Routes
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

app.get("/students", async (req, res) => {
    try {
        const [results] = await db.execute("SELECT * FROM students");
        res.json(results);
    } catch (err) {
        console.error("Failed to fetch students:", err);
        res.status(500).json({ error: "Failed to fetch students" });
    }
});

app.get("/", (req, res) => {
    res.send("Hello! Your HTTPS setup is working 🚀");
});

// Start Secure HTTPS Server
https.createServer(options, app).listen(port, "0.0.0.0", () => {
    console.log(`✅ Server running securely on https://0.0.0.0:${port}`);
});
