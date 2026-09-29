const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ message: "Access Denied. No Token Provided." });
  }

  try {
    // "Bearer <token>" format se actual token extract karna
    const actualToken = token.startsWith("Bearer ") ? token.slice(7, token.length) : token;
    
    const verified = jwt.verify(actualToken, process.env.JWT_SECRET);
    req.user = verified; // Token ka user data request object me attach kar diya
    next(); // Next function/controller par proceed karega
  } catch (err) {
    res.status(400).json({ message: "Invalid or Expired Token." });
  }
};

module.exports = verifyToken;