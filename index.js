const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { CohereClient } = require("cohere-ai");
const SibApiV3Sdk = require('sib-api-v3-sdk');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ["http://localhost:3000"],
  methods: ["GET", "POST"],
  credentials: true,
}));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB Error:", err));

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  resetToken: String,
  tokenExpire: Date,
  history: [
    {
      recommendedAt: { type: Date, default: Date.now },
      result: Array,
    }
  ]
});
const User = mongoose.model('User', userSchema);

// Cohere Setup
const co = new CohereClient({
  token: process.env.CO_API_KEY,
});

// Recommend Route
app.post("/recommend", async (req, res) => {
  const { skills, interests, email } = req.body;

  const prompt = `
I have the following skills: ${skills}.
My interests are: ${interests}.
Recommend 3 suitable career paths, each with a short description and a learning path.
Return the result as a valid JSON array in this format:

[
  {
    "career": "Career Name",
    "description": "Short description",
    "learningPath": [
      "Step 1",
      "Step 2",
      "Step 3"
    ]
  }
]
`;

  try {
    const response = await co.generate({
      model: "command-r-plus",
      prompt,
    });

    const text = response.generations?.[0]?.text;
    if (!text) return res.status(500).json({ error: "Empty response from Cohere" });

    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Save to history
    const user = await User.findOne({ email });
    if (user) {
      if (!user.history) user.history = [];
      user.history.push({ result: parsed });
      await user.save();
    }


    res.json({ result: parsed });
  } catch (error) {
    console.error("❌ /recommend Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get History
app.get("/history/:email", async (req, res) => {
  const { email } = req.params;
  try {
    const user = await User.findOne({ email });
    res.json({ history: user.history || [] });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch history" });
  }
});

// Signup
app.post("/signup", async (req, res) => {
  try {
    const { email, createpassword } = req.body;

    if (!email || !createpassword) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(createpassword, 10);
    const newUser = new User({ email, password: hashedPassword });
    await newUser.save();

    return res.status(200).json({ message: "Signup successful", user: { email } });
  } catch (err) {
    console.error("Signup Error:", err.message);
    return res.status(500).json({ message: "Signup failed", error: err.message });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const { password: _, ...userWithoutPassword } = user.toObject();
    res.json({ success: true, message: "Login successful", user: userWithoutPassword });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

// Forgot Password
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const token = crypto.randomBytes(20).toString("hex");
    user.resetToken = token;
    user.tokenExpire = Date.now() + 3600000;
    await user.save();

    const resetUrl = `http://localhost:3000/reset-password/${token}`;

    // Brevo setup
    SibApiV3Sdk.ApiClient.instance.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

    const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
    const sendSmtpEmail = {
      to: [{ email: user.email }],
      sender: { name: "Career Assistant", email: "yeswanthyeswanth20@gmail.com" },
subject: "Reset your Career AI password",
      htmlContent: `
        
  <div style="max-width: 600px; margin: auto; padding: 30px; font-family: 'Segoe UI', sans-serif; background: #f9f9fb; border-radius: 10px; border: 1px solid #e0e0e0;">

    <div style="text-align: center; margin-bottom: 25px;">
      <h1 style="color: #2c3e50; margin-bottom: 5px;">🚀 Career Assistant</h1>
      <p style="color: #7f8c8d; font-size: 14px;">Your AI-Powered Career Partner</p>
    </div>

    <div style="background: #ffffff; padding: 25px; border-radius: 8px;">
      <p style="font-size: 16px; color: #2c3e50;">Hi ${user.name || "there"},</p>
      <p style="color: #34495e; font-size: 15px;">
        We received a request to reset your password. Click the button below to create a new one:
      </p>

      <div style="text-align: center; margin: 25px 0;">
        <a href="${resetUrl}" style="background-color: #4a90e2; color: white; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">
          🔐 Reset Password
        </a>
      </div>

      <p style="font-size: 14px; color: #7f8c8d;">
        If you didn’t request this, please ignore this email. The link is valid for 1 hour.
      </p>
    </div>

    <div style="margin-top: 30px; text-align: center;">
      <p style="font-size: 13px; color: #95a5a6;">Follow us for updates:</p>
      <div style="margin: 10px;">
        <a href="https://github.com/yeswanthvuddagiri" style="margin: 0 10px;">
          <img src="https://cdn-icons-png.flaticon.com/512/733/733553.png" width="24" alt="GitHub" />
        </a>
        <a href=" https://linkedin.com/in/yeswanth-vuddagiri-03928b238" style="margin: 0 10px;">
          <img src="https://cdn-icons-png.flaticon.com/512/174/174857.png" width="24" alt="LinkedIn" />
        </a>
      </div>
    </div>

    <div style="margin-top: 25px; text-align: center; font-size: 12px; color: #bdc3c7;">
      <p style="margin: 4px 0;">Need help? Contact us at <a href="mailto:yeswanthvuddagiri20.com" style="color: #4a90e2;">yeswanthvuddagiri20.com</a></p>
      <p style="margin: 4px 0;">© ${new Date().getFullYear()} Career Assistant. All rights reserved.</p>
    </div>
  </div>
`

    };

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    res.json({ message: "Reset link sent via Career Assistant email." });

  } catch (err) {
    console.error("Forgot Password Error:", err.message);
    res.status(500).json({ message: "Something went wrong!" });
  }
});


// Reset Password
app.post("/reset-password/:token", async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  try {
    const user = await User.findOne({
      resetToken: token,
      tokenExpire: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: "Invalid or expired token" });

    const hashed = await bcrypt.hash(password, 10);
    user.password = hashed;
    user.resetToken = undefined;
    user.tokenExpire = undefined;
    await user.save();

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Reset Password Error:", err.message);
    res.status(500).json({ message: "Reset failed" });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
