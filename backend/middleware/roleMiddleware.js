/* Usage: router.get("/x", verifyToken, requireRole("Admin","Teacher"), handler) */
const requireRole = (...roles) => (req, res, next) => {
  const role = String((req.user && req.user.role) || "");
  if (!roles.some((r) => r.toLowerCase() === role.toLowerCase())) {
    return res.status(403).json({ message: "You do not have permission to perform this action." });
  }
  next();
};
module.exports = requireRole;
