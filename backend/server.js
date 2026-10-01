const express = require("express");
const { getConnection } = require("./config/db");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const loginRoutes = require("./routes/loginRoutes");
const verifyToken = require("./middleware/authMiddleware");
const studentRoutes = require("./routes/studentRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const schoolRoutes = require("./routes/schoolRoutes");

require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/auth", loginRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api", schoolRoutes);

// Home
app.get("/", (req, res) => {
  res.json({
    message: "Smart Attendance Backend is running!"
  });
});

// Protected test route
app.get("/api/protected", verifyToken, (req, res) => {
  res.json({
    message: "Protected area accessed successfully!",
    user: req.user,
  });
});

// Test database connection
getConnection()
  .then(() => {
    console.log("Database connection ready");
  })
  .catch((e) => {
    console.error("Startup DB error:", e.message);
  });

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});